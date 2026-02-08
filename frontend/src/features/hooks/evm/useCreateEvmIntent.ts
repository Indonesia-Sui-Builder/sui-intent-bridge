import { useWriteContract, useWaitForTransactionReceipt, useAccount, useReadContract } from 'wagmi';
import { parseUnits, encodePacked, keccak256, erc20Abi, decodeEventLog } from 'viem';
import { useState, useCallback, useEffect } from 'react';

// From Handover or Config
// Using dummy for typing, but real usage passes address
// We should probably rely on the component to pass addresses to keep hook pure regarding config
const EVM_INTENT_BRIDGE_ADDRESS = '0x0000000000000000000000000000000000000000';

export const INTENT_BRIDGE_ABI = [
    {
        "anonymous": false,
        "inputs": [
            { "indexed": true, "internalType": "uint256", "name": "orderId", "type": "uint256" },
            { "indexed": true, "internalType": "address", "name": "depositor", "type": "address" },
            { "indexed": false, "internalType": "uint256", "name": "inputAmount", "type": "uint256" },
            { "indexed": false, "internalType": "uint256", "name": "startOutputAmount", "type": "uint256" },
            { "indexed": false, "internalType": "uint256", "name": "minOutputAmount", "type": "uint256" },
            { "indexed": false, "internalType": "uint256", "name": "startTime", "type": "uint256" },
            { "indexed": false, "internalType": "uint256", "name": "duration", "type": "uint256" },
            { "indexed": false, "internalType": "bytes32", "name": "recipientSui", "type": "bytes32" }
        ],
        "name": "OrderCreated",
        "type": "event"
    },
    {
        "inputs": [
            { "internalType": "uint256", "name": "inputAmount", "type": "uint256" },
            { "internalType": "uint256", "name": "startOutputAmount", "type": "uint256" },
            { "internalType": "uint256", "name": "minOutputAmount", "type": "uint256" },
            { "internalType": "uint256", "name": "duration", "type": "uint256" },
            { "internalType": "bytes32", "name": "recipientSui", "type": "bytes32" }
        ],
        "name": "createOrder",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    }
] as const;

export function useCreateEvmIntent(
    bridgeAddress?: `0x${string}`,
    usdcAddress?: `0x${string}`
) {
    const { address } = useAccount();
    const { writeContractAsync } = useWriteContract();

    // State for createOrder tx
    const [txHash, setTxHash] = useState<`0x${string}` | undefined>(undefined);
    const { isLoading: isConfirming, isSuccess: isConfirmed, data: receipt } = useWaitForTransactionReceipt({ hash: txHash });

    // State for Order ID
    const [orderId, setOrderId] = useState<string | undefined>(undefined);

    // Parse OrderCreated event
    useEffect(() => {
        if (isConfirmed && receipt) {
            console.log("Tx Confirmed! Parsing Logs...", receipt.logs);
            // Find logs that match
            // Event OrderCreated(uint256 indexed orderId, ...)
            // We use viem's decodeEventLog or rely on the fact that we know the ABI
            // Since we need to parse it cleanly:
            try {
                for (const log of receipt.logs) {
                    try {
                        const decoded = decodeEventLog({
                            abi: INTENT_BRIDGE_ABI,
                            data: log.data,
                            topics: log.topics,
                        });
                        if (decoded.eventName === 'OrderCreated') {
                            console.log("Found OrderCreated Event:", decoded);
                            const args = decoded.args as any;
                            setOrderId(args.orderId.toString());
                            break;
                        }
                    } catch (e) {
                        // Not our event
                    }
                }
            } catch (e) {
                console.error("Failed to parse logs", e);
            }
        }
    }, [isConfirmed, receipt]);

    // State for Approve tx
    const [approveHash, setApproveHash] = useState<`0x${string}` | undefined>(undefined);
    const { isLoading: isApproving, isSuccess: isApproved } = useWaitForTransactionReceipt({ hash: approveHash });

    // Read Allowance
    const { data: allowance, refetch: refetchAllowance } = useReadContract({
        address: usdcAddress,
        abi: erc20Abi,
        functionName: 'allowance',
        args: address && bridgeAddress ? [address, bridgeAddress] : undefined,
        query: {
            enabled: !!address && !!bridgeAddress && !!usdcAddress,
        }
    });

    // Read Balance
    const { data: balance, refetch: refetchBalance } = useReadContract({
        address: usdcAddress,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: address ? [address] : undefined,
        query: {
            enabled: !!address && !!usdcAddress,
            refetchInterval: 5000, // Poll every 5s
        }
    });

    // Refetch allowance when approval confirms
    useEffect(() => {
        if (isApproved) {
            console.log("Approval confirmed, refetching allowance...");
            refetchAllowance();
            // Retry after delays to handle RPC propagation lag
            setTimeout(() => { console.log("Refetching allowance (1s)..."); refetchAllowance(); }, 1000);
            setTimeout(() => { console.log("Refetching allowance (3s)..."); refetchAllowance(); }, 3000);
        }
    }, [isApproved, refetchAllowance]);

    const approve = useCallback(async (amount: string) => {
        if (!usdcAddress || !bridgeAddress) return;
        const amountWei = parseUnits(amount, 6); // USDC 6 decimals

        try {
            const hash = await writeContractAsync({
                address: usdcAddress,
                abi: erc20Abi,
                functionName: 'approve',
                args: [bridgeAddress, amountWei],
            });
            setApproveHash(hash);
            return hash;
        } catch (error) {
            console.error("Approval Failed:", error);
            throw error;
        }
    }, [writeContractAsync, usdcAddress, bridgeAddress]);

    const createOrder = useCallback(async (
        inputAmountUsdc: string,
        startOutputAmountSui: string,
        minOutputAmountSui: string,
        durationSeconds: number,
        recipientSui: string
    ) => {
        if (!bridgeAddress) return;

        const inputAmountWei = parseUnits(inputAmountUsdc, 6); // USDC 6 decimals
        const startOutputWei = parseUnits(startOutputAmountSui, 9); // SUI 9 decimals
        const minOutputWei = parseUnits(minOutputAmountSui, 9); // SUI 9 decimals

        // Ensure recipientSui is 0x prefixed and correct length/format if needed
        // Assuming user input "0x..." 32 bytes hex
        let recipientHex = recipientSui;
        if (!recipientHex.startsWith('0x')) recipientHex = '0x' + recipientHex;

        try {
            const hash = await writeContractAsync({
                address: bridgeAddress,
                abi: INTENT_BRIDGE_ABI,
                functionName: 'createOrder',
                args: [
                    inputAmountWei,
                    startOutputWei,
                    minOutputWei,
                    BigInt(durationSeconds),
                    recipientHex as `0x${string}`
                ]
            });

            setTxHash(hash);
            setOrderId(undefined); // Reset
            return hash;
        } catch (error) {
            console.error("Create Create Order Failed:", error);
            throw error;
        }

    }, [writeContractAsync, bridgeAddress]);

    return {
        createOrder,
        approve,
        allowance,
        isConfirming, // Order confirming
        isConfirmed,
        isApproving, // Approval confirming
        isApproved,
        txHash,
        approveHash,
        orderId, // Newly exposed
        receipt,
        balance,
        refetchBalance
    };
}
