import { Angry, Meh, Smile } from 'lucide-react'

import { Button } from '@/components/ui/button'
import type { BotDifficulty } from '@/race/types'

const options = [
  { id: 'easy', label: 'Fácil', tone: 'text-success', Icon: Smile },
  { id: 'normal', label: 'Médio', tone: 'text-warning', Icon: Meh },
  { id: 'hard', label: 'Difícil', tone: 'text-destructive', Icon: Angry },
] as const

export function DifficultyButton({
  value,
  onChange,
  disabled = false,
}: {
  value: BotDifficulty
  onChange: (value: BotDifficulty) => void
  disabled?: boolean
}) {
  const index = Math.max(0, options.findIndex((option) => option.id === value))
  const { label, tone, Icon } = options[index]
  return (
    <Button
      aria-label={`Dificuldade dos bots: ${label}; clique para alterar`}
      className={`mt-2 size-11 ${tone}`}
      disabled={disabled}
      onClick={() => onChange(options[(index + 1) % options.length].id)}
      size="icon"
      title={`Bots no ${label.toLocaleLowerCase('pt-BR')}`}
      type="button"
      variant="secondary"
    >
      <Icon aria-hidden="true" className="size-5" />
    </Button>
  )
}
