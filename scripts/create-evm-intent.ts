import { ethers } from "ethers";
import * as dotenv from "dotenv";

dotenv.config();

const EVM_RPC = process.env.EVM_RPC || "https://sepolia.base.org";
const PRIVATE_KEY_EVM = process.env.PRIVATE_KEY_EVM || "";
const EVM_INTENT_VAULT_ADDRESS = process.env.EVM_INTENT_VAULT_ADDRESS || "";
const MOCK_USDC_ADDRESS = process.env.MOCK_USDC_ADDRESS || "0xF06055B3e8874b1361Dd41d92836Ab7f18f8Bc90";

const ERC20_ABI = [
    "function approve(address spender, uint256 amount) public returns (bool)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function decimals() view returns (uint8)"
];

const INTENT_VAULT_ABI = [
    "function createOrder(uint256 amount, bytes32 recipientSui) external"
];

async function main() {
    if (!PRIVATE_KEY_EVM) throw new Error("Missing PRIVATE_KEY_EVM");

    const provider = new ethers.JsonRpcProvider(EVM_RPC);
    const wallet = new ethers.Wallet(PRIVATE_KEY_EVM, provider);

    console.log(`Using Wallet: ${wallet.address}`);

    const vault = new ethers.Contract(EVM_INTENT_VAULT_ADDRESS, [
        ...INTENT_VAULT_ABI,
        "function usdc() view returns (address)"
    ], wallet);

    // Check actual USDC address in vault
    const vaultUsdcAddress = await vault.usdc();
    console.log(`Vault USDC Address: ${vaultUsdcAddress}`);

    const usdc = new ethers.Contract(vaultUsdcAddress, ERC20_ABI, wallet);

    // Amount to bridge: 0.1 USDC (6 decimals)
    const amount = ethers.parseUnits("0.1", 6);

    // Check Allowance
    console.log("Checking Allowance...");
    const allowance = await usdc.allowance(wallet.address, EVM_INTENT_VAULT_ADDRESS);
    console.log(`Allowance: ${ethers.formatUnits(allowance, 6)}`);

    if (allowance < amount) {
        console.log("Approving USDC...");
        const txApprove = await usdc.approve(EVM_INTENT_VAULT_ADDRESS, amount);
        await txApprove.wait();
        console.log("Approved. Waiting for propagation...");

        // Wait loop
        let retries = 5;
        while (retries > 0) {
            await new Promise(r => setTimeout(r, 2000));
            const newAllowance = await usdc.allowance(wallet.address, EVM_INTENT_VAULT_ADDRESS);
            console.log(`Current Allowance: ${ethers.formatUnits(newAllowance, 6)}`);
            if (newAllowance >= amount) break;
            retries--;
        }
    } else {
        console.log("Allowance sufficient.");
    }

    // Recipient on Sui: Intelligent quartz (0x542d...)
    const recipientSui = "0x542d7c6f5491970fa1450f4df4be36158737e8c0026547d751f489bb5f94ab3a";

    console.log(`Creating Order for ${ethers.formatUnits(amount, 6)} USDC...`);
    console.log(`Recipient Sui: ${recipientSui}`);

    const txCreate = await vault.createOrder(amount, recipientSui);
    console.log(`Tx Sent: ${txCreate.hash}`);

    const receipt = await txCreate.wait();
    console.log("Order Created!");

    // Find OrderId from logs
    const logs = receipt.logs.filter((l: any) => l.topics[0] === ethers.id("OrderCreated(uint256,address,uint256,bytes32)"));
    if (logs.length > 0) {
        const parsedLog = vault.interface.parseLog(logs[0]);
        console.log(`✅ Order ID: ${parsedLog?.args.orderId}`);
    } else {
        console.warn("⚠️ OrderCreated event not found in receipt.");
    }
}

main().catch(console.error);
