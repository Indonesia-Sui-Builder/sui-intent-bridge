import { ethers } from "ethers";
import { getFullnodeUrl, SuiClient } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import * as dotenv from "dotenv";
import { fromB64 } from "@mysten/sui/utils";
import axios from "axios";

dotenv.config();

const SUI_RPC = process.env.SUI_RPC || getFullnodeUrl("testnet");
const PRIVATE_KEY_SUI = process.env.PRIVATE_KEY_SUI || "";
const SUI_PACKAGE_ID = process.env.SUI_PACKAGE_ID || "";
const SOLVER_CONFIG_ID = process.env.SOLVER_CONFIG_ID || "";
const WORMHOLE_STATE_ID = process.env.WORMHOLE_STATE_ID || "0x31358d198147da50db32eda2562951d53973a0c0ad5ed738e9b17d88b213d790";

if (!SUI_PACKAGE_ID) console.warn("⚠️ SUI_PACKAGE_ID is empty!");
if (!SOLVER_CONFIG_ID) console.warn("⚠️ SOLVER_CONFIG_ID is empty!");
if (!PRIVATE_KEY_SUI) console.warn("⚠️ PRIVATE_KEY_SUI is empty!");

const WORMHOLE_API_URL = "https://api.testnet.wormholescan.io";

// Target VAA details
const EMITTER_CHAIN = 10004;
const EMITTER_ADDRESS = "8cadcb1f8f87c8796ea94fca7c78e0855ef99148";
const SEQUENCE = 1;
const INTENT_ID = "0xd256c0efb719f6c1df04424a3db325b7076df58c9b779440070ebbac3bdccda0";

const suiClient = new SuiClient({ url: SUI_RPC });

async function initializeSuiKeypair(): Promise<Ed25519Keypair> {
    if (PRIVATE_KEY_SUI.startsWith("suiprivkey")) {
        const { decodeSuiPrivateKey } = await import("@mysten/sui/cryptography");
        const { secretKey } = decodeSuiPrivateKey(PRIVATE_KEY_SUI);
        return Ed25519Keypair.fromSecretKey(secretKey);
    } else {
        // Try raw base64 (32 bytes or 64 bytes)
        try {
            // First try pure base64
            const raw = Buffer.from(PRIVATE_KEY_SUI, "base64");
            if (raw.length === 32) {
                return Ed25519Keypair.fromSecretKey(raw);
            }
            // If length is not 32, maybe it's 64 (priv+pub)
            if (raw.length === 64) {
                return Ed25519Keypair.fromSecretKey(raw.slice(0, 32));
            }
        } catch { }

        throw new Error("Invalid SUI Private Key format in .env");
    }
}

async function main() {
    console.log(`Polling for VAA: Chain ${EMITTER_CHAIN}, Emitter ${EMITTER_ADDRESS}, Seq ${SEQUENCE}`);

    let vaaBytes: Uint8Array | null = null;
    while (!vaaBytes) {
        try {
            const url = `${WORMHOLE_API_URL}/v1/signed_vaa/${EMITTER_CHAIN}/${EMITTER_ADDRESS}/${SEQUENCE}`;
            console.log(`Checking: ${url}`);
            const res = await axios.get(url);

            if (res.data.vaaBytes) {
                console.log("VAA Found:", res.data.vaaBytes);
                // The API returns base64 string, so we need to decode it
                // ethers.getBytes handles hex strings, but maybe not raw base64 directly?
                // Let's use Buffer for safety if it's base64
                vaaBytes = new Uint8Array(Buffer.from(res.data.vaaBytes, "base64"));
            }
        } catch (e: any) {
            console.log(`Polling error: ${e.message}`);
            if (e.response) {
                console.log(`Status: ${e.response.status}`);
            }
        }
        await new Promise(r => setTimeout(r, 5000));
    }

    console.log(`\n✅ VAA Fetched! Length: ${vaaBytes.length}`);

    console.log(`\n💰 Claiming on Sui...`);
    console.log(`   Package: ${SUI_PACKAGE_ID}`);
    console.log(`   Intent: ${INTENT_ID}`);
    console.log(`   Config: ${SOLVER_CONFIG_ID}`);

    const suiKeypair = await initializeSuiKeypair();
    const txSui = new Transaction();
    txSui.moveCall({
        target: `${SUI_PACKAGE_ID}::intent::claim_intent`,
        arguments: [
            txSui.object(INTENT_ID),
            txSui.object(SOLVER_CONFIG_ID),
            txSui.object(WORMHOLE_STATE_ID),
            txSui.object("0x6"), // Clock
            txSui.pure.vector("u8", Array.from(vaaBytes))
        ]
    });

    const resSui = await suiClient.signAndExecuteTransaction({
        signer: suiKeypair,
        transaction: txSui,
        options: { showEffects: true }
    });

    console.log(`   ✅ Sui Claim Tx: ${resSui.digest}`);
    console.log("🎉 BRIDGE COMPLETE!");
}

main().catch(console.error);
