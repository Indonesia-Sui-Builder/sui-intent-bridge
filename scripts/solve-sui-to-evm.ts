import { ethers } from "ethers";
import { getFullnodeUrl, SuiClient } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import * as dotenv from "dotenv";
import { fromB64 } from "@mysten/sui/utils";
import axios from "axios";
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
const SOLVER_CONFIG_ID = process.env.SOLVER_CONFIG_ID || "";
const WORMHOLE_STATE_ID = process.env.WORMHOLE_STATE_ID || "0x31358d198147da50db32eda2562951d53973a0c0ad5ed738e9b17d88b213d790";

const evmProvider = new ethers.JsonRpcProvider(EVM_RPC);
const evmWallet = new ethers.Wallet(PRIVATE_KEY_EVM, evmProvider);
const suiClient = new SuiClient({ url: SUI_RPC });

// ABI for IntentVault
const INTENT_VAULT_ABI = [
    "function fulfillOrder(bytes32 intentId, address payable recipient, bytes32 solverSuiAddress, uint256 amount) external payable returns (uint64 sequence)",
    "function wormhole() view returns (address)",
    "function messageFee() view returns (uint256)"
];

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
    } catch (e: any) {
        console.warn("⚠️ Failed to fetch Wormhole fee, defaulting to 0:", e.message);
        return 0n;
    }
}

// ============ Main Logic ============

async function main() {
    console.log("🚀 Starting Sui -> EVM Solver (Wormhole SDK Integrated)...");

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

    console.log(`\n🎧 Listening for IntentCreated events on ${SUI_PACKAGE_ID}...`);

    await suiClient.subscribeEvent({
        filter: { MoveEventType: `${SUI_PACKAGE_ID}::intent::IntentCreated` },
        onMessage: async (event) => {
            console.log("\n🔔 Event detected!");
            await processIntentEvent(event, suiKeypair, solverSuiAddress);
        }
    });

    await new Promise(() => { });
}

async function processSpecificIntent(intentId: string, suiKeypair: Ed25519Keypair, solverSuiAddress: string) {
    const obj = await suiClient.getObject({
        id: intentId,
        options: { showContent: true }
    });

    if (obj.error) throw new Error(`Object not found: ${obj.error}`);
    const fields = (obj.data?.content as any)?.fields;

    if (!fields) throw new Error("No fields found on object");

    const recipientEvmVec = fields.recipient_evm;
    const recipientEvm = vectorToEvmAddress(recipientEvmVec);
    const ethAmountExpected = BigInt(fields.amount_expected);

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
        console.log("\n⚡ Fulfilling on EVM (Base Sepolia)...");
        const vault = new ethers.Contract(EVM_INTENT_VAULT_ADDRESS, INTENT_VAULT_ABI, evmWallet);

        const WORMHOLE_ADDRESS = "0x79A1027a6A159502049F10906D333EC57E95F083";
        const fee = await getWormholeFee(WORMHOLE_ADDRESS);
        console.log(`   Wormhole Message Fee: ${fee.toString()}`);

        const totalValue = ethAmountExpected + fee;
        const intentIdBytes32 = ethers.zeroPadValue(intentId, 32);
        const solverSuiBytes32 = ethers.zeroPadValue(solverSuiAddress, 32);

        const tx = await vault.fulfillOrder(
            intentIdBytes32,
            recipientEvm,
            solverSuiBytes32,
            ethAmountExpected,
            {
                value: totalValue,
                gasLimit: 3000000
            }
        );

        console.log(`   ⏳ EVM Tx Sent: ${tx.hash}`);
        const receipt = await tx.wait();
        console.log(`   ✅ EVM Tx Confirmed!`);

        // --- NEW WORMHOLE SDK INTEGRATION ---
        console.log("\n🔍 Initializing Wormhole SDK for VAA retrieval...");
        const wh = await wormhole("Testnet", [evm, sui]);
        const chain = wh.getChain("BaseSepolia");

        console.log("   Parsing transaction for Wormhole messages...");
        const messages = await chain.parseTransaction(tx.hash);

        if (messages.length === 0) {
            throw new Error("No Wormhole messages found in transaction logs!");
        }

        const message = messages[0];
        console.log(`   Found Message: Sequence ${message.sequence}`);
        console.log("   ⏳ Waiting for Signed VAA (this may take several minutes on testnet)...");

        // Use SDK to get VAA with a long timeout (20 mins)
        const vaa = await wh.getVaa(message, "Uint8Array", 1200000);

        if (!vaa) {
            throw new Error("VAA retrieval timed out after 20 minutes.");
        }

        console.log(`   ✅ VAA Fetched Successfully!`);
        const vaaBytes = serialize(vaa);

        // 4. Claim on Sui
        console.log("\n💰 Claiming on Sui...");
        const txSui = new Transaction();
        txSui.moveCall({
            target: `${SUI_PACKAGE_ID}::intent::claim_intent`,
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

    } catch (e: any) {
        console.error("❌ Error processing:", e.message || e);
    }
}

main().catch(console.error);
