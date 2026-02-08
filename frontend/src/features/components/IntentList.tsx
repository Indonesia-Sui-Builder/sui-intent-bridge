/**
 * IntentList Component
 * 
 * Displays real YieldIntents from Sui blockchain
 * Shows status: Open, Bidding, Fulfilled
 */

import { useQueryIntents, IntentWithStatus, formatAmount, formatApy, formatAddress, formatTimeRemaining } from '../hooks/sui/useQueryIntents';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2,
  Clock,
  CheckCircle2,
  XCircle,
  TrendingUp,
  Wallet,
  Activity,
  ExternalLink
} from 'lucide-react';

export function IntentList() {
  const { data: intents, isLoading, error, refetch } = useQueryIntents();

  if (isLoading) {
    return (
      <Card className="bg-white/[0.02]">
        <CardContent className="p-8 flex flex-col items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-400 mb-4" />
          <p className="text-white/50">Loading intents from blockchain...</p>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="bg-white/[0.02] border-red-500/20">
        <CardContent className="p-6">
          <p className="text-red-400">Failed to load intents</p>
          <Button variant="secondary" size="sm" onClick={() => refetch()} className="mt-2">
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!intents || intents.length === 0) {
    return (
      <Card className="bg-white/[0.02]">
        <CardContent className="p-8 text-center">
          <div className="mx-auto h-12 w-12 rounded-full bg-white/[0.05] flex items-center justify-center mb-4">
            <Activity className="h-6 w-6 text-white/30" />
          </div>
          <p className="text-white/50">No active intents found</p>
          <p className="text-sm text-white/30 mt-1">
            Create an intent to see it here
          </p>
        </CardContent>
      </Card>
    );
  }

  // Separate by status
  const openIntents = intents.filter(i => i.status === 'OPEN');
  const fulfilledIntents = intents.filter(i => i.status === 'FULFILLED');
  const expiredIntents = intents.filter(i => i.status === 'EXPIRED');

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="flex gap-4">
        <StatBadge
          label="Open"
          value={openIntents.length}
          color="indigo"
          icon={Clock}
        />
        <StatBadge
          label="Fulfilled"
          value={fulfilledIntents.length}
          color="emerald"
          icon={CheckCircle2}
        />
        <StatBadge
          label="Expired"
          value={expiredIntents.length}
          color="gray"
          icon={XCircle}
        />
      </div>

      {/* Open Intents */}
      {openIntents.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-white/70 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-indigo-500 animate-pulse" />
            Active Intents (Waiting for Solvers)
          </h3>
          <AnimatePresence>
            {openIntents.map((intent) => (
              <IntentCard key={intent.intentId} intent={intent} />
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Fulfilled Intents */}
      {fulfilledIntents.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-white/70 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            Recently Fulfilled
          </h3>
          {fulfilledIntents.slice(0, 3).map((intent) => (
            <IntentCard key={intent.intentId} intent={intent} />
          ))}
        </div>
      )}
    </div>
  );
}

// Individual intent card
function IntentCard({ intent }: { intent: IntentWithStatus }) {
  const isOpen = intent.status === 'OPEN';
  const isFulfilled = intent.status === 'FULFILLED';
  // const isExpired = intent.status === 'expired';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className={`p-4 rounded-lg border ${isOpen
          ? 'bg-indigo-500/[0.03] border-indigo-500/20'
          : isFulfilled
            ? 'bg-emerald-500/[0.03] border-emerald-500/20'
            : 'bg-white/[0.02] border-white/[0.06]'
        }`}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          {/* Amount */}
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-white/40" />
            <span className="text-lg font-semibold text-white">
              {formatAmount(intent.amount)} SUI
            </span>
          </div>

          {/* User & Time */}
          <div className="flex items-center gap-3 text-xs text-white/40">
            <span>From: {formatAddress(intent.user)}</span>
            {isOpen && (
              <span className="flex items-center gap-1 text-indigo-400">
                <Clock className="h-3 w-3" />
                {formatTimeRemaining(intent.deadline)}
              </span>
            )}
          </div>
        </div>

        {/* Status Badge */}
        <StatusBadge status={intent.status} />
      </div>

      {/* APY Info */}
      <div className="mt-3 pt-3 border-t border-white/[0.06] flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <TrendingUp className="h-4 w-4 text-white/40" />
            <span className="text-sm text-white/60">Min APY:</span>
            <span className="text-sm font-medium text-white">
              {formatApy(intent.minApy)}
            </span>
          </div>

          {isFulfilled && intent.fulfilledApy && (
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              <span className="text-sm text-white/60">Filled at:</span>
              <span className="text-sm font-bold text-emerald-400">
                {formatApy(intent.fulfilledApy)}
              </span>
            </div>
          )}
        </div>

        {/* View on Explorer */}
        <a
          href={`https://suiscan.xyz/testnet/tx/${intent.txDigest}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-white/30 hover:text-white/60 transition-colors"
        >
          <ExternalLink className="h-4 w-4" />
        </a>
      </div>

      {/* Solver info (if fulfilled) */}
      {isFulfilled && intent.solver && (
        <div className="mt-2 text-xs text-white/40">
          Fulfilled by: {formatAddress(intent.solver)}
        </div>
      )}
    </motion.div>
  );
}

// Status badge component
function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    OPEN: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
    FULFILLED: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    EXPIRED: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  };

  const labels: Record<string, string> = {
    OPEN: 'Open',
    FULFILLED: 'Fulfilled',
    EXPIRED: 'Expired',
  };

  const style = styles[status] || styles.EXPIRED;
  const label = labels[status] || status;

  return (
    <Badge
      className={`${style} capitalize`}
    >
      {status === 'OPEN' && (
        <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-indigo-400 animate-pulse" />
      )}
      {label}
    </Badge>
  );
}

// Stat badge component
function StatBadge({
  label,
  value,
  color,
  icon: Icon
}: {
  label: string;
  value: number;
  color: string;
  icon: any;
}) {
  const colorClasses = {
    indigo: 'bg-indigo-500/10 text-indigo-400',
    emerald: 'bg-emerald-500/10 text-emerald-400',
    gray: 'bg-gray-500/10 text-gray-400',
  };

  return (
    <div className={`flex-1 p-3 rounded-lg ${colorClasses[color as keyof typeof colorClasses]}`}>
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 opacity-70" />
        <span className="text-2xl font-bold">{value}</span>
      </div>
      <span className="text-xs opacity-70">{label}</span>
    </div>
  );
}
