import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const rendererCapture = vi.hoisted(() => ({
  options: [] as Array<{ splitScreenAspectRatio?: () => number }>,
}))

vi.mock('@/race/RaceRenderer', () => ({
  RaceRenderer: class {
    constructor(
      _canvas: HTMLCanvasElement,
      _track: unknown,
      options: { splitScreenAspectRatio?: () => number },
    ) {
      rendererCapture.options.push(options)
    }

    render() {}
  },
}))

import {
  DriverTelemetryCard,
  RaceCanvas,
  type DriverTelemetry,
} from '@/components/race/RaceCanvas'
import { RaceEngine } from '@/race/RaceEngine'
import { SHORT_TRACK } from '@/test/track-fixtures'

afterEach(() => {
  cleanup()
  rendererCapture.options.length = 0
  vi.unstubAllGlobals()
})

function telemetry(
  overrides: Partial<DriverTelemetry> = {},
): DriverTelemetry {
  return {
    name: 'Piloto 1',
    lap: 1,
    speedKph: 120,
    damage: 'none',
    health: 100,
    ...overrides,
  }
}

describe('DriverTelemetryCard', () => {
  it('does not expose removed driving modes or boost controls', () => {
    render(
      <DriverTelemetryCard
        driver={telemetry()}
        driverIndex={0}
        lapCount={1}
      />,
    )

    expect(screen.queryByText(/Modo da corrida/)).not.toBeInTheDocument()
    expect(screen.queryByText(/boost|nitro|shift/i)).not.toBeInTheDocument()
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
    expect(screen.queryByText(/boost|nitro|shift/i)).not.toBeInTheDocument()
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

describe('RaceCanvas layout', () => {
  it('uses the full viewport and the real screen ratio without a bottom overlay', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    vi.stubGlobal('innerWidth', 900)
    vi.stubGlobal('innerHeight', 800)
    const engine = new RaceEngine({
      track: SHORT_TRACK,
      mode: 'local',
      racers: [
        {
          id: 'player-1',
          name: 'Piloto 1',
          kind: 'human',
          color: '#2d7dff',
        },
        {
          id: 'player-2',
          name: 'Piloto 2',
          kind: 'human',
          color: '#ff2e88',
        },
      ],
    })

    render(
      <RaceCanvas
        engine={engine}
        mode="local"
        onAbort={vi.fn()}
        onFinished={vi.fn()}
        timeOfDay="day"
      />,
    )

    const race = screen.getByRole('region', {
      name: 'Corrida local em andamento',
    })
    expect(race).toHaveClass('fixed', 'inset-0', 'h-dvh', 'overflow-hidden')
    expect(screen.getByLabelText(/Circuito/)).toHaveClass(
      'absolute',
      'size-full',
    )
    expect(screen.queryByRole('banner')).not.toBeInTheDocument()
    expect(screen.getByText(/para identificar pilotos/)).toHaveTextContent(
      'Segure ESPAÇO para identificar pilotos',
    )
    expect(screen.getByRole('button', { name: 'Sair da corrida' })).toHaveClass(
      'bottom-4',
      'right-4',
      'size-11',
    )
    expect(rendererCapture.options).toHaveLength(1)
    expect(rendererCapture.options[0].splitScreenAspectRatio?.()).toBe(1.125)
  })
})
