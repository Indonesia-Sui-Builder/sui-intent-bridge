/**
 * useQueryIntentList Hook (SUI)
 * 
 * Query hook for fetching user's yield intents
 */

import { useQuery } from '@tanstack/react-query';
import { useCurrentAccount } from '@mysten/dapp-kit';

export interface Intent {
  id: string;
  user: string;
  amount: number;
  minApy: number;
  deadline: number;
  status: 'OPEN' | 'FULFILLED' | 'EXPIRED' | 'CANCELLED';
  targetProtocol: string;
  createdAt: number;
}

const MOCK_INTENTS: Intent[] = [
  {
    id: '0x1234567890abcdef',
    user: '0x1234...5678',
    amount: 100,
    minApy: 750,
    deadline: Date.now() + 86400000,
    status: 'OPEN',
    targetProtocol: 'scallop',
    createdAt: Date.now(),
  },
];

export function useQueryIntentList() {
  const account = useCurrentAccount();

  return useQuery<Intent[]>({
    queryKey: ['intents', account?.address],
    queryFn: async () => {
      // TODO: Replace with actual Sui object query
      // const objects = await suiClient.getOwnedObjects({...})
      return MOCK_INTENTS;
    },
    enabled: !!account,
  });
}
