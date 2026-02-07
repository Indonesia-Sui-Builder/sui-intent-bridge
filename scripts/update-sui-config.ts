
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { fromB64 } from "@mysten/sui/utils";
import * as dotenv from "dotenv";
import { ethers } from "ethers";

dotenv.config();

const SUI_RPC = process.env.SUI_RPC || getFullnodeUrl("testnet");
const PRIVATE_KEY_SUI = process.env.PRIVATE_KEY_SUI || "";
const SUI_PACKAGE_ID = process.env.SUI_PACKAGE_ID || "";
const SOLVER_CONFIG_ID = process.env.SOLVER_CONFIG_ID || "";
const EVM_INTENT_VAULT_ADDRESS = process.env.EVM_INTENT_VAULT_ADDRESS || "";

async function main() {
    if (!PRIVATE_KEY_SUI || !SUI_PACKAGE_ID || !SOLVER_CONFIG_ID || !EVM_INTENT_VAULT_ADDRESS) {
        throw new Error("Missing required env vars");
    }

    // 1. Init Client & Signer
    const client = new SuiClient({ url: SUI_RPC });
    let keypair: Ed25519Keypair;

    if (PRIVATE_KEY_SUI.startsWith("suiprivkey")) {
        const { decodeSuiPrivateKey } = await import("@mysten/sui/cryptography");
        const { secretKey } = decodeSuiPrivateKey(PRIVATE_KEY_SUI);
        keypair = Ed25519Keypair.fromSecretKey(secretKey);
    } else {
        const raw = fromB64(PRIVATE_KEY_SUI);
        keypair = Ed25519Keypair.fromSecretKey(raw.slice(1));
    }

    console.log(`Updating Solver Config...`);
    console.log(`Config ID: ${SOLVER_CONFIG_ID}`);
    console.log(`New Emitter (EVM): ${EVM_INTENT_VAULT_ADDRESS}`);

    // 2. Prepare Emitter Address (32 bytes)
    // EVM address is 20 bytes. Wormhole expects 32 bytes (left-padded).
    const emitterAddressBytes32 = ethers.zeroPadValue(EVM_INTENT_VAULT_ADDRESS, 32);
    const emitterBytes = ethers.getBytes(emitterAddressBytes32);

    // 3. Execute Transaction
    const tx = new Transaction();

    tx.moveCall({
        target: `${SUI_PACKAGE_ID}::intent::update_solver_config`,
        arguments: [
            tx.object(SOLVER_CONFIG_ID),
            tx.pure.u16(10004), // Base Sepolia Chain ID (Wormhole)
            tx.pure.vector("u8", Array.from(emitterBytes))
        ]
    });

    const result = await client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true }
    });

    if (result.effects?.status.status !== "success") {
        console.error("Update failed:", result.effects?.status);
        process.exit(1);
    }

    console.log(`✅ Config Updated! Digest: ${result.digest}`);
}

main().catch(console.error);
