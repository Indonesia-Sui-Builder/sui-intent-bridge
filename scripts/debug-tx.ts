import { ethers } from "ethers";
import * as dotenv from "dotenv";

dotenv.config();

const EVM_RPC = process.env.EVM_RPC;
const TX_HASH = "0x93751e06d775904870acbe6d8ff722fbc6f9b8f2c8492c2b0b44467eeef0c802";

async function main() {
    console.log("Debugging Tx:", TX_HASH);
    const provider = new ethers.JsonRpcProvider(EVM_RPC);
    const receipt = await provider.getTransactionReceipt(TX_HASH);

    if (!receipt) {
        console.error("Receipt not found");
        return;
    }

    console.log("Status:", receipt.status);
    console.log("Logs:", receipt.logs.length);

    receipt.logs.forEach((log, i) => {
        console.log(`\nLog [${i}]`);
        console.log("  Address:", log.address);
        console.log("  Topics:", log.topics);
        console.log("  Data:", log.data);
    });
}

main().catch(console.error);
