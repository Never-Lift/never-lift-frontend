import { describe, expect, it, vi } from 'vitest'

import type { TrackDefinition } from '@/lib/api'
import type { CameraTransform } from '@/race/camera'
import { RaceEngine } from '@/race/RaceEngine'
import {
  calculateTrackCullMarginMeters,
  RaceRenderer,
  sortVehiclesByProjectedDepth,
} from '@/race/RaceRenderer'
import type { InterpolatedVehicleState } from '@/race/types'
import { LONG_TRACK } from '@/test/track-fixtures'

type DrawOperation = {
  kind: 'fill' | 'stroke'
  color: string
  width: number
  lineCap: CanvasLineCap
  lineDashOffset: number
  path: Array<{ x: number; y: number }>
}

type RendererInternals = {
  drawTrackAsphalt: (
    points: TrackDefinition['centerline'],
    transform: CameraTransform,
  ) => void
  drawTrackEnvironments: (
    points: TrackDefinition['centerline'],
    transform: CameraTransform,
  ) => void
  drawTrackBarriers: (
    points: TrackDefinition['centerline'],
    transform: CameraTransform,
  ) => void
  drawTrackFences: (
    points: TrackDefinition['centerline'],
    transform: CameraTransform,
  ) => void
  drawTrackCurbs: (
    points: TrackDefinition['centerline'],
    transform: CameraTransform,
  ) => void
  drawTrackDetails: (
    points: TrackDefinition['centerline'],
    transform: CameraTransform,
  ) => void
  splitByElevationLayer: (
    points: TrackDefinition['centerline'],
  ) => Array<{
    elevationLayer: number
    points: TrackDefinition['centerline']
  }>
}

function createRecordingContext() {
  let properties = new Map<PropertyKey, unknown>([
    ['strokeStyle', '#000000'],
    ['fillStyle', '#000000'],
    ['lineWidth', 1],
    ['lineCap', 'butt'],
    ['lineJoin', 'miter'],
    ['lineDashOffset', 0],
  ])
  const propertyStack: Array<Map<PropertyKey, unknown>> = []
  const operations: DrawOperation[] = []
  let currentPath: Array<{ x: number; y: number }> = []
  const noOperation = vi.fn()
  const context = new Proxy(
    {},
    {
      get: (_target, property) => {
        if (property === 'save') {
          return () => propertyStack.push(new Map(properties))
        }
        if (property === 'restore') {
          return () => {
            properties = propertyStack.pop() ?? properties
          }
        }
        if (property === 'beginPath') {
          return () => {
            currentPath = []
          }
        }
        if (property === 'setLineDash') {
          return (dash: number[]) => properties.set('lineDash', [...dash])
        }
        if (property === 'moveTo' || property === 'lineTo') {
          return (x: number, y: number) => {
            currentPath.push({ x, y })
          }
        }
        if (property === 'stroke' || property === 'fill') {
          return () => {
            const kind = property as 'stroke' | 'fill'
            operations.push({
              kind,
              color: String(
                properties.get(kind === 'stroke' ? 'strokeStyle' : 'fillStyle'),
              ),
              width: Number(properties.get('lineWidth')),
              lineCap: properties.get('lineCap') as CanvasLineCap,
              lineDashOffset: Number(properties.get('lineDashOffset')),
              path: currentPath.map((point) => ({ ...point })),
            })
          }
        }
        if (property === 'createRadialGradient') {
          return () => ({ addColorStop: noOperation })
        }
        return properties.has(property) ? properties.get(property) : noOperation
      },
      set: (_target, property, value) => {
        properties.set(property, value)
        return true
      },
    },
  ) as CanvasRenderingContext2D
  return { context, operations }
}

function createCanvas(context: CanvasRenderingContext2D) {
  const canvas = document.createElement('canvas')
  Object.defineProperty(canvas, 'getContext', { value: () => context })
  Object.defineProperty(canvas, 'getBoundingClientRect', {
    value: () => ({
      x: 0,
      y: 0,
      width: 960,
      height: 640,
      top: 0,
      right: 960,
      bottom: 640,
      left: 0,
      toJSON: () => ({}),
    }),
  })
  return canvas
}

function createEngine(track: TrackDefinition) {
  return new RaceEngine({
    track,
    mode: 'solo',
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
        color: '#ff2d8d',
      },
    ],
  })
}

