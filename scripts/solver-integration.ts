import { createWalletClient, http, parseAbi, publicActions } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import axios from 'axios';
import * as dotenv from 'dotenv';
import { fromB64 } from '@mysten/sui/utils';

dotenv.config();

// ============ Configuration ============

// Environment Variables
const PRIVATE_KEY_EVM = process.env.PRIVATE_KEY_EVM || "";
const PRIVATE_KEY_SUI = process.env.PRIVATE_KEY_SUI || "";
const SUI_PACKAGE_ID = process.env.SUI_PACKAGE_ID || "";
const SOLVER_STATE_ID = process.env.SOLVER_STATE_ID || "";
const WORMHOLE_STATE_ID = process.env.WORMHOLE_STATE_ID || ""; // Sui Wormhole State
const EVM_VAULT_ADDRESS = process.env.EVM_VAULT_ADDRESS || "";

// Constants
const WORMHOLE_API_URL = "https://api.testnet.wormholescan.io";
const SUI_CHAIN_ID = 21; // Wormhole Chain ID for Sui

// Simulation Data
const TEST_RECIPIENT_SUI = "0xa6a3da85bbe05da5bfd953708d56f1a3a023e7fb58e5a824a3d4de3791e8f690"; // Example
const TEST_AMOUNT_SUI = 100_000_000; // 0.1 SUI
const TEST_INTENT_ID = new Uint8Array(32); // Order ID 0 (32 bytes of zeros)

// ============ Clients ============

// Sui Client
const suiClient = new SuiClient({ url: getFullnodeUrl('testnet') });

// EVM Client
const account = privateKeyToAccount(PRIVATE_KEY_EVM as `0x${string}`);
const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http()
}).extend(publicActions);

// ============ Helper Functions ============

async function getSuiKeypair() {
    if (PRIVATE_KEY_SUI.startsWith("suiprivkey")) {
        const { decodeSuiPrivateKey } = await import("@mysten/sui/cryptography");
        const { secretKey } = decodeSuiPrivateKey(PRIVATE_KEY_SUI);
        return Ed25519Keypair.fromSecretKey(secretKey);
    }
    // Assume Base64
    return Ed25519Keypair.fromSecretKey(fromB64(PRIVATE_KEY_SUI));
}

// ============ Main Flow ============

async function main() {
    console.log("🚀 Starting Solver Integration Script...");

    try {
        const suiKeypair = await getSuiKeypair();
        const solverAddress = suiKeypair.getPublicKey().toSuiAddress();
        console.log(`📍 Solver Address: ${solverAddress}`);

        // 1. Execute solve_and_prove on Sui
        console.log("\n🔗 Step 1: Executing solve_and_prove on Sui...");

        const tx = new Transaction();

        // Fee coin assumption: The solver has SUI.
        // We need to split a coin for the transfer amount and the wormhole fee if needed.
        // solve_and_prove takes:
        // solver_state: &mut SolverState
        // wormhole_state: &mut State
        // payment_coin: Coin<SUI>
        // message_fee: Coin<SUI>
        // recipient: address
        // intent_id: vector<u8>
        // clock: &Clock

        const [paymentCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(TEST_AMOUNT_SUI)]);
        const [messageFee] = tx.splitCoins(tx.gas, [tx.pure.u64(0)]); // Zero fee for testnet usually? Or check Wormhole fee.

        tx.moveCall({
            target: `${SUI_PACKAGE_ID}::solver_engine::solve_and_prove`,
            arguments: [
                tx.object(SOLVER_STATE_ID),
                tx.object(WORMHOLE_STATE_ID),
                paymentCoin,
                messageFee,
                tx.pure.address(TEST_RECIPIENT_SUI),
                tx.pure.vector("u8", Array.from(TEST_INTENT_ID)),
                tx.object("0x6"), // Clock
            ]
        });

        const result = await suiClient.signAndExecuteTransaction({
            signer: suiKeypair,
            transaction: tx,
            options: {
                showEffects: true,
                showEvents: true,
            },
        });

        console.log(`✅ Sui Transaction Digest: ${result.digest}`);

        // 2. Parse Event for Sequence Number
        console.log("\n🔍 Step 2: Extracting Sequence Number...");

        // Look for WormholeMessage event from the system or our wrapper event
        // Our contract emits ::solver_engine::MessagePublished
        // Wormhole emits ::publish_message::WormholeMessage

        const event = result.events?.find(e => e.type.includes("WormholeMessage"));
        if (!event) {
            console.log("Full events:", JSON.stringify(result.events, null, 2));
            throw new Error("WormholeMessage event not found in transaction");
        }

        const parsedJson = event.parsedJson as any;
        const sequence = parsedJson.sequence;
        const emitterAddress = parsedJson.sender; // This is the ID of the EmitterCap or Object ID

        console.log(`   Sequence: ${sequence}`);
        console.log(`   Emitter: ${emitterAddress}`);

        // 3. Fetch VAA
        console.log("\n📡 Step 3: Fetching VAA from Wormhole Guardian API...");

        let vaaBase64 = "";
        const maxRetries = 60;
        const retryDelay = 3000; // 3 seconds

        for (let i = 0; i < maxRetries; i++) {
            try {
                const url = `${WORMHOLE_API_URL}/v1/signed_vaa/${SUI_CHAIN_ID}/${emitterAddress}/${sequence}`;
                console.log(`   Attempt ${i + 1}/${maxRetries}: ${url}`);

                const response = await axios.get(url);
                if (response.data && response.data.vaaBytes) {
                    vaaBase64 = response.data.vaaBytes;
                    console.log("   ✅ VAA Fetched!");
                    break;
                }
            } catch (e) {
                // Ignore 404 and retry
                await new Promise(r => setTimeout(r, retryDelay));
            }
        }

        if (!vaaBase64) {
            throw new Error("Timeout fetching VAA");
        }

        // Convert base64 VAA to hex for EVM
        const vaaHex = `0x${Buffer.from(vaaBase64, 'base64').toString('hex')}`;
        console.log(`   VAA Hex: ${vaaHex.slice(0, 64)}...`);

        // 4. Settle on EVM
        console.log("\n💰 Step 4: Settling Order on EVM (Base Sepolia)...");

        const { request } = await walletClient.simulateContract({
            address: EVM_VAULT_ADDRESS as `0x${string}`,
            abi: parseAbi([
                "function settleOrder(bytes memory encodedVM) public"
            ]),
            functionName: 'settleOrder',
            args: [vaaHex as `0x${string}`],
            account
        });

        const hash = await walletClient.writeContract(request);
        console.log(`   ⏳ Transaction sent: ${hash}`);

        const receipt = await walletClient.waitForTransactionReceipt({ hash });
        console.log(`✅ EVM Settlement Confirmed! Block: ${receipt.blockNumber}`);

    } catch (e) {
        console.error("❌ Error:", e);
        process.exit(1);
    }
}

main();
