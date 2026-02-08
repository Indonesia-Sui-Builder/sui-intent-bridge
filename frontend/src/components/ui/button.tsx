import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'
import { forwardRef } from 'react'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-2xl text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-indigo-500 text-white hover:bg-indigo-400 active:scale-[0.98]',
        secondary: 'bg-slate-800 text-slate-200 hover:bg-slate-700 border border-slate-700',
        outline: 'border-2 border-slate-700 bg-transparent text-slate-200 hover:bg-slate-800',
        ghost: 'hover:bg-slate-800 text-slate-400 hover:text-slate-200',
        danger: 'bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/30',
      },
      size: {
        sm: 'h-9 px-4 py-2',
        md: 'h-12 px-6 py-3',
        lg: 'h-14 px-8 py-4 text-base',
        icon: 'h-10 w-10',
      },
      fullWidth: {
        true: 'w-full',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, fullWidth, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, fullWidth, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
