import { Minus, Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'

/** Shared presentation; each mode owns its limits and validation. */
export function CountStepper({
  label,
  value,
  minimum,
  maximum,
  disabled = false,
  onDecrease,
  onIncrease,
  onValueChange,
  onBlur,
  valueLabel,
}: {
  label: string
  value: string | number
  minimum: number
  maximum: number
  disabled?: boolean
  onDecrease: () => void
  onIncrease: () => void
  onValueChange?: (value: string) => void
  onBlur?: () => void
  valueLabel?: string
}) {
  return (
    <div className="mt-2 flex h-11 items-center justify-between rounded-[10px] border border-border bg-background/45 p-1">
      <Button
        aria-label={`Diminuir ${label.toLocaleLowerCase('pt-BR')}`}
        disabled={disabled || Number(value) <= minimum}
        onClick={onDecrease}
        size="icon"
        type="button"
        variant="ghost"
      >
        <Minus aria-hidden="true" className="size-4" />
      </Button>
      {onValueChange ? (
        <input
          aria-label={label}
          className="h-full min-w-0 flex-1 rounded-md bg-transparent text-center font-mono text-base font-black text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          disabled={disabled}
          inputMode="numeric"
          onBlur={onBlur}
          onChange={(event) => onValueChange(event.target.value)}
          type="text"
          value={value}
        />
      ) : (
        <span
          aria-label={valueLabel}
          className="font-mono text-base font-black text-foreground"
        >
          {value}
        </span>
      )}
      <Button
        aria-label={`Aumentar ${label.toLocaleLowerCase('pt-BR')}`}
        disabled={disabled || Number(value) >= maximum}
        onClick={onIncrease}
        size="icon"
        type="button"
        variant="ghost"
      >
        <Plus aria-hidden="true" className="size-4" />
      </Button>
    </div>
  )
}
