import { cva } from 'class-variance-authority'

export const buttonVariants = cva(
  'relative inline-flex items-center justify-center gap-2 overflow-hidden whitespace-nowrap rounded-[10px] border text-sm font-extrabold uppercase tracking-[0.04em] transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'border-primary bg-primary text-primary-foreground shadow-[0_12px_28px_rgb(45_125_255/0.18)] hover:-translate-y-0.5 hover:border-info hover:bg-[#3988ff]',
        secondary:
          'border-border bg-secondary/75 text-secondary-foreground hover:-translate-y-0.5 hover:border-primary/60 hover:bg-secondary hover:text-foreground',
        ghost:
          'border-transparent bg-transparent text-muted-foreground hover:border-border hover:bg-muted/70 hover:text-foreground',
        destructive:
          'border-destructive/70 bg-destructive text-destructive-foreground shadow-[0_12px_28px_rgb(255_64_85/0.12)] hover:-translate-y-0.5 hover:bg-[#ff5265]',
      },
      size: {
        default: 'h-11 px-5',
        sm: 'h-9 rounded-lg px-3 text-[11px]',
        lg: 'h-12 px-7 text-sm',
        icon: 'size-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)
