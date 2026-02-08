import { wormhole } from "@wormhole-foundation/sdk";
import evm from "@wormhole-foundation/sdk/evm";
import sui from "@wormhole-foundation/sdk/sui";

async function checkVaa() {
    // Direction B (Sui -> EVM): The VAA is emitted by the EVM Fulfillment Tx
    const txHash = "0xcd0bc6ed0cfcec54554d8f45cf460814a4570f70e8f27718b3762ebf8060706c";
    console.log(`🔍 Checking VAA status for EVM Tx: ${txHash}`);

    try {
        const wh = await wormhole("Testnet", [evm, sui]);
        const chain = wh.getChain("BaseSepolia");

        console.log("   Parsing transaction for Wormhole messages...");
        const messages = await chain.parseTransaction(txHash);

        if (messages.length === 0) {
            console.log("❌ No Wormhole messages found in this transaction.");
            return;
        }

        const message = messages[0];
        console.log(`✅ Found Message: Sequence ${message.sequence}, Emitter: ${message.emitter.toUniversalAddress()}`);

        console.log("⏳ Fetching VAA (timeout 30s)...");
        const vaa = await wh.getVaa(message, "Uint8Array", 30000);

        if (vaa) {
            console.log("🎉 VAA is AVAILABLE and READY!");
        } else {
            console.log("⏳ VAA is NOT yet available (still being signed or processed).");
        }
    } catch (error) {
        console.error("❌ Error checking VAA:", error);
    }
}

checkVaa();
