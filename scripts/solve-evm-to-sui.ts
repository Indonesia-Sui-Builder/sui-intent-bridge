import { ethers } from "ethers";
import { getFullnodeUrl, SuiClient } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import * as dotenv from "dotenv";
import { fromB64 } from "@mysten/sui/utils";
import { wormhole, serialize } from "@wormhole-foundation/sdk";
import evm from "@wormhole-foundation/sdk/evm";
import sui from "@wormhole-foundation/sdk/sui";

dotenv.config();

// ============ Configuration ============

const EVM_RPC = process.env.EVM_RPC || "https://sepolia.base.org";
const PRIVATE_KEY_EVM = process.env.PRIVATE_KEY_EVM || "";
const EVM_INTENT_VAULT_ADDRESS = process.env.EVM_INTENT_VAULT_ADDRESS || "";

const SUI_RPC = process.env.SUI_RPC || getFullnodeUrl("testnet");
const PRIVATE_KEY_SUI = process.env.PRIVATE_KEY_SUI || "";
const SUI_PACKAGE_ID = process.env.SUI_PACKAGE_ID || "";
const SOLVER_STATE_ID = process.env.SOLVER_STATE_ID || "";
const WORMHOLE_STATE_ID = process.env.WORMHOLE_STATE_ID || "";

const evmProvider = new ethers.JsonRpcProvider(EVM_RPC);
const evmWallet = new ethers.Wallet(PRIVATE_KEY_EVM, evmProvider);
const suiClient = new SuiClient({ url: SUI_RPC });

// ABI for IntentVault
const INTENT_VAULT_ABI = [
    "function createOrder(uint256 amount, bytes32 recipientSui) external",
    "function settleOrder(bytes calldata encodedVM) external",
    "event OrderCreated(uint256 indexed orderId, address indexed depositor, uint256 amount, bytes32 recipientSui)",
    "event OrderSettled(uint256 indexed orderId, address indexed solver, bytes32 vaaHash)"
];

// ============ Helper Functions ============

async function initializeSuiKeypair(): Promise<Ed25519Keypair> {
    if (PRIVATE_KEY_SUI.startsWith("suiprivkey")) {
        const { decodeSuiPrivateKey } = await import("@mysten/sui/cryptography");
        const { secretKey } = decodeSuiPrivateKey(PRIVATE_KEY_SUI);
        return Ed25519Keypair.fromSecretKey(secretKey);
    } else {
        try {
            const raw = fromB64(PRIVATE_KEY_SUI);
            return Ed25519Keypair.fromSecretKey(raw.slice(1));
        } catch {
            return Ed25519Keypair.fromSecretKey(Buffer.from(PRIVATE_KEY_SUI, "base64"));
        }
    }
}

// ============ Main Logic ============

async function main() {
    console.log("🚀 Starting EVM -> Sui Solver...");

    if (!PRIVATE_KEY_EVM || !PRIVATE_KEY_SUI || !EVM_INTENT_VAULT_ADDRESS || !SOLVER_STATE_ID) {
        throw new Error("Missing env vars (Check SOLVER_STATE_ID also)");
    }

    const suiKeypair = await initializeSuiKeypair();
    const solverSuiAddress = suiKeypair.getPublicKey().toSuiAddress();
    console.log(`Solver Sui Address: ${solverSuiAddress}`);
    console.log(`Listening to EVM Vault: ${EVM_INTENT_VAULT_ADDRESS}`);

    const vault = new ethers.Contract(EVM_INTENT_VAULT_ADDRESS, INTENT_VAULT_ABI, evmProvider);

    const targetOrderId = process.argv[2];
    if (targetOrderId) {
        console.log(`\n🎯 Processing SPECIFIC Order ID: ${targetOrderId}`);
        // Fetch order details from events (by filtering past events)
        console.log("   Fetching past events to get order details...");

        const filter = vault.filters.OrderCreated(targetOrderId);
        const currentBlock = await evmProvider.getBlockNumber();
        const fromBlock = currentBlock - 5000;
        const events = await vault.queryFilter(filter, fromBlock);

        if (events.length === 0) {
            throw new Error(`Order ${targetOrderId} not found in logs.`);
        }

        const event = events[0] as any;
        const { orderId, depositor, amount, recipientSui } = event.args;

        console.log(`   Found Order!`);
        console.log(`   Depositor: ${depositor}`);
        console.log(`   Amount: ${ethers.formatUnits(amount, 6)} USDC (Mock)`);
        console.log(`   Recipient Sui: ${recipientSui}`);

        await processOrder(orderId, amount, recipientSui, suiKeypair);
        return;
    }

    // Listen for events (Fallback)
    console.log(`\n🎧 Listening for OrderCreated events...`);
    vault.on("OrderCreated", async (orderId, depositor, amount, recipientSui, event) => {
        console.log(`\n🔔 Event Detected! Order ID: ${orderId}`);
        console.log(`   Depositor: ${depositor}`);
        console.log(`   Amount: ${ethers.formatUnits(amount, 6)} USDC (Mock)`);
        console.log(`   Recipient Sui: ${recipientSui}`);

        try {
            await processOrder(orderId, amount, recipientSui, suiKeypair);
        } catch (e: any) {
            console.error("❌ Error processing order:", e);
        }
    });

    console.log("   Waiting for events...");

    // Keep process alive
    await new Promise(() => { });
}

