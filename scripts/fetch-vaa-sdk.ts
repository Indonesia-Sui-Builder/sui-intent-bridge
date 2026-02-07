import { wormhole } from "@wormhole-foundation/sdk";
import evm from "@wormhole-foundation/sdk/evm";
import sui from "@wormhole-foundation/sdk/sui";

async function main() {
    try {
        console.log("Initializing Wormhole SDK for Testnet...");
        const wh = await wormhole("Testnet", [evm, sui]);

        const chain = "BaseSepolia";
        const txHash = "0x45a669cf29df95c5a0123d70726e92abb9d4262a10ec04d3b4bf26ce8640671d";

        console.log(`\nParsing transaction on ${chain}...`);
        console.log(`Tx Hash: ${txHash}`);

        // Get the chain context
        const srcChain = wh.getChain(chain);

        // Parse the transaction to get the Wormhole Message ID
        const messages = await srcChain.parseTransaction(txHash);
        console.log(`\nFound ${messages.length} Wormhole message(s) in transaction.`);

        if (messages.length === 0) {
            console.error("No Wormhole messages found! Ensure the transaction emitted a LogMessagePublished event.");
            return;
        }

        const message = messages[0];
        console.log("Message Details:", message);

        console.log("\nAttempting to fetch Signed VAA (Timeout: 2 minutes)...");

        // Attempt to fetch the VAA
        // 120000 ms = 2 minutes
        const vaa = await wh.getVaa(message, "Uint8Array", 120000);

        if (vaa) {
            console.log("\n✅ VAA Fetched Successfully!");
            console.log("VAA Details:", vaa);
            // The result might be an object that contains the bytes
            // Based on SDK docs, if 'Uint8Array' is passed, it should return Uint8Array
            // But if it's an object, let's inspect it or try to acccess 'payload' or similar if it's a parsed VAA

            // If vaa is standard VAA object from SDK, it might have 'payload' property or similar
            // Let's safe stringify
            try {
                if (vaa instanceof Uint8Array) {
                    console.log(Buffer.from(vaa).toString("hex"));
                } else {
                    // Check if it's a VAA object with 'payload' or 'bytes'
                    // @ts-ignore
                    const bytes = vaa.bytes || vaa.payload || (vaa as any).vaaBytes;
                    if (bytes) {
                        console.log(Buffer.from(bytes).toString("hex"));
                    } else {
                        console.log("Could not find bytes in VAA object. JSON dump:");
                        console.log(JSON.stringify(vaa, (key, value) =>
                            typeof value === 'bigint' ? value.toString() : value
                            , 2));
                    }
                }
            } catch (e) {
                console.log("Error printing hex:", e);
            }
        } else {
            console.log("\n❌ VAA Fetch Timed Out.");
        }

    } catch (error) {
        console.error("\n❌ Error:", error);
    }
}

main();
