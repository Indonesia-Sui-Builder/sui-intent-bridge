/**
 * useTestHook (EVM)
 * 
 * Dev/testing hook untuk EVM contract interaction
 */

import { useCallback } from 'react';
import { useAccount, useWriteContract, useReadContract } from 'wagmi';
import { useCurrentAccount as useSuiAccount } from '@mysten/dapp-kit';
import { CONTRACTS, HOOK_ABI } from '@/config/contracts';

export function useTestHook() {
  const { address, chainId } = useAccount();
  const suiAccount = useSuiAccount();
  
  const { writeContract } = useWriteContract();
  
  const contracts = chainId ? CONTRACTS[chainId as keyof typeof CONTRACTS] : null;
  
  // Set Intent Data
  const setIntent = useCallback(async (strategyId: number) => {
    if (!address || !suiAccount || !contracts) {
      throw new Error('Wallets not connected');
    }
    
    // Convert Sui address to bytes32
    const suiAddressHex = suiAccount.address.startsWith('0x')
      ? suiAccount.address
      : `0x${suiAccount.address}`;
    const suiDestination = `0x${suiAddressHex.slice(2).padStart(64, '0')}` as `0x${string}`;
    
    writeContract({
      address: contracts.hook as `0x${string}`,
      abi: HOOK_ABI,
      functionName: 'setIntentData',
      args: [suiDestination, strategyId],
    });
    
    return { suiDestination, strategyId };
  }, [address, suiAccount, contracts, writeContract]);
  
  // Check User Intents
  const { data: userIntents } = useReadContract({
    address: contracts?.hook as `0x${string}` | undefined,
    abi: HOOK_ABI,
    functionName: 'getUserIntents',
    args: address ? [address] : undefined,
    query: {
      enabled: !!address && !!contracts,
    },
  });
  
  // Get Intent Details
  const getIntent = useCallback((intentId: `0x${string}`) => {
    return { intentId };
  }, []);
  
  return {
    setIntent,
    userIntents: userIntents as `0x${string}`[] | undefined,
    getIntent,
    hookAddress: contracts?.hook,
  };
}
