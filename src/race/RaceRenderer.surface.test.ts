import { describe, expect, it, vi } from 'vitest'

import type { TrackDefinition } from '@/lib/api'
import {
  CAMERA_GROUND_DEPTH_SCALE,
  CAMERA_HEIGHT_SCALE,
  CAMERA_VERTICAL_ANCHOR_RATIO,
  type CameraTransform,
} from '@/race/camera'
import { RaceEngine } from '@/race/RaceEngine'
import {
  calculateSuzukaUpperLayerOpacity,
  calculateTrackCullMarginMeters,
  findSuzukaCrossingPoints,
  RaceRenderer,
  sceneryVisualMetrics,
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
  opacity: number
  path: Array<{ x: number; y: number }>
}

type CompositeOperation = {
  source: CanvasImageSource
  opacity: number
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
  drawPitInfrastructure: (transform: CameraTransform) => void
  drawEscapeRoadSurfaces: (
    transform: CameraTransform,
    elevationLayer: number,
  ) => void
  drawEscapeRoadObstacleRows: (
    transform: CameraTransform,
    elevationLayer: number,
  ) => void
  drawBrakingMarkers: (
    transform: CameraTransform,
    elevationLayer: number,
  ) => void
  drawScenery: (
    transform: CameraTransform,
    layer: 'ground' | 'overhead',
  ) => void
  drawBridgeUnderstructure: (
    points: TrackDefinition['centerline'],
    transform: CameraTransform,
  ) => void
  drawIsolatedOpacityLayer: (
    viewport: { x: number; y: number; width: number; height: number },
    opacity: number,
    draw: () => void,
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
    ['globalAlpha', 1],
  ])
  const propertyStack: Array<Map<PropertyKey, unknown>> = []
  const operations: DrawOperation[] = []
  const composites: CompositeOperation[] = []
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
              opacity: Number(properties.get('globalAlpha')),
              path: currentPath.map((point) => ({ ...point })),
            })
          }
        }
        if (property === 'drawImage') {
          return (source: CanvasImageSource) => {
            composites.push({
              source,
              opacity: Number(properties.get('globalAlpha')),
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
  return { context, operations, composites }
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
  track.lengthMeters = 20
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
      toDistanceMeters: 20,
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
  track.barrierGeometry.segments = track.trackLimits.segments.flatMap(
    (segment) =>
      (['left', 'right'] as const).map((side, sideIndex) => {
        const direction = side === 'left' ? 1 : -1
        const fromPoint = track.centerline.find(
          (point) => point.distanceMeters === segment.fromDistanceMeters,
        )!
        const toPoint = track.centerline.find(
          (point) => point.distanceMeters === segment.toDistanceMeters,
        )!
        const fromEnvironmentWidth =
          segment[side].zones.reduce(
            (sum, zone) => sum + zone.widthMeters,
            0,
          )
        const nextSegment = track.trackLimits.segments.find(
          (candidate) =>
            candidate.fromDistanceMeters === segment.toDistanceMeters,
        )
        const toEnvironmentWidth = (
          nextSegment?.[side] ?? segment[side]
        ).zones.reduce((sum, zone) => sum + zone.widthMeters, 0)
        return {
          index: segment.index * 2 + sideIndex,
          trackLimitSegmentIndex: segment.index,
          side,
          fromDistanceMeters: segment.fromDistanceMeters,
          toDistanceMeters: segment.toDistanceMeters,
          material: segment[side].barrier,
          thicknessMeters: 0.32,
          collisionLayer: 'track-barrier' as const,
          chunkIndexes: [0],
          path: [
            {
              x: fromPoint.x,
              y:
                fromPoint.y +
                direction *
                  (fromPoint.halfWidthMeters + fromEnvironmentWidth),
              distanceMeters: fromPoint.distanceMeters,
              elevationLayer: fromPoint.elevationLayer,
            },
            {
              x: toPoint.x,
              y:
                toPoint.y +
                direction *
                  (toPoint.halfWidthMeters + toEnvironmentWidth),
              distanceMeters: toPoint.distanceMeters,
              elevationLayer: toPoint.elevationLayer,
            },
          ],
        }
      }),
  )
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

  it('keeps wide runoff visible at the inclined viewport edge and culls a distant chunk', () => {
    const track = createStraightTransitionTrack()
    const viewportHeight = 640
    const cameraOrientation = Math.PI / 4
    const pixelsPerMeter =
      (viewportHeight * 0.06) / 5.6
    const marginMeters = calculateTrackCullMarginMeters(track)
    const forwardLimitMeters =
      (viewportHeight * CAMERA_VERTICAL_ANCHOR_RATIO) /
      (pixelsPerMeter * CAMERA_GROUND_DEPTH_SCALE)
    const forward = {
      x: Math.cos(cameraOrientation),
      y: Math.sin(cameraOrientation),
    }
    const boundsAround = (distanceMeters: number) => {
      const center = {
        x: forward.x * distanceMeters,
        y: forward.y * distanceMeters,
      }
      return {
        minX: center.x - 0.5,
        minY: center.y - 0.5,
        maxX: center.x + 0.5,
        maxY: center.y + 0.5,
      }
    }
    track.chunks = [
      {
        index: 0,
        fromDistanceMeters: 0,
        toDistanceMeters: 10,
        bounds: boundsAround(0),
      },
      {
        index: 1,
        fromDistanceMeters: 10,
        toDistanceMeters: 20,
        bounds: boundsAround(forwardLimitMeters + 4),
      },
      {
        index: 2,
        fromDistanceMeters: 20,
        toDistanceMeters: 30,
        bounds: boundsAround(
          forwardLimitMeters +
            marginMeters / CAMERA_GROUND_DEPTH_SCALE +
            20,
        ),
      },
    ]

    const { context } = createRecordingContext()
    const renderer = new RaceRenderer(createCanvas(context), track)
    const focus = {
      ...createEngine(track).getInterpolatedVehicles()[0],
      renderPosition: { x: 0, y: 0 },
      renderAngle: cameraOrientation,
      velocity: {
        x: forward.x * 20,
        y: forward.y * 20,
      },
    }
    const engine = {
      mode: 'solo',
      getInterpolatedVehicles: () => [focus],
    } as RaceEngine

    renderer.render(engine, 1 / 60)

    expect(renderer.getRenderStats().visibleChunksByViewport).toEqual([2])
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
    for (const barrier of track.barrierGeometry.segments) {
      const environment =
        track.trackLimits.segments[barrier.trackLimitSegmentIndex]?.[
          barrier.side
        ]
      if (environment) barrier.material = environment.barrier
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
    const barrierIndices = indicesFor('stroke', ['#aeb7c3', '#6787ad'])
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
          operation.kind === 'stroke' && operation.color === '#aeb7c3',
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

  it('draws continuous alternating curb stripes outside the selected track edge', () => {
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
        outerColor: '#2f8548',
        outerWidthMeters: 0.4,
      },
    ]
    const { context, operations } = createRecordingContext()
    const renderer = new RaceRenderer(createCanvas(context), track)
    const curbTransform = { ...IDENTITY_TRANSFORM, pixelsPerMeter: 10 }

    internals(renderer).drawTrackCurbs(
      track.centerline.slice(0, 2),
      curbTransform,
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
      expect(stroke.path[0].y).toBeCloseTo(-55, 8)
      expect(stroke.path[1].y).toBeCloseTo(-55, 8)
    }
    const outerPaint = operations.filter(
      (operation) =>
        operation.kind === 'stroke' && operation.color === '#2f8548',
    )
    expect(outerPaint).toHaveLength(1)
    expect(outerPaint[0].lineCap).toBe('butt')
    expect(outerPaint[0].width).toBeCloseTo(4, 8)
    expect(outerPaint[0].path[0].y).toBeCloseTo(-62, 8)
    expect(outerPaint[0].path[1].y).toBeCloseTo(-62, 8)
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
      expect(Math.min(stroke.path[0].x, stroke.path[1].x)).toBeGreaterThanOrEqual(0)
      expect(Math.min(stroke.path[0].x, stroke.path[1].x)).toBeLessThan(1)
      expect(Math.max(stroke.path[0].x, stroke.path[1].x)).toBeGreaterThan(9)
      expect(Math.max(stroke.path[0].x, stroke.path[1].x)).toBeLessThan(11)
    }
  })

  it('extrudes debris fencing above the canonical barrier face', () => {
    const track = createStraightTransitionTrack()
    const { context, operations } = createRecordingContext()
    const renderer = new RaceRenderer(createCanvas(context), track)

    internals(renderer).drawTrackFences(track.centerline, IDENTITY_TRANSFORM)

    const meshFaces = operations.filter(
      (operation) =>
        operation.kind === 'fill' &&
        operation.color === '#697789' &&
        operation.opacity === 0.22,
    )
    const posts = operations.filter(
      (operation) =>
        operation.kind === 'stroke' && operation.color === '#748194',
    )
    expect(meshFaces.length).toBeGreaterThan(0)
    expect(posts.length).toBeGreaterThan(0)
    expect(
      posts.some(
        (post) =>
          post.path.length === 2 &&
          Math.abs(post.path[1].y - post.path[0].y) > 1,
      ),
    ).toBe(true)
  })

  it('uses the authored mesh, height, post spacing and cantilever for each fence segment', () => {
    const track = createStraightTransitionTrack()
    const barrier = track.barrierGeometry.segments.find(
      (candidate) =>
        candidate.trackLimitSegmentIndex === 0 && candidate.side === 'left',
    )!
    barrier.path = [
      {
        x: 0,
        y: 65,
        distanceMeters: 0,
        elevationLayer: 0,
      },
      {
        x: 10,
        y: 65,
        distanceMeters: 10,
        elevationLayer: 0,
      },
    ]
    track.barrierGeometry.segments = [barrier]
    track.trackLimits.segments[0].left.fenceVisualStyle = {
      heightMeters: 4,
      postSpacingMeters: 5,
      postColor: '#123456',
      meshColor: '#654321',
      meshOpacity: 0.31,
      cantileverMeters: 0.6,
    }
    const { context, operations } = createRecordingContext()
    const renderer = new RaceRenderer(createCanvas(context), track)

    internals(renderer).drawTrackFences(track.centerline, IDENTITY_TRANSFORM)

    const mesh = operations.filter(
      (operation) =>
        operation.kind === 'fill' && operation.color === '#654321',
    )
    const postsAndTopRail = operations.filter(
      (operation) =>
        operation.kind === 'stroke' && operation.color === '#123456',
    )
    expect(mesh).toHaveLength(1)
    expect(mesh[0].opacity).toBeCloseTo(0.31, 8)
    expect(postsAndTopRail).toHaveLength(4)
    expect(
      postsAndTopRail.filter((operation) => operation.path.length === 2),
    ).toHaveLength(4)
    const firstPost = postsAndTopRail[1]
    expect(Math.abs(firstPost.path[1].y - firstPost.path[0].y)).toBeGreaterThan(
      0.5,
    )
  })

  it('extrudes the canonical barrier into a visible 2.5D side face', () => {
    const track = createStraightTransitionTrack()
    const { context, operations } = createRecordingContext()
    const renderer = new RaceRenderer(createCanvas(context), track)

    internals(renderer).drawTrackBarriers(track.centerline, IDENTITY_TRANSFORM)

    const sideFaces = operations.filter(
      (operation) =>
        operation.kind === 'fill' && operation.color === '#6f7b89',
    )
    const topFaces = operations.filter(
      (operation) =>
        operation.kind === 'fill' && operation.color === '#aeb7c3',
    )
    expect(sideFaces.length).toBeGreaterThan(0)
    expect(topFaces.length).toBeGreaterThan(0)
    expect(
      sideFaces.some((face) => {
        const verticalExtent = Math.max(...face.path.map((point) => point.y)) -
          Math.min(...face.path.map((point) => point.y))
        return verticalExtent > 0.7
      }),
    ).toBe(true)
  })

  it('draws end caps only at real protection ends, not at every sampled joint', () => {
    const track = createStraightTransitionTrack()
    const barrier = structuredClone(track.barrierGeometry.segments[0])
    const from = barrier.path[0]
    const to = barrier.path[1]
    barrier.path = [
      from,
      {
        x: (from.x + to.x) / 2,
        y: (from.y + to.y) / 2 + 1.5,
        distanceMeters: (from.distanceMeters + to.distanceMeters) / 2,
        elevationLayer: from.elevationLayer,
      },
      to,
    ]
    track.barrierGeometry.segments = [barrier]
    const { context, operations } = createRecordingContext()
    const renderer = new RaceRenderer(createCanvas(context), track)

    internals(renderer).drawTrackBarriers(track.centerline, IDENTITY_TRANSFORM)

    expect(
      operations.filter(
        (operation) =>
          operation.kind === 'fill' &&
          operation.color === 'rgba(86, 96, 108, 0.86)',
      ),
    ).toHaveLength(1)
    expect(
      operations.filter(
        (operation) =>
          operation.kind === 'fill' &&
          operation.color === 'rgba(64, 73, 84, 0.92)',
      ),
    ).toHaveLength(1)
    const continuousTop = operations.filter(
      (operation) =>
        operation.kind === 'fill' && operation.color === '#aeb7c3',
    )
    expect(continuousTop).toHaveLength(1)
    expect(continuousTop[0].path).toHaveLength(6)
  })

  it('draws proportional braking boards only on their authored elevation layer', () => {
    const track = createStraightTransitionTrack()
    track.sceneryLayout.brakingMarkers = [
      {
        id: 'turn-1-150m',
        cornerIndex: 1,
        distanceToCornerMeters: 150,
        trackDistanceMeters: 5,
        side: 'right',
        position: { x: 5, y: -9 },
        rotation: 0,
        elevationLayer: 0,
      },
    ]
    const { context, operations } = createRecordingContext()
    const renderer = new RaceRenderer(createCanvas(context), track)

    internals(renderer).drawBrakingMarkers(IDENTITY_TRANSFORM, 1)
    expect(operations).toHaveLength(0)

    internals(renderer).drawBrakingMarkers(IDENTITY_TRANSFORM, 0)
    expect(
      operations.filter(
        (operation) =>
          operation.kind === 'fill' && operation.color === '#f5f4ef',
      ),
    ).toHaveLength(1)
    const board = operations.find(
      (operation) =>
        operation.kind === 'fill' && operation.color === '#f5f4ef',
    )
    expect(board?.path).toHaveLength(4)
    expect(
      Math.hypot(
        (board?.path[1].x ?? 0) - (board?.path[0].x ?? 0),
        (board?.path[1].y ?? 0) - (board?.path[0].y ?? 0),
      ),
    ).toBeCloseTo(3, 6)
    expect(
      operations.some(
        (operation) =>
          operation.kind === 'stroke' && operation.color === '#34383f',
      ),
    ).toBe(true)
  })

  it('draws a connected pit lane, box markings and repeated garages', () => {
    const track = createStraightTransitionTrack()
    track.pitLane.path = Array.from({ length: 25 }, (_, index) => ({
      x: index * (20 / 24),
      y: -11,
    }))
    const { context, operations } = createRecordingContext()
    const renderer = new RaceRenderer(createCanvas(context), track)

    internals(renderer).drawPitInfrastructure(IDENTITY_TRANSFORM)

    expect(
      operations.filter(
        (operation) =>
          operation.kind === 'stroke' && operation.color === '#29313a',
      ),
    ).toHaveLength(24)
    expect(
      operations
        .filter(
          (operation) =>
            operation.kind === 'stroke' && operation.color === '#29313a',
        )
        .every((operation) => Math.abs(operation.width - 11) < 1e-8),
    ).toBe(true)
    expect(
      operations.some(
        (operation) =>
          operation.kind === 'fill' && operation.color === '#eceeef',
      ),
    ).toBe(true)
    expect(
      operations.some(
        (operation) =>
          operation.kind === 'fill' &&
          operation.color === '#d9dcdf55',
      ),
    ).toBe(true)
    expect(
      operations.some(
        (operation) =>
          operation.kind === 'fill' &&
          operation.color === 'rgba(88, 148, 169, 0.56)',
      ),
    ).toBe(true)
    const firstPitBox = operations.find(
      (operation) =>
        operation.kind === 'fill' && operation.color === '#d9dcdf55',
    )!
    const boxWidth =
      Math.max(...firstPitBox.path.map((point) => point.x)) -
      Math.min(...firstPitBox.path.map((point) => point.x))
    const boxDepth =
      Math.max(...firstPitBox.path.map((point) => point.y)) -
      Math.min(...firstPitBox.path.map((point) => point.y))
    expect(boxWidth).toBeCloseTo(7, 8)
    expect(boxDepth).toBeCloseTo(2.4, 8)

    const pitWallBase = operations.find(
      (operation) =>
        operation.kind === 'stroke' &&
        operation.color === '#505a64' &&
        operation.path.length === 25,
    )!
    const pitWallTop = operations.find(
      (operation) =>
        operation.kind === 'stroke' &&
        operation.color === '#8f2933' &&
        operation.path.length === 25,
    )!
    expect(pitWallBase).toBeDefined()
    expect(pitWallTop).toBeDefined()
    expect(pitWallBase.path[0].y - pitWallTop.path[0].y).toBeCloseTo(
      CAMERA_HEIGHT_SCALE,
      8,
    )
  })

  it('draws a cullable visual-only escape road with alternating block rows', () => {
    const track = createStraightTransitionTrack()
    track.sceneryLayout.escapeRoads = [
      {
        id: 'test-slalom',
        kind: 'slalom-block-rows',
        affectsPhysics: false,
        elevationLayer: 0,
        widthMeters: 7,
        path: [
          { x: -150, y: 0 },
          { x: 150, y: 0 },
        ],
        obstacleRows: [
          {
            from: { x: -6, y: -3 },
            to: { x: -6, y: 1 },
            blockLengthMeters: 1,
            palette: 'white-red-chevron',
          },
          {
            from: { x: 0, y: -1 },
            to: { x: 0, y: 3 },
            blockLengthMeters: 1,
            palette: 'white-red-chevron',
          },
          {
            from: { x: 6, y: -3 },
            to: { x: 6, y: 1 },
            blockLengthMeters: 1,
            palette: 'white-red-chevron',
          },
        ],
      },
    ]
    const { context, operations } = createRecordingContext()
    const renderer = new RaceRenderer(createCanvas(context), track)

    internals(renderer).drawEscapeRoadSurfaces(IDENTITY_TRANSFORM, 0)
    internals(renderer).drawEscapeRoadObstacleRows(IDENTITY_TRANSFORM, 0)

    expect(
      operations.filter(
        (operation) =>
          operation.kind === 'stroke' && operation.color === '#29303b',
      ),
    ).toHaveLength(1)
    expect(
      operations.some(
        (operation) =>
          operation.kind === 'fill' && operation.color === '#f0f0fa',
      ),
    ).toBe(true)
    expect(
      operations.some(
        (operation) =>
          operation.kind === 'fill' && operation.color === '#d9283b',
      ),
    ).toBe(true)

    const beforeWrongLayer = operations.length
    internals(renderer).drawEscapeRoadSurfaces(IDENTITY_TRANSFORM, 1)
    internals(renderer).drawEscapeRoadObstacleRows(IDENTITY_TRANSFORM, 1)
    expect(operations).toHaveLength(beforeWrongLayer)

    track.sceneryLayout.escapeRoads[0].path = [
      { x: 300, y: 300 },
      { x: 360, y: 300 },
    ]
    track.sceneryLayout.escapeRoads[0].obstacleRows = [
      {
        from: { x: 320, y: 296 },
        to: { x: 320, y: 300 },
        blockLengthMeters: 1,
        palette: 'white-red-chevron',
      },
      {
        from: { x: 330, y: 300 },
        to: { x: 330, y: 304 },
        blockLengthMeters: 1,
        palette: 'white-red-chevron',
      },
      {
        from: { x: 340, y: 296 },
        to: { x: 340, y: 300 },
        blockLengthMeters: 1,
        palette: 'white-red-chevron',
      },
    ]
    const beforeCulled = operations.length
    internals(renderer).drawEscapeRoadSurfaces(IDENTITY_TRANSFORM, 0)
    internals(renderer).drawEscapeRoadObstacleRows(IDENTITY_TRANSFORM, 0)
    expect(operations).toHaveLength(beforeCulled)
  })

  it('renders only the authored external edge of a physical escape road', () => {
    const track = createStraightTransitionTrack()
    track.sceneryLayout.escapeRoads = [
      {
        id: 'external-edge-only',
        kind: 'slalom-block-rows',
        affectsPhysics: true,
        elevationLayer: 0,
        widthMeters: 10.5,
        edgeMaterial: 'concrete-wall',
        edgeSides: ['left'],
        path: [
          { x: -20, y: 0 },
          { x: 20, y: 0 },
        ],
        obstacleRows: [
          {
            from: { x: -8, y: -4 },
            to: { x: -8, y: 2 },
            blockLengthMeters: 1,
            palette: 'white-red-chevron',
            collisionMaterial: 'concrete-wall',
          },
          {
            from: { x: 0, y: -2 },
            to: { x: 0, y: 4 },
            blockLengthMeters: 1,
            palette: 'white-red-chevron',
            collisionMaterial: 'concrete-wall',
          },
          {
            from: { x: 8, y: -4 },
            to: { x: 8, y: 2 },
            blockLengthMeters: 1,
            palette: 'white-red-chevron',
            collisionMaterial: 'concrete-wall',
          },
        ],
      },
    ]
    const { context, operations } = createRecordingContext()
    const renderer = new RaceRenderer(createCanvas(context), track)

    internals(renderer).drawEscapeRoadSurfaces(IDENTITY_TRANSFORM, 0)

    expect(
      operations.filter(
        (operation) =>
          operation.kind === 'stroke' && operation.color === '#242b32',
      ),
    ).toHaveLength(1)
  })

  it('keeps visual escape roads outside the deterministic physics state', () => {
    const baseTrack = structuredClone(LONG_TRACK)
    const visualTrack = structuredClone(LONG_TRACK)
    visualTrack.sceneryLayout.escapeRoads = [
      {
        id: 'physics-isolation-slalom',
        kind: 'slalom-block-rows',
        affectsPhysics: false,
        elevationLayer: 0,
        widthMeters: 7,
        path: [
          { x: 0, y: 0 },
          { x: 30, y: 0 },
        ],
        obstacleRows: [
          { from: { x: 8, y: -3 }, to: { x: 8, y: 1 }, blockLengthMeters: 1, palette: 'white-red-chevron' },
          { from: { x: 15, y: -1 }, to: { x: 15, y: 3 }, blockLengthMeters: 1, palette: 'white-red-chevron' },
          { from: { x: 22, y: -3 }, to: { x: 22, y: 1 }, blockLengthMeters: 1, palette: 'white-red-chevron' },
        ],
      },
    ]
    const baseEngine = createEngine(baseTrack)
    const visualEngine = createEngine(visualTrack)
    for (const engine of [baseEngine, visualEngine]) {
      engine.setInput('player-1', { throttle: 0.82, brake: 0, steer: 0.18 })
    }
    for (let frame = 0; frame < 180; frame += 1) {
      baseEngine.advanceFrame(1 / 60)
      visualEngine.advanceFrame(1 / 60)
    }

    expect(visualEngine.getVehicleState('player-1')).toEqual(
      baseEngine.getVehicleState('player-1'),
    )
    expect(visualEngine.getResults()).toEqual(baseEngine.getResults())
  })

  it('draws a visible deck underside and supports for the Suzuka overpass', () => {
    const track = createStraightTransitionTrack()
    track.id = 'suzuka'
    const elevated = track.centerline.map((point) => ({
      ...point,
      elevationLayer: 1,
    }))
    const { context, operations } = createRecordingContext()
    const renderer = new RaceRenderer(createCanvas(context), track)

    internals(renderer).drawBridgeUnderstructure(
      elevated,
      IDENTITY_TRANSFORM,
    )

    expect(
      operations.filter(
        (operation) =>
          operation.kind === 'stroke' && operation.color === '#111720',
      ).length,
    ).toBe(elevated.length - 1)
    expect(
      operations
        .filter(
          (operation) =>
            operation.kind === 'stroke' && operation.color === '#111720',
        )
        .every((operation) => operation.lineCap === 'butt'),
    ).toBe(true)
    expect(
      operations.some(
        (operation) =>
          operation.kind === 'stroke' && operation.color === '#222a34',
      ),
    ).toBe(true)
  })

  it('uses authored structure dimensions for footprint scaling and safe culling', () => {
    const metrics = sceneryVisualMetrics({
      id: 'metric-race-control',
      kind: 'race-control-building',
      position: { x: 0, y: 0 },
      rotation: 0,
      scale: 2,
      dimensions: {
        lengthMeters: 27,
        depthMeters: 8.2,
        heightMeters: 10,
      },
    })

    expect(metrics.scale).toBeCloseTo(20, 8)
    expect(metrics.depthScale).toBeCloseTo(0.5, 8)
    expect(metrics.cullRadiusMeters).toBeCloseTo(
      Math.hypot(13.5, 4.1) + 10 * CAMERA_HEIGHT_SCALE,
      8,
    )
  })

  it('fades only Suzuka upper layers for a lower car approaching the crossover', () => {
    const track = createStraightTransitionTrack()
    track.id = 'suzuka'
    track.centerline = [
      { x: -80, y: 0, distanceMeters: 0, halfWidthMeters: 6, elevationLayer: 0 },
      { x: 80, y: 0, distanceMeters: 160, halfWidthMeters: 6, elevationLayer: 0 },
      { x: 80, y: -80, distanceMeters: 240, halfWidthMeters: 6, elevationLayer: 1 },
      { x: 0, y: -80, distanceMeters: 320, halfWidthMeters: 6, elevationLayer: 1 },
      { x: 0, y: 80, distanceMeters: 480, halfWidthMeters: 6, elevationLayer: 1 },
      { x: -80, y: 80, distanceMeters: 560, halfWidthMeters: 6, elevationLayer: 0 },
    ]
    const crossings = findSuzukaCrossingPoints(track)
    expect(crossings).toEqual([{ x: 0, y: 0 }])
    expect(
      calculateSuzukaUpperLayerOpacity(
        track.id,
        { renderPosition: { x: 0, y: 0 }, trackLayer: 0 },
        crossings,
      ),
    ).toBeCloseTo(0.34, 8)
    expect(
      calculateSuzukaUpperLayerOpacity(
        track.id,
        { renderPosition: { x: -80, y: 0 }, trackLayer: 0 },
        crossings,
      ),
    ).toBe(1)
    expect(
      calculateSuzukaUpperLayerOpacity(
        track.id,
        { renderPosition: { x: 0, y: 0 }, trackLayer: 1 },
        crossings,
      ),
    ).toBe(1)
  })

  it('composites a faded Suzuka layer once so overlapping round segments stay smooth', () => {
    const track = createStraightTransitionTrack()
    track.id = 'suzuka'
    const main = createRecordingContext()
    const layer = createRecordingContext()
    const renderer = new RaceRenderer(createCanvas(main.context), track)
    const layerCanvas = document.createElement('canvas')
    Object.defineProperty(layerCanvas, 'getContext', {
      value: () => layer.context,
    })
    const rendererInternals = internals(renderer) as RendererInternals & {
      opacityLayerCanvas?: HTMLCanvasElement
      opacityLayerContext?: CanvasRenderingContext2D
    }
    rendererInternals.opacityLayerCanvas = layerCanvas
    rendererInternals.opacityLayerContext = layer.context

    const opacityWhileDrawing: number[] = []
    rendererInternals.drawIsolatedOpacityLayer(
      { x: 0, y: 0, width: 120, height: 80 },
      0.34,
      () => {
        opacityWhileDrawing.push(layer.context.globalAlpha)
        layer.context.beginPath()
        layer.context.moveTo(0, 0)
        layer.context.lineTo(60, 0)
        layer.context.stroke()
        layer.context.beginPath()
        layer.context.moveTo(40, 0)
        layer.context.lineTo(100, 0)
        layer.context.stroke()
      },
    )

    expect(opacityWhileDrawing).toEqual([1])
    expect(layer.operations).toHaveLength(2)
    expect(main.operations).toHaveLength(0)
    expect(main.composites).toEqual([
      { source: layerCanvas, opacity: 0.34 },
    ])
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
