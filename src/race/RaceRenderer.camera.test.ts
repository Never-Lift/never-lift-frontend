import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RaceEngine } from '@/race/RaceEngine'
import { RaceRenderer } from '@/race/RaceRenderer'
import { TrackGeometry } from '@/race/TrackGeometry'
import type { InterpolatedVehicleState } from '@/race/types'
import { SHORT_TRACK } from '@/test/track-fixtures'

const { drawVehicleVisualMock } = vi.hoisted(() => ({
  drawVehicleVisualMock: vi.fn(),
}))

vi.mock('@/race/vehicle-visuals', async () => {
  const actual = await vi.importActual<typeof import('@/race/vehicle-visuals')>(
    '@/race/vehicle-visuals',
  )
  return { ...actual, drawVehicleVisual: drawVehicleVisualMock }
})

function createNoopContext() {
  const noOperation = vi.fn()
  const gradient = { addColorStop: noOperation }
  return new Proxy(
    {},
    {
      get: (_target, property) => {
        if (property === 'createLinearGradient') return () => gradient
        if (property === 'createRadialGradient') return () => gradient
        return noOperation
      },
      set: () => true,
    },
  ) as CanvasRenderingContext2D
}

function createCanvas(
  context: CanvasRenderingContext2D,
  width = 1_600,
  height = 900,
) {
  const canvas = document.createElement('canvas')
  Object.defineProperty(canvas, 'getContext', { value: () => context })
  Object.defineProperty(canvas, 'getBoundingClientRect', {
    value: () => ({
      x: 0,
      y: 0,
      width,
      height,
      top: 0,
      right: width,
      bottom: height,
      left: 0,
      toJSON: () => ({}),
    }),
  })
  return canvas
}

function createVehicles() {
  const engine = new RaceEngine({
    track: SHORT_TRACK,
    mode: 'local',
    racers: [
      {
        id: 'player-1',
        name: 'Player 1',
        kind: 'human',
        color: '#31c7ff',
      },
      {
        id: 'player-2',
        name: 'Player 2',
        kind: 'human',
        color: '#ff2e88',
      },
    ],
  })
  const vehicles = engine.getInterpolatedVehicles()
  return [
    {
      ...vehicles[0],
      renderPosition: { x: 0, y: 0 },
      renderAngle: Math.PI / 2,
      velocity: { x: 20, y: 0 },
    },
    {
      ...vehicles[1],
      renderPosition: { x: 0, y: 4 },
      renderAngle: Math.PI / 2,
      velocity: { x: 0, y: 20 },
    },
  ] satisfies InterpolatedVehicleState[]
}

