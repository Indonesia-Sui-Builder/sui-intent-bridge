import { execSync } from "child_process";
import * as dotenv from "dotenv";
import * as fs from "fs";

dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY_SUI || "";

function run(cmd: string) {
    try {
        return execSync(cmd, { stdio: 'pipe', encoding: 'utf-8', env: process.env });
    } catch (e: any) {
        console.error("Command failed:", cmd);
        console.error(e.stderr);
        console.error(e.stdout);
        process.exit(1);
    }
}

async function main() {
    if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY_SUI missing");

    // 1. Import Key (ignore output/error if already exists)
    console.log("Importing key...");
    try {
        // We use the raw key directly if it starts with suiprivkey, otherwise basic handling
        // sui keytool import expects suiprivkey...
        // Use --json to avoid interactive prompts
        // We need to pass the key as argument.
        execSync(`sui keytool import "${PRIVATE_KEY}" --json`, { stdio: 'pipe' });
    } catch (e: any) {
        // Likely 'Account already exists' or similar
        // console.log("Key import notice:", e.message);
    }

    // 2. Set Active Address (just in case)
    // We get the address from the key
    // We can list keys and pick the one matching?
    // Let's assume the imported key is set as active or available.
    // Ideally we assume the user's environment is okay, but explicit import is safer.

    // 3. Publish
    console.log("Publishing contracts/sui...");
    // Force rebuild to ensure 0x0?
    run("rm -rf contracts/sui/build contracts/sui/Move.lock contracts/sui/Published.toml");

    // Check running address in Move.toml? No, assume OK.

    const output = run("sui client publish --gas-budget 200000000 --json contracts/sui");

    // Find the JSON part. It starts with '{'
    const jsonStart = output.indexOf('{');
    if (jsonStart === -1) {
        console.error("No JSON output found.");
        console.error(output);
        process.exit(1);
    }
    const jsonString = output.slice(jsonStart);
    const result = JSON.parse(jsonString);

    if (result.effects?.status?.status !== "success") {
        console.error("Publish failed:", JSON.stringify(result, null, 2));
        process.exit(1);
    }

    // 4. Parse IDs
    const objectChanges = result.objectChanges;

    const publishedChange = objectChanges.find((c: any) => c.type === "published");
    const packageId = publishedChange?.packageId;
    console.log(`PACKAGE_ID=${packageId}`);

    const solverConfigChange = objectChanges.find((c: any) =>
        c.type === "created" && c.objectType.includes("::intent::SolverConfig")
    );
    const solverConfigId = solverConfigChange?.objectId;
    console.log(`SOLVER_CONFIG_ID=${solverConfigId}`);

    const adminCapChange = objectChanges.find((c: any) =>
        c.type === "created" && c.objectType.includes("::solver_engine::AdminCap")
    );
    const adminCapId = adminCapChange?.objectId;
    console.log(`SUI_ADMIN_CAP=${adminCapId}`);

    // Need to initialize/register emitter?
    // Wait, the previous script did `register_emitter` AFTER publish.
    // I can stick to calling that transaction via CLI too.

    const WORMHOLE_STATE_ID = process.env.WORMHOLE_STATE_ID;
    if (!WORMHOLE_STATE_ID) throw new Error("WORMHOLE_STATE_ID missing");

    console.log("Registering Emitter...");
    // call solver_engine::register_emitter(AdminCap, WormholeState)
    const cmd2 = `sui client call --package ${packageId} --module solver_engine --function register_emitter --args ${adminCapId} ${WORMHOLE_STATE_ID} --gas-budget 100000000 --json`;
    const output2 = run(cmd2);
    const result2 = JSON.parse(output2);

    if (result2.effects?.status?.status !== "success") {
        console.error("Register Emitter failed:", JSON.stringify(result2, null, 2));
        process.exit(1);
    }

    const changes2 = result2.objectChanges;
    const solverStateChange = changes2.find((c: any) =>
        c.type === "created" && c.objectType.includes("::solver_engine::SolverState")
    );
    const solverStateId = solverStateChange?.objectId;
    console.log(`SOLVER_STATE_ID=${solverStateId}`);

    // Get Emitter Cap ID from SolverState
    // `sui client object <ID> --json`
    const objOutput = run(`sui client object ${solverStateId} --json`);
    const objData = JSON.parse(objOutput);
    const emitterCapId = objData.content.fields.emitter_cap.fields.id.id;
    console.log(`SUI_EMITTER_CAP_ID=${emitterCapId}`);
}

main().catch(console.error);
