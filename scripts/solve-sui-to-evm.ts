import { ethers } from "ethers";
import { getFullnodeUrl, SuiClient } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import * as dotenv from "dotenv";
import { fromB64 } from "@mysten/sui/utils";
import axios from "axios";

dotenv.config();

// ============ Configuration ============

const EVM_RPC = process.env.EVM_RPC || "https://sepolia.base.org";
const PRIVATE_KEY_EVM = process.env.PRIVATE_KEY_EVM || "";
const EVM_INTENT_VAULT_ADDRESS = process.env.EVM_INTENT_VAULT_ADDRESS || ""; // Updated Contract

const SUI_RPC = process.env.SUI_RPC || getFullnodeUrl("testnet");
const PRIVATE_KEY_SUI = process.env.PRIVATE_KEY_SUI || "";
const PACKAGE_ID_SUI = process.env.PACKAGE_ID_SUI || "";
const SOLVER_CONFIG_ID = process.env.SOLVER_CONFIG_ID || "";
const WORMHOLE_STATE_ID = process.env.WORMHOLE_STATE_ID || "0x31358d198147da50db32eda2562951d53973a0c0ad5ed738e9b17d88b213d790";

const WORMHOLE_API_URL = "https://api.testnet.wormholescan.io";
const SUI_TO_ETH_RATE = 0.0001; // Mock rate

// ============ Clients ============

const evmProvider = new ethers.JsonRpcProvider(EVM_RPC);
const evmWallet = new ethers.Wallet(PRIVATE_KEY_EVM, evmProvider);
const suiClient = new SuiClient({ url: SUI_RPC });

// ABI for IntentVault
const INTENT_VAULT_ABI = [
    "function fulfillOrder(bytes32 intentId, address payable recipient, bytes32 solverSuiAddress, uint256 amount) external payable returns (uint64 sequence)",
    "function wormhole() view returns (address)",
    "function messageFee() view returns (uint256)" // On Wormhole contract, but usually checked via bridge
];