describe('RaceRenderer 2.5D camera integration', () => {
  beforeEach(() => drawVehicleVisualMock.mockClear())
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('does not draw a detailed opponent outside the viewport and keeps it in the minimap', () => {
    const renderer = new RaceRenderer(createCanvas(createNoopContext()), SHORT_TRACK)
    const vehicles = createVehicles()
    vehicles[1].renderPosition = { x: 10000, y: 10000 }
    const minimap = vi.spyOn(renderer as unknown as { drawMinimap: (...args: unknown[]) => void }, 'drawMinimap')
    renderer.render({ mode: 'solo', getInterpolatedVehicles: () => vehicles } as RaceEngine, 1 / 60)
    expect(drawVehicleVisualMock).toHaveBeenCalledTimes(1)
    expect(minimap.mock.calls.some(call => call.some(value => value === vehicles))).toBe(true)
  })

  it('precomputes pit projections instead of searching the circuit every frame in two viewports', () => {
    const project = vi.spyOn(TrackGeometry.prototype, 'project')
    const renderer = new RaceRenderer(createCanvas(createNoopContext()), SHORT_TRACK)
    expect(project.mock.calls.length).toBeGreaterThan(0)
    const vehicles = createVehicles()
    project.mockClear()
    for (let frame = 0; frame < 3; frame++) {
      renderer.render({ mode: 'local', getInterpolatedVehicles: () => vehicles } as RaceEngine, 1 / 60)
    }
    expect(project).not.toHaveBeenCalled()
  })

  it('caps high-DPI raster work without changing CSS car size or split-screen layout', () => {
    vi.stubGlobal('devicePixelRatio', 2)
    const canvas = createCanvas(createNoopContext())
    const renderer = new RaceRenderer(canvas, SHORT_TRACK, { pixelRatioCap: 1 })
    const vehicles = createVehicles()
    renderer.render({ mode: 'local', getInterpolatedVehicles: () => vehicles } as RaceEngine, 1 / 60)
    expect(canvas.width).toBe(1600)
    expect(canvas.height).toBe(900)
    expect(drawVehicleVisualMock).toHaveBeenCalledTimes(4)
    expect(drawVehicleVisualMock.mock.calls[0][1].length).toBeCloseTo(54, 8)
  })

  it('selects the same car view independently in both split-screen cameras', () => {
    const context = createNoopContext()
    const renderer = new RaceRenderer(createCanvas(context), SHORT_TRACK)
    const vehicles = createVehicles()
    const engine = {
      mode: 'local',
      getInterpolatedVehicles: () => vehicles,
    } as RaceEngine

    renderer.render(engine, 1 / 60)

    expect(drawVehicleVisualMock).toHaveBeenCalledTimes(4)
    const playerOneViews = drawVehicleVisualMock.mock.calls
      .map((call) => call[1])
      .filter((options) => options.color === '#31c7ff')

    expect(playerOneViews).toHaveLength(2)
    expect(playerOneViews[0].relativeYawRadians).toBeCloseTo(Math.PI / 2, 8)
    expect(playerOneViews[1].relativeYawRadians).toBeCloseTo(0, 8)
    expect(playerOneViews[0].x).toBeLessThan(800)
    expect(playerOneViews[1].x).toBeGreaterThan(800)
  })

  it('keeps the race car at the documented nominal 6% size in a real viewport', () => {
    const context = createNoopContext()
    const renderer = new RaceRenderer(createCanvas(context), SHORT_TRACK)
    const vehicles = createVehicles()
    const engine = {
      mode: 'local',
      getInterpolatedVehicles: () => vehicles,
    } as RaceEngine

    renderer.render(engine, 1 / 60)

    const lengths = drawVehicleVisualMock.mock.calls.map(
      (call) => call[1].length,
    )
    expect(lengths).toHaveLength(4)
    for (const length of lengths) {
      expect(length).toBeCloseTo(54, 8)
    }
  })

  it('keeps independent F1 views and anchors in a horizontal split below 1.35', () => {
    const context = createNoopContext()
    const renderer = new RaceRenderer(
      createCanvas(context, 900, 800),
      SHORT_TRACK,
      { splitScreenAspectRatio: () => 900 / 800 },
    )
    const vehicles = createVehicles()
    const engine = {
      mode: 'local',
      getInterpolatedVehicles: () => vehicles,
    } as RaceEngine

    renderer.render(engine, 1 / 60)

    expect(drawVehicleVisualMock).toHaveBeenCalledTimes(4)
    const calls = drawVehicleVisualMock.mock.calls.map((call) => call[1])
    const playerOneCalls = calls.filter(
      (options) => options.color === '#31c7ff',
    )
    const playerTwoCalls = calls.filter(
      (options) => options.color === '#ff2e88',
    )

    expect(playerOneCalls).toHaveLength(2)
    expect(playerTwoCalls).toHaveLength(2)
    expect(playerOneCalls[0]).toMatchObject({
      x: 450,
      y: 272,
    })
    expect(playerTwoCalls[1]).toMatchObject({
      x: 450,
      y: 672,
    })
    expect(playerOneCalls[0].relativeYawRadians).toBeCloseTo(Math.PI / 2, 8)
    expect(playerTwoCalls[1].relativeYawRadians).toBeCloseTo(0, 8)
    expect(playerOneCalls[0].length).toBeCloseTo(24, 8)
    expect(playerTwoCalls[1].length).toBeCloseTo(24, 8)
    expect(playerOneCalls[0].y).toBeLessThan(400)
    expect(playerTwoCalls[1].y).toBeGreaterThan(400)
  })
})
