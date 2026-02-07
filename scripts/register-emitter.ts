import { getFullnodeUrl, SuiClient } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import * as fs from "fs";
import * as dotenv from "dotenv";
import { fromB64 } from "@mysten/sui/utils";

dotenv.config();

const SUI_RPC = process.env.SUI_RPC || getFullnodeUrl("testnet");
const PRIVATE_KEY_SUI = process.env.PRIVATE_KEY_SUI || "";
const WORMHOLE_STATE_ID = process.env.WORMHOLE_STATE_ID || "";

async function main() {
    if (!PRIVATE_KEY_SUI) throw new Error("PRIVATE_KEY_SUI missing");
    if (!WORMHOLE_STATE_ID) throw new Error("WORMHOLE_STATE_ID missing");

    // 1. Init Client & Signer
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
    const deployer = keypair.getPublicKey().toSuiAddress();
    console.log(`Deployer: ${deployer}`);

    // 2. Read Publish Output
    console.log("Reading publish output...");
    const publishPath = "contracts/sui/publish_clean.json";
    const publishResult = JSON.parse(fs.readFileSync(publishPath, "utf-8"));
    const objectChanges = publishResult.objectChanges;

    // Find Package ID
    const publishedChange = objectChanges.find((c: any) => c.type === "published");
    const packageId = (publishedChange as any)?.packageId;
    console.log(`PACKAGE_ID: ${packageId}`);

    // Find SolverConfig (for .env reference)
    const solverConfigChange = objectChanges.find((c: any) => c.type === "created" && c.objectType.includes("::intent::SolverConfig"));
    const solverConfigId = (solverConfigChange as any)?.objectId;
    console.log(`SOLVER_CONFIG_ID: ${solverConfigId}`);

    // Find AdminCap (created in solver_engine::init)
    const adminCapChange = objectChanges.find((c: any) => c.type === "created" && c.objectType.includes("::solver_engine::AdminCap"));
    const adminCapId = (adminCapChange as any)?.objectId;
    console.log(`SUI_ADMIN_CAP: ${adminCapId}`);

    if (!adminCapId) {
        console.error("AdminCap not found! Was init run?");
        process.exit(1);
    }

    // 3. Register Emitter
    console.log("Registering Emitter (solver_engine)...");
    const tx = new Transaction();
    tx.moveCall({
        target: `${packageId}::solver_engine::register_emitter`,
        arguments: [
            tx.object(adminCapId),
            tx.object(WORMHOLE_STATE_ID)
        ]
    });

    const result = await client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true, showObjectChanges: true }
    });

    if (result.effects?.status.status !== "success") {
        console.error("Register Emitter failed:", result.effects?.status);
        if (result.effects?.status.error) console.error(result.effects.status.error);
        process.exit(1);
    }

    console.log(`Register Tx Digest: ${result.digest}`);

    const changes = result.objectChanges!;
    const solverStateChange = changes.find((c: any) => c.type === "created" && c.objectType.includes("::solver_engine::SolverState"));
    const solverStateId = (solverStateChange as any)?.objectId;
    console.log(`SOLVER_STATE_ID: ${solverStateId}`);

    // Get internal EmitterCap ID
    const solverStateObj = await client.getObject({
        id: solverStateId,
        options: { showContent: true }
    });
    const content = solverStateObj.data?.content as any;
    const emitterCapId = content.fields.emitter_cap.fields.id.id;
    console.log(`SUI_EMITTER_CAP_ID: ${emitterCapId}`);

    console.log("\nUpdate your .env with:");
    console.log(`SUI_PACKAGE_ID=${packageId}`);
    console.log(`SOLVER_CONFIG_ID=${solverConfigId}`);
    console.log(`SOLVER_STATE_ID=${solverStateId}`);
    console.log(`SUI_ADMIN_CAP=${adminCapId}`);
    console.log(`SUI_EMITTER_CAP_ID=${emitterCapId}`);
}

main().catch(console.error);
