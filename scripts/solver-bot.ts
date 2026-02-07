import { ethers } from "ethers";
import { getFullnodeUrl, SuiClient } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { fromB64 } from "@mysten/sui/utils";
import axios from "axios";
import * as dotenv from "dotenv";

dotenv.config();

// ============ Configuration ============
const EVM_RPC = process.env.EVM_RPC || "https://sepolia.base.org";
const PRIVATE_KEY_EVM = process.env.PRIVATE_KEY_EVM || "";
const EVM_INTENT_VAULT_ADDRESS = process.env.EVM_INTENT_VAULT_ADDRESS || "";

const SUI_RPC = process.env.SUI_RPC || getFullnodeUrl("testnet");
const PRIVATE_KEY_SUI = process.env.PRIVATE_KEY_SUI || "";
const SUI_PACKAGE_ID = process.env.SUI_PACKAGE_ID || "";
const SOLVER_STATE_ID = process.env.SOLVER_STATE_ID || "";
const WORMHOLE_STATE_ID = process.env.WORMHOLE_STATE_ID || "";

// Wormhole Config
const WORMHOLE_API = "https://wormhole-v2-testnet-api.certus.one";
const SUI_CHAIN_ID_WH = 21;
const SUI_EMITTER_ADDRESS = process.env.SUI_EMITTER_ADDRESS || ""; // Should be in .env or derived? logic check. 
// Actually, for VAA fetching we need the emitter address of the SUI CONTRACT. 
// The user provided SUI_EMITTER_CAP_ID but usually we need the package or state object ID as emitter?
// In `solver_engine.move`, the emitter capability is used. The emitter address is usually the ID of the object that holds the EmitterCap OR the address of the sender? 
// For shared object emitters (Sui), it's often the Object ID of the State/EmitterCap holder.
// Let's assume SUI_EMITTER_CAP_ID or SOLVER_STATE_ID is relevant, but typically it is the ID of the `SolverState` object? 
// Wait, `solver_engine` uses `emitter::new`. The emitter address is the ID of the `EmitterCap` object.
// Let's verify `SUI_EMITTER_CAP_ID` from .env.

// ============ ABIs ============
const INTENT_VAULT_ABI = [
    "function createOrder(uint256 inputAmount, uint256 startOutputAmount, uint256 minOutputAmount, uint256 duration, bytes32 recipientSui) external",
    "function settleOrder(bytes calldata encodedVM) external",
    "function getCurrentRequiredAmount(uint256 orderId) public view returns (uint256)",
    "event OrderCreated(uint256 indexed orderId, address indexed depositor, uint256 inputAmount, uint256 startOutputAmount, uint256 minOutputAmount, uint256 startTime, uint256 duration, bytes32 recipientSui)",
    "event OrderSettled(uint256 indexed orderId, address indexed solver, uint256 amountPaidBySolver, bytes32 vaaHash)"
];

// ============ Types ============
interface AuctionOrder {
    orderId: bigint;
    depositor: string;
    inputAmount: bigint;
    startOutputAmount: bigint;
    minOutputAmount: bigint;
    startTime: bigint;
    duration: bigint;
    recipientSui: string;
}

// ============ Main Class ============
class SolverBot {
    evmProvider: ethers.JsonRpcProvider;
    evmWallet: ethers.Wallet;
    vault: ethers.Contract;
    suiClient: SuiClient;
    suiKeypair: Ed25519Keypair;
    solverSuiAddress: string;

    constructor() {
        this.evmProvider = new ethers.JsonRpcProvider(EVM_RPC);
        this.evmWallet = new ethers.Wallet(PRIVATE_KEY_EVM, this.evmProvider);
        this.vault = new ethers.Contract(EVM_INTENT_VAULT_ADDRESS, INTENT_VAULT_ABI, this.evmWallet);
        this.suiClient = new SuiClient({ url: SUI_RPC });

        // Initialize Sui Keypair
        if (PRIVATE_KEY_SUI.startsWith("suiprivkey")) {
            // We'll handle this in init async
        }
    }

