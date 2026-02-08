/**
 * useQueryIntentStatus Hook (SUI)
 * 
 * Query hook for fetching intent status directly from Sui network
 * Handles:
 * 1. Checking if intent object exists (OPEN)
 * 2. Checking for IntentFulfilled events (FULFILLED)
 */

import { useSuiClient } from '@mysten/dapp-kit';
import { useQuery } from '@tanstack/react-query';
import { useNetworkConfig } from '@/hooks/useNetworkConfig';
import { INTENT_MODULE } from '@/lib/constants';

export interface IntentStatusResponse {
  id: string;
  status: 'OPEN' | 'FULFILLED' | 'CANCELLED' | 'UNKNOWN';
  details?: any;
}

export function useQueryIntentStatus(intentId: string | null) {
  const client = useSuiClient();
  const { config } = useNetworkConfig();

  // Build event types dynamically based on network config
  const INTENT_FULFILLED_EVENT = `${config.intentPackage}::${INTENT_MODULE}::IntentFulfilled`;
  const INTENT_CANCELLED_EVENT = `${config.intentPackage}::${INTENT_MODULE}::IntentCancelled`;

  return useQuery<IntentStatusResponse>({
    queryKey: ['intent-status', intentId, config.network],
    queryFn: async () => {
      if (!intentId) throw new Error('No intent ID');

      console.log('Checking status for:', intentId, 'on', config.network);

      // 1. Check if object exists
      const objectRes = await client.getObject({
        id: intentId,
        options: { showOwner: true }
      });

      // If object exists and endpoint is correct, it's OPEN
      if (objectRes.data && !objectRes.error) {

        // Object exists and is open
        return { id: intentId, status: 'OPEN', details: objectRes.data };
      }

      // 2. If object missing/deleted, check events to see why
      // Query for Fulfilled events
      const fulfilledEvents = await client.queryEvents({
        query: {
          MoveEventType: INTENT_FULFILLED_EVENT
        },
        limit: 1
      });

      // Client-side filtering for specific intent ID
      const fulfilled = fulfilledEvents.data.find(
        (e: any) => e.parsedJson?.intent_id === intentId
      );

      if (fulfilled) {
        return {
          id: intentId,
          status: 'FULFILLED',
          details: fulfilled.parsedJson
        };
      }

      // Check Cancelled events
      const cancelledEvents = await client.queryEvents({
        query: { MoveEventType: INTENT_CANCELLED_EVENT },
        limit: 50
      });

      const cancelled = cancelledEvents.data.find(
        (e: any) => e.parsedJson?.intent_id === intentId
      );

      if (cancelled) {
        return {
          id: intentId,
          status: 'CANCELLED',
          details: cancelled.parsedJson
        };
      }

      // If object deleted but no event found (yet), it might be race condition or indexing delay
      // For now, assume FULFILLED if deleted (demo optimization)
      if (objectRes.error && (objectRes.error as any).code === 'deleted') {
        return {
          id: intentId,
          status: 'FULFILLED',
          details: { note: 'Object deleted (fulfilled)' }
        };
      }

      return {
        id: intentId,
        status: 'UNKNOWN'
      };
    },
    enabled: !!intentId,
    refetchInterval: (query) => {
      // Stop polling if final state
      const data = query.state.data;
      if (data?.status === 'FULFILLED' || data?.status === 'CANCELLED') return false;
      return 2000;
    },
  });
}
