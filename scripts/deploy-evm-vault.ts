import { ethers } from "ethers";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

dotenv.config();

const EVM_RPC = process.env.EVM_RPC || "https://sepolia.base.org";
const PRIVATE_KEY_EVM = process.env.PRIVATE_KEY_EVM || "";
const MOCK_USDC_ADDRESS = process.env.MOCK_USDC_ADDRESS || ""; // Should be set
const WORMHOLE_EVM_ADDRESS = "0x79A1027a6A159502049F10906D333EC57E95F083"; // Base Sepolia Core Bridge
const SUI_EMITTER_CAP_ID = process.env.SUI_EMITTER_CAP_ID || "";

// ABI/Bytecode from Forge build
const ARTIFACT_PATH = "contracts/evm/out/IntentVault.sol/IntentVault.json";

async function main() {
    if (!PRIVATE_KEY_EVM) throw new Error("Missing PRIVATE_KEY_EVM");
    if (!MOCK_USDC_ADDRESS) throw new Error("Missing MOCK_USDC_ADDRESS");
    if (!SUI_EMITTER_CAP_ID) throw new Error("Missing SUI_EMITTER_CAP_ID in .env");

    const provider = new ethers.JsonRpcProvider(EVM_RPC);
    const wallet = new ethers.Wallet(PRIVATE_KEY_EVM, provider);

    console.log(`Deploying from: ${wallet.address}`);

    // Load Artifact
    // Run `forge build` first if not exists
    if (!fs.existsSync(ARTIFACT_PATH)) {
        throw new Error(`Artifact not found at ${ARTIFACT_PATH}. Run 'forge build' in contracts/evm first.`);
    }
    const artifact = JSON.parse(fs.readFileSync(ARTIFACT_PATH, "utf-8"));

    const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode.object, wallet);

    // Convert SUI_EMITTER_CAP_ID to bytes32
    // SUI ID is 32 bytes (64 hex chars).
    // Ensure it is 0x prefixed and 66 chars long.
    let suiEmitter = SUI_EMITTER_CAP_ID;
    if (!suiEmitter.startsWith("0x")) suiEmitter = "0x" + suiEmitter;
    // Pad if necessary (though SUI IDs are usually full 32 bytes)
    const suiEmitterBytes32 = ethers.zeroPadValue(suiEmitter, 32);

    console.log(`Sui Emitter (Bytes32): ${suiEmitterBytes32}`);

    const contract = await factory.deploy(
        MOCK_USDC_ADDRESS,
        WORMHOLE_EVM_ADDRESS,
        suiEmitterBytes32
    );

    console.log(`Deploying IntentVault... Tx: ${contract.deploymentTransaction()?.hash}`);

    await contract.waitForDeployment();

    const address = await contract.getAddress();
    console.log(`✅ IntentVault Deployed at: ${address}`);
    console.log(`\nUpdate .env with:\nEVM_INTENT_VAULT_ADDRESS=${address}`);
}

main().catch(console.error);