// We need ABI for Wormhole to check fee if IntentVault doesn't expose it directly (mock assumed it did via delegate or similar, but realistically need ICoreBridge)
// Actually in our IntentVault we call wormhole.messageFee() inside. The caller just sends value. 
// But caller needs to know WHAT value.
// Usually we query the Wormhole contract for the fee.
const WORMHOLE_ABI = [
    "function messageFee() view returns (uint256)"
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

function vectorToEvmAddress(vector: number[]): string {
    const bytes = new Uint8Array(vector);
    return "0x" + Buffer.from(bytes).toString("hex");
}

async function getWormholeFee(wormholeAddress: string): Promise<bigint> {
    try {
        const wormhole = new ethers.Contract(wormholeAddress, WORMHOLE_ABI, evmProvider);
        return await wormhole.messageFee();
    } catch (e) {
        console.warn("⚠️ Failed to fetch Wormhole fee, defaulting to 0:", e.message);
        return 0n;
    }
}

// ============ Main Logic ============

// 1. Listen for IntentCreated OR Process Specific ID
async function main() {
    console.log("🚀 Starting Sui -> EVM Solver (VAA Verified)...");

    if (!PRIVATE_KEY_EVM || !PRIVATE_KEY_SUI || !EVM_INTENT_VAULT_ADDRESS) {
        throw new Error("Missing env vars");
    }

    const suiKeypair = await initializeSuiKeypair();
    const solverSuiAddress = suiKeypair.getPublicKey().toSuiAddress();
    console.log(`Solver Sui Address: ${solverSuiAddress}`);

    const targetIntentId = process.argv[2];
    if (targetIntentId) {
        console.log(`\n🎯 Processing specific Intent ID: ${targetIntentId}`);
        await processSpecificIntent(targetIntentId, suiKeypair, solverSuiAddress);
        return;
    }

    // Subscribe to Sui Events
    console.log(`\n🎧 Listening for IntentCreated events on ${PACKAGE_ID_SUI}...`);

    const unsubscribe = await suiClient.subscribeEvent({
        filter: { MoveEventType: `${PACKAGE_ID_SUI}::intent::IntentCreated` },
        onMessage: async (event) => {
            console.log("\n🔔 Event detected!");
            await processIntentEvent(event, suiKeypair, solverSuiAddress);
        }
    });

    // Keep alive
    await new Promise(() => { });
}

async function processSpecificIntent(intentId: string, suiKeypair: Ed25519Keypair, solverSuiAddress: string) {
    // Fetch object fields
    const obj = await suiClient.getObject({
        id: intentId,
        options: { showContent: true }
    });

    if (obj.error) throw new Error(`Object not found: ${obj.error}`);
    const fields = (obj.data?.content as any)?.fields;

    if (!fields) throw new Error("No fields found on object");

    const recipientEvmVec = fields.recipient_evm; // vector<u8>
    const recipientEvm = vectorToEvmAddress(recipientEvmVec); // Need to handle Uint8Array or array
    const ethAmountExpected = BigInt(fields.amount_expected); // Note: field name in Move is amount_expected? 
    // Intent struct: amount_expected: u64.

    console.log(`   Intent ID: ${intentId}`);
    console.log(`   Recipient: ${recipientEvm}`);
    console.log(`   Amount: ${ethers.formatEther(ethAmountExpected)} ETH`);

    await processLogic(intentId, recipientEvm, ethAmountExpected, suiKeypair, solverSuiAddress);
}

async function processIntentEvent(event: any, suiKeypair: Ed25519Keypair, solverSuiAddress: string) {
    const data = event.parsedJson;
    const intentId = data.intent_id;
    const recipientEvm = vectorToEvmAddress(data.recipient_evm);
    const ethAmountExpected = BigInt(data.eth_amount_expected);

    await processLogic(intentId, recipientEvm, ethAmountExpected, suiKeypair, solverSuiAddress);
}

async function processLogic(intentId: string, recipientEvm: string, ethAmountExpected: bigint, suiKeypair: Ed25519Keypair, solverSuiAddress: string) {
    try {
        // 2. Fulfill on EVM
        console.log("\n⚡ Fulfilling on EVM (Base Sepolia)...");
        const vault = new ethers.Contract(EVM_INTENT_VAULT_ADDRESS, INTENT_VAULT_ABI, evmWallet);

        // Get Wormhole Fee
        // Assuming we know Wormhole address or getter
        // For Hackathon, hardcode or fetch. Let's assume the Vault exposes a way or we know the wormhole address.
        // Base Sepolia Wormhole Core Bridge
        const WORMHOLE_ADDRESS = "0x79A1027a6A159502049F10906D333EC57E95F083";

        const fee = await getWormholeFee(WORMHOLE_ADDRESS);
        console.log(`\n💰 Wormhole Message Fee: ${fee.toString()}`);

        const balance = await evmProvider.getBalance(evmWallet.address);
        console.log(`💳 Solver Balance: ${ethers.formatEther(balance)} ETH`);

        const totalValue = ethAmountExpected + fee;
        console.log(`💸 Total Value Attempted: ${ethers.formatEther(totalValue)} ETH`);

        if (balance < totalValue) {
            throw new Error("Insufficient Balance for Fulfillment + Fee");
        }

        // Convert intentId (hex string from sui) to bytes32
        // Sui ID is 0x... (address). Ethers needs bytes32.
        const intentIdBytes32 = ethers.zeroPadValue(intentId, 32);

        // Convert solver Sui address to bytes32
        // Sui address is 32 bytes hex.
        const solverSuiBytes32 = ethers.zeroPadValue(solverSuiAddress, 32);

        const tx = await vault.fulfillOrder(
            intentIdBytes32,
            recipientEvm,
            solverSuiBytes32,
            ethAmountExpected, // The actual amount to user
            {
                value: totalValue,
                gasLimit: 3000000
            }
        );

        console.log(`   ⏳ EVM Tx Sent: ${tx.hash}`);
        const receipt = await tx.wait();
        console.log(`   ✅ EVM Tx Confirmed!`);

        // 3. Get VAA
        console.log("\nSearch for Wormhole Sequence...");
        // Log[0] might not be it. We need to find the Log emitted by Wormhole.
        // Or we can assume the return value of the function was the sequence (not accessible in receipt easily).
        // Best way: Look for Wormhole 'LogMessagePublished' topic.

        // Simplified: Fetch VAA by Tx Hash from Wormhole Scan (it might take a moment)
        console.log("   ⏳ Waiting for VAA generation...");
        let vaaBytes: Uint8Array | null = null;
        let attempts = 0;

        // Base Sepolia Chain ID = 10004 (Wormhole)
        const EMITTER_CHAIN = 10004;
        const EMITTER_ADDRESS = EVM_INTENT_VAULT_ADDRESS.slice(2); // Remove 0x

        // Wait a bit for Guardian to pick it up
        await new Promise(r => setTimeout(r, 5000));

        // We need the Sequence number to query specifically, OR we query by TxHash if supported.
        // Let's try to parse sequence from logs. 
        // Wormhole LogMessagePublished topic: 0x6eb224fb001ed210e379b335e35efe88672a8ce935d981a6896b27ffdf52a3b2
        const WORMHOLE_TOPIC = "0x6eb224fb001ed210e379b335e35efe88672a8ce935d981a6896b27ffdf52a3b2";
        const log = receipt.logs.find((l: any) => l.topics[0] === WORMHOLE_TOPIC);

        if (!log) throw new Error("Wormhole log not found in receipt");

        // Sequence is the 2nd argument (indexed? no, see wormhole ABI). 
        // Wormhole: event LogMessagePublished(address indexed sender, uint64 sequence, uint32 nonce, bytes payload, uint8 consistencyLevel);
        // sender is indexed (topic 1). sequence is data.
        // Just Use Wormholescan API with TxHash? 
        // API: /v1/signed_vaa_by_tx_hash/:tx_hash NOT always standard.
        // Better: /v1/signed_vaa/:chain/:emitter/:seq

        // Parsing sequence from log data (non-indexed):
        // sender (indexed)
        // sequence (uint64) -> first 32 bytes of data?
        // Actually it's cleaner to use the interface to decode.
        const iface = new ethers.Interface(["event LogMessagePublished(address indexed sender, uint64 sequence, uint32 nonce, bytes payload, uint8 consistencyLevel)"]);
        const parsedLog = iface.parseLog({ topics: [...log.topics], data: log.data });
        const sequence = parsedLog?.args.sequence;
        console.log(`   Sequence: ${sequence}`);

        while (!vaaBytes && attempts < 30) {
            try {
                const url = `${WORMHOLE_API_URL}/v1/signed_vaa/${EMITTER_CHAIN}/${EMITTER_ADDRESS}/${sequence}`;
                const res = await axios.get(url);
                if (res.data.vaaBytes) {
                    vaaBytes = ethers.getBytes("0x" + res.data.vaaBytes);
                }
            } catch (e) {
                process.stdout.write(".");
            }
            await new Promise(r => setTimeout(r, 2000));
            attempts++;
        }

        if (!vaaBytes) throw new Error("VAA Timeout");
        console.log(`\n   ✅ VAA Fetched!`);

        // 4. Claim on Sui
        console.log("\n💰 Claiming on Sui...");
        const txSui = new Transaction();
        txSui.moveCall({
            target: `${PACKAGE_ID_SUI}::intent::claim_intent`,
            arguments: [
                txSui.object(intentId),
                txSui.object(SOLVER_CONFIG_ID),
                txSui.object(WORMHOLE_STATE_ID),
                txSui.object("0x6"), // Clock
                txSui.pure.vector("u8", Array.from(vaaBytes))
            ]
        });

        const resSui = await suiClient.signAndExecuteTransaction({
            signer: suiKeypair,
            transaction: txSui,
            options: { showEffects: true }
        });

        console.log(`   ✅ Sui Claim Tx: ${resSui.digest}`);
        console.log("🎉 BRIDGE COMPLETE!");

    } catch (e) {
        console.error("❌ Error processing:", e);
    }
}

main().catch(console.error);
