/**
 * Self-Hosted Intent Bridge Solver Bot
 * 
 * This solver listens for IntentCreated events on Sui Testnet,
 * sends ETH on Base Sepolia to fulfill the intent, then claims
 * the locked SUI on Sui.
 * 
 * HACKATHON MVP: Trusted solver model (whitelisted address)
 * 
 * PRODUCTION IMPROVEMENTS:
 * - ZK proof generation of EVM transaction
 * - Wormhole VAA for cross-chain verification
 * - Multi-solver competition with slashing
 * - MEV protection mechanisms
 */

import { ethers } from "ethers";
import { getFullnodeUrl, SuiClient } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import * as dotenv from "dotenv";

dotenv.config();

// ============ Configuration ============

// Base Sepolia Configuration
const EVM_RPC = process.env.EVM_RPC || "https://sepolia.base.org";
const PRIVATE_KEY_EVM = process.env.PRIVATE_KEY_EVM || "";

// Sui Testnet Configuration
const PRIVATE_KEY_SUI = process.env.PRIVATE_KEY_SUI || ""; // base64 encoded
const PACKAGE_ID_SUI = process.env.PACKAGE_ID_SUI || "";
const SOLVER_CONFIG_ID = process.env.SOLVER_CONFIG_ID || "";

// Exchange Rate: 1 SUI = 0.0001 ETH (for hackathon demo)
// In production, this would come from an oracle or DEX price feed
const SUI_TO_ETH_RATE = 0.0001;

// ============ Setup Clients ============

console.log("🔧 Initializing clients...");

// EVM Client (Base Sepolia)
const evmProvider = new ethers.JsonRpcProvider(EVM_RPC);
const evmWallet = new ethers.Wallet(PRIVATE_KEY_EVM, evmProvider);

// Sui Client
const suiClient = new SuiClient({ url: getFullnodeUrl("testnet") });

// Initialize keypair - will be set in initializeKeypair()
let suiKeypair: Ed25519Keypair;

/**
 * Initialize the Sui keypair from various formats
 */
async function initializeKeypair(): Promise<Ed25519Keypair> {
    if (PRIVATE_KEY_SUI.startsWith("suiprivkey")) {
        // Bech32 format (suiprivkey1...)
        const { decodeSuiPrivateKey } = await import("@mysten/sui/cryptography");
        const { secretKey } = decodeSuiPrivateKey(PRIVATE_KEY_SUI);
        return Ed25519Keypair.fromSecretKey(secretKey);
    } else {
        try {
            // Try base64 format
            return Ed25519Keypair.fromSecretKey(
                Buffer.from(PRIVATE_KEY_SUI, "base64")
            );
        } catch {
            // Fall back to hex format
            const keyBytes = PRIVATE_KEY_SUI.startsWith("0x")
                ? PRIVATE_KEY_SUI.slice(2)
                : PRIVATE_KEY_SUI;
            return Ed25519Keypair.fromSecretKey(
                Buffer.from(keyBytes, "hex")
            );
        }
    }
}

// ============ Event Types ============

interface IntentCreatedEvent {
    intent_id: string;
    creator: string;
    sui_amount: string;
    recipient_evm: number[]; // vector<u8> comes as array of numbers
    eth_amount_expected: string;
}

// ============ Helper Functions ============

/**
 * Convert Sui vector<u8> (array of numbers) to EVM address string
 */
function vectorToEvmAddress(vector: number[]): string {
    const bytes = new Uint8Array(vector);
    return "0x" + Buffer.from(bytes).toString("hex");
}

/**
 * Calculate ETH amount from SUI amount
 * In production, use real-time price oracle
 */
function calculateEthAmount(suiMist: bigint): bigint {
    // SUI has 9 decimals (MIST), ETH has 18 decimals (wei)
    // 1 SUI = 1e9 MIST
    // 1 ETH = 1e18 wei

    const suiAmount = Number(suiMist) / 1e9; // Convert MIST to SUI
    const ethAmount = suiAmount * SUI_TO_ETH_RATE;
    const weiAmount = BigInt(Math.floor(ethAmount * 1e18));

    return weiAmount;
}