function createStraightTransitionTrack() {
  const track = structuredClone(LONG_TRACK)
  track.lengthMeters = 30
  track.centerline = [
    {
      x: 0,
      y: 0,
      distanceMeters: 0,
      halfWidthMeters: 5,
      elevationLayer: 0,
    },
    {
      x: 10,
      y: 0,
      distanceMeters: 10,
      halfWidthMeters: 5,
      elevationLayer: 0,
    },
    {
      x: 20,
      y: 0,
      distanceMeters: 20,
      halfWidthMeters: 5,
      elevationLayer: 0,
    },
  ]
  track.trackLimits.segments = [
    {
      index: 0,
      fromDistanceMeters: 0,
      toDistanceMeters: 10,
      left: {
        zones: [{ surface: 'gravel', widthMeters: 60 }],
        barrier: 'guardrail',
        fence: 'debris-fence',
      },
      right: {
        zones: [{ surface: 'gravel', widthMeters: 60 }],
        barrier: 'guardrail',
        fence: 'debris-fence',
      },
    },
    {
      index: 1,
      fromDistanceMeters: 10,
      toDistanceMeters: 30,
      left: {
        zones: [{ surface: 'grass', widthMeters: 8 }],
        barrier: 'guardrail',
        fence: 'debris-fence',
      },
      right: {
        zones: [{ surface: 'grass', widthMeters: 8 }],
        barrier: 'guardrail',
        fence: 'debris-fence',
      },
    },
  ]
  return track
}

const IDENTITY_TRANSFORM: CameraTransform = {
  position: { x: 0, y: 0 },
  orientation: Math.PI / 2,
  pixelsPerMeter: 1,
  groundDepthScale: 1,
  viewport: { x: -100, y: -100, width: 200, height: 200 },
  anchor: { x: 0, y: 0 },
}

function internals(renderer: RaceRenderer) {
  return renderer as unknown as RendererInternals
}

