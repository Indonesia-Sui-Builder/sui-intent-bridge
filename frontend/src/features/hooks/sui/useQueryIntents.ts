/**
 * useQueryIntents Hook
 * 
 * Query YieldIntent objects from Sui blockchain
 * Shows real active intents with their status
 */

import { useQuery } from '@tanstack/react-query';
import { useSuiClient } from '@mysten/dapp-kit';
import { useNetworkConfig } from '@/hooks/useNetworkConfig';

export interface IntentEvent {
  intentId: string;
  user: string;
  amount: string;
  minApy: number; // basis points
  deadline: number;
  targetProtocol: string;
  timestamp: number;
  txDigest: string;
}

export interface FulfilledEvent {
  intentId: string;
  user: string;
  solver: string;
  protocol: string;
  apy: number;
  txDigest: string;
  timestamp: number;
}

type IntentStatus = 'OPEN' | 'FULFILLED' | 'EXPIRED';

export interface IntentWithStatus extends IntentEvent {
  status: IntentStatus;
  solver?: string;
  fulfilledApy?: number;
}

export function useQueryIntents() {
  const suiClient = useSuiClient();
  const { config } = useNetworkConfig();

  // Mark the config as used for network-specific query caching
  void config.network;

  // Build event types dynamically based on network
  const INTENT_CREATED_EVENT = `${config.intentPackage}::intent::IntentCreated`;
  const INTENT_FULFILLED_EVENT = `${config.intentPackage}::intent::IntentFulfilled`;

  return useQuery({
    queryKey: ['intents', 'list', config.network],
    queryFn: async (): Promise<IntentWithStatus[]> => {
      console.log('🔍 Querying intents from blockchain...', config.network);

      if (!config.intentPackage) {
        console.warn('⚠️ No intent package configured for', config.network);
        return [];
      }

      // Query IntentCreated events
      const createdEvents = await suiClient.queryEvents({
        query: { MoveEventType: INTENT_CREATED_EVENT },
        limit: 20,
      });

      // Query IntentFulfilled events
      const fulfilledEvents = await suiClient.queryEvents({
        query: { MoveEventType: INTENT_FULFILLED_EVENT },
        limit: 50,
      });

      // Parse created intents
      const intents = new Map<string, IntentWithStatus>();

      for (const event of createdEvents.data) {
        // cast to any first because raw Move events are snake_case
        const parsed = event.parsedJson as any;
        if (parsed && parsed.intent_id) {
          intents.set(parsed.intent_id, {
            intentId: parsed.intent_id,
            user: parsed.user,
            amount: parsed.amount,
            minApy: Number(parsed.min_apy),
            deadline: Number(parsed.deadline),
            targetProtocol: parsed.target_protocol, // assuming snake_case
            timestamp: Number(event.timestampMs),
            txDigest: (event as any).id?.txDigest || 'unknown',
            status: 'OPEN',
          });
        }
      }

      // Mark fulfilled intents
      for (const event of fulfilledEvents.data) {
        const parsed = event.parsedJson as any;
        if (parsed && parsed.intent_id && intents.has(parsed.intent_id)) {
          const intent = intents.get(parsed.intent_id)!;
          intent.status = 'FULFILLED';
          intent.solver = parsed.solver;
          intent.fulfilledApy = Number(parsed.apy);
        }
      }

      // Return all intents for the component to filter
      return Array.from(intents.values());
    },
    refetchInterval: 5000, // Refresh every 5 seconds
  });
}

// Helper functions for formatting
export function formatAmount(amount: string, decimals: number = 9): string {
  const value = parseFloat(amount) / Math.pow(10, decimals);
  return value.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

export function formatApy(apyBps: number): string {
  return (apyBps / 100).toFixed(2) + '%';
}

export function formatAddress(address: string): string {
  if (!address) return '';
  return address.slice(0, 6) + '...' + address.slice(-4);
}

export function formatTimeRemaining(deadline: number): string {
  const now = Date.now();
  const deadlineMs = deadline * 1000;
  const diff = deadlineMs - now;

  if (diff <= 0) return 'Expired';

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