/**
 * Send ETH on Base Sepolia
 */
async function sendEthOnBaseSepolia(
    recipientAddress: string,
    weiAmount: bigint
): Promise<string> {
    console.log(`💸 Sending ${ethers.formatEther(weiAmount)} ETH to ${recipientAddress}...`);

    const tx = await evmWallet.sendTransaction({
        to: recipientAddress,
        value: weiAmount,
    });

    console.log(`⏳ Waiting for EVM tx confirmation: ${tx.hash}`);
    const receipt = await tx.wait();

    if (!receipt) {
        throw new Error("Transaction failed - no receipt");
    }

    console.log(`✅ EVM Transaction confirmed in block ${receipt.blockNumber}`);
    return tx.hash;
}

/**
 * Claim the locked SUI on Sui Testnet
 * 
 * PRODUCTION NOTE: In production, this would include:
 * - ZK proof of the EVM transaction
 * - Or Wormhole VAA verification
 * - Or oracle attestation
 */
async function claimIntentOnSui(intentId: string): Promise<string> {
    console.log(`🔐 Claiming intent ${intentId} on Sui...`);

    const tx = new Transaction();

    // Call claim_intent function
    // SECURITY: Only works because our solver address is whitelisted
    // 
    // PRODUCTION TODO: Add proof parameter
    // ```
    // tx.moveCall({
    //     target: `${PACKAGE_ID_SUI}::intent::claim_intent_with_proof`,
    //     arguments: [
    //         tx.object(intentId),
    //         tx.object(SOLVER_CONFIG_ID),
    //         tx.pure(zkProofBytes), // ZK proof of EVM tx
    //     ],
    // });
    // ```
    tx.moveCall({
        target: `${PACKAGE_ID_SUI}::intent::claim_intent`,
        arguments: [
            tx.object(intentId),
            tx.object(SOLVER_CONFIG_ID),
        ],
    });

    const result = await suiClient.signAndExecuteTransaction({
        signer: suiKeypair,
        transaction: tx,
        options: {
            showEffects: true,
            showEvents: true,
        },
    });

    console.log(`✅ Sui claim transaction: ${result.digest}`);
    return result.digest;
}

/**
 * Process a detected intent
 */
async function processIntent(event: IntentCreatedEvent): Promise<void> {
    const intentId = event.intent_id;
    const suiAmount = BigInt(event.sui_amount);
    const recipientEvm = vectorToEvmAddress(event.recipient_evm);

    console.log("\n" + "=".repeat(60));
    console.log("🔔 NEW INTENT DETECTED!");
    console.log("=".repeat(60));
    console.log(`   Intent ID: ${intentId}`);
    console.log(`   Creator: ${event.creator}`);
    console.log(`   SUI Amount: ${Number(suiAmount) / 1e9} SUI`);
    console.log(`   Recipient EVM: ${recipientEvm}`);
    console.log(`   Expected ETH: ${Number(event.eth_amount_expected) / 1e18} ETH`);

    try {
        // Step 1: Calculate ETH to send
        const ethAmount = calculateEthAmount(suiAmount);
        console.log(`\n📊 Calculated ETH amount: ${ethers.formatEther(ethAmount)} ETH`);

        // Step 2: Send ETH on Base Sepolia
        console.log("\n🌉 Step 1/2: Sending ETH on Base Sepolia...");
        const evmTxHash = await sendEthOnBaseSepolia(recipientEvm, ethAmount);
        console.log(`   ✅ EVM TX: https://sepolia.basescan.org/tx/${evmTxHash}`);

        // Step 3: Claim SUI on Sui Testnet
        console.log("\n🌉 Step 2/2: Claiming SUI on Sui Testnet...");
        const suiDigest = await claimIntentOnSui(intentId);
        console.log(`   ✅ SUI TX: https://testnet.suivision.xyz/txblock/${suiDigest}`);

        console.log("\n🎉 Intent fulfilled successfully!");
        console.log(`   User received: ${ethers.formatEther(ethAmount)} ETH on Base Sepolia`);
        console.log(`   Solver received: ${Number(suiAmount) / 1e9} SUI on Sui Testnet`);
        console.log("=".repeat(60) + "\n");

    } catch (error) {
        console.error("\n❌ Error processing intent:", error);
        console.error("   Intent ID:", intentId);
        // In production: Add retry logic, alerting, etc.
    }
}