    async init() {
        let kp;
        if (PRIVATE_KEY_SUI.startsWith("suiprivkey")) {
            const { decodeSuiPrivateKey } = await import("@mysten/sui/cryptography");
            const { secretKey } = decodeSuiPrivateKey(PRIVATE_KEY_SUI);
            kp = Ed25519Keypair.fromSecretKey(secretKey);
        } else {
            kp = Ed25519Keypair.fromSecretKey(fromB64(PRIVATE_KEY_SUI).slice(1));
        }
        this.suiKeypair = kp;
        this.solverSuiAddress = kp.toSuiAddress();
        console.log(`🤖 Bot Initialized!`);
        console.log(`   EVM Solver: ${this.evmWallet.address}`);
        console.log(`   Sui Solver: ${this.solverSuiAddress}`);
    }

    // ============ The Brain: Price Calculation ============
    calculateDutchPrice(startAmount: bigint, minAmount: bigint, startTime: bigint, duration: bigint): bigint {
        const now = BigInt(Math.floor(Date.now() / 1000));

        if (now <= startTime) return startAmount;

        const elapsed = now - startTime;
        if (elapsed >= duration) return minAmount;

        const totalDrop = startAmount - minAmount;
        const decay = (totalDrop * elapsed) / duration;
        return startAmount - decay;
    }

    // ============ The Loop ============
    async start() {
        console.log(`🎧 Listening for OrderCreated events on ${EVM_INTENT_VAULT_ADDRESS}...`);

        this.vault.on("OrderCreated", async (orderId, depositor, inputAmount, startOutputAmount, minOutputAmount, startTime, duration, recipientSui) => {
            console.log(`\n🔔 New Order #${orderId} Detected!`);
            const order: AuctionOrder = {
                orderId, depositor, inputAmount, startOutputAmount, minOutputAmount, startTime, duration, recipientSui
            };

            this.monitorAndSolve(order);
        });
    }

    async monitorAndSolve(order: AuctionOrder) {
        console.log(`   🕵️  Monitoring Order #${order.orderId}...`);

        const pollInterval = 5000; // 5 seconds

        const interval = setInterval(async () => {
            try {
                // 1. Calculate Required Amount
                const requiredAmount = this.calculateDutchPrice(
                    order.startOutputAmount,
                    order.minOutputAmount,
                    order.startTime,
                    order.duration
                );

                // 2. Check Profitability (Mock: Always profitable if below max?)
                // For this demo, let's just solve it immediately or when it drops slightly.
                // Let's solve when price is <= 99% of start amount to simulate waiting? 
                // Or just solve immediately for demo speed.

                console.log(`   📉 Current Required: ${requiredAmount.toString()} SUI`);

                // Check if already settled on EVM
                // (Optional check to stop polling)

                // EXECUTE
                clearInterval(interval);
                await this.executeSolve(order, requiredAmount);

            } catch (e) {
                console.error("Error in monitoring loop:", e);
                clearInterval(interval);
            }
        }, pollInterval);
    }

