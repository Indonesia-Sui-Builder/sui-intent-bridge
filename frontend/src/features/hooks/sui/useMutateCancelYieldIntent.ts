/**
 * useCancelYieldIntent Hook
 * 
 * Cancels an intent and refunds the assets to the user.
 * Refactored to use @tanstack/react-query useMutation
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit';
import { useNetworkConfig } from '@/hooks/useNetworkConfig';

type UseMutateCancelYieldIntentProps = {
  onSuccess?: (digest: string) => void;
  onError?: (error: Error) => void;
};

export const mutateKeyCancelIntent = ['cancel-yield-intent'];

export function useMutateCancelYieldIntent({ onSuccess, onError }: UseMutateCancelYieldIntentProps = {}) {
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const client = useSuiClient();
  const queryClient = useQueryClient();
  const { config } = useNetworkConfig();

  return useMutation({
    mutationKey: [...mutateKeyCancelIntent, config.network],
    mutationFn: async (intentId: string): Promise<string> => {
      // 1. Fetch object to get the Coin Type
      const obj = await client.getObject({
        id: intentId,
        options: { showType: true }
      });

      if (obj.error || !obj.data) throw new Error('Intent object not found');

      const typeString = obj.data.type;
      const match = typeString?.match(/<(.+)>/);
      const coinType = match ? match[1] : null;

      if (!coinType) throw new Error('Could not determine Coin Type from intent object');

      console.log('Cancelling intent:', { intentId, coinType, network: config.network });

      const { Transaction } = await import('@mysten/sui/transactions');
      const txb = new Transaction();

      txb.moveCall({
        target: `${config.intentPackage}::intent::user_cancel_intent`,
        typeArguments: [coinType],
        arguments: [txb.object(intentId)],
      });

      console.log('Executing cancel transaction...');
      const { digest } = await signAndExecute({
        transaction: txb as any,
      });
      console.log('Cancel submitted:', digest);

      await client.waitForTransaction({ digest });

      return digest;
    },
    onSuccess: (digest) => {
      onSuccess?.(digest);
      // Invalidate balances as we got a refund
      queryClient.invalidateQueries({ queryKey: ['sui-token-balance'] });
    },
    onError: (error) => {
      onError?.(error);
      console.error('Cancel intent error:', error);
    }
  });
}
