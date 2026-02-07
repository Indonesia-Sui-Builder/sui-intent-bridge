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
const SOLVER_CONFIG_ID = process.env.SOLVER_CONFIG_ID || "";
const EVM_INTENT_VAULT_ADDRESS = process.env.EVM_INTENT_VAULT_ADDRESS || "";

async function main() {
    if (!PRIVATE_KEY_SUI) throw new Error("PRIVATE_KEY_SUI missing");
    if (!SUI_PACKAGE_ID) throw new Error("SUI_PACKAGE_ID missing");
    if (!SOLVER_CONFIG_ID) throw new Error("SOLVER_CONFIG_ID missing");
    if (!EVM_INTENT_VAULT_ADDRESS) throw new Error("EVM_INTENT_VAULT_ADDRESS missing");

    const client = new SuiClient({ url: SUI_RPC });
    let keypair: Ed25519Keypair;

    if (PRIVATE_KEY_SUI.startsWith("suiprivkey")) {
        const { decodeSuiPrivateKey } = await import("@mysten/sui/cryptography");
        const { secretKey } = decodeSuiPrivateKey(PRIVATE_KEY_SUI);
        keypair = Ed25519Keypair.fromSecretKey(secretKey);
    } else {
        try {
            const raw = fromB64(PRIVATE_KEY_SUI);
            keypair = Ed25519Keypair.fromSecretKey(raw.slice(1));
        } catch {
            keypair = Ed25519Keypair.fromSecretKey(Buffer.from(PRIVATE_KEY_SUI, "base64"));
        }
    }

    const sender = keypair.getPublicKey().toSuiAddress();
    console.log(`Configuring Solver as ${sender}...`);

    // Prepare Arguments
    const NEW_CHAIN_ID = 10004; // Base Sepolia

    // EVM Address to 32 bytes (Wormhole Format: left padded with zeros? No, usually standard address is 20 bytes, wormhole uses 32 bytes left-padded)
    // "Official" Wormhole address format is 32 bytes.
    // E.g. 0x000000000000000000000000<20 byte address>
    const emitterAddress32 = ethers.zeroPadValue(EVM_INTENT_VAULT_ADDRESS, 32);
    const emitterBytes = ethers.getBytes(emitterAddress32);

    console.log(`Setting Emitter Chain: ${NEW_CHAIN_ID}`);
    console.log(`Setting Emitter Address: ${emitterAddress32}`);

    const tx = new Transaction();

    // update_solver_config(config, new_solver, new_chain, new_emitter)
    // We keep the solver as the sender for now (or whatever it was).
    // Actually, I want to keep the current solver.
    // The current solver is `sender` because deployer set it to `sender`.
    // I can just pass `sender`.

    tx.moveCall({
        target: `${SUI_PACKAGE_ID}::intent::update_solver_config`,
        arguments: [
            tx.object(SOLVER_CONFIG_ID),
            tx.pure.address(sender),
            tx.pure.u16(NEW_CHAIN_ID),
            tx.pure.vector("u8", Array.from(emitterBytes))
        ]
    });

    const result = await client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true }
    });

    if (result.effects?.status.status !== "success") {
        console.error("Configuration Failed:", result.effects?.status);
        process.exit(1);
    }

    console.log(`✅ Configuration Updated! Digest: ${result.digest}`);
}

main().catch(console.error);
