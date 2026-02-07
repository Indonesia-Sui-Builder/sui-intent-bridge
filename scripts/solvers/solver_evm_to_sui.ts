
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
    SOLVER_STATE_ID,
    WORMHOLE_STATE_ID
} from "./utils.ts";
import { parseAbiItem, encodeFunctionData, formatUnits, parseUnits } from "viem";
import { Transaction } from "@mysten/sui/transactions";
import { ethers } from "ethers"; // Only for some bytes utils if needed, but viem covers most.

// ================= CONFIG =================

// Mock Price: 1 SUI = 1 USDC (for demonstration)
// In production, fetch from an oracle (e.g., Pyth/Chainlink)
const MOCK_SUI_PRICE_USDC = 1.0;
const MIN_PROFIT_USDC = 0.01; // Minimum profit to execute

const POLLING_INTERVAL_MS = 5000;

// ABI Definition
const EVENT_ABI = parseAbiItem(
    "event OrderCreated(uint256 indexed orderId, address indexed depositor, uint256 inputAmount, uint256 startOutputAmount, uint256 minOutputAmount, uint256 startTime, uint256 duration, bytes32 recipientSui)"
);

const SETTLE_ORDER_ABI = [
    {
        name: "settleOrder",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [{ name: "encodedVM", type: "bytes" }],
        outputs: []
    }
] as const;

// ================= MAIN =================

async function main() {
    console.log("🚀 Starting Solver (Direction A: EVM -> Sui)...");

    let lastBlock = await evmPublicClient.getBlockNumber();
    console.log(`   Initial Block: ${lastBlock}`);

    // Infinite Polling Loop
    while (true) {
        try {
            const currentBlock = await evmPublicClient.getBlockNumber();

            if (currentBlock > lastBlock) {
                // Fetch events
                const logs = await evmPublicClient.getLogs({
                    address: EVM_INTENT_BRIDGE_ADDRESS,
                    event: EVENT_ABI,
                    fromBlock: lastBlock, // Logic to avoid duplicates might be needed in prod
                    toBlock: currentBlock
                });

                for (const log of logs) {
                    const args = log.args;
                    if (!args) continue;

                    console.log(`\n🟢 New Order Detected! Order ID: ${args.orderId}`);
                    await processOrder(args, log.transactionHash);
                }

                lastBlock = currentBlock + 1n; // Move forward
            }
        } catch (e) {
            console.error("❌ Polling Error:", e);
        }

        await sleep(POLLING_INTERVAL_MS);
    }
}

async function processOrder(args: any, txHash: string) {
    try {
        const { orderId, depositor, inputAmount, startOutputAmount, minOutputAmount, startTime, duration, recipientSui } = args;

        console.log(`   Depositor: ${depositor}`);
        console.log(`   Input (USDC): ${formatUnits(inputAmount, 6)}`);

        // 1. Calculate Required SUI Amount
        const currentTime = BigInt(Math.floor(Date.now() / 1000)); // EVM time is seconds
        const requiredSuiRaw = calculateCurrentPrice(
            startOutputAmount,
            minOutputAmount,
            startTime,
            duration,
            currentTime
        );

        console.log(`   Required SUI: ${formatUnits(requiredSuiRaw, 9)}`);

        // 2. Check Profitability
        // Profit = (InputUSDC) - (RequiredSUI * Price) - Gas
        // Since inputAmount is 6 decimals, RequiredSUI is 9 decimals.
        // Normalize to float for comparison
        const inputUsdcFloat = parseFloat(formatUnits(inputAmount, 6));
        const requiredSuiFloat = parseFloat(formatUnits(requiredSuiRaw, 9));

        const costUsdc = requiredSuiFloat * MOCK_SUI_PRICE_USDC;
        const potentialProfit = inputUsdcFloat - costUsdc;
        // Approximation of gas fees (0.005 SUI + EVM gas). Ignored for simple logic here.

        console.log(`   💰 Profit Check: Input=${inputUsdcFloat}, Cost=${costUsdc}, Profit=${potentialProfit}`);

        if (potentialProfit < MIN_PROFIT_USDC) {
            console.warn("   ⚠️ Not profitable yet. Skipping or waiting...");
            // Real bot would wait and retry later as price decays
            return;
        }

        console.log("   🚀 Executing Order on Sui...");

        // 3. Execute on Sui
        const suiKeypair = await getSuiKeypair();
        const tx = new Transaction();

        const [paymentCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(requiredSuiRaw)]);
        const [feeCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(0)]); // Solver engine requires a fee coin placeholder? 
        // Existing script passed a coin with 0 value as feeCoin? 
        // "const [feeCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(0)]);" in old script.

        // Convert orderId (bigint) to vector<u8> (32 bytes big endian)
        // using ethers or viem toBytes
        let orderIdHex = orderId.toString(16);
        if (orderIdHex.length % 2 !== 0) orderIdHex = '0' + orderIdHex;
        const hexString = orderIdHex.padStart(64, '0');
        const orderIdBytes = new Uint8Array(Buffer.from(hexString, 'hex'));

        tx.moveCall({
            target: `${SUI_PACKAGE_ID}::solver_engine::solve_and_prove`,
            arguments: [
                tx.object(SOLVER_STATE_ID),
                tx.object(WORMHOLE_STATE_ID),
                tx.makeMoveVec({ elements: [paymentCoin] }), // payment_coins: vector<Coin<SUI>>
                feeCoin, // message_fee
                tx.pure.address(recipientSui),
                tx.pure.vector("u8", Array.from(orderIdBytes)), // intent_id
                tx.pure.u64(requiredSuiRaw), // amount_to_send
                tx.pure.vector("u8", Array.from(ethers.getBytes(evmWalletClient.account.address))), // solver_evm_address
                tx.object("0x6") // Clock
            ]
        });

        const res = await suiClient.signAndExecuteTransaction({
            signer: suiKeypair,
            transaction: tx,
            options: { showEffects: true, showEvents: true }
        });

        if (res.effects?.status.status !== "success") {
            throw new Error(`Sui transaction failed: ${res.effects?.status.error}`);
        }
        console.log(`   ✅ Sui Tx Digest: ${res.digest}`);

        // 4. Settlement (Claim on EVM)
        const vaaBytes = await fetchVAA(res.digest, "Sui");

        console.log("   💰 Settling on EVM...");
        const hash = await evmWalletClient.writeContract({
            address: EVM_INTENT_BRIDGE_ADDRESS,
            abi: SETTLE_ORDER_ABI,
            functionName: 'settleOrder',
            args: [`0x${Buffer.from(vaaBytes).toString('hex')}`]
        });

        console.log(`   ⏳ EVM Tx Sent: ${hash}`);
        await evmPublicClient.waitForTransactionReceipt({ hash });
        console.log(`   ✅ EVM Settled!`);

    } catch (e) {
        console.error("   ❌ Error processing order:", e);
    }
}

main().catch(console.error);