    // ============ The Hand: Sui Execution ============
    async executeSolve(order: AuctionOrder, amountToPay: bigint) {
        console.log(`\n⚡ Executing Solve on Sui for ${amountToPay} SUI...`);

        const tx = new Transaction();

        // Split exact amount
        const [paymentCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(amountToPay)]);
        const [feeCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(0)]); // Zero value coin for message fee (Testnet ignores fee?)

        // EVM Address parsing
        // We need to pass the EVM solver address to SUI so it can come back in the Payload
        // `solver_evm_address`: vector<u8> (20 bytes)
        const solverEvmBytes = ethers.getBytes(this.evmWallet.address);

        // Call solve_and_prove
        tx.moveCall({
            target: `${SUI_PACKAGE_ID}::solver_engine::solve_and_prove`,
            arguments: [
                tx.object(SOLVER_STATE_ID),
                tx.object(WORMHOLE_STATE_ID),
                tx.makeMoveVec({ elements: [paymentCoin] }), // vector<Coin<SUI>>
                feeCoin,
                tx.pure.address(order.recipientSui), // Recipient
                tx.pure.vector("u8", Array.from(ethers.getBytes(ethers.toBeHex(order.orderId, 32)))), // Intent ID
                tx.pure.u64(amountToPay), // Amount
                tx.pure.vector("u8", Array.from(solverEvmBytes)), // Solver EVM Address
                tx.object("0x6") // Clock
            ]
        });

        const res = await this.suiClient.signAndExecuteTransaction({
            signer: this.suiKeypair,
            transaction: tx,
            options: { showEffects: true, showEvents: true }
        });

        if (res.effects?.status.status !== "success") {
            throw new Error(`Sui transaction failed: ${res.effects?.status.error}`);
        }

        console.log(`   ✅ Sui Tx Hash: ${res.digest}`);

        // Extract Sequence Number from events
        // We look for `MessagePublished` event from Wormhole or our contract
        // Our contract emits `MessagePublished` with `sequence` field.
        // Or Wormhole emits `WormholeMessage`.
        // Let's parse the events.

        // Find event from our package
        const event = res.events?.find(e => e.type.includes("solver_engine::MessagePublished"));
        if (!event) throw new Error("MessagePublished event not found");

        const seq = (event.parsedJson as any).sequence;
        const emitterAddress = (event.parsedJson as any).sender; // Wait, event has sender? 
        // We need the EMITTER ADDRESS (the Object ID of EmitterCap usually).
        // For `solve_and_prove`, it uses `SolverState.emitter_cap`.
        // The Emitter Address registered in Wormhole is the ID of the EmitterCap object.
        // Let's use `SUI_EMITTER_CAP_ID` from env if available, or try to find it.

        const emitterId = process.env.SUI_EMITTER_CAP_ID;
        console.log(`   Sequence: ${seq}, Emitter: ${emitterId}`);

        await this.fetchVaaAndSettle(emitterId!, seq, order.orderId);
    }

    // ============ The Eyes: VAA Fetching ============
    async fetchVaaAndSettle(emitter: string, paramsSeq: string, orderId: bigint) {
        console.log(`\n👀 Fetching VAA for Seq ${paramsSeq}...`);

        const maxRetries = 30; // 60 seconds / 2s
        let vaaBase64 = "";

        for (let i = 0; i < maxRetries; i++) {
            try {
                const url = `${WORMHOLE_API}/v1/signed_vaa/${SUI_CHAIN_ID_WH}/${emitter}/${paramsSeq}`;
                const response = await axios.get(url);
                if (response.data.vaaBytes) {
                    vaaBase64 = response.data.vaaBytes;
                    console.log(`   ✅ VAA Found!`);
                    break;
                }
            } catch (e) {
                process.stdout.write(".");
            }
            await new Promise(r => setTimeout(r, 2000));
        }

        if (!vaaBase64) {
            console.error("\n❌ Timeout fetching VAA");
            return;
        }

        // ============ The Closer: EVM Settlement ============
        this.settleOnEvm(vaaBase64, orderId);
    }

    async settleOnEvm(vaaBase64: string, orderId: bigint) {
        console.log(`\n💰 Settling Order #${orderId} on EVM...`);

        try {
            const vaaBytes = Buffer.from(vaaBase64, "base64");
            const tx = await this.vault.settleOrder(vaaBytes);
            console.log(`   ⏳ Transaction Sent: ${tx.hash}`);
            await tx.wait();
            console.log(`   🎉 Order Settled Successfully!`);
        } catch (e) {
            console.error("   ❌ Settlement Failed:", e);
        }
    }
}

// Run
const bot = new SolverBot();
bot.init().then(() => bot.start());
