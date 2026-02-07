import { getFullnodeUrl, SuiClient } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import * as dotenv from "dotenv";
import { fromB64 } from "@mysten/sui/utils";
import { ethers } from "ethers";

dotenv.config();

const SUI_RPC = process.env.SUI_RPC || getFullnodeUrl("testnet");
const PRIVATE_KEY_SUI = process.env.PRIVATE_KEY_SUI || "";
const SUI_PACKAGE_ID = process.env.SUI_PACKAGE_ID || "";
// Recipient EVM address (can be random or specific)
const PRIVATE_KEY_EVM = process.env.PRIVATE_KEY_EVM || "";

async function main() {
    if (!PRIVATE_KEY_SUI) throw new Error("PRIVATE_KEY_SUI missing");
    if (!SUI_PACKAGE_ID) throw new Error("SUI_PACKAGE_ID missing");

    const client = new SuiClient({ url: SUI_RPC });
    let keypair: Ed25519Keypair;
    try {
        const raw = fromB64(PRIVATE_KEY_SUI);
        keypair = Ed25519Keypair.fromSecretKey(raw.slice(1));
    } catch {
        // fallback
        const { decodeSuiPrivateKey } = await import("@mysten/sui/cryptography");
        const { secretKey } = decodeSuiPrivateKey(PRIVATE_KEY_SUI);
        keypair = Ed25519Keypair.fromSecretKey(secretKey);
    }

    const sender = keypair.getPublicKey().toSuiAddress();
    console.log(`Creator: ${sender}`);

    // EVM Recipient
    let recipientEvm = "0x1234567890123456789012345678901234567890";
    if (PRIVATE_KEY_EVM) {
        recipientEvm = new ethers.Wallet(PRIVATE_KEY_EVM).address;
    }
    console.log(`Target EVM Recipient: ${recipientEvm}`);

    const recipientBytes = ethers.getBytes(recipientEvm); // 20 bytes

    const SUI_AMOUNT = 50_000_000; // 0.05 SUI (MIST)
    const ETH_AMOUNT = ethers.parseEther("0.0001"); // 0.0001 ETH (wei)

    const tx = new Transaction();

    // Split coin for payment
    const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(SUI_AMOUNT)]);

    tx.moveCall({
        target: `${SUI_PACKAGE_ID}::intent::create_intent`,
        arguments: [
            coin,
            tx.pure.vector("u8", Array.from(recipientBytes)),
            tx.pure.u64(ETH_AMOUNT) // u64 for wei? 
            // In intent.move: eth_amount_expected: u64.
            // 0.0001 ETH = 10^14 wei. u64 max is 1.8 * 10^19. Safe.
        ]
    });

    console.log("Submitting Create Intent Tx...");
    const result = await client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true, showEvents: true }
    });

    if (result.effects?.status.status !== "success") {
        console.error("Create Intent failed:", result.effects?.status);
        process.exit(1);
    }

    const event = result.events?.find(e => e.type.includes("IntentCreated"));
    const intentId = (event?.parsedJson as any)?.intent_id;

    console.log(`✅ Intent Created! ID: ${intentId}`);
    console.log(`Digest: ${result.digest}`);
}

main().catch(console.error);
