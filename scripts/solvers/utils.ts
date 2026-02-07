
import { createPublicClient, createWalletClient, http, defineChain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { fromB64 } from "@mysten/sui/utils";
import { wormhole, serialize } from "@wormhole-foundation/sdk";
import evm from "@wormhole-foundation/sdk/evm";
import sui from "@wormhole-foundation/sdk/sui";
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

// ================= CONSTANTS & CONFIG =================

export const EVM_RPC = process.env.EVM_RPC || "https://sepolia.base.org";
export const PRIVATE_KEY_EVM = process.env.PRIVATE_KEY_EVM || "";
export const EVM_INTENT_BRIDGE_ADDRESS = (process.env.EVM_INTENT_VAULT_ADDRESS || "") as `0x${string}`;

export const SUI_RPC = process.env.SUI_RPC || getFullnodeUrl("testnet");
export const PRIVATE_KEY_SUI = process.env.PRIVATE_KEY_SUI || "";
export const SUI_PACKAGE_ID = process.env.SUI_PACKAGE_ID || "";
export const SOLVER_STATE_ID = process.env.SOLVER_STATE_ID || "";
export const WORMHOLE_STATE_ID = process.env.WORMHOLE_STATE_ID || "";
export const SOLVER_CONFIG_ID = process.env.SOLVER_CONFIG_ID || "";

if (!PRIVATE_KEY_EVM || !PRIVATE_KEY_SUI || !EVM_INTENT_BRIDGE_ADDRESS || !SUI_PACKAGE_ID) {
    console.error("❌ Missing required environment variables. Please check .env file.");
    process.exit(1);
}

// ================= CLIENTS =================

// EVM Clients (viem)

export function getEvmAccount() {
    return privateKeyToAccount(PRIVATE_KEY_EVM as `0x${string}`);
}

export const evmPublicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(EVM_RPC)
});

export const evmWalletClient = createWalletClient({
    account: getEvmAccount(),
    chain: baseSepolia,
    transport: http(EVM_RPC)
});

// Sui Client
export const suiClient = new SuiClient({ url: SUI_RPC });

export async function getSuiKeypair(): Promise<Ed25519Keypair> {
    if (PRIVATE_KEY_SUI.startsWith("suiprivkey")) {
        const { decodeSuiPrivateKey } = await import("@mysten/sui/cryptography");
        const { secretKey } = decodeSuiPrivateKey(PRIVATE_KEY_SUI);
        return Ed25519Keypair.fromSecretKey(secretKey);
    } else {
        try {
            const raw = fromB64(PRIVATE_KEY_SUI);
            return Ed25519Keypair.fromSecretKey(raw.slice(1));
        } catch {
            return Ed25519Keypair.fromSecretKey(Buffer.from(PRIVATE_KEY_SUI, "base64"));
        }
    }
}

// ================= UTILS =================

/**
 * Calculates the current price for a Dutch Auction.
 * Formula: price = startAmount - (startAmount - minAmount) * (currentTime - startTime) / duration
 * All inputs should be BigInt or compatible. Time units must match (e.g., all seconds or all ms).
 */
export function calculateCurrentPrice(
    startAmount: bigint,
    minAmount: bigint,
    startTime: bigint,
    duration: bigint,
    currentTime: bigint
): bigint {
    if (currentTime <= startTime) {
        return startAmount;
    }

    const elapsed = currentTime - startTime;

    if (elapsed >= duration) {
        return minAmount;
    }

    const totalDrop = startAmount - minAmount;
    const decay = (totalDrop * elapsed) / duration;

    return startAmount - decay;
}

/**
 * Sleep helper function.
 */
export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetches the VAA from Wormhole Guardian Network.
 * Handles parsing the transaction hash to find the sequence number first.
 */
export async function fetchVAA(
    txHash: string,
    sourceChainName: "BaseSepolia" | "Sui",
    timeoutMs: number = 600000 // 10 minutes default
): Promise<Uint8Array> {
    console.log(`\n🔍 Fetching VAA for Tx: ${txHash} on ${sourceChainName}...`);

    try {
        const wh = await wormhole("Testnet", [evm, sui]);
        const chain = wh.getChain(sourceChainName);

        // Parse transaction to get message
        console.log("   Parsing transaction for Wormhole messages...");
        // Wait for indexer to catch up slightly
        await sleep(5000);

        let messages: any[] = [];
        let attempts = 0;

        // Retry loop for parsing transaction (sometimes indexer is slow)
        while (messages.length === 0 && attempts < 5) {
            try {
                messages = await chain.parseTransaction(txHash);
            } catch (e) {
                console.log(`   ⚠️ Parse attempt ${attempts + 1} failed, retrying...`);
                await sleep(5000);
            }
            attempts++;
        }

        if (messages.length === 0) {
            // One last try
            try {
                messages = await chain.parseTransaction(txHash);
            } catch (e) { }
        }

        if (messages.length === 0) {
            throw new Error("No Wormhole messages found in transaction logs.");
        }

        const message = messages[0];
        console.log(`   Found Message: Sequence ${message.sequence}`);
        console.log("   ⏳ Waiting for Signed VAA...");

        const vaa = await wh.getVaa(message, "Uint8Array", timeoutMs);

        if (!vaa) {
            throw new Error(`VAA retrieval timed out after ${timeoutMs}ms`);
        }

        console.log(`   ✅ VAA Fetched Successfully!`);
        return serialize(vaa);

    } catch (error: any) {
        console.error("❌ Error fetching VAA:", error);
        throw error;
    }
}
