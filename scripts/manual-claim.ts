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
const PACKAGE_ID_SUI = process.env.PACKAGE_ID_SUI || "";
const SOLVER_CONFIG_ID = process.env.SOLVER_CONFIG_ID || "";
const WORMHOLE_STATE_ID = process.env.WORMHOLE_STATE_ID || "0x31358d198147da50db32eda2562951d53973a0c0ad5ed738e9b17d88b213d790";

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
        try {
            const raw = fromB64(PRIVATE_KEY_SUI);
            return Ed25519Keypair.fromSecretKey(raw.slice(1));
        } catch {
            return Ed25519Keypair.fromSecretKey(Buffer.from(PRIVATE_KEY_SUI, "base64"));
        }
    }
}

async function main() {
    console.log(`Polling for VAA: Chain ${EMITTER_CHAIN}, Emitter ${EMITTER_ADDRESS}, Seq ${SEQUENCE}`);

    let vaaBytes: Uint8Array | null = null;
    while (!vaaBytes) {
        try {
            const url = `${WORMHOLE_API_URL}/v1/signed_vaa/${EMITTER_CHAIN}/${EMITTER_ADDRESS}/${SEQUENCE}`;
            const res = await axios.get(url);
            if (res.data.vaaBytes) {
                vaaBytes = ethers.getBytes("0x" + res.data.vaaBytes);
            }
        } catch (e) {
            process.stdout.write(".");
        }
        await new Promise(r => setTimeout(r, 5000));
    }

    console.log(`\n✅ VAA Fetched! Length: ${vaaBytes.length}`);

    console.log("\n💰 Claiming on Sui...");
    const suiKeypair = await initializeSuiKeypair();
    const txSui = new Transaction();
    txSui.moveCall({
        target: `${PACKAGE_ID_SUI}::intent::claim_intent`,
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
