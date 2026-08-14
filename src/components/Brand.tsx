import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

type BrandProps = ComponentProps<'span'> & {
  compact?: boolean
  tagline?: string
}

export function Brand({
  className,
  compact = false,
  tagline,
  ...props
}: BrandProps) {
  return (
    <span
      className={cn('inline-flex min-w-0 items-center gap-3', className)}
      {...props}
    >
      <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-[10px] border border-primary/35 bg-primary/10 shadow-[0_0_30px_rgb(45_125_255/0.12)]">
        <img
          alt=""
          aria-hidden="true"
          className="size-7 object-contain"
          src="/brand/never-lift-symbol-white.svg"
        />
      </span>

      {!compact && (
        <span className="min-w-0">
          <img
            alt="Never Lift"
            className="h-[18px] w-auto max-w-[132px] object-contain object-left"
            src="/brand/never-lift-wordmark-white.svg"
          />
          {tagline && (
            <span className="mt-1 block truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {tagline}
            </span>
          )}
        </span>
      )}
    </span>
  )
}
