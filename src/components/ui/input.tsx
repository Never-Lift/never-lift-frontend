import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

function Input({ className, type, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'flex h-11 w-full rounded-[10px] border border-input bg-background/65 px-3.5 py-2 text-sm font-medium text-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.025)] outline-none transition placeholder:font-normal placeholder:text-muted-foreground/75 hover:border-border focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      type={type}
      {...props}
    />
  )
}

export { Input }