async function processOrder(orderId: bigint, amount: bigint, recipientSui: string, suiKeypair: Ed25519Keypair) {
    // 1. Fulfill on Sui
    console.log("\n⚡ Fulfilling on Sui...");

    // Convert recipientSui (bytes32) to Sui address
    const recipientAddress = recipientSui;

    // Order ID to bytes (vector<u8>) - 32 bytes Big Endian
    const orderIdHex = ethers.toBeHex(orderId, 32);
    const orderIdBytes = ethers.getBytes(orderIdHex);

    const tx = new Transaction();

    // Scale amount: USDC (6 decimals) -> SUI (9 decimals)
    // 1 raw USDC unit = 1000 raw SUI units
    const amountToTransfer = Number(amount) * 1000;

    const [paymentCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(amountToTransfer)]);
    const [feeCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(0)]);

    tx.moveCall({
        target: `${SUI_PACKAGE_ID}::solver_engine::solve_and_prove`,
        arguments: [
            tx.object(SOLVER_STATE_ID),
            tx.object(WORMHOLE_STATE_ID),
            paymentCoin,
            feeCoin,
            tx.pure.address(recipientAddress),
            tx.pure.vector("u8", Array.from(orderIdBytes)),
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

    console.log(`   ✅ Sui Fulfillment Tx: ${res.digest}`);

    // 2. Fetch VAA
    console.log("\n🔍 Initializing Wormhole SDK for VAA retrieval...");
    const wh = await wormhole("Testnet", [evm, sui]);
    const chain = wh.getChain("Sui");

    console.log("   Parsing transaction for Wormhole messages...");
    // Wait for indexer to catch up
    await new Promise(r => setTimeout(r, 5000));
    let messages = [];
    try {
        messages = await chain.parseTransaction(res.digest);
    } catch (e) {
        console.log("   Retrying parseTransaction after delay...");
        await new Promise(r => setTimeout(r, 5000));
        messages = await chain.parseTransaction(res.digest);
    }

    if (messages.length === 0) throw new Error("No Wormhole messages found!");

    const message = messages[0];
    console.log(`   Found Message: Sequence ${message.sequence}`);
    console.log("   ⏳ Waiting for Signed VAA...");

    const vaa = await wh.getVaa(message, "Uint8Array", 600000); // 10 min
    if (!vaa) throw new Error("VAA retrieval timed out");

    console.log(`   ✅ VAA Fetched Successfully!`);
    const vaaBytes = serialize(vaa);

    // 3. Settle on EVM
    console.log("\n💰 Settling on EVM...");
    const vault = new ethers.Contract(EVM_INTENT_VAULT_ADDRESS, INTENT_VAULT_ABI, evmWallet);
    const txEvm = await vault.settleOrder(vaaBytes);
    console.log(`   ⏳ EVM Settle Tx: ${txEvm.hash}`);
    await txEvm.wait();
    console.log(`   ✅ EVM Order Settled!`);
    console.log("🎉 REVERSE BRIDGE COMPLETE!");
}

main().catch(console.error);