// ============ Pending Intent Scanning ============

/**
 * Scan for missed intents (intent objects that exist but weren't processed)
 */
async function scanForPendingIntents(): Promise<void> {
    console.log("\n" + "=".repeat(60));
    console.log("🔍 SCANNING FOR PENDING INTENTS");
    console.log("=".repeat(60));

    let hasNextPage = true;
    let cursor: any = null;
    const pendingIntents: IntentCreatedEvent[] = [];

    // Step 1: Query all IntentCreated events
    try {
        while (hasNextPage) {
            const result = await suiClient.queryEvents({
                query: {
                    MoveEventType: `${PACKAGE_ID_SUI}::intent::IntentCreated`,
                },
                cursor,
                order: "ascending",
            });

            for (const event of result.data) {
                // Ensure the event matches our expected structure
                if (event.parsedJson) {
                    const parsed = event.parsedJson as IntentCreatedEvent;
                    pendingIntents.push(parsed);
                }
            }

            hasNextPage = result.hasNextPage;
            cursor = result.nextCursor;
        }
    } catch (e) {
        console.error("❌ Error querying events:", e);
        return;
    }

    console.log(`📜 Found ${pendingIntents.length} total intent events history.`);

    if (pendingIntents.length === 0) {
        return;
    }

    // Step 2: Check which intents are still valid (object exists on-chain)
    // We process in chunks to respect RPC limits
    const CHUNK_SIZE = 50;
    let processedCount = 0;

    for (let i = 0; i < pendingIntents.length; i += CHUNK_SIZE) {
        const chunk = pendingIntents.slice(i, i + CHUNK_SIZE);
        const ids = chunk.map(x => x.intent_id);

        try {
            const objects = await suiClient.multiGetObjects({
                ids,
                options: { showContent: true } // We just need to know if it exists
            });

            for (let j = 0; j < chunk.length; j++) {
                const obj = objects[j];
                const event = chunk[j];

                // If object data exists, it means the intent is still pending (not deleted/claimed)
                if (obj.data) {
                    console.log(`⚡ Found PENDING intent: ${event.intent_id}`);
                    await processIntent(event);
                    processedCount++;
                }
            }
        } catch (e) {
            console.error("❌ Error checking intent status:", e);
        }
    }

    if (processedCount === 0) {
        console.log("✅ All past intents have been processed or claimed.");
    }
    console.log("=".repeat(60) + "\n");
}

// ============ Event Subscription ============

