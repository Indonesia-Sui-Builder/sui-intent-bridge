/**
 * SimpleYieldForm - Native Sui Yield Intent
 * 
 * Clean form for creating yield intents on Sui
 * Users specify: Amount, Min APY, Deadline
 * Solvers compete to fulfill!
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { useMutateYieldIntent } from '../hooks/sui/useMutateYieldIntent';
import { useQuerySuiTokenBalance } from '@/hooks/sui/useQuerySuiTokenBalance';
import { STRATEGIES } from '@/config/contracts';
import { StrategySelector } from './StrategySelector';
import { motion } from 'framer-motion';
import { Zap, Clock, TrendingUp, Check, Loader2, Wallet } from 'lucide-react';

interface YieldIntentFormProps {
  onIntentCreated?: (intentId: string, digest: string) => void;
}

export const PRESET_AMOUNTS = ['1', '2', '5', '10']; // Minimum 1 SUI for staking
export const PRESET_APYS = [
  { value: 1, label: '1%', color: 'text-amber-400', desc: 'Conservative' },
  { value: 2, label: '2%', color: 'text-emerald-400', desc: 'Staking' },
  { value: 5, label: '5%', color: 'text-cyan-400', desc: 'Lending' },
  { value: 7.5, label: '7.5%', color: 'text-indigo-400', desc: 'High Yield' },
];

export function YieldIntentForm({ onIntentCreated }: YieldIntentFormProps) {
  const account = useCurrentAccount();
  const { mutateAsync: createIntent, isPending, data, reset } = useMutateYieldIntent();

  const [amount, setAmount] = useState('');
  const [minApy, setMinApy] = useState(2);
  const [deadline, setDeadline] = useState(1); // hours
  const [step, setStep] = useState<'form' | 'creating' | 'bidding' | 'success'>('form');

  const isConnected = !!account;
  const [selectedToken, setSelectedToken] = useState<'SUI' | 'USDC'>('SUI');
  const [selectedStrategyId, setSelectedStrategyId] = useState<number | null>(null);

  // Fetch balance
  const { data: balanceData, isLoading: isFetchingBalance } = useQuerySuiTokenBalance({
    accountAddress: account?.address,
    coinType: selectedToken === 'SUI' ? '0x2::sui::SUI' : '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC'
  });

  const rawBalance = balanceData ? parseInt(balanceData.totalBalance) : 0;
  const decimals = selectedToken === 'SUI' ? 9 : 6;
  const balance = (rawBalance / Math.pow(10, decimals)).toFixed(4);

  const handleMax = () => {
    if (!balanceData) return;

    // Leave a bit for gas if SUI
    if (selectedToken === 'SUI') {
      const val = (rawBalance - 100_000_000) / 1e9;
      setAmount(val > 0 ? val.toFixed(4) : '0');
    } else {
      setAmount(balance);
    }
  };

  const handleStrategySelect = (id: number) => {
    if (selectedStrategyId === id) {
      setSelectedStrategyId(null);
      return;
    }

    setSelectedStrategyId(id);
    const strategy = STRATEGIES.find(s => s.id === id);
    if (strategy) {
      setMinApy(strategy.apy);
      // Determine token type from strategy asset string
      const token = strategy.asset === 'SUI' ? 'SUI' : 'USDC';
      setSelectedToken(token);
    }
  };

  const handleSubmit = async () => {
    if (!amount || !isConnected) return;

    const amountNum = parseFloat(amount);
    if (amountNum <= 0) {
      alert('Please enter a valid amount');
      return;
    }

    setStep('creating');

    try {
      const strategy = STRATEGIES.find(s => s.id === selectedStrategyId);

      const result = await createIntent({
        amount,
        minApy,
        deadline,
        targetProtocol: strategy ? strategy.protocol.toLowerCase() : 'any',
        token: selectedToken,
      });

      setStep('bidding');
      onIntentCreated?.(result.intentId, result.digest);

      // Simulate solver bidding delay for demo effect
      setTimeout(() => {
        setStep('success');
      }, 3000);
    } catch (err) {
      console.error('Failed to create intent:', err);
      setStep('form');
    }
  };

  const handleReset = () => {
    setAmount('');
    setMinApy(7.5);
    setDeadline(1);
    setSelectedStrategyId(null);
    setStep('form');
    reset();
  };

  // Success state
  if (step === 'success' && data) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md"
      >
        <Card className="border-emerald-500/20 bg-emerald-500/[0.03]">
          <CardContent className="p-6 text-center space-y-4">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20">
              <Check className="h-8 w-8 text-emerald-400" />
            </div>

            <div>
              <h3 className="text-lg font-semibold text-white">Intent Fulfilled! 🎉</h3>
              <p className="text-sm text-white/50 mt-1">
                Scallop won with <span className="text-emerald-400 font-medium">8.3% APY</span>
              </p>
            </div>

            <div className="rounded-lg bg-white/[0.05] p-4 space-y-2 text-left">
              <div className="flex justify-between text-sm">
                <span className="text-white/40">Intent ID</span>
                <span className="font-mono text-white/70">{data.intentId.slice(0, 12)}...</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-white/40">Amount</span>
                <span className="text-white">{amount} {selectedToken}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-white/40">You Receive</span>
                <span className="text-emerald-400">sSUI (yield-bearing)</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-white/40">APY</span>
                <span className="text-emerald-400 font-medium">8.3%</span>
              </div>
            </div>

            <Button variant="outline" fullWidth onClick={handleReset}>
              Create Another Intent
            </Button>
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  // Bidding state - Show solver competition
  if (step === 'bidding') {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="w-full max-w-md"
      >
        <Card>
          <CardContent className="p-6 space-y-6">
            <div className="text-center space-y-2">
              <div className="flex justify-center gap-1">
                <span className="h-2 w-2 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="h-2 w-2 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="h-2 w-2 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
              <h3 className="text-lg font-semibold text-white">Solvers Competing...</h3>
              <p className="text-sm text-white/50">Scallop vs Navi - who will give you the best rate?</p>
            </div>

            {/* Animated bidding visualization */}
            <div className="space-y-3">
              <SolverBid
                name="Scallop"
                apy={8.3}
                color="indigo"
                delay={0}
                isWinning={true}
              />
              <SolverBid
                name="Navi"
                apy={7.85}
                color="cyan"
                delay={500}
                isWinning={false}
              />
            </div>

            <div className="text-center text-xs text-white/30">
              Bids are submitted atomically via Sui PTB
            </div>
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  // Creating state
  if (step === 'creating') {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="w-full max-w-md"
      >
        <Card>
          <CardContent className="p-6 text-center space-y-4">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-indigo-400" />
            <div>
              <h3 className="text-lg font-semibold text-white">Creating Intent...</h3>
              <p className="text-sm text-white/50">Submitting to Sui blockchain</p>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  // Form state
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-md"
    >
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-indigo-400" />
            <span>Create Yield Intent</span>
          </CardTitle>
          <p className="text-sm text-white/50">
            Set your minimum APY. Solvers will compete to give you the best rate!
          </p>
        </CardHeader>

        <CardContent className="space-y-5">
          {/* Amount */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-sm font-medium text-white/70">Amount</label>
              {isConnected && (
                <div className="flex items-center gap-1.5 cursor-pointer hover:text-white transition-colors text-xs text-white/50" onClick={handleMax}>
                  <Wallet className="w-3 h-3" />
                  <span>
                    Balance: {isFetchingBalance ? '...' : balance}
                  </span>
                  <span className="text-indigo-400 font-medium ml-1 text-[10px] bg-indigo-500/10 px-1 py-0.5 rounded">MAX</span>
                </div>
              )}
            </div>

            <div className="relative group">
              <Input
                type="number"
                placeholder="0.0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="pr-32 font-mono text-lg"
                rightElement={
                  <div className="relative">
                    <button
                      onClick={() => setSelectedToken(selectedToken === 'SUI' ? 'USDC' : 'SUI')}
                      className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white px-3 py-1.5 rounded-lg border border-white/10 transition-colors"
                    >
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${selectedToken === 'SUI' ? 'bg-blue-500' : 'bg-green-500'
                        }`}>
                        {selectedToken[0]}
                      </div>
                      <span className="font-semibold">{selectedToken}</span>
                    </button>
                  </div>
                }
              />
            </div>
            <div className="flex gap-2">
              {PRESET_AMOUNTS.map((amt) => (
                <button
                  key={amt}
                  onClick={() => setAmount(amt)}
                  className="px-3 py-1 text-xs rounded-full bg-white/[0.05] hover:bg-white/[0.1] text-white/60 transition-colors"
                >
                  {amt} {selectedToken}
                </button>
              ))}
            </div>
          </div>

          {/* Strategy Selection */}
          <StrategySelector selected={selectedStrategyId} onSelect={handleStrategySelect} />

          {/* Manual APY Override */}
          {!selectedStrategyId && (
            <div className="space-y-2 pt-2 border-t border-white/[0.05]">
              <label className="text-sm font-medium text-white/70 flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                Minimum APY Override
              </label>
              <div className="flex gap-2">
                {PRESET_APYS.map((apy) => (
                  <button
                    key={apy.value}
                    onClick={() => setMinApy(apy.value)}
                    className={`flex-1 py-1.5 px-2 rounded-lg border text-xs font-medium transition-all ${minApy === apy.value
                      ? `border-${apy.color.split('-')[1]}-500/50 bg-${apy.color.split('-')[1]}-500/10 ${apy.color}`
                      : 'border-white/[0.1] bg-white/[0.03] text-white/60 hover:bg-white/[0.05]'
                      }`}
                  >
                    {apy.label}
                  </button>
                ))}
              </div>
              <input
                type="range"
                min="1"
                max="20"
                step="0.5"
                value={minApy}
                onChange={(e) => setMinApy(parseFloat(e.target.value))}
                className="w-full mt-2"
              />
              <div className="text-center text-sm font-medium text-white/70">
                {minApy}% minimum APY
              </div>
            </div>
          )}

          {/* Deadline */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-white/70 flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Deadline
            </label>
            <div className="flex gap-2">
              {[1, 6, 12, 24].map((hours) => (
                <button
                  key={hours}
                  onClick={() => setDeadline(hours)}
                  className={`flex-1 py-2 px-3 rounded-lg border text-sm transition-all ${deadline === hours
                    ? 'border-indigo-500/50 bg-indigo-500/10 text-indigo-400'
                    : 'border-white/[0.1] bg-white/[0.03] text-white/60 hover:bg-white/[0.05]'
                    }`}
                >
                  {hours}h
                </button>
              ))}
            </div>
          </div>

          {/* Expected outcome */}
          {amount && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="rounded-lg bg-white/[0.03] p-3 space-y-1"
            >
              <div className="flex justify-between text-xs">
                <span className="text-white/40">Target Strategy</span>
                <span className="text-white/70 capitalize">
                  {selectedStrategyId
                    ? STRATEGIES.find(s => s.id === selectedStrategyId)?.name
                    : `Simulated Auction (> ${minApy}%)`}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-white/40">Estimated APY</span>
                <span className="text-emerald-400 font-medium">
                  {selectedStrategyId
                    ? `${STRATEGIES.find(s => s.id === selectedStrategyId)?.apy}%`
                    : `${(minApy + 1.2).toFixed(1)}%`}
                </span>
              </div>
            </motion.div>
          )}

          {/* Wallet warning */}
          {!isConnected && (
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <p className="text-sm text-amber-400 text-center">
                Connect your Sui wallet to create an intent
              </p>
            </div>
          )}

          {/* Submit */}
          <Button
            fullWidth
            size="lg"
            onClick={handleSubmit}
            disabled={!isConnected || !amount || isPending}
          >
            {isPending ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                Create Intent
                <Zap className="h-4 w-4" />
              </span>
            )}
          </Button>

          <p className="text-xs text-center text-white/30">
            Your funds are locked until a solver fulfills your intent or the deadline expires.
          </p>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// Solver bid component
function SolverBid({
  name,
  apy,
  color,
  delay,
  isWinning
}: {
  name: string;
  apy: number;
  color: 'indigo' | 'cyan';
  delay: number;
  isWinning: boolean;
}) {
  const colorClasses = {
    indigo: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-400',
    cyan: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-400',
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: delay / 1000 }}
      className={`flex items-center justify-between p-3 rounded-lg border ${colorClasses[color]} ${isWinning ? 'ring-2 ring-emerald-500/50' : ''
        }`}
    >
      <div className="flex items-center gap-3">
        <div className={`h-8 w-8 rounded-full flex items-center justify-center ${isWinning ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/10'
          }`}>
          {isWinning ? <Check className="h-4 w-4" /> : <span className="text-sm font-bold">{name[0]}</span>}
        </div>
        <div>
          <p className="font-medium">{name}</p>
          <p className="text-xs opacity-70">Solver</p>
        </div>
      </div>
      <div className="text-right">
        <p className="text-lg font-bold">{apy}%</p>
        <p className="text-xs opacity-70">APY</p>
      </div>
    </motion.div>
  );
}
