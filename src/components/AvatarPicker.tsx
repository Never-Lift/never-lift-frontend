import { Check, UserRound } from 'lucide-react'

import { avatars } from '@/lib/avatars'
import { cn } from '@/lib/utils'

type AvatarPickerProps = {
  value?: string | null
  onChange: (avatarId: string | undefined) => void
  disabled?: boolean
  allowEmpty?: boolean
}

export function AvatarPicker({
  value,
  onChange,
  disabled = false,
  allowEmpty = true,
}: AvatarPickerProps) {
  return (
    <fieldset className="space-y-4" disabled={disabled}>
      <div>
        <legend className="text-sm font-bold">Avatar</legend>
        <p className="mt-1 text-xs text-muted-foreground">
          Opcional. Você poderá trocar depois na sua conta.
        </p>
      </div>

      <div
        className="grid grid-cols-3 gap-2.5 sm:grid-cols-5"
        role="radiogroup"
      >
        {allowEmpty && (
          <button
            aria-checked={!value}
            aria-label="Sem avatar"
            className={cn(
              'group relative aspect-square overflow-hidden rounded-xl border bg-background/55 transition duration-200 hover:-translate-y-0.5 hover:border-primary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-card',
              !value
                ? 'border-primary ring-2 ring-primary/20'
                : 'border-border',
            )}
            onClick={() => onChange(undefined)}
            role="radio"
            type="button"
          >
            <UserRound className="m-auto size-8 text-muted-foreground" />
            {!value && (
              <span className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
                <Check aria-hidden="true" className="size-3" />
              </span>
            )}
          </button>
        )}

        {avatars.map((avatar) => {
          const selected = value === avatar.id

          return (
            <button
              aria-checked={selected}
              aria-label={avatar.name}
              className={cn(
                'group relative aspect-square overflow-hidden rounded-xl border bg-background/55 transition duration-200 hover:-translate-y-0.5 hover:border-primary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-card',
                selected
                  ? 'border-primary ring-2 ring-primary/20'
                  : 'border-border',
              )}
              key={avatar.id}
              onClick={() => onChange(avatar.id)}
              role="radio"
              type="button"
            >
              <img
                alt=""
                className="size-full object-cover transition duration-300 group-hover:scale-105"
                src={avatar.image}
              />
              {selected && (
                <span className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
                  <Check aria-hidden="true" className="size-3" />
                </span>
              )}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}
