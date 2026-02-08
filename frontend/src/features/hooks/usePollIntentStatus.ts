
import { useQuery } from '@tanstack/react-query';
import { readContract } from '@wagmi/core';
import { useEffect } from 'react';
import { useIntentHistory, IntentTransaction, IntentStatus } from './useIntentHistory';
import { useConfig } from 'wagmi';
import { useSuiClient } from '@mysten/dapp-kit';

// Re-using ABI from useCreateEvmIntent or defining here if not shared.
// Ideally should be in @/abis/intentVaultAbi
const INTENT_BRIDGE_ABI = [
    {
        "inputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
        "name": "orders",
        "outputs": [
            { "internalType": "address", "name": "depositor", "type": "address" },
            { "internalType": "uint256", "name": "inputAmount", "type": "uint256" },
            { "internalType": "bytes32", "name": "recipientSui", "type": "bytes32" },
            { "internalType": "uint256", "name": "startOutputAmount", "type": "uint256" },
            { "internalType": "uint256", "name": "minOutputAmount", "type": "uint256" },
            { "internalType": "uint256", "name": "startTime", "type": "uint256" },
            { "internalType": "uint256", "name": "duration", "type": "uint256" },
            { "internalType": "uint8", "name": "status", "type": "uint8" }
        ],
        "stateMutability": "view",
        "type": "function"
    }
] as const;

const BRIDGE_ADDRESS = process.env.NEXT_PUBLIC_EVM_BRIDGE_ADDRESS || '0xc7ECA6bb572aB9BFBa36F503D7c6c64b9fcFf2B4';

// Hardcoded package ID (same as useCreateSuiIntent)
const SUI_PACKAGE_ID = process.env.NEXT_PUBLIC_SUI_BRIDGE_PACKAGE_ID || '0xd37320c6f09b433003d383aca5f7069d917caed77a280cb07427c915e051f0e2';

export function usePollIntentStatus(transaction: IntentTransaction) {
    const { updateTransactionStatus } = useIntentHistory();
    const wagmiConfig = useConfig();
    const suiClient = useSuiClient();

    const fetchStatus = async () => {
        if (transaction.type === 'EVM_TO_SUI') {
            try {
                const result = await readContract(wagmiConfig, {
                    address: BRIDGE_ADDRESS,
                    abi: INTENT_BRIDGE_ABI,
                    functionName: 'orders',
                    args: [BigInt(transaction.orderId)],
                });
                return { type: 'EVM', data: result };
            } catch (error) {
                console.error('Error polling EVM order status:', error);
                return null;
            }
        } else if (transaction.type === 'SUI_TO_EVM') {
            try {
                // Check if Object Exists
                const objectInfo = await suiClient.getObject({
                    id: transaction.orderId,
                    options: { showOwner: true }
                });

                // If error or data is null/undefined, it might be deleted
                if (objectInfo.error && objectInfo.error.code === 'deleted') {
                    return { type: 'SUI', status: 'SETTLED' };
                }

                // Double check deletion via error object structure or simply availability
                if (!objectInfo.data) {
                    return { type: 'SUI', status: 'SETTLED' };
                }

                return { type: 'SUI', status: 'PENDING' };

            } catch (error: any) {
                // If specifically "deleted" error
                if (error.message?.includes('deleted') || error.code === 'deleted') {
                    return { type: 'SUI', status: 'SETTLED' };
                }
                // If not found, assume settled (claimed)
                if (error.message?.includes('not found')) {
                    return { type: 'SUI', status: 'SETTLED' };
                }
                console.error('Error polling Sui intent status:', error);
                return null;
            }
        }
        return null;
    };

    const { data } = useQuery({
        queryKey: ['intentStatus', transaction.orderId],
        queryFn: fetchStatus,
        // Poll if Pending
        enabled: transaction.status === 'PENDING',
        refetchInterval: (query) => {
            const result = query.state.data;
            if (!result) return 3000;
            if (transaction.status !== 'PENDING') return false;

            if (result.type === 'EVM') {
                // @ts-ignore
                const status = result.data?.[7];
                if (status === 1 || status === 2) return false;
            }
            if (result.type === 'SUI') {
                if (result.status === 'SETTLED') return false;
            }
            return 3000;
        },
    });

    useEffect(() => {
        const checkStatusAndEvents = async () => {
            if (!data) return;

            let newStatus: IntentStatus | null = null;
            let destTxHash: string | undefined = undefined;

            // EVM -> SUI Logic
            if (data.type === 'EVM') {
                const rawStatus = (data.data as any)[7];
                if (rawStatus === 1) {
                    newStatus = 'SETTLED';
                    // Fetch Destination Hash logic (existing)
                    try {
                        const eventType = `${SUI_PACKAGE_ID}::solver_engine::MessagePublished`;
                        console.log(`Polling Sui Events for Order ${transaction.orderId}. Type: ${eventType}`);

                        const events = await suiClient.queryEvents({
                            query: { MoveEventType: eventType },
                            limit: 50,
                            order: 'descending'
                        });

                        console.log(`Fetched ${events.data.length} events from Sui.`);

                        const targetOrderId = BigInt(transaction.orderId);
                        for (const event of events.data) {
                            const parsed = event.parsedJson as any;
                            if (parsed && parsed.intent_id) {
                                const bytes = parsed.intent_id as number[];
                                let hex = '0x' + bytes.map(b => b.toString(16).padStart(2, '0')).join('');
                                const eventOrderId = BigInt(hex);

                                console.log(`Checking Event ${event.id.txDigest}: EventOrderID=${eventOrderId}, Target=${targetOrderId}`);

                                if (eventOrderId === targetOrderId) {
                                    destTxHash = event.id.txDigest;
                                    console.log(`Found matching Sui Tx: ${destTxHash}`);
                                    break;
                                }
                            }
                        }
                    } catch (e) { console.error("Failed to fetch/parse Sui events:", e); }
                }
                if (rawStatus === 2) newStatus = 'FAILED';
            }

            // SUI -> EVM Logic
            if (data.type === 'SUI') {
                if (data.status === 'SETTLED') {
                    newStatus = 'SETTLED';
                    // TODO: Fetch EVM Destination Hash?
                    // Harder to find without event, but for now just status.
                }
            }

            if (newStatus && (newStatus !== transaction.status || (destTxHash && !transaction.destTxHash))) {
                updateTransactionStatus(transaction.orderId, newStatus, destTxHash);
            }
        };

        checkStatusAndEvents();
    }, [data, transaction.status, transaction.orderId, updateTransactionStatus, transaction.destTxHash, suiClient, transaction.type]);

    return data;
}
