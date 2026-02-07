import { getFullnodeUrl, SuiClient } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import * as dotenv from "dotenv";
import { fromB64 } from "@mysten/sui/utils";

dotenv.config();

const SUI_RPC = process.env.SUI_RPC || getFullnodeUrl("testnet");
const PRIVATE_KEY_SUI = process.env.PRIVATE_KEY_SUI || "";
const WORMHOLE_STATE_ID = process.env.WORMHOLE_STATE_ID || "";

// from previous step
const PACKAGE_ID = "0x8c5125613aee779db5906ee533451c3432e5fa0ad6311658e6c62017922d7ed0";
const ADMIN_CAP_ID = "0xd2d1db924ae8f794ae9fefba92350da680f3f97d870a6f50a98bfc4becca3d5b";

async function main() {
    console.log("Initializing Sui State...");
    const client = new SuiClient({ url: SUI_RPC });
    let keypair: Ed25519Keypair;

    if (PRIVATE_KEY_SUI.startsWith("suiprivkey")) {
        const { decodeSuiPrivateKey } = await import("@mysten/sui/cryptography");
        const { secretKey } = decodeSuiPrivateKey(PRIVATE_KEY_SUI);
        keypair = Ed25519Keypair.fromSecretKey(secretKey);
    } else {
        keypair = Ed25519Keypair.fromSecretKey(fromB64(PRIVATE_KEY_SUI).slice(1));
    }

    const tx = new Transaction();
    tx.moveCall({
        target: `${PACKAGE_ID}::solver_engine::register_emitter`,
        arguments: [
            tx.object(ADMIN_CAP_ID),
            tx.object(WORMHOLE_STATE_ID)
        ]
    });

    const result = await client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true, showObjectChanges: true }
    });

    if (result.effects?.status.status !== "success") {
        console.error("Failed:", result.effects?.status);
        process.exit(1);
    }

    console.log(`Digest: ${result.digest}`);

    // Find SolverState
    const changes = result.objectChanges!;
    const stateChange = changes.find(c => c.type === "created" && c.objectType.includes("SolverState"));
    const stateId = (stateChange as any)?.objectId;
    console.log(`SOLVER_STATE_ID: ${stateId}`);

    // Get Emitter Cap ID
    const obj = await client.getObject({
        id: stateId,
        options: { showContent: true }
    });

    // The field `emitter_cap` inside `SolverState` struct
    const content = obj.data?.content as any;
    // SolverState has `emitter_cap: EmitterCap`. EmitterCap has `id: UID`.
    const emitterCapId = content.fields.emitter_cap.fields.id.id;
    console.log(`SUI_EMITTER_CAP_ID: ${emitterCapId}`);
}

main().catch(console.error);
