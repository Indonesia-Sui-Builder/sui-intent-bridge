/**
 * useQueryEvmUserIntents Hook (EVM)
 * 
 * Query hook for fetching user's intents from EVM contract
 */

import { useAccount, useReadContract } from 'wagmi';
import { CONTRACTS, HOOK_ABI } from '@/config/contracts';

export function useQueryEvmUserIntents() {
  const { address, chainId } = useAccount();

  const contracts = chainId ? CONTRACTS[chainId as keyof typeof CONTRACTS] : null;

  const { data: userIntents, isLoading, error } = useReadContract({
    address: contracts?.hook as `0x${string}` | undefined,
    abi: HOOK_ABI,
    functionName: 'getUserIntents',
    args: address ? [address] : undefined,
    query: {
      enabled: !!address && !!contracts,
    },
  });

  return {
    data: userIntents as `0x${string}`[] | undefined,
    isLoading,
    error,
    hookAddress: contracts?.hook,
  };
}
