/**
 * useQueryStrategies Hook (SUI)
 * 
 * Query hook for fetching available yield strategies
 */

import { useQuery } from '@tanstack/react-query';

const API = '/api/v1';

export interface Strategy {
  strategy: string;
  name: string;
  protocol: string;
  asset: string;
  apy: number;
  tvl: string;
  enabled: boolean;
}

const FALLBACK_STRATEGIES: Strategy[] = [
  { strategy: 'scallop_usdc', name: 'Scallop USDC Lending', protocol: 'Scallop', asset: 'USDC', apy: 8.5, tvl: '10M', enabled: true },
  { strategy: 'scallop_sui', name: 'Scallop SUI Lending', protocol: 'Scallop', asset: 'SUI', apy: 12.0, tvl: '5M', enabled: true },
  { strategy: 'navi_usdc', name: 'Navi USDC Lending', protocol: 'Navi', asset: 'USDC', apy: 7.8, tvl: '15M', enabled: true },
  { strategy: 'navi_sui', name: 'Navi SUI Lending', protocol: 'Navi', asset: 'SUI', apy: 11.5, tvl: '8M', enabled: true },
];

export function useQueryStrategies() {
  return useQuery<Strategy[]>({
    queryKey: ['strategies'],
    queryFn: async () => {
      const res = await fetch(`${API}/strategies`);
      if (!res.ok) throw new Error('Failed to fetch strategies');
      return res.json();
    },
    placeholderData: FALLBACK_STRATEGIES,
  });
}
