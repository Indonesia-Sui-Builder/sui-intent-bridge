import { createWalletClient, http, parseAbi, publicActions } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import * as dotenv from 'dotenv';

dotenv.config();

const PRIVATE_KEY_EVM = process.env.PRIVATE_KEY_EVM || "";
const EVM_VAULT_ADDRESS = process.env.EVM_INTENT_VAULT_ADDRESS || "";
const MOCK_USDC_ADDRESS = process.env.MOCK_USDC_ADDRESS || "";

// Test Data
// Use a specific SUI recipient address (the user's address or a test address)
const RECIPIENT_SUI = "0xa6a3da85bbe05da5bfd953708d56f1a3a023e7fb58e5a824a3d4de3791e8f690"; // 32 bytes hex
const AMOUNT = 100_000n; // 0.1 USDC (6 decimals)

const account = privateKeyToAccount(PRIVATE_KEY_EVM as `0x${string}`);

const client = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http()
}).extend(publicActions);

async function main() {
    console.log("🚀 Creating Order on Base Sepolia...");
    console.log(`Vault: ${EVM_VAULT_ADDRESS}`);
    console.log(`User: ${account.address}`);

    // 1. Check Balance & Allowance
    console.log("\n🔍 Checking Balance & Allowance...");
    const balance = await client.readContract({
        address: MOCK_USDC_ADDRESS as `0x${string}`,
        abi: parseAbi(["function balanceOf(address) view returns (uint256)"]),
        functionName: 'balanceOf',
        args: [account.address]
    });
    console.log(`Balance: ${balance}`);

    const allowance = await client.readContract({
        address: MOCK_USDC_ADDRESS as `0x${string}`,
        abi: parseAbi(["function allowance(address, address) view returns (uint256)"]),
        functionName: 'allowance',
        args: [account.address, EVM_VAULT_ADDRESS as `0x${string}`]
    });
    console.log(`Allowance: ${allowance}`);

    // Mint if needed
    if (balance < AMOUNT) {
        console.log("⚠️ Insufficient Balance. Attempting to mint...");
        try {
            const { request: mintReq } = await client.simulateContract({
                address: MOCK_USDC_ADDRESS as `0x${string}`,
                abi: parseAbi(["function mint(address to, uint256 amount) public"]),
                functionName: 'mint',
                args: [account.address, AMOUNT * 10n],
                account
            });
            const mintHash = await client.writeContract(mintReq);
            console.log(`Mint Tx: ${mintHash}`);
            await client.waitForTransactionReceipt({ hash: mintHash });
            console.log("✅ Minted.");
        } catch (e) {
            console.error("❌ Mint failed. Does MockUSDC have a public mint function?", e);
        }
    }

    // 2. Approve USDC
    console.log("\n🔓 Approving USDC...");
    const { request: approveReq } = await client.simulateContract({
        address: MOCK_USDC_ADDRESS as `0x${string}`,
        abi: parseAbi(["function approve(address spender, uint256 value) public returns (bool)"]),
        functionName: 'approve',
        args: [EVM_VAULT_ADDRESS as `0x${string}`, AMOUNT],
        account
    });
    const approveHash = await client.writeContract(approveReq);
    console.log(`Approve Tx: ${approveHash}`);
    await client.waitForTransactionReceipt({ hash: approveHash });
    console.log("✅ Approved.");

    // Robust Allowance Check
    let allowanceAfter = 0n;
    let attempts = 0;
    while (allowanceAfter < AMOUNT && attempts < 5) {
        console.log(`Waiting for allowance update... (${attempts + 1})`);
        await new Promise(r => setTimeout(r, 2000));
        allowanceAfter = await client.readContract({
            address: MOCK_USDC_ADDRESS as `0x${string}`,
            abi: parseAbi(["function allowance(address, address) view returns (uint256)"]),
            functionName: 'allowance',
            args: [account.address, EVM_VAULT_ADDRESS as `0x${string}`]
        });
        attempts++;
    }
    console.log(`Allowance After: ${allowanceAfter}`);
    if (allowanceAfter < AMOUNT) {
        throw new Error("Allowance not updated!");
    }

    // 3. Create Order
    console.log("\n💸 Creating Order...");
    console.log(`SUI Amount: 0.05 SUI (50,000,000 MIST)`);

    const { request: createReq } = await client.simulateContract({
        address: EVM_VAULT_ADDRESS as `0x${string}`,
        abi: parseAbi([
            "function createOrder(uint256 inputAmount, uint256 startOutputAmount, uint256 minOutputAmount, uint256 duration, bytes32 recipientSui) external",
            "event OrderCreated(uint256 indexed orderId, address indexed depositor, uint256 inputAmount, uint256 startOutputAmount, uint256 minOutputAmount, uint256 startTime, uint256 duration, bytes32 recipientSui)",
            "error InvalidAmount()",
            "error TransferFailed()",
            "error InvalidOrder()",
            "error OrderAlreadySettled()",
            "error BidTooLow()"
        ]),
        functionName: 'createOrder',
        args: [
            AMOUNT,
            50_000_000n, // startOutputAmount: 0.05 SUI
            25_000_000n,   // minOutputAmount: 0.025 SUI
            600n,           // duration: 10 mins
            RECIPIENT_SUI as `0x${string}`
        ],
        account
    });
    const createHash = await client.writeContract(createReq);
    console.log(`Create Tx: ${createHash}`);

    const receipt = await client.waitForTransactionReceipt({ hash: createHash });

    // Parse Logs for OrderId
    console.log("✅ Order Created!");
    console.log("Check logs for Order ID. Typically 0 for fresh contract.");
}

main().catch(console.error);
