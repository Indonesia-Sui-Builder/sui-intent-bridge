/**
 * Intent Formatters
 * 
 * Utility functions for formatting intent data
 */

/**
 * Format address for display (0xabc...def)
 */
export function formatAddress(address: string, start = 6, end = 4): string {
  if (address.length <= start + end) return address;
  return `${address.slice(0, start)}...${address.slice(-end)}`;
}

/**
 * Format APY from basis points to percentage
 * 750 -> 7.5%
 */
export function formatApy(apyBps: number): string {
  return `${(apyBps / 100).toFixed(2)}%`;
}

/**
 * Format time left until deadline
 */
export function formatTimeLeft(deadline: number): string {
  const now = Date.now();
  const diff = deadline - now;

  if (diff <= 0) return 'Expired';

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

/**
 * Format amount with commas
 */
export function formatAmount(amount: number, decimals = 2): string {
  return amount.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
