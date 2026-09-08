import { afterEach, describe, expect, it, vi } from 'vitest'
import { RaceRenderer } from './RaceRenderer'
import { RaceEngine } from './RaceEngine'
import { createMinimapTransform, worldToMinimap, type Viewport } from './camera'
import type { InterpolatedVehicleState } from './types'
import { SHORT_TRACK } from '@/test/track-fixtures'

afterEach(() => vi.unstubAllGlobals())

describe('fixed minimap vector cache', () => {
  it('keeps every original point, reuses the static path, and moves markers independently', () => {
    class RecordingPath {
      points: Array<{ x: number; y: number }> = []
      moveTo(x: number, y: number) { this.points.push({ x, y }) }
      lineTo(x: number, y: number) { this.points.push({ x, y }) }
    }
    vi.stubGlobal('Path2D', RecordingPath)
    const paths: RecordingPath[] = []
    const arcs: Array<{ x: number; y: number }> = []
    const context = new Proxy({}, { get: (_object, key) => {
      if (key === 'stroke') return (path?: RecordingPath) => { if (path) paths.push(path) }
      if (key === 'arc') return (x: number, y: number) => { arcs.push({ x, y }) }
      return () => {}
    }, set: () => true }) as CanvasRenderingContext2D
    const canvas = document.createElement('canvas')
    vi.spyOn(canvas, 'getContext').mockReturnValue(context)
    const renderer = new RaceRenderer(canvas, SHORT_TRACK)
    const internals = renderer as unknown as {
      drawMinimap(viewport: Viewport, vehicles: InterpolatedVehicleState[], focus: InterpolatedVehicleState): void
    }
    const engine = new RaceEngine({ track: SHORT_TRACK, mode: 'solo', racers: [{ id: 'player-1', name: 'P1', color: '#fff', kind: 'human' }] })
    const vehicles = engine.getInterpolatedVehicles()
    const viewport = { x: 0, y: 0, width: 960, height: 1080 }
    internals.drawMinimap(viewport, vehicles, vehicles[0])
    const initialMarker = arcs.at(-1)
    vehicles[0].renderPosition = { x: vehicles[0].renderPosition.x + 40, y: vehicles[0].renderPosition.y }
    internals.drawMinimap(viewport, vehicles, vehicles[0])
    expect(paths).toHaveLength(2)
    expect(paths[0]).toBe(paths[1])
    expect(arcs.at(-1)).not.toEqual(initialMarker)
    const transform = createMinimapTransform(SHORT_TRACK.bounds, { x: 668, y: 12, width: 280, height: 188 }, 12)
    expect(paths[0].points).toEqual(SHORT_TRACK.centerline.map(point => worldToMinimap(point, transform)))
    internals.drawMinimap({ ...viewport, x: 960 }, vehicles, vehicles[0])
    expect(paths[2]).not.toBe(paths[0])
    expect(paths[2].points[0].x - paths[0].points[0].x).toBeCloseTo(960)
  })
})

describe('primitive culling inside visible chunks', () => {
  it('reuses immutable barrier/fence cuts and metric offsets without modifying track data', () => {
    const context = new Proxy({}, { get: () => () => {}, set: () => true }) as CanvasRenderingContext2D
    const canvas = document.createElement('canvas')
    vi.spyOn(canvas, 'getContext').mockReturnValue(context)
    const renderer = new RaceRenderer(canvas, SHORT_TRACK) as unknown as {
      getBarrierDraws(points: typeof SHORT_TRACK.centerline): Array<{ path: typeof SHORT_TRACK.centerline }>
      getFenceDraws(points: typeof SHORT_TRACK.centerline): unknown[]
      offsetPolyline(points: { x: number; y: number }[], side: 'left' | 'right', offset: number): { x: number; y: number }[]
    }
    const original = JSON.stringify(SHORT_TRACK)
    const points = SHORT_TRACK.centerline.slice(0, 10)
    const barriers = renderer.getBarrierDraws(points)
    expect(barriers.length).toBeGreaterThan(0)
    expect(renderer.getBarrierDraws(points)).toBe(barriers)
    const fences = renderer.getFenceDraws(points)
    expect(renderer.getFenceDraws(points)).toBe(fences)
    const path = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }]
    const left = renderer.offsetPolyline(path, 'left', 2)
    expect(left).toEqual([{ x: 0, y: 2 }, { x: 10, y: 2 }, { x: 20, y: 2 }])
    expect(renderer.offsetPolyline(path, 'left', 2)).toBe(left)
    expect(renderer.offsetPolyline(path, 'right', 2)[1]).toEqual({ x: 10, y: -2 })
    expect(renderer.offsetPolyline(path, 'left', 3)[1]).toEqual({ x: 10, y: 3 })
    expect(path[1]).toEqual({ x: 10, y: 0 })
    expect(JSON.stringify(SHORT_TRACK)).toBe(original)
  })
  it('does not submit invisible segments but retains crossing/thick segments and drawing state', () => {
    const stroke = vi.fn()
    const context = new Proxy({ stroke }, {
      get: (object, key) => Reflect.get(object, key) ?? (() => {}),
      set: (object, key, value) => Reflect.set(object, key, value),
    }) as unknown as CanvasRenderingContext2D
    const canvas = document.createElement('canvas')
    vi.spyOn(canvas, 'getContext').mockReturnValue(context)
    const renderer = new RaceRenderer(canvas, SHORT_TRACK) as unknown as {
      drawingViewport: Viewport
      strokeSegment(from: { x: number; y: number }, to: { x: number; y: number }, width: number, color: string): void
      strokePolyline(points: { x: number; y: number }[], width: number, color: string): void
    }
    renderer.drawingViewport = { x: 0, y: 0, width: 100, height: 100 }
    renderer.strokeSegment({ x: -100, y: -100 }, { x: -80, y: -80 }, 2, '#123456')
    expect(stroke).not.toHaveBeenCalled()
    expect(context.strokeStyle).toBe('#123456')
    renderer.strokeSegment({ x: -100, y: 50 }, { x: 200, y: 50 }, 2, '#fff')
    renderer.strokeSegment({ x: -3, y: 10 }, { x: -3, y: 90 }, 10, '#fff')
    expect(stroke).toHaveBeenCalledTimes(2)
    renderer.strokePolyline([{ x: 200, y: 20 }, { x: 210, y: 50 }], 2, '#fff')
    expect(stroke).toHaveBeenCalledTimes(2)
    renderer.strokePolyline([{ x: -100, y: 50 }, { x: 200, y: 50 }], 2, '#fff')
    expect(stroke).toHaveBeenCalledTimes(3)
  })
})