async function startEventListener(): Promise<void> {
    if (!PACKAGE_ID_SUI) {
        console.error("❌ PACKAGE_ID_SUI environment variable not set!");
        console.log("   Please set: export PACKAGE_ID_SUI='0x...'");
        process.exit(1);
    }

    if (!SOLVER_CONFIG_ID) {
        console.error("❌ SOLVER_CONFIG_ID environment variable not set!");
        console.log("   Please set: export SOLVER_CONFIG_ID='0x...'");
        process.exit(1);
    }

    console.log("\n" + "=".repeat(60));
    console.log("🚀 SELF-HOSTED INTENT BRIDGE SOLVER");
    console.log("=".repeat(60));
    console.log(`   Sui Package: ${PACKAGE_ID_SUI}`);
    console.log(`   Solver Config: ${SOLVER_CONFIG_ID}`);
    console.log(`   EVM Wallet: ${evmWallet.address}`);
    console.log(`   Exchange Rate: 1 SUI = ${SUI_TO_ETH_RATE} ETH`);
    console.log("=".repeat(60));
    console.log("\n👀 Listening for IntentCreated events on Sui Testnet...\n");

    // Subscribe to IntentCreated events
    const unsubscribe = await suiClient.subscribeEvent({
        filter: {
            MoveEventType: `${PACKAGE_ID_SUI}::intent::IntentCreated`,
        },
        onMessage: async (event) => {
            console.log("📨 Event received:", event.type);

            try {
                const parsedEvent = event.parsedJson as IntentCreatedEvent;
                await processIntent(parsedEvent);
            } catch (error) {
                console.error("❌ Error parsing event:", error);
            }
        },
    });

    // Handle graceful shutdown
    process.on("SIGINT", async () => {
        console.log("\n👋 Shutting down solver...");
        await unsubscribe();
        process.exit(0);
    });

    // Keep the process running
    console.log("💡 Press Ctrl+C to stop the solver\n");
}

// ============ Alternative: Polling Mode ============

/**
 * Polling-based event detection (alternative to WebSocket subscription)
 * Use this if WebSocket subscription isn't reliable on testnet
 */
async function startPollingMode(): Promise<void> {
    console.log("📡 Starting in polling mode...");

    let lastCursor: string | null = null;
    const POLL_INTERVAL_MS = 3000; // 3 seconds

    const poll = async () => {
        try {
            const events = await suiClient.queryEvents({
                query: {
                    MoveEventType: `${PACKAGE_ID_SUI}::intent::IntentCreated`,
                },
                cursor: lastCursor ? { eventSeq: lastCursor, txDigest: "" } : undefined,
                order: "ascending",
            });

            for (const event of events.data) {
                console.log("📨 Event detected via polling");

                try {
                    const parsedEvent = event.parsedJson as IntentCreatedEvent;
                    await processIntent(parsedEvent);
                } catch (error) {
                    console.error("❌ Error processing polled event:", error);
                }
            }

            if (events.nextCursor) {
                lastCursor = events.nextCursor.eventSeq;
            }
        } catch (error) {
            console.error("❌ Polling error:", error);
        }
    };

    // Initial poll
    await poll();

    // Continue polling
    setInterval(poll, POLL_INTERVAL_MS);
}

// ============ Main ============

async function main(): Promise<void> {
    // Validate configuration
    if (!PRIVATE_KEY_EVM) {
        console.error("❌ PRIVATE_KEY_EVM not set!");
        process.exit(1);
    }

    if (!PRIVATE_KEY_SUI) {
        console.error("❌ PRIVATE_KEY_SUI not set!");
        process.exit(1);
    }

    // Initialize Sui keypair
    suiKeypair = await initializeKeypair();
    console.log(`📍 Solver Sui Address: ${suiKeypair.getPublicKey().toSuiAddress()}`);

    // Check EVM wallet balance
    const evmBalance = await evmProvider.getBalance(evmWallet.address);
    console.log(`💰 EVM Wallet Balance: ${ethers.formatEther(evmBalance)} ETH`);

    if (evmBalance === 0n) {
        console.warn("⚠️  Warning: EVM wallet has 0 ETH. Cannot fulfill intents!");
    }

    // Check Sui wallet balance
    const suiBalance = await suiClient.getBalance({
        owner: suiKeypair.getPublicKey().toSuiAddress(),
    });
    console.log(`💰 Sui Wallet Balance: ${Number(suiBalance.totalBalance) / 1e9} SUI`);

    // Scan for pending intents that were missed while solver was offline
    await scanForPendingIntents();

    // Start event listener (try WebSocket first, fall back to polling)
    try {
        await startEventListener();
    } catch (error) {
        console.warn("⚠️  WebSocket subscription failed, falling back to polling mode");
        await startPollingMode();
    }
}

main().catch((error) => {
    console.error("💥 Fatal error:", error);
    process.exit(1);
});
