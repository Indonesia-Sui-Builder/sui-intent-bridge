/**
 * useMutateCancelIntent Hook
 * 
 * Cancel intent and reclaim locked funds
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCurrentAccount, useSignAndExecuteTransaction } from '@mysten/dapp-kit';
import { useNetworkConfig } from '@/hooks/useNetworkConfig';

export function useMutateCancelIntent() {
  const account = useCurrentAccount();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const queryClient = useQueryClient();
  const { config } = useNetworkConfig();

  return useMutation({
    mutationKey: ['cancel-intent', config.network],
    mutationFn: async (intentId: string) => {
      if (!account) {
        throw new Error('Wallet not connected');
      }

      const { Transaction } = await import('@mysten/sui/transactions');
      const txb = new Transaction();

      txb.moveCall({
        target: `${config.intentPackage}::intent::user_cancel_intent`,
        typeArguments: ['0x2::sui::SUI'],
        arguments: [
          txb.object(intentId),
        ],
      });

      const { digest } = await signAndExecute({
        transaction: txb as any,
      });

      console.log('Cancel transaction:', digest);

      return { digest };
    },
    onSuccess: () => {
      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ['intents', 'list'] });
      queryClient.invalidateQueries({ queryKey: ['sui-token-balance'] });
    },
  });
}
