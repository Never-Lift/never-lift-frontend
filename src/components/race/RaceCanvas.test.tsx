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
    health: 100,
    ...overrides,
  }
}

describe('DriverTelemetryCard', () => {
  it('explains the race-wide handling mode and reserves Shift for boost', () => {
    render(
      <DriverTelemetryCard
        driver={telemetry({ handlingMode: 'drift' })}
        driverIndex={0}
        lapCount={1}
      />,
    )

    expect(screen.getByText('Modo da corrida: Drift')).toBeInTheDocument()
    expect(
      screen.getByText('Shift esquerdo: boost (disponível no Módulo 5)'),
    ).toBeInTheDocument()
  })

  it.each([
    ['engine', 'Motor: potência levemente reduzida'],
    ['steering', 'Direção: carro puxando para um lado'],
    ['engine-and-steering', 'Motor e direção danificados'],
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
      screen.getByText('Shift direito: boost (disponível no Módulo 5)'),
    ).toBeInTheDocument()
  })

  it('shows cumulative vehicle health as an accessible bar', () => {
    render(
      <DriverTelemetryCard
        driver={telemetry({ damage: 'steering', health: 73 })}
        driverIndex={0}
        lapCount={1}
      />,
    )

    expect(
      screen.getByRole('progressbar', { name: 'Vida do carro: 73%' }),
    ).toHaveAttribute('aria-valuenow', '73')
  })
})
