import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-slate-800 text-slate-200 border border-slate-700',
        primary: 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/30',
        success: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30',
        warning: 'bg-amber-500/10 text-amber-400 border border-amber-500/30',
        danger: 'bg-red-500/10 text-red-400 border border-red-500/30',
        accent: 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
