import { createWalletClient, http, parseAbi, publicActions } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import * as dotenv from 'dotenv';
import { fromHex } from 'viem';

dotenv.config();

const EVM_VAULT_ADDRESS = process.env.EVM_VAULT_ADDRESS || "";
const PRIVATE_KEY_EVM = process.env.PRIVATE_KEY_EVM || "";

const client = createWalletClient({
    account: privateKeyToAccount(PRIVATE_KEY_EVM as `0x${string}`),
    chain: baseSepolia,
    transport: http()
}).extend(publicActions);

async function main() {
    console.log(`Checking Vault at: ${EVM_VAULT_ADDRESS}`);

    // Check SUI Contract Address
    const suiAddr = await client.readContract({
        address: EVM_VAULT_ADDRESS as `0x${string}`,
        abi: parseAbi(["function suiContractAddress() view returns (bytes32)"]),
        functionName: 'suiContractAddress'
    });
    console.log(`Stored Sui Emitter: ${suiAddr}`);

    // Check Wormhole Address
    try {
        const wormholeAddr = await client.readContract({
            address: EVM_VAULT_ADDRESS as `0x${string}`,
            abi: parseAbi(["function wormhole() view returns (address)"]),
            functionName: 'wormhole'
        });
        console.log(`Stored Wormhole Address: ${wormholeAddr}`);

        const code = await client.getBytecode({ address: wormholeAddr });
        console.log(`Wormhole Code Length: ${code ? code.length : 0}`);
    } catch (e) { console.error("Could not read wormhole", e); }


    // Check Order 0
    try {
        const order = await client.readContract({
            address: EVM_VAULT_ADDRESS as `0x${string}`,
            abi: parseAbi([
                "function orders(uint256) view returns (address depositor, uint256 amount, bytes32 recipientSui, uint8 status)"
            ]),
            functionName: 'orders',
            args: [0n]
        });
        console.log("Order 0 Details:");
        console.log(`  Depositor: ${order[0]}`);
        console.log(`  Amount: ${order[1]}`);
        console.log(`  RecipientSui: ${order[2]}`);
        console.log(`  Status: ${order[3]} (0=Pending, 1=Settled)`);
    } catch (e) {
        console.error("Failed to read order 0 (maybe doesn't exist?)", e);
    }
}

main();
