import { wormhole, UniversalAddress } from "@wormhole-foundation/sdk";
import evm from "@wormhole-foundation/sdk/evm";
import sui from "@wormhole-foundation/sdk/sui";

async function main() {
    try {
        console.log("Initializing Wormhole SDK for Testnet...");
        const wh = await wormhole("Testnet", [evm, sui]);

        // Parameters for Sequence 2
        const chain = "BaseSepolia";
        // This is the EVM_INTENT_VAULT_ADDRESS
        const emitterAddress = "0x8cadcb1f8f87c8796ea94fca7c78e0855ef99148";
        const sequence = 3n;

        console.log(`\nFetching VAA for:`);
        console.log(`  Chain: ${chain}`);
        console.log(`  Emitter: ${emitterAddress}`);
        console.log(`  Sequence: ${sequence}`);

        // Construct the Wormhole Message ID
        const whm = {
            chain: chain as any,
            emitter: new UniversalAddress(emitterAddress),
            sequence: sequence,
        };

        console.log("\nAttempting to fetch Signed VAA via SDK...");

        // Timeout 30 seconds for this check
        const vaa = await wh.getVaa(whm, "Uint8Array", 30000);

        if (vaa) {
            console.log("\n✅ VAA Fetched Successfully using SDK!");
            console.log("VAA (Hex):");

            console.log("VAA Fetched. Keys:", Object.keys(vaa));

            // @ts-ignore
            if (vaa.payload) console.log("Payload Length:", vaa.payload.length);

            // In the new SDK, we might need to use serialize
            try {
                // @ts-ignore
                const { serialize } = await import("@wormhole-foundation/sdk");
                // @ts-ignore
                const bytes = serialize(vaa);
                console.log("Full VAA (Hex via serialize):");
                console.log(Buffer.from(bytes).toString("hex"));
            } catch (e: any) {
                console.log("Serialize failed:", e.message);
                // Fallback to manual extraction if possible
                // @ts-ignore
                const bytes = vaa.bytes || vaa.vaaBytes || vaa.vaa;
                if (bytes) {
                    console.log("Full VAA (Hex via manual extraction):");
                    console.log(Buffer.from(bytes).toString("hex"));
                }
            }
        } else {
            console.log("\n❌ VAA not found yet via SDK for Sequence " + sequence);
        }

    } catch (error) {
        console.error("\n❌ Error:", error);
    }
}

main();
