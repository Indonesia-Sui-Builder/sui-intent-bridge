/**
 * useMutateEvmIntent Hook (EVM)
 * 
 * Hook for creating intents on EVM via wagmi
 */

import { useState, useCallback } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { useCurrentAccount as useSuiAccount } from '@mysten/dapp-kit';
import { CONTRACTS, HOOK_ABI } from '@/config/contracts';
import { parseEther } from 'viem';

export type EvmIntentStatus = 'idle' | 'setting_intent' | 'swapping' | 'bridging' | 'depositing' | 'completed' | 'failed';

export interface EvmIntentState {
  status: EvmIntentStatus;
  txHash?: `0x${string}`;
  error?: string;
  intentId?: string;
}

interface UseMutateEvmIntentReturn {
  mutate: (amount: string, strategyId: number) => Promise<void>;
  state: EvmIntentState;
  reset: () => void;
  isConfirming: boolean;
  isConfirmed: boolean;
  error: Error | null;
}

export function useMutateEvmIntent(): UseMutateEvmIntentReturn {
  const { address, chainId } = useAccount();
  const suiAccount = useSuiAccount();
  const [state, setState] = useState<EvmIntentState>({ status: 'idle' });

  const { writeContract, data: hash, error: writeError } = useWriteContract() as any;
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash });

  const mutate = useCallback(async (amount: string, strategyId: number) => {
    if (!address || !chainId || !suiAccount) {
      setState({ status: 'failed', error: 'Please connect both EVM and Sui wallets' });
      return;
    }

    const contracts = CONTRACTS[chainId as keyof typeof CONTRACTS];
    if (!contracts) {
      setState({ status: 'failed', error: 'Unsupported chain' });
      return;
    }

    try {
      setState({ status: 'setting_intent' });

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
        value: parseEther(amount),
      });

      setState({ status: 'swapping', txHash: hash });
    } catch (err) {
      setState({
        status: 'failed',
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }, [address, chainId, suiAccount, writeContract, hash]);

  const reset = useCallback(() => {
    setState({ status: 'idle' });
  }, []);

  return {
    mutate,
    state,
    reset,
    isConfirming,
    isConfirmed,
    error: writeError,
  };
}
