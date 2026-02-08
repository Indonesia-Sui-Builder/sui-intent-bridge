/**
 * IntentCard Component
 * 
 * Card displaying intent details with bid status
 */

// Intent Card Component
import { IntentWithBids } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatAddress, formatApy, formatTimeLeft } from '../utils/formatters';

interface IntentCardProps {
  intent: IntentWithBids;
}

export function IntentCard({ intent }: IntentCardProps) {
  const isOpen = intent.status === 'OPEN';
  const hasWinner = !!intent.winningBid;

  return (
    <Card className="w-full">
      <CardHeader className="pb-2">
        <div className="flex justify-between items-start">
          <CardTitle className="text-lg">Intent #{formatAddress(intent.id)}</CardTitle>
          <StatusBadge status={intent.status} />
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <p className="text-sm text-gray-500">Amount</p>
            <p className="font-medium">{intent.amount.toLocaleString()} USDC</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Min APY</p>
            <p className="font-medium">{formatApy(intent.minApy)}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Target</p>
            <p className="font-medium capitalize">{intent.targetProtocol}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Time Left</p>
            <p className="font-medium">{formatTimeLeft(intent.deadline)}</p>
          </div>
        </div>

        {/* Bid Competition */}
        {isOpen && intent.bids.length > 0 && (
          <div className="border-t pt-4">
            <p className="text-sm font-medium mb-2">Solver Competition</p>
            <div className="space-y-2">
              {intent.bids
                .sort((a, b) => b.apy - a.apy)
                .map((bid, idx) => (
                  <div
                    key={idx}
                    className={`flex justify-between items-center p-2 rounded ${idx === 0 ? 'bg-green-50 border border-green-200' : 'bg-gray-50'
                      }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-lg">
                        {idx === 0 ? '🏆' : '🤖'}
                      </span>
                      <span className="font-medium">{bid.solverName}</span>
                      {idx === 0 && (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">
                          Winning
                        </span>
                      )}
                    </div>
                    <span className={`font-bold ${idx === 0 ? 'text-green-600' : ''}`}>
                      {formatApy(bid.apy)}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        )}

        {hasWinner && (
          <div className="border-t pt-4">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <p className="text-sm text-green-600 font-medium">🎉 Fulfilled!</p>
              <p className="text-lg font-bold text-green-700 mt-1">
                {formatApy(intent.winningBid!.apy)} APY
              </p>
              <p className="text-sm text-green-600">
                via {intent.winningBid!.solverName}
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles = {
    OPEN: 'bg-blue-100 text-blue-700',
    FULFILLED: 'bg-green-100 text-green-700',
    EXPIRED: 'bg-gray-100 text-gray-700',
    CANCELLED: 'bg-red-100 text-red-700',
  };

  return (
    <span className={`px-2 py-1 rounded text-xs font-medium ${styles[status as keyof typeof styles]}`}>
      {status}
    </span>
  );
}
