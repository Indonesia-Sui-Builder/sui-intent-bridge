import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { StrategySelector } from './StrategySelector'
import { useMutateCreateIntentApi, useTestHook } from '@/features/intent'
import { useAccount } from 'wagmi'
import { useCurrentAccount as useSuiAccount } from '@mysten/dapp-kit'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowRight, Wallet, AlertCircle, Check } from 'lucide-react'
import { formatNumber } from '@/lib/utils'

type Direction = 'evm_to_sui' | 'sui_to_evm'

interface IntentFormProps {
  onIntentCreated: (id: string) => void
}

const STRATEGY_MAP: Record<number, string> = { 1: 'scallop_usdc', 2: 'scallop_sui', 3: 'navi_usdc', 4: 'navi_sui' }

export function IntentForm({ onIntentCreated }: IntentFormProps) {
  const { address: evmAddress } = useAccount()
  const suiAccount = useSuiAccount()
  const createIntent = useMutateCreateIntentApi()
  const { setIntent: testSetIntent, hookAddress } = useTestHook()

  const [direction, setDirection] = useState<Direction>('evm_to_sui')
  const [amount, setAmount] = useState('')
  const [selectedStrategy, setSelectedStrategy] = useState<number | null>(null)
  const [createdId, setCreatedId] = useState<string | null>(null)

  const isConnected = !!(evmAddress && suiAccount)
  const isLoading = createIntent.isPending
  const estimatedUsdc = amount ? (direction === 'evm_to_sui' ? parseFloat(amount) * 3000 : parseFloat(amount)) : 0

  // ─── Submit ─────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!amount || !evmAddress || !suiAccount) return
    if (direction === 'evm_to_sui' && !selectedStrategy) return

    try {
      const intent = await createIntent.mutateAsync({
        direction,
        source_address: direction === 'evm_to_sui' ? evmAddress : suiAccount.address,
        dest_address: direction === 'evm_to_sui' ? suiAccount.address : evmAddress,
        evm_chain: 'BaseSepolia',
        input_token: direction === 'evm_to_sui'
          ? '0x4200000000000000000000000000000000000006'
          : '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN',
        input_amount: amount,
        strategy: selectedStrategy ? STRATEGY_MAP[selectedStrategy] : undefined,
      })
      setCreatedId(intent.id)
      onIntentCreated(intent.id)
    } catch {
      // error state handled by mutation
    }
  }

  const reset = () => { setAmount(''); setSelectedStrategy(null); setCreatedId(null); createIntent.reset() }

  // ─── Success State ──────────────────────────────────────────────────────

  if (createdId) {
    return (
      <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.3 }}>
        <Card padding="lg" className="w-full max-w-lg">
          <CardContent className="space-y-5 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/[0.1] border border-emerald-500/25">
              <Check className="h-7 w-7 text-emerald-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">Intent Created</h3>
              <p className="text-sm text-white/[0.4] mt-0.5">Your cross-chain intent is being processed</p>
            </div>

            {/* Detail card */}
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 space-y-2.5">
              <Row label="Intent ID" value={<span className="font-mono text-indigo-400 text-xs">{createdId.slice(0, 8)}…{createdId.slice(-6)}</span>} />
              <Row label="Direction" value={direction === 'evm_to_sui' ? 'EVM → Sui' : 'Sui → EVM'} />
              <Row label="Amount" value={`${amount} ${direction === 'evm_to_sui' ? 'ETH' : 'USDC'}`} />
            </div>

            {/* Mini progress */}
            <div className="flex items-center justify-center gap-2 text-xs text-white/[0.35]">
              <Dot color="emerald" />  Created
              <Line filled />
              <Dot color="indigo" pulse />  Bridging
              <Line />
              <Dot color="muted" />  {direction === 'evm_to_sui' ? 'Deposited' : 'Arrived'}
            </div>

            <Button variant="outline" fullWidth onClick={reset}>New Intent</Button>
          </CardContent>
        </Card>
      </motion.div>
    )
  }

  // ─── Form ───────────────────────────────────────────────────────────────

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
      <Card padding="lg" className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="text-xl">
            <span className="text-white">One Intent.</span>{' '}
            <span className="bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent">Naisu Executes.</span>
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-5">
          {/* Direction toggle */}
          <div className="flex gap-1.5 rounded-xl border border-white/[0.07] bg-white/[0.03] p-1">
            <DirButton active={direction === 'evm_to_sui'} color="indigo" onClick={() => setDirection('evm_to_sui')}>
              <span>EVM</span><ArrowRight className="h-3.5 w-3.5" /><span>Sui</span>
            </DirButton>
            <DirButton active={direction === 'sui_to_evm'} color="cyan" onClick={() => { setDirection('sui_to_evm'); setSelectedStrategy(null) }}>
              <span>Sui</span><ArrowRight className="h-3.5 w-3.5" /><span>EVM</span>
            </DirButton>
          </div>

          {/* Flow path */}
          <div className="flex items-center justify-center gap-1.5 text-xs text-white/[0.28]">
            <span className="text-white/[0.5]">{direction === 'evm_to_sui' ? 'ETH' : 'USDC'}</span>
            <ArrowRight className="h-3 w-3" />
            <span>USDC</span>
            <ArrowRight className="h-3 w-3" />
            <span className="text-indigo-400/70">CCTP</span>
            <ArrowRight className="h-3 w-3" />
            <span className={direction === 'evm_to_sui' ? 'text-emerald-400/70' : 'text-cyan-400/70'}>
              {direction === 'evm_to_sui' ? 'Yield' : 'Base'}
            </span>
          </div>

          {/* Amount */}
          <div>
            <Input
              label="Amount"
              type="number"
              placeholder="0.0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              rightElement={<span className="text-sm font-medium text-white/[0.45]">{direction === 'evm_to_sui' ? 'ETH' : 'USDC'}</span>}
              disabled={isLoading}
            />
            {amount && (
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-1.5 text-xs text-white/[0.32]">
                ≈ {formatNumber(estimatedUsdc)} USDC{direction === 'evm_to_sui' ? ' (after swap)' : ''}
              </motion.p>
            )}
          </div>

          {/* Strategy selector — EVM→Sui only */}
          <AnimatePresence>
            {direction === 'evm_to_sui' && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.25 }}>
                <StrategySelector selected={selectedStrategy} onSelect={setSelectedStrategy} />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Wallet warning */}
          {!isConnected && (
            <div className="flex items-center gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] p-3.5">
              <Wallet className="h-4 w-4 shrink-0 text-amber-400" />
              <span className="text-sm text-amber-400">Connect both EVM and Sui wallets to continue</span>
            </div>
          )}

          {/* Mutation error */}
          {createIntent.error instanceof Error && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2.5 rounded-xl border border-red-500/25 bg-red-500/[0.07] p-3.5">
              <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
              <span className="text-sm text-red-400">{createIntent.error.message}</span>
            </motion.div>
          )}

          {/* CTA */}
          <Button
            fullWidth size="lg"
            onClick={handleSubmit}
            disabled={!isConnected || !amount || (direction === 'evm_to_sui' && !selectedStrategy) || isLoading}
            className="group"
          >
            {isLoading ? (
              <div className="flex items-center gap-2">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                Creating Intent…
              </div>
            ) : (
              <div className="flex items-center gap-2">
                {direction === 'evm_to_sui' ? 'Start Yield Migration' : 'Bridge to EVM'}
                <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
              </div>
            )}
          </Button>

          {/* Dev: direct contract test */}
          <div className="border-t border-white/[0.06] pt-3.5">
            <p className="mb-2 text-xs text-white/[0.22]">Dev testing</p>
            <Button variant="outline" size="sm" fullWidth
              onClick={() => selectedStrategy && testSetIntent(selectedStrategy)}
              disabled={!isConnected || !selectedStrategy}
            >
              Test: setIntentData (contract)
            </Button>
            {hookAddress && <p className="mt-2 text-xs text-white/[0.18] font-mono break-all">Hook: {hookAddress}</p>}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}

