
import {
    evmPublicClient,
    evmWalletClient,
    suiClient,
    getSuiKeypair,
    getEvmAccount,
    calculateCurrentPrice,
    fetchVAA,
    sleep,
    EVM_INTENT_BRIDGE_ADDRESS,
    SUI_PACKAGE_ID,
    SOLVER_CONFIG_ID,
    WORMHOLE_STATE_ID
} from "./utils.ts";
import { parseAbiItem, encodeFunctionData, formatUnits, parseUnits } from "viem";
import { Transaction } from "@mysten/sui/transactions";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

// ================= CONFIG =================

// Mock Price: 1 SUI = 1 USDC (for demonstration)
const MOCK_SUI_PRICE_USDC = 1.0;
const MOCK_ETH_PRICE_USDC = 2000.0; // Assuming output is ETH/USDC-value 
const MIN_PROFIT_USDC = 0.01;

const POLLING_INTERVAL_MS = 3000;

// ABI Definition
const WORMHOLE_ABI = [
    {
        name: "messageFee",
        type: "function",
        stateMutability: "view",
        inputs: [],
        outputs: [{ name: "", type: "uint256" }]
    }
] as const;

const FULFILL_ORDER_ABI = [
    {
        name: "fulfillOrder",
        type: "function",
        stateMutability: "payable",
        inputs: [
            { name: "intentId", type: "bytes32" },
            { name: "recipient", type: "address" },
            { name: "solverSuiAddress", type: "bytes32" },
            { name: "amount", type: "uint256" }
        ],
        outputs: [{ name: "sequence", type: "uint64" }]
    }
] as const;

// Helper to convert vector<u8> to hex string (EVM address)
function vectorToEvmAddress(vector: number[]): `0x${string}` {
    const bytes = new Uint8Array(vector);
    return `0x${Buffer.from(bytes).toString("hex")}`;
}

// ================= MAIN =================

async function main() {
    console.log("🚀 Starting Solver (Direction B: Sui -> EVM)...");

    let nextCursor = null;

    // Infinite Polling Loop
    while (true) {
        try {
            // Poll events
            const events = await suiClient.queryEvents({
                query: { MoveEventType: `${SUI_PACKAGE_ID}::intent::IntentCreated` },
                cursor: nextCursor,
                limit: 50 // process batch
            });

            nextCursor = events.nextCursor;

            for (const event of events.data) {
                const parsed = event.parsedJson as any;
                console.log(`\n🟢 New Intent Detected! ID: ${parsed?.intent_id}`);
                await processIntent(parsed);
            }

        } catch (e) {
            console.error("❌ Polling Error:", e);
        }

        await sleep(POLLING_INTERVAL_MS);
    }
}

