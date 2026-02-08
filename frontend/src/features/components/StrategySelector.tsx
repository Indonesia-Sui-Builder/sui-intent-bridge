import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { STRATEGIES } from '@/config/contracts'
import { TrendingUp, Check } from 'lucide-react'
import { motion } from 'framer-motion'

interface StrategySelectorProps {
  selected: number | null
  onSelect: (id: number) => void
}

export function StrategySelector({ selected, onSelect }: StrategySelectorProps) {
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-white/[0.55]">Select Yield Strategy</label>
      <div className="grid gap-2">
        {STRATEGIES.map((strategy, index) => (
          <motion.div key={strategy.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.08 }}>
            <Card
              padding="md"
              variant={selected === strategy.id ? 'default' : 'ghost'}
              className={`cursor-pointer transition-all duration-200 hover:border-white/[0.2] ${selected === strategy.id
                ? 'border-indigo-500/50 bg-indigo-500/[0.08] ring-1 ring-indigo-500/30'
                : ''
                }`}
              onClick={() => onSelect(strategy.id)}
            >
              <CardContent className="p-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${strategy.protocol === 'Scallop' ? 'bg-orange-500/[0.15] text-orange-400' : 'bg-blue-500/[0.15] text-blue-400'
                      }`}>
                      <TrendingUp className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-white">{strategy.protocol}</span>
                        <Badge variant={strategy.protocol === 'Scallop' ? 'warning' : 'primary'}>{strategy.asset}</Badge>
                      </div>
                      <p className="text-xs text-white/[0.35]">{strategy.description}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="text-xl font-bold text-emerald-400">{strategy.apy}%</div>
                      <div className="text-xs text-white/[0.3]">APY</div>
                    </div>
                    {selected === strategy.id && (
                      <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-500">
                        <Check className="h-4 w-4 text-white" />
                      </motion.div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>
    </div>
  )
}
