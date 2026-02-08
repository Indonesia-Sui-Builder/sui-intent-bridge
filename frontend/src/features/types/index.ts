/**
 * Intent Feature Types
 * 
 * Type definitions for yield intent creation and management
 */

export interface YieldIntent {
  id: string;
  user: string;
  amount: number;
  minApy: number; // in basis points (750 = 7.5%)
  deadline: number;
  status: IntentStatus;
  targetProtocol: string;
  createdAt: number;
}

export type IntentStatus = 'OPEN' | 'FULFILLED' | 'EXPIRED' | 'CANCELLED';

export interface CreateIntentInput {
  amount: string;
  minApy: number;
  deadline: number; // in seconds
  targetProtocol: string;
}

export interface IntentReceipt {
  id: string;
  protocol: string;
  apy: number;
  amount: number;
  fulfilledAt: number;
}

export interface Bid {
  solverName: string;
  apy: number;
  timestamp: number;
}

export interface IntentWithBids extends YieldIntent {
  bids: Bid[];
  winningBid?: Bid;
}

// Yield Intent from Move contract
export interface CreateYieldIntentInput {
  amount: string;      // Amount in SUI (e.g., "0.1")
  minApy: number;      // Minimum APY in basis points (750 = 7.5%)
  deadline: number;    // Deadline in hours
  targetProtocol: string; // 'scallop' | 'navi'
}

export interface YieldIntentResult {
  intentId: string;
  digest: string;
}
