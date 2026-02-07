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

    // 2. Read Build Output
    console.log("Reading build output...");
    const buildPath = "contracts/sui/build_output.json";
    const buildData = JSON.parse(fs.readFileSync(buildPath, "utf-8"));
    // buildData.modules is string[] (base64)
    // buildData.dependencies is string[] (IDs)

    // 3. Publish Package
    console.log("Publishing package...");
    const tx = new Transaction();

    const [upgradeCap] = tx.publish({
        modules: buildData.modules,
        dependencies: buildData.dependencies
    });

    tx.transferObjects([upgradeCap], tx.pure.address(deployer));

    const result = await client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true, showObjectChanges: true }
    });

    if (result.effects?.status.status !== "success") {
        console.error("Publish failed:", result.effects?.status);
        process.exit(1);
    }

    // 4. Capture IDs
    console.log(`Publish Digest: ${result.digest}`);

    const objectChanges = result.objectChanges!;

    // Find Package ID
    const publishedChange = objectChanges.find(c => c.type === "published");
    const packageId = (publishedChange as any)?.packageId;
    console.log(`PACKAGE_ID: ${packageId}`);

    // Find SolverConfig (created in intent::init)
    const solverConfigChange = objectChanges.find(c =>
        c.type === "created" && c.objectType.includes("::intent::SolverConfig")
    );
    const solverConfigId = (solverConfigChange as any)?.objectId;
    console.log(`SOLVER_CONFIG_ID: ${solverConfigId}`);

    // Find AdminCap (created in solver_engine::init)
    const adminCapChange = objectChanges.find(c =>
        c.type === "created" && c.objectType.includes("::solver_engine::AdminCap")
    );
    const adminCapId = (adminCapChange as any)?.objectId;
    console.log(`SUI_ADMIN_CAP: ${adminCapId}`);

    // 5. Register Emitter (Create SolverState)
    console.log("Registering Emitter...");
    const tx2 = new Transaction();

    tx2.moveCall({
        target: `${packageId}::solver_engine::register_emitter`,
        arguments: [
            tx2.object(adminCapId),
            tx2.object(WORMHOLE_STATE_ID)
        ]
    });

    const result2 = await client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx2,
        options: { showEffects: true, showObjectChanges: true, showContent: true } // showContent to see fields
    });

    if (result2.effects?.status.status !== "success") {
        console.error("Register Emitter failed:", result2.effects?.status);
        process.exit(1);
    }

    const changes2 = result2.objectChanges!;
    const solverStateChange = changes2.find(c =>
        c.type === "created" && c.objectType.includes("::solver_engine::SolverState")
    );
    const solverStateId = (solverStateChange as any)?.objectId;
    console.log(`SOLVER_STATE_ID: ${solverStateId}`);

    // Inspect SolverState to get internal EmitterCap ID
    // We need to fetch the object content
    const solverStateObj = await client.getObject({
        id: solverStateId,
        options: { showContent: true }
    });

    // Structure: SolverState { id, emitter_cap: { id, ... } }
    const content = solverStateObj.data?.content as any;
    const emitterCapId = content.fields.emitter_cap.fields.id.id; // or just .id if direct
    console.log(`SUI_EMITTER_CAP_ID: ${emitterCapId}`);

    // Append to .env file logic (manual for now, just logging)
    console.log("\nUpdate your .env with:");
    console.log(`SUI_PACKAGE_ID=${packageId}`);
    console.log(`SOLVER_CONFIG_ID=${solverConfigId}`);
    console.log(`SOLVER_STATE_ID=${solverStateId}`);
    console.log(`SUI_ADMIN_CAP=${adminCapId}`);
    console.log(`SUI_EMITTER_CAP_ID=${emitterCapId}  <-- Use this for EVM deployment`);
}

main().catch(console.error);
