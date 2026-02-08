import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';

// Hardcoded for now, should ideally come from env or config
// Hardcoded for now, should ideally come from env or config
const INTENT_PACKAGE_ID = process.env.NEXT_PUBLIC_SUI_BRIDGE_PACKAGE_ID || '0xd37320c6f09b433003d383aca5f7069d917caed77a280cb07427c915e051f0e2';
const CLOCK_OBJECT_ID = '0x6';

export interface CreateSuiIntentParams {
    amountFn: number; // Amount in SUI (e.g., 1.5)
    recipientEvm: string; // 0x... (will be validated length 20)
    startOutputAmountWei: string; // e.g. "1000000000000000" (1 ETH)
    minOutputAmountWei: string;
    durationSeconds: number;
}

export function useCreateSuiIntent() {
    const account = useCurrentAccount();
    const suiClient = useSuiClient();
    const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (params: CreateSuiIntentParams) => {
            if (!account) throw new Error('Wallet not connected');

            const tx = new Transaction();

            // 1. Prepare Arguments
            const amountMist = BigInt(Math.floor(params.amountFn * 1_000_000_000));

            // Handle EVM Address (remove 0x, ensure it's bytes)
            let evmAddrClean = params.recipientEvm.startsWith('0x')
                ? params.recipientEvm.slice(2)
                : params.recipientEvm;

            if (evmAddrClean.length !== 40) {
                throw new Error('Invalid EVM address length (must be 20 bytes/40 hex chars)');
            }

            const evmAddrBytes = Uint8Array.from(Buffer.from(evmAddrClean, 'hex'));

            // 2. Split Coin for Payment
            const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(amountMist)]);

            // 3. Call create_intent
            // public fun create_intent(
            //     payment: Coin<SUI>,
            //     recipient_evm: vector<u8>,
            //     start_output_amount: u64,
            //     min_output_amount: u64,
            //     duration: u64,
            //     clock: &Clock,
            //     ctx: &mut TxContext
            // )
            tx.moveCall({
                target: `${INTENT_PACKAGE_ID}::intent::create_intent`,
                arguments: [
                    coin,
                    tx.pure.vector('u8', evmAddrBytes),
                    tx.pure.u64(BigInt(params.startOutputAmountWei)), // Move u64 is large enough for wei if < 18 ETH approx? No, u64 max is ~18.4 ETH equivalent if wei.
                    // WAIT: ETH has 18 decimals. 1 ETH = 10^18. u64 max is ~1.8 * 10^19. 
                    // So u64 can hold up to ~18 ETH. If user wants to bridge more than 18 ETH, this contract design might be limited or expects scaled units. 
                    // However, for this task we assume standard wei usage as per IDL unless specified otherwise.
                    // The contract defined start_output_amount as u64. This is a constraint of Move (no u256 natively in function args usually without custom types or recent upgrades, but u64 is standard).
                    // We will proceed with u64.
                    tx.pure.u64(BigInt(params.minOutputAmountWei)),
                    tx.pure.u64(params.durationSeconds * 1000), // milliseconds in contract? 
                    // "start_time = clock::timestamp_ms(clock)" -> yes, duration should be ms likely, but let's check contract.
                    // Contract says: "duration: u64" and "elapsed >= duration". "elapsed = current_time_ms - start_time".
                    // So duration MUST be in milliseconds.
                    tx.object(CLOCK_OBJECT_ID),
                ],
            });

            // 4. Sign & Execute
            const response = await signAndExecute({
                transaction: tx as any,
            });

            // 5. Wait for effect and events
            const result = await suiClient.waitForTransaction({
                digest: response.digest,
                options: {
                    showEvents: true,
                    showEffects: true
                }
            });

            // Parse IntentCreated event
            // Event type: <package>::intent::IntentCreated
            const eventType = `${INTENT_PACKAGE_ID}::intent::IntentCreated`;
            const intentEvent = result.events?.find(e => e.type === eventType);

            let intentId = '';
            if (intentEvent && intentEvent.parsedJson) {
                const parsed = intentEvent.parsedJson as any;
                intentId = parsed.intent_id;
            }

            return {
                digest: response.digest,
                intentId,
                events: result.events
            };
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['sui-intents'] });
        },
    });
}