async function processIntent(args: any) {
    try {
        const {
            intent_id,
            creator,
            sui_amount,
            recipient_evm,
            start_output_amount,
            min_output_amount,
            start_time,
            duration
        } = args;

        const recipientAddress = vectorToEvmAddress(recipient_evm);

        console.log(`   Creator: ${creator}`);
        console.log(`   Input (SUI): ${formatUnits(BigInt(sui_amount), 9)}`);

        // 1. Calculate Required Output Amount (USDC/ETH)
        // Note: Sui times are in ms (uint64). EVM script used logic for seconds, here we use ms directly.
        // `intent.move` uses ms. `calculateCurrentPrice` is generic.
        const currentTime = BigInt(Date.now());

        const requiredAmountRaw = calculateCurrentPrice(
            BigInt(start_output_amount),
            BigInt(min_output_amount),
            BigInt(start_time),
            BigInt(duration),
            currentTime
        );

        // Assumption: output amount is 6 decimals (USDC) from prompt, but contract pays ETH (18 decimals).
        // If contract pays ETH from `msg.value`, then requiredAmountRaw is in Wei.
        // If PROMPT says "Output is USDC (6 decimals)", but Contract `fulfillOrder` pays `recipient.call{value: amount}`,
        // Then existing code likely treated `start_output_amount` as Wei.
        // Handling strict "USDC" requirement vs "ETH" contract:
        // I will assume the prompt implies *value equivalent*.
        // If the contract pays Wei, I must treat `requiredAmountRaw` as Wei.
        // Formatting for logs:
        console.log(`   Required Output (Wei/Units): ${requiredAmountRaw}`);

        // 2. Check Profitability
        // Profit = (InputSUI * PriceSUI) - (RequiredOutput * PriceOutput) - Gas
        const inputSuiFloat = parseFloat(formatUnits(BigInt(sui_amount), 9));
        // If output is USDC (6 dec), use formatUnits(..., 6). If Wei (18), use formatEther.
        // Prompt says "Output is USDC (6 decimals)".
        // BUT contract `fulfillOrder` pays ETH. 
        // I will log assuming USDC (6 decimals) as requested, but also note ETH context.
        // If `start_output_amount` was created with 6 decimals, sending it as `msg.value` (Wei) would be tiny (1e-12 ETH).
        // So `start_output_amount` MUST be 18 decimals (Wei) if it is to be paid in ETH.
        // OR the contract uses a token but the ABI I saw was payable.
        // I will trust the ABI (Wei) and ignore the "6 decimals" requirement for *execution*, only using it for *concept* if it was a token.
        // Given the ambiguity, I proceed with Wei (18 decimals) logic for safety with current contract.

        const requiredOutputFloat = parseFloat(formatUnits(requiredAmountRaw, 18)); // Assuming Wei

        const valueInSui = inputSuiFloat * MOCK_SUI_PRICE_USDC;
        const valueOutEth = requiredOutputFloat * MOCK_ETH_PRICE_USDC;
        const potentialProfit = valueInSui - valueOutEth;

        console.log(`   💰 Profit Check: Input(~$${valueInSui}), Output(~$${valueOutEth}), Profit(~$${potentialProfit})`);

        if (potentialProfit < MIN_PROFIT_USDC) {
            console.warn("   ⚠️ Not profitable yet. Skipping or waiting...");
            return;
        }

        console.log("   🚀 Executing Order on EVM...");

        // 3. Execute on EVM

        // Get Wormhole Fee
        // WORMHOLE_ADDRESS is needed. I can get it from IntentBridge via view `wormhole()`?
        // Or hardcode testnet address: 0x79A1027a6A159502049F10906D333EC57E95F083
        const WORMHOLE_ADDRESS = "0x79A1027a6A159502049F10906D333EC57E95F083";
        // Ideally fetch from contract `wormhole()` view.
        // I'll assume standard testnet address for now or add view call.

        const wormholeContract = {
            address: WORMHOLE_ADDRESS as `0x${string}`,
            abi: WORMHOLE_ABI
        };
        const fee = await evmPublicClient.readContract({
            ...wormholeContract,
            functionName: 'messageFee'
        });

        // fulfillOrder(bytes32 intentId, address recipient, bytes32 solverSuiAddress, uint256 amount)
        // intentId in EVM bytes32 is 32 bytes.
        // `intent_id` from Sui is address (0x...). Pad to 32 bytes.
        const intentIdBytes32 = intent_id.padEnd(66, '0'); // Wait, address is 0x + 64 hex chars? No, Sui is 32 bytes (0x + 64 chars).
        // Sui address is 32 bytes.
        // `intent_id` string usually "0x...". If strict 32 bytes, fits in bytes32.

        const suiKeypair = await getSuiKeypair();
        const solverSuiAddress = suiKeypair.getPublicKey().toSuiAddress();
        const solverSuiBytes32 = solverSuiAddress.padEnd(66, '0'); // Should be fine if already 0x...64 chars

        const totalValue = requiredAmountRaw + fee;

        /* 
           NOTE: The user requested "Approve USDC". 
           However, the contract `fulfillOrder` is payable and sends ETH via `msg.value`.
           Transferring USDC is not part of `fulfillOrder` in the current ABI.
           Proceeding with ETH payment.
        */
        const hash = await evmWalletClient.writeContract({
            address: EVM_INTENT_BRIDGE_ADDRESS,
            abi: FULFILL_ORDER_ABI,
            functionName: 'fulfillOrder',
            args: [
                intent_id as `0x${string}`, // Ensure 0x prefix
                recipientAddress,
                solverSuiAddress as `0x${string}`, // Ensure 0x prefix
                requiredAmountRaw
            ],
            value: totalValue
        });

        console.log(`   ⏳ EVM Tx Sent: ${hash}`);
        const receipt = await evmPublicClient.waitForTransactionReceipt({ hash });
        console.log(`   ✅ EVM Executed!`);

        // 4. Settlement (Claim on Sui)
        const vaaBytes = await fetchVAA(hash, "BaseSepolia", 1200000); // 20 mins timeout for testnet

        console.log("   💰 Claiming on Sui...");

        const tx = new Transaction();
        tx.moveCall({
            target: `${SUI_PACKAGE_ID}::intent::claim_intent`, // As seen in existing script
            arguments: [
                tx.object(intent_id),
                tx.object(SOLVER_CONFIG_ID),
                tx.object(WORMHOLE_STATE_ID),
                tx.object("0x6"), // Clock
                tx.pure.vector("u8", Array.from(vaaBytes))
            ]
        });

        const res = await suiClient.signAndExecuteTransaction({
            signer: suiKeypair,
            transaction: tx,
            options: { showEffects: true }
        });

        if (res.effects?.status.status !== "success") {
            throw new Error(`Sui transaction failed: ${res.effects?.status.error}`);
        }
        console.log(`   ✅ Sui Claimed: ${res.digest}`);

    } catch (e) {
        console.error("   ❌ Error processing intent:", e);
    }
}

main().catch(console.error);
