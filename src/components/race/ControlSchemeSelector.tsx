import {
  KEYBOARD_CONTROL_SCHEMES,
  type KeyboardControlSchemeId,
} from '@/race/control-schemes'

type ControlSchemeSelectorProps = {
  label: string
  value: KeyboardControlSchemeId
  onChange: (value: KeyboardControlSchemeId) => void
  blocked?: readonly KeyboardControlSchemeId[]
  disabled?: boolean
}

export function ControlSchemeSelector({
  label,
  value,
  onChange,
  blocked = [],
  disabled = false,
}: ControlSchemeSelectorProps) {
  return (
    <div aria-label={label} className="grid grid-cols-3 gap-2" role="group">
      {KEYBOARD_CONTROL_SCHEMES.map((scheme) => {
        const unavailable = blocked.includes(scheme.id)
        const selected = scheme.id === value
        return (
          <button
            aria-label={`${scheme.label}${unavailable ? ' (em uso pelo outro jogador)' : ''}`}
            aria-pressed={selected}
            className={`min-w-0 rounded-xl border px-2 py-2.5 text-center transition ${
              selected
                ? 'border-primary/80 bg-primary/12 text-foreground shadow-[inset_0_0_0_1px_rgba(49,199,255,0.16)]'
                : 'border-border/70 bg-background/40 text-muted-foreground hover:border-info/45 hover:bg-muted/55'
            } disabled:cursor-not-allowed disabled:opacity-30`}
            disabled={disabled || unavailable}
            key={scheme.id}
            onClick={() => onChange(scheme.id)}
            type="button"
          >
            <strong className="block truncate text-xs font-extrabold uppercase tracking-[0.12em]">
              {scheme.label}
            </strong>
            <span
              aria-hidden="true"
              className="mx-auto mt-1.5 grid w-fit grid-cols-3 gap-0.5"
            >
              {scheme.keys.map((key, index) => (
                <kbd
                  className={`grid size-5 place-items-center rounded border border-current/25 bg-background/65 font-mono text-[10px] font-black ${
                    index === 0 ? 'col-start-2' : ''
                  }`}
                  key={key}
                >
                  {key}
                </kbd>
              ))}
            </span>
          </button>
        )
      })}
    </div>
  )
}
