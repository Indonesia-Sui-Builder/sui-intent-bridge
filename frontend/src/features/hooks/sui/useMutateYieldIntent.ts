/**
 * useMutateYieldIntent Hook (SUI)
 * 
 * Hook for creating yield intents directly on Sui blockchain via PTB
 * Refactored to use @tanstack/react-query useMutation
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit';
import { useNetworkConfig } from '@/hooks/useNetworkConfig';

export type TokenType = 'SUI' | 'USDC';

export interface TokenConfig {
  symbol: TokenType;
  type: string;
  decimals: number;
}

export const TOKENS: Record<TokenType, TokenConfig> = {
  SUI: {
    symbol: 'SUI',
    type: '0x2::sui::SUI',
    decimals: 9,
  },
  USDC: {
    symbol: 'USDC',
    // Correct Testnet USDC Address
    type: '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC',
    decimals: 6,
  }
};

export interface CreateYieldIntentInput {
  amount: string;      // Amount in user format (e.g., "0.1")
  minApy: number;      // Minimum APY in basis points (750 = 7.5%)
  deadline: number;    // Deadline in hours
  targetProtocol: string; // 'scallop' | 'navi' | 'any'
  token: TokenType;    // Token to deposit
}

export interface YieldIntentResult {
  intentId: string;
  digest: string;
}

type UseMutateYieldIntentProps = {
  onSuccess?: (data: YieldIntentResult) => void;
  onError?: (error: Error) => void;
};

export const mutateKeyCreateIntent = ['create-yield-intent'];

export function useMutateYieldIntent({ onSuccess, onError }: UseMutateYieldIntentProps = {}) {
  const account = useCurrentAccount();
  const suiClient = useSuiClient();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const queryClient = useQueryClient();
  const { config } = useNetworkConfig();

  return useMutation({
    mutationKey: mutateKeyCreateIntent,
    mutationFn: async (input: CreateYieldIntentInput): Promise<YieldIntentResult> => {
      if (!account) {
        throw new Error('Wallet not connected');
      }

      const tokenConfig = TOKENS[input.token];
      if (!tokenConfig) throw new Error(`Unsupported token: ${input.token}`);

      // Convert amount to MIST/Units based on decimals
      const amountInUnits = Math.floor(parseFloat(input.amount) * Math.pow(10, tokenConfig.decimals));

      const minApyBps = Math.floor(input.minApy * 100);
      const deadlineSeconds = input.deadline * 3600;

      console.log('Creating yield intent:', {
        ...input,
        amountInUnits,
        minApyBps,
        deadlineSeconds,
        coinType: tokenConfig.type
      });

      const { Transaction } = await import('@mysten/sui/transactions');
      const txb = new Transaction();

      // Logic differs slightly for SUI (Gas) vs other coins
      let coinToTransfer;

      if (tokenConfig.symbol === 'SUI') {
        const [splitCoin] = txb.splitCoins(txb.gas, [txb.pure.u64(amountInUnits)]);
        coinToTransfer = splitCoin;
      } else {
        // For non-SUI tokens (USDC)
        const coins = await suiClient.getCoins({
          owner: account.address,
          coinType: tokenConfig.type,
        });

        if (coins.data.length === 0) {
          throw new Error(`No ${input.token} coins found in wallet`);
        }

        const firstCoin = coins.data[0];
        if (coins.data.length > 1) {
          const coinObjects = coins.data.slice(1).map(c => txb.object(c.coinObjectId));
          txb.mergeCoins(txb.object(firstCoin.coinObjectId), coinObjects);
        }

        const [splitCoin] = txb.splitCoins(txb.object(firstCoin.coinObjectId), [txb.pure.u64(amountInUnits)]);
        coinToTransfer = splitCoin;
      }

      txb.moveCall({
        target: `${config.intentPackage}::intent::create_intent`,
        typeArguments: [tokenConfig.type],
        arguments: [
          coinToTransfer,
          txb.pure.u64(minApyBps),
          txb.pure.u64(deadlineSeconds),
          txb.pure.string(input.targetProtocol),
        ],
      });

      console.log('Executing transaction...');
      const { digest } = await signAndExecute({
        transaction: txb as any,
      });
      console.log('Transaction submitted. Digest:', digest);

      console.log('Waiting for transaction...');
      const result = await suiClient.waitForTransaction({
        digest,
        options: {
          showEffects: true,
          showObjectChanges: true,
        },
      });

      console.log('Transaction confirmed:', result);

      if (!result.objectChanges) {
        throw new Error('Transaction confirmed but no object changes returned');
      }

      const createdObject = result.objectChanges.find(
        (change) => change.type === 'created' && change.objectType.includes('::intent::YieldIntent')
      );

      const intentId = (createdObject as any)?.objectId || (result.effects?.created?.[0]?.reference?.objectId);

      if (!intentId) {
        throw new Error('Intent creation failed - no object ID found in transaction changes');
      }

      console.log('Intent created:', { intentId, digest });

      return { intentId, digest };
    },
    onSuccess: (data) => {
      onSuccess?.(data);
      // Invalidate all token balances so the UI updates
      queryClient.invalidateQueries({ queryKey: ['sui-token-balance'] });
    },
    onError: (error) => {
      onError?.(error);
      console.error('Create intent error:', error);
    }
  });
}