describe('RaceRenderer audited surfaces', () => {
  it('keeps culling margin outside wide runoff, barrier and fence', () => {
    const track = createStraightTransitionTrack()

    const margin = calculateTrackCullMarginMeters(track)

    expect(margin).toBeGreaterThan(65)
    expect(margin).toBeLessThan(66)
  })

  it('orders same-layer cars by projected depth without mutating input', () => {
    const vehicles = createEngine(LONG_TRACK).getInterpolatedVehicles()
    const behind = {
      ...vehicles[0],
      id: 'behind',
      renderPosition: { x: -10, y: 0 },
    }
    const ahead = {
      ...vehicles[1],
      id: 'ahead',
      renderPosition: { x: 10, y: 0 },
    }
    const input: InterpolatedVehicleState[] = [behind, ahead]
    const transform: CameraTransform = {
      ...IDENTITY_TRANSFORM,
      orientation: 0,
      groundDepthScale: 0.5,
    }

    const ordered = sortVehiclesByProjectedDepth(input, transform)

    expect(ordered.map((vehicle) => vehicle.id)).toEqual(['ahead', 'behind'])
    expect(input.map((vehicle) => vehicle.id)).toEqual(['behind', 'ahead'])
  })

  it('keeps the centerline dash phase continuous across sampled segments', () => {
    const track = createStraightTransitionTrack()
    const { context, operations } = createRecordingContext()
    const renderer = new RaceRenderer(createCanvas(context), track)

    internals(renderer).drawTrackDetails(track.centerline, IDENTITY_TRANSFORM)

    const centerline = operations.filter(
      (operation) =>
        operation.kind === 'stroke' &&
        operation.color === 'rgba(240, 240, 250, 0.17)',
    )
    expect(centerline).toHaveLength(2)
    expect(centerline[0].lineDashOffset).toBeCloseTo(0, 8)
    expect(centerline[1].lineDashOffset).toBeCloseTo(-1, 8)
  })

  it('draws material passes in environment, asphalt, fence, barrier order', () => {
    const track = structuredClone(LONG_TRACK)
    for (const segment of track.trackLimits.segments) {
      segment.left = {
        zones: [{ surface: 'grass', widthMeters: 5 }],
        barrier: 'guardrail',
        fence: 'debris-fence',
      }
      segment.right = {
        zones: [
          { surface: 'asphalt', widthMeters: 3 },
          { surface: 'gravel', widthMeters: 9 },
        ],
        barrier: 'tecpro',
      }
    }

    const { context, operations } = createRecordingContext()
    const renderer = new RaceRenderer(createCanvas(context), track)
    renderer.render(createEngine(track), 1 / 60)

    const indicesFor = (
      kind: DrawOperation['kind'],
      colors: string[],
    ) =>
      operations.flatMap((operation, index) =>
        operation.kind === kind && colors.includes(operation.color) ? [index] : [],
      )
    const environmentIndices = indicesFor('fill', [
      '#39414d',
      '#24492d',
      '#716956',
    ])
    const asphaltIndices = indicesFor('stroke', ['#29303b'])
    const fenceIndices = indicesFor('stroke', ['#697789'])
    const barrierIndices = indicesFor('stroke', ['#9aa6b8', '#5c7da7'])
    const detailIndices = indicesFor('stroke', [
      'rgba(240, 240, 250, 0.78)',
      'rgba(240, 240, 250, 0.17)',
    ])

    expect(environmentIndices.length).toBeGreaterThan(0)
    expect(asphaltIndices.length).toBeGreaterThan(0)
    expect(fenceIndices.length).toBeGreaterThan(0)
    expect(barrierIndices.length).toBeGreaterThan(0)
    expect(detailIndices.length).toBeGreaterThan(0)
    expect(Math.max(...environmentIndices)).toBeLessThan(
      Math.min(...asphaltIndices),
    )
    expect(Math.max(...asphaltIndices)).toBeLessThan(
      Math.min(...fenceIndices),
    )
    expect(Math.max(...fenceIndices)).toBeLessThan(
      Math.min(...barrierIndices),
    )
    expect(Math.max(...barrierIndices)).toBeLessThan(
      Math.min(...detailIndices),
    )
  })

  it('fills wide environment zones as bounded quadrilaterals without cap bleed', () => {
    const track = createStraightTransitionTrack()
    const { context, operations } = createRecordingContext()
    const renderer = new RaceRenderer(createCanvas(context), track)

    internals(renderer).drawTrackEnvironments(
      track.centerline.slice(0, 2),
      IDENTITY_TRANSFORM,
    )

    const gravelFills = operations.filter(
      (operation) => operation.kind === 'fill' && operation.color === '#716956',
    )
    expect(gravelFills).toHaveLength(2)
    expect(
      operations.filter(
        (operation) =>
          operation.kind === 'stroke' && operation.color === '#716956',
      ),
    ).toHaveLength(0)
    for (const fill of gravelFills) {
      expect(fill.path).toHaveLength(4)
      const longitudinalCoordinates = fill.path.map((point) => point.x)
      expect(Math.min(...longitudinalCoordinates)).toBeCloseTo(0, 8)
      expect(Math.max(...longitudinalCoordinates)).toBeCloseTo(10, 8)
    }
  })

  it('tapers offset changes longitudinally without transverse connector strokes', () => {
    const track = createStraightTransitionTrack()
    const { context, operations } = createRecordingContext()
    const renderer = new RaceRenderer(createCanvas(context), track)
    const rendererInternals = internals(renderer)

    rendererInternals.drawTrackFences(track.centerline, IDENTITY_TRANSFORM)
    rendererInternals.drawTrackBarriers(track.centerline, IDENTITY_TRANSFORM)

    const fenceStrokes = operations.filter(
      (operation) =>
        operation.kind === 'stroke' && operation.color === '#697789',
    )
    const barrierStrokes = operations.filter(
      (operation) =>
        operation.kind === 'stroke' && operation.color === '#9aa6b8',
    )
    expect(fenceStrokes).toHaveLength(4)
    expect(barrierStrokes).toHaveLength(4)

    for (const stroke of [...fenceStrokes, ...barrierStrokes]) {
      expect(stroke.path).toHaveLength(2)
      expect(Math.abs(stroke.path[1].x - stroke.path[0].x)).toBeGreaterThan(9.9)
    }
    expect(
      barrierStrokes.some(
        (stroke) => Math.abs(stroke.path[1].y - stroke.path[0].y) > 40,
      ),
    ).toBe(true)
  })

  it('draws alternating curb stripes inside the selected track edge', () => {
    const track = createStraightTransitionTrack()
    track.curbs = [
      {
        index: 0,
        fromDistanceMeters: 0,
        toDistanceMeters: 10,
        side: 'left',
        widthMeters: 1,
        stripeLengthMeters: 2.5,
        palette: 'red-white',
      },
    ]
    const { context, operations } = createRecordingContext()
    const renderer = new RaceRenderer(createCanvas(context), track)

    internals(renderer).drawTrackCurbs(
      track.centerline.slice(0, 2),
      IDENTITY_TRANSFORM,
    )

    const curbStrokes = operations.filter(
      (operation) =>
        operation.kind === 'stroke' &&
        ['#d9283b', '#f0f0fa'].includes(operation.color),
    )
    expect(curbStrokes).toHaveLength(4)
    expect(curbStrokes.map((stroke) => stroke.color)).toEqual([
      '#d9283b',
      '#f0f0fa',
      '#d9283b',
      '#f0f0fa',
    ])
    for (const stroke of curbStrokes) {
      expect(stroke.lineCap).toBe('butt')
      expect(stroke.path).toHaveLength(2)
      expect(stroke.path[0].y).toBeCloseTo(-4.5, 8)
      expect(stroke.path[1].y).toBeCloseTo(-4.5, 8)
    }
  })

  it('does not extend a fence into the next unfenced segment', () => {
    const track = createStraightTransitionTrack()
    delete track.trackLimits.segments[1].left.fence
    delete track.trackLimits.segments[1].right.fence
    const { context, operations } = createRecordingContext()
    const renderer = new RaceRenderer(createCanvas(context), track)

    internals(renderer).drawTrackFences(track.centerline, IDENTITY_TRANSFORM)

    const fenceStrokes = operations.filter(
      (operation) =>
        operation.kind === 'stroke' && operation.color === '#697789',
    )
    expect(fenceStrokes).toHaveLength(2)
    for (const stroke of fenceStrokes) {
      expect(stroke.path).toHaveLength(2)
      expect(Math.min(stroke.path[0].x, stroke.path[1].x)).toBeCloseTo(0, 8)
      expect(Math.max(stroke.path[0].x, stroke.path[1].x)).toBeCloseTo(10, 8)
    }
  })

  it('splits elevation transitions at the same midpoint used by TrackGeometry', () => {
    const track = createStraightTransitionTrack()
    const { context, operations } = createRecordingContext()
    const renderer = new RaceRenderer(createCanvas(context), track)
    const points: TrackDefinition['centerline'] = [
      {
        x: 0,
        y: 0,
        distanceMeters: 0,
        halfWidthMeters: 5,
        elevationLayer: 0,
      },
      {
        x: 10,
        y: 0,
        distanceMeters: 20,
        halfWidthMeters: 9,
        elevationLayer: 1,
      },
      {
        x: 20,
        y: 0,
        distanceMeters: 40,
        halfWidthMeters: 5,
        elevationLayer: 0,
      },
    ]

    const sections = internals(renderer).splitByElevationLayer(points)

    expect(sections).toHaveLength(3)
    expect(sections.map((section) => section.elevationLayer)).toEqual([0, 1, 0])
    expect(sections[0].points.at(-1)).toMatchObject({
      x: 5,
      y: 0,
      distanceMeters: 10,
      halfWidthMeters: 7,
      elevationLayer: 0,
    })
    expect(sections[1].points[0]).toMatchObject({
      x: 5,
      y: 0,
      distanceMeters: 10,
      halfWidthMeters: 7,
      elevationLayer: 1,
    })
    expect(sections[1].points.at(-1)).toMatchObject({
      x: 15,
      y: 0,
      distanceMeters: 30,
      halfWidthMeters: 7,
      elevationLayer: 1,
    })
    expect(sections[2].points[0]).toMatchObject({
      x: 15,
      y: 0,
      distanceMeters: 30,
      halfWidthMeters: 7,
      elevationLayer: 0,
    })

    for (const section of sections) {
      internals(renderer).drawTrackAsphalt(section.points, IDENTITY_TRANSFORM)
    }
    const asphaltStrokes = operations.filter(
      (operation) =>
        operation.kind === 'stroke' && operation.color === '#29303b',
    )
    expect(asphaltStrokes).toHaveLength(4)
    expect(asphaltStrokes.every((stroke) => stroke.lineCap === 'butt')).toBe(
      true,
    )
    expect(
      asphaltStrokes.flatMap((stroke) => stroke.path.map((point) => point.x)),
    ).toEqual([0, 5, 5, 10, 10, 15, 15, 20])
  })
})
