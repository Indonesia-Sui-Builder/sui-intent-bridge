import { ethers } from "ethers";
import * as dotenv from "dotenv";

dotenv.config();

const EVM_RPC = process.env.EVM_RPC;
const EVM_INTENT_VAULT_ADDRESS = "0x252c60fbbbebce0e49f38c6e63385294b1be6ad9"; // Latest

const ABI = [
    "function wormhole() view returns (address)",
    "function messageFee() view returns (uint256)" // if exposed? No, it's inside fulfillOrder.
];

// But we can check public variable 'wormhole'
async function main() {
    console.log("Debugging Vault at", EVM_INTENT_VAULT_ADDRESS);
    const provider = new ethers.JsonRpcProvider(EVM_RPC);
    const vault = new ethers.Contract(EVM_INTENT_VAULT_ADDRESS, ABI, provider);

    try {
        const wormholeAddr = await vault.wormhole();
        console.log("Vault.wormhole() =", wormholeAddr);

        if (wormholeAddr.toLowerCase() !== "0x79A1027a6A159502049F10906D333EC57E95F083".toLowerCase()) {
            console.error("❌ MISMATCH! Expected 0x79A1027a6A159502049F10906D333EC57E95F083");
        } else {
            console.log("✅ Match!");
        }

    } catch (e) {
        console.error("Failed to read wormhole:", e);
    }
}

main().catch(console.error);
