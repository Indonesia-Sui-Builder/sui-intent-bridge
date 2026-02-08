/**
 * useMutateCreateIntentApi Hook (SUI)
 * 
 * React Query mutation hook for creating intents via API
 * Backward compatibility with old useCreateIntentApi
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';

const API = '/api/v1';

export interface CreateIntentPayload {
  direction: 'evm_to_sui' | 'sui_to_evm';
  source_address: string;
  dest_address: string;
  evm_chain: string;
  input_token: string;
  input_amount: string;
  strategy?: string;
}

export interface IntentResponse {
  id: string;
  direction: string;
  status: string;
  source_address: string;
  dest_address: string;
  evm_chain: string;
  input_token: string;
  input_amount: string;
  strategy: string | null;
  bridge_nonce: string | null;
  created_at: number;
}

export function useMutateCreateIntentApi() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreateIntentPayload): Promise<IntentResponse> => {
      const res = await fetch(`${API}/intents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(err || 'Failed to create intent');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['intents'] });
    },
  });
}
