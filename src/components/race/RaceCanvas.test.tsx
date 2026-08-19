import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  DriverTelemetryCard,
  type DriverTelemetry,
} from '@/components/race/RaceCanvas'

afterEach(cleanup)

function telemetry(
  overrides: Partial<DriverTelemetry> = {},
): DriverTelemetry {
  return {
    name: 'Piloto 1',
    lap: 1,
    speedKph: 120,
    handlingMode: 'normal',
    damage: 'none',
    ...overrides,
  }
}

describe('DriverTelemetryCard', () => {
  it('explains the active handling mode and what Shift will do', () => {
    render(
      <DriverTelemetryCard
        driver={telemetry({ handlingMode: 'drift' })}
        driverIndex={0}
        lapCount={1}
      />,
    )

    expect(screen.getByText('Drift ativo')).toBeInTheDocument()
    expect(
      screen.getByText('Shift esquerdo alterna para Normal'),
    ).toBeInTheDocument()
  })

  it.each([
    ['engine', 'Motor: potência reduzida'],
    ['steering', 'Direção: esterço reduzido'],
    ['total-loss', 'Perda total: controles desativados'],
  ] as const)('describes the mechanical effect of %s damage', (damage, label) => {
    render(
      <DriverTelemetryCard
        driver={telemetry({ damage })}
        driverIndex={1}
        lapCount={1}
      />,
    )

    expect(screen.getByText(label)).toBeInTheDocument()
    expect(
      screen.getByText('Shift direito alterna para Drift'),
    ).toBeInTheDocument()
  })
})