// ─── Tiny helpers ────────────────────────────────────────────────────────────

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-white/[0.38]">{label}</span>
      <span className="text-white/[0.75]">{value}</span>
    </div>
  )
}

function DirButton({ active, color, onClick, children }: { active: boolean; color: 'indigo' | 'cyan'; onClick: () => void; children: React.ReactNode }) {
  const styles = {
    indigo: active ? 'bg-indigo-500/[0.18] border border-indigo-500/35 text-indigo-300' : 'text-white/[0.38] hover:text-white/60',
    cyan: active ? 'bg-cyan-500/[0.18]   border border-cyan-500/35   text-cyan-300' : 'text-white/[0.38] hover:text-white/60',
  }
  return (
    <button onClick={onClick} className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium transition-all ${styles[color]}`}>
      {children}
    </button>
  )
}

function Dot({ color, pulse }: { color: 'emerald' | 'indigo' | 'muted'; pulse?: boolean }) {
  const bg = { emerald: 'bg-emerald-500', indigo: 'bg-indigo-500', muted: 'bg-white/[0.15]' }
  return <span className={`h-2.5 w-2.5 rounded-full ${bg[color]} ${pulse ? 'animate-pulse' : ''}`} />
}

function Line({ filled }: { filled?: boolean }) {
  return <span className={`h-px w-5 ${filled ? 'bg-white/[0.3]' : 'bg-white/[0.1]'}`} />
}
