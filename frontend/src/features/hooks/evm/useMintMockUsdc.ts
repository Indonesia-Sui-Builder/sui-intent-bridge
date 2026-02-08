import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseUnits } from 'viem';

const MOCK_USDC_ABI = [
    {
        "inputs": [
            { "internalType": "address", "name": "to", "type": "address" },
            { "internalType": "uint256", "name": "amount", "type": "uint256" }
        ],
        "name": "mint",
        "outputs": [],
        "stateMutability": "public",
        "type": "function"
    }
] as const;

export function useMintMockUsdc() {
    const { data: hash, writeContract, isPending, error } = useWriteContract();

    const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
        hash
    });

    const mint = (to: string, amount: string = "1000") => {
        const usdcAddress = process.env.NEXT_PUBLIC_EVM_USDC_ADDRESS as `0x${string}`;
        if (!usdcAddress) {
            console.error("VITE_EVM_USDC_ADDRESS not set");
            return;
        }

        writeContract({
            address: usdcAddress,
            abi: MOCK_USDC_ABI,
            functionName: 'mint',
            args: [to as `0x${string}`, parseUnits(amount, 6)],
        });
    }

    return {
        mint,
        isPending,
        isConfirming,
        isSuccess,
        error,
        hash
    };
}
