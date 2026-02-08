import { motion } from 'framer-motion'
import { Check, Loader2, Clock, ArrowDown, ExternalLink, AlertTriangle } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useQueryIntentStatus, useMutateCancelYieldIntent } from '@/features/intent'
import { useSolverCompetition, SolverRace } from '@/features/solver'

// ─── Status helpers ─────────────────────────────────────────────────────────

type StepStatus = 'completed' | 'in_progress' | 'pending'

function resolveSteps(status: string | undefined): StepStatus[] {
  if (!status) return ['pending', 'pending', 'pending'];

  if (status === 'FULFILLED') {
    return ['completed', 'completed', 'completed'];
  }

  if (status === 'OPEN') {
    return ['completed', 'in_progress', 'pending'];
  }

  return ['completed', 'pending', 'pending'];
}

// ─── Component ───────────────────────────────────────────────────────────────

interface ProgressTrackerProps {
  intentId: string | null
  minApy?: number
  marketApy?: number
}

export function ProgressTracker({ intentId, minApy, marketApy }: ProgressTrackerProps) {
  const { data: statusData } = useQueryIntentStatus(intentId)
  const status = statusData?.status;

  const { competition, isBidding, winner } = useSolverCompetition({
    intentId: intentId ?? '',
    minApy: minApy ?? 7.5,
    marketApy: marketApy ?? 8.5,
    enabled: !!intentId && status === 'OPEN',
    mockMode: false,
  });

  const cancelIntent = useMutateCancelYieldIntent();

  const handleEmergencyWithdraw = () => {
    if (!intentId) return;
    if (!confirm('Cancel this intent and withdraw your assets?')) return;

    cancelIntent.mutate(intentId, {
      onSuccess: () => {
        alert('Intent cancelled successfully! Your assets will be returned.');
      },
      onError: (error: Error) => {
        alert(`Failed to cancel: ${error.message}`);
      },
    });
  };

  const stepStatuses = resolveSteps(status)

  const stepDefs = [
    { label: 'Intent Created', desc: 'Assets locked on Sui' },
    { label: 'Solver Competition', desc: 'Solvers bidding for best yield' },
    { label: 'Yield Deposited', desc: 'Winner fulfilled intent' },
  ]

  const explorerUrl = intentId
    ? `https://suiscan.xyz/testnet/object/${intentId}`
    : null;

  return (
    <Card padding="lg" className="w-full">
      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <h3 className="text-base font-semibold text-white">
          {intentId ? 'Intent Progress' : 'How It Works'}
        </h3>
        <div className="flex items-center gap-2">
          {intentId && (
            <>
              <a
                href={explorerUrl || '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 transition-colors font-mono"
              >
                {intentId.slice(0, 8)}…
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
              {status === 'OPEN' && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleEmergencyWithdraw}
                  disabled={cancelIntent.isPending}
                  className="flex items-center gap-1.5 text-xs border-orange-500/30 text-orange-400 hover:bg-orange-500/10"
                >
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {cancelIntent.isPending ? 'Canceling...' : 'Emergency Withdraw'}
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Steps */}
      <div className="space-y-1.5">
        {stepDefs.map((step, i) => (
          <div key={step.label}>
            <StepRow label={step.label} desc={step.desc} status={stepStatuses[i]} />

            {/* Solver Race UI: shown after step 2 while bidding or winner selected but not yet fulfilled */}
            {i === 1 && status !== 'FULFILLED' && competition && competition.bids.length > 0 && (
              <div className="mt-2 mb-1 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                <SolverRace competition={competition} isBidding={isBidding} />
              </div>
            )}

            {/* Winner executing pulse: winner picked but on-chain not yet fulfilled */}
            {i === 1 && status !== 'FULFILLED' && winner && !isBidding && (
              <div className="mt-2 flex items-center justify-center">
                <span className="animate-pulse text-xs text-indigo-400 font-medium">
                  ⚡ Winner executing on-chain…
                </span>
              </div>
            )}

            {i < stepDefs.length - 1 && (
              <div className="flex justify-center my-0.5">
                <ArrowDown className="h-4 w-4 text-white/[0.12]" />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="mt-6 pt-5 border-t border-white/[0.06] flex flex-wrap gap-4 text-xs text-white/[0.3]">
        <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Completed</div>
        <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-indigo-500 animate-pulse" /> In Progress</div>
        <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-white/[0.15]" /> Pending</div>
      </div>
    </Card>
  )
}

// ─── Step row ────────────────────────────────────────────────────────────────

function StepRow({ label, desc, status }: { label: string; desc: string; status: StepStatus }) {
  const theme = {
    completed: { ring: 'border-emerald-500/40 bg-emerald-500/[0.1]', text: 'text-emerald-400', sub: 'text-emerald-400/60' },
    in_progress: { ring: 'border-indigo-500/40 bg-indigo-500/[0.1]', text: 'text-indigo-300', sub: 'text-indigo-400/50' },
    pending: { ring: 'border-white/[0.08]  bg-white/[0.03]', text: 'text-white/[0.45]', sub: 'text-white/[0.25]' },
  }[status]

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3 }}
      className={`flex items-center gap-3.5 rounded-xl border ${theme.ring} p-3.5`}
    >
      {/* Icon circle */}
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${theme.ring}`}>
        {status === 'completed' && <Check className={`h-5 w-5 ${theme.text}`} />}
        {status === 'in_progress' && <Loader2 className={`h-5 w-5 ${theme.text} animate-spin`} />}
        {status === 'pending' && <Clock className={`h-5 w-5 ${theme.text}`} />}
      </div>
      {/* Text */}
      <div>
        <p className={`text-sm font-medium ${theme.text}`}>{label}</p>
        <p className={`text-xs ${theme.sub}`}>{desc}</p>
      </div>
    </motion.div>
  )
}
