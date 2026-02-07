import { createWalletClient, http, parseAbi, publicActions } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import * as dotenv from 'dotenv';

dotenv.config();

const EVM_VAULT_ADDRESS = process.env.EVM_VAULT_ADDRESS || "";
const PRIVATE_KEY_EVM = process.env.PRIVATE_KEY_EVM || "";

// Extracted from log
const VAA_HEX = "0x01000000000100b2c90340d5c9ea5eecd5824e87dbc7fbb6f9ff415e5967fc8faa82d52676efe731c9fcaeb6d9d61eb75b08dd166b47e75ec8a026e72e9a954c1b452d73d05d7600698617de000000000015f6a696471cc053ede2007c1624405f7b0aa8e860f780589e358776e0b88ce2f10000000000000003000000000000000000000000000000000000000000000000000000000000000000ffed326eb5d14d91fd492f9793c4c31c127a00c868a6418786394fbfd61cdfcd";

const client = createWalletClient({
    account: privateKeyToAccount(PRIVATE_KEY_EVM as `0x${string}`),
    chain: baseSepolia,
    transport: http()
}).extend(publicActions);

async function main() {
    console.log("Checking Wormhole VAA Verification...");

    // Get Wormhole Address from Vault
    const wormholeAddr = await client.readContract({
        address: EVM_VAULT_ADDRESS as `0x${string}`,
        abi: parseAbi(["function wormhole() view returns (address)"]),
        functionName: 'wormhole'
    });
    console.log(`Wormhole: ${wormholeAddr}`);

    // Call parseAndVerifyVM
    // Interface: function parseAndVerifyVM(bytes calldata encodedVM) external view returns (Structs.VM memory vm, bool valid, string memory reason);
    // Return struct is complex. Viem might struggle interpreting struct without full ABI logic if not standard.
    // However, parseAbi can approximate. VM struct has many fields.
    // Let's rely on basic types or just return data.

    // Actually, we can use `readContract`.

    // Definition of VM struct for parsing
    // struct VM { uint8 version; uint32 timestamp; uint32 nonce; uint16 emitterChainId; bytes32 emitterAddress; uint64 sequence; uint8 consistencyLevel; bytes payload; uint32 guardianSetIndex; Signature[] signatures; bytes32 hash; }
    // struct Signature { bytes32 r; bytes32 s; uint8 v; uint8 guardianIndex; }

    // Check Guardian Set
    try {
        const idx = await client.readContract({
            address: wormholeAddr as `0x${string}`,
            abi: parseAbi(["function getCurrentGuardianSetIndex() view returns (uint32)"]),
            functionName: 'getCurrentGuardianSetIndex'
        });
        console.log(`Current Guardian Set Index: ${idx}`);
    } catch (e) { console.error("Could not read GS Index", e); }

    const abi = [{
        type: 'function',
        name: 'parseAndVerifyVM',
        inputs: [{ type: 'bytes', name: 'encodedVM' }],
        outputs: [
            {
                type: 'tuple', name: 'vm', components: [
                    { type: 'uint8', name: 'version' },
                    { type: 'uint32', name: 'timestamp' },
                    { type: 'uint32', name: 'nonce' },
                    { type: 'uint16', name: 'emitterChainId' },
                    { type: 'bytes32', name: 'emitterAddress' },
                    { type: 'uint64', name: 'sequence' },
                    { type: 'uint8', name: 'consistencyLevel' },
                    { type: 'bytes', name: 'payload' },
                    { type: 'uint32', name: 'guardianSetIndex' },
                    {
                        type: 'tuple[]', name: 'signatures', components: [
                            { type: 'bytes32', name: 'r' },
                            { type: 'bytes32', name: 's' },
                            { type: 'uint8', name: 'v' },
                            { type: 'uint8', name: 'guardianIndex' }
                        ]
                    },
                    { type: 'bytes32', name: 'hash' }
                ]
            },
            { type: 'bool', name: 'valid' },
            { type: 'string', name: 'reason' }
        ],
        stateMutability: 'view'
    }] as const;

    try {
        const result = await client.readContract({
            address: wormholeAddr as `0x${string}`,
            abi,
            functionName: 'parseAndVerifyVM',
            args: [VAA_HEX as `0x${string}`]
        });

        console.log("Verification Result:");
        console.log("Valid:", result[1]);
        console.log("Reason:", result[2]);
        console.log("Emitter Chain:", result[0].emitterChainId);
        console.log("Emitter Addr:", result[0].emitterAddress);
        console.log("Payload:", result[0].payload);

    } catch (e: any) {
        console.error("Verification Reverted:");
        console.error(e.shortMessage || e.message);
        if (e.cause) console.error("Cause:", e.cause);
    }
}

main();
