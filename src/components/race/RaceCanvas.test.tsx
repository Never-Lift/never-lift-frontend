import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
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
import { LocalRaceSession } from '@/race/LocalRaceSession'
import { SHORT_TRACK } from '@/test/track-fixtures'

afterEach(() => {
  cleanup()
  rendererCapture.options.length = 0
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
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
  it.each(['solo', 'local'] as const)('exits %s with Esc and cleans up the shortcut on unmount', (mode) => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const onAbort = vi.fn()
    const onRestart = vi.fn()
    const engine = new RaceEngine({ track: SHORT_TRACK, mode, racers: [
      { id: 'player-1', name: 'Pilot', kind: 'human', color: '#2d7dff' },
    ] })
    const props = { engine, mode, timeOfDay: 'day' as const, onFinished: vi.fn(), onRestart }
    const { rerender, unmount } = render(<RaceCanvas {...props} onAbort={onAbort} />)
    expect(screen.getByRole('button', { name: 'Sair da corrida' })).toHaveAttribute('aria-keyshortcuts', 'Escape')
    fireEvent.keyDown(window, { code: 'Escape', key: 'Escape' })
    fireEvent.keyDown(window, { code: 'Escape', repeat: true })
    expect(onAbort).toHaveBeenCalledTimes(1)
    expect(onRestart).not.toHaveBeenCalled()
    const latestAbort = vi.fn()
    rerender(<RaceCanvas {...props} onAbort={latestAbort} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(latestAbort).toHaveBeenCalledTimes(1)
    for (const tag of ['input', 'textarea', 'select']) {
      const element = document.createElement(tag)
      document.body.append(element)
      fireEvent.keyDown(element, { key: 'Escape' })
      element.remove()
    }
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.append(dialog)
    fireEvent.keyDown(dialog, { key: 'Escape' })
    dialog.remove()
    const prevented = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
    prevented.preventDefault()
    window.dispatchEvent(prevented)
    expect(latestAbort).toHaveBeenCalledTimes(1)
    unmount()
    fireEvent.keyDown(window, { code: 'Escape' })
    expect(latestAbort).toHaveBeenCalledTimes(1)
  })

  it('passes each current vehicle to the keyboard adapter in the local frame loop', () => {
    let frame: FrameRequestCallback = () => {}
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => { frame = callback; return 1 }))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const engine = new RaceEngine({ track: SHORT_TRACK, mode: 'local', racers: [
      { id: 'player-1', name: 'P1', kind: 'human', color: '#2d7dff' },
      { id: 'player-2', name: 'P2', kind: 'human', color: '#ff0000' },
    ] })
    const getState = engine.getVehicleState.bind(engine)
    vi.spyOn(engine, 'getVehicleState').mockImplementation((id) => {
      const vehicle = getState(id)!
      vehicle.angle = 0
      vehicle.velocity = { x: id === 'player-1' ? -4 : 4, y: 0 }
      return vehicle
    })
    const inputSpy = vi.spyOn(LocalRaceSession.prototype, 'advanceFrame')
    render(<RaceCanvas engine={engine} mode="local" timeOfDay="day" onAbort={vi.fn()} onRestart={vi.fn()} onFinished={vi.fn()} />)
    fireEvent.keyDown(window, { code: 'KeyD' })
    fireEvent.keyDown(window, { code: 'ArrowRight' })
    act(() => frame(0))
    expect(inputSpy).toHaveBeenCalledWith(0, {
      'player-1': { throttle: 0, brake: 0, steer: 1 },
      'player-2': { throttle: 0, brake: 0, steer: -1 },
    })
  })
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
        onRestart={vi.fn()}
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
      'Segure ESPAÇO para identificar pilotos•R reinicia•ESC sai',
    )
    expect(screen.getByRole('button', { name: 'Reiniciar corrida' })).toHaveAttribute(
      'aria-keyshortcuts',
      'R',
    )
    expect(screen.getByRole('button', { name: 'Sair da corrida' })).toHaveClass('size-11')
    expect(rendererCapture.options).toHaveLength(1)
    expect(rendererCapture.options[0].splitScreenAspectRatio?.()).toBe(1.125)
  })

  it.each(['solo', 'local'] as const)(
    'restarts a %s race immediately from the button or the R key',
    (mode) => {
      vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
      vi.stubGlobal('cancelAnimationFrame', vi.fn())
      const onRestart = vi.fn()
      const engine = new RaceEngine({
        track: SHORT_TRACK,
        mode,
        racers: [
          {
            id: 'player-1',
            name: 'Piloto 1',
            kind: 'human',
            color: '#2d7dff',
          },
        ],
      })

      render(
        <RaceCanvas
          engine={engine}
          mode={mode}
          onAbort={vi.fn()}
          onFinished={vi.fn()}
          onRestart={onRestart}
          timeOfDay="day"
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'Reiniciar corrida' }))
      fireEvent.keyDown(window, { code: 'KeyR', key: 'r', repeat: false })
      fireEvent.keyDown(window, { code: 'KeyR', key: 'r', repeat: true })

      expect(onRestart).toHaveBeenCalledTimes(2)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    },
  )
})
