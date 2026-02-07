import { ethers } from "ethers";
import * as dotenv from "dotenv";

dotenv.config();

const EVM_RPC = process.env.EVM_RPC;
const WORMHOLE_ADDRESS = "0x79A1027a6A159502049F10906D333EC57E95F083";

const ABI = [
    "function messageFee() view returns (uint256)",
    "function chainId() view returns (uint16)",
    "function getCurrentGuardianSetIndex() view returns (uint32)"
];

async function main() {
    console.log("Checking Wormhole at", WORMHOLE_ADDRESS);
    const provider = new ethers.JsonRpcProvider(EVM_RPC);
    const contract = new ethers.Contract(WORMHOLE_ADDRESS, ABI, provider);

    try {
        const chainId = await contract.chainId();
        console.log("Chain ID:", chainId);
    } catch (e) {
        console.error("Failed to fetch chainId:", e.message);
    }

    try {
        const fee = await contract.messageFee();
        console.log("Message Fee:", fee.toString());
    } catch (e) {
        console.error("Failed to fetch messageFee:", e.message);
    }
}

main().catch(console.error);
