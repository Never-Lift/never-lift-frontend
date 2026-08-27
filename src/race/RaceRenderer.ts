import type {
  TrackBarrierType,
  TrackChunk,
  TrackCurbPalette,
  TrackDefinition,
  TrackPitVisualStyle,
  TrackSideEnvironment,
  TrackSurfaceMaterial,
} from '@/lib/api'
import {
  CAMERA_HEIGHT_SCALE,
  createCameraTransform,
  createMinimapTransform,
  createSplitViewports,
  getVisibleTrackChunks,
  projectedSegmentPixelsPerMeter,
  projectedTrackWidth,
  RaceCamera,
  type CameraTransform,
  type Viewport,
  worldToCamera,
  worldToMinimap,
} from '@/race/camera'
import { PHYSICS_CONSTANTS } from '@/race/constants'
import type { LocalRaceOverlayState } from '@/race/LocalRaceSession'
import { magnitude } from '@/race/math'
import type { RaceEngine } from '@/race/RaceEngine'
import {
  drawSceneryVisual,
  getSceneryRenderLayer,
  getSceneryRotationOffset,
} from '@/race/scenery-visuals'
import {
  TrackGeometry,
  trackSideEnvironmentWidth,
} from '@/race/TrackGeometry'
import type { InterpolatedVehicleState, Vector2 } from '@/race/types'
import {
  drawVehicleVisual,
  vehicleYawRelativeToCamera,
} from '@/race/vehicle-visuals'
import {
  AMBIENT_PARTICLE_BUDGET,
  DEFAULT_GRAPHICS_QUALITY,
  HEADLIGHT_VISUAL_SETTINGS,
  VEHICLE_SHADOW_SETTINGS,
  type GraphicsQuality,
  type TimeOfDayPreset,
} from '@/race/visual-settings'

type TireMark = {
  position: Vector2
  onGrass: boolean
  trackLayer: number
}

type ElevationTrackSection = {
  elevationLayer: number
  points: TrackDefinition['centerline']
}

export type RenderStats = {
  totalChunks: number
  visibleChunksByViewport: number[]
  ambientParticlesByViewport: number[]
}

export type RaceRendererOptions = {
  timeOfDay?: TimeOfDayPreset
  quality?: GraphicsQuality
  splitScreenAspectRatio?: () => number
}

const SURFACE_COLORS: Record<TrackSurfaceMaterial, string> = {
  asphalt: '#39414d',
  grass: '#24492d',
  gravel: '#716956',
}

const BACKGROUND_COLORS: Record<TrackDefinition['sceneryLayout']['preset'], string> = {
  park: '#142b1d',
  street: '#222832',
  desert: '#3b3223',
  coastal: '#16302c',
  classic: '#182b1d',
  'night-city': '#171c25',
}

const GLAZED_PIT_ARCHITECTURES = new Set<
  TrackPitVisualStyle['architecture']
>([
  'permanent-modern',
  'stepped-modern',
  'wing',
  'stadium',
  'exhibition',
  'marina-canopy',
])

const BARRIER_STYLES: Record<
  TrackBarrierType,
  {
    color: string
    sideColor: string
    widthMeters: number
    heightMeters: number
    dashMeters?: number[]
  }
> = {
  'concrete-wall': {
    color: '#d7dce5',
    sideColor: '#8f99a6',
    widthMeters: 0.48,
    heightMeters: 1.05,
  },
  guardrail: {
    color: '#aeb7c3',
    sideColor: '#6f7b89',
    widthMeters: 0.32,
    heightMeters: 0.78,
  },
  tecpro: {
    color: '#6787ad',
    sideColor: '#405c7d',
    widthMeters: 0.62,
    heightMeters: 1.15,
  },
  'tyre-barrier': {
    color: '#171b21',
    sideColor: '#080b0f',
    widthMeters: 0.72,
    heightMeters: 1,
    dashMeters: [0.9, 0.28],
  },
}

const FENCE_STYLE = {
  color: '#697789',
  widthMeters: 0.22,
  dashMeters: [0.8, 0.45],
}
const FENCE_GAP_METERS = 0.18
const FENCE_HEIGHT_METERS = 2.6
const FENCE_POST_SPACING_METERS = 3
const PIT_LANE_WIDTH_METERS = 6
const BRIDGE_DECK_HEIGHT_METERS = 2.4
const SUZUKA_REVEAL_START_METERS = 62
const SUZUKA_REVEAL_FULL_METERS = 18
const SUZUKA_UPPER_LAYER_MINIMUM_OPACITY = 0.34

const CURB_PALETTES: Record<TrackCurbPalette, string[]> = {
  'red-white': ['#d9283b', '#f0f0fa'],
  'orange-white': ['#ff6a2a', '#f0f0fa'],
  'red-white-blue': ['#d9283b', '#f0f0fa', '#2574d9'],
  'green-white-red': ['#169b62', '#f0f0fa', '#d9283b'],
  'red-yellow': ['#d9283b', '#f4ca28'],
  'green-yellow': ['#14944f', '#f4ca28'],
  'maroon-white': ['#7d1735', '#f0f0fa'],
  'blue-white': ['#277bd8', '#f0f0fa'],
}

const AMBIENT_PARTICLE_COLORS: Record<
  TrackDefinition['sceneryLayout']['preset'],
  string
> = {
  park: 'rgba(180, 211, 151, 0.34)',
  street: 'rgba(185, 199, 218, 0.24)',
  desert: 'rgba(226, 190, 124, 0.34)',
  coastal: 'rgba(184, 226, 230, 0.28)',
  classic: 'rgba(196, 215, 159, 0.3)',
  'night-city': 'rgba(118, 192, 255, 0.3)',
}

function deterministicHash(seed: string) {
  let hash = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function segmentIntersection(
  firstFrom: Vector2,
  firstTo: Vector2,
  secondFrom: Vector2,
  secondTo: Vector2,
) {
  const first = {
    x: firstTo.x - firstFrom.x,
    y: firstTo.y - firstFrom.y,
  }
  const second = {
    x: secondTo.x - secondFrom.x,
    y: secondTo.y - secondFrom.y,
  }
  const denominator = first.x * second.y - first.y * second.x
  if (Math.abs(denominator) <= 1e-8) return null
  const delta = {
    x: secondFrom.x - firstFrom.x,
    y: secondFrom.y - firstFrom.y,
  }
  const firstRatio = (delta.x * second.y - delta.y * second.x) / denominator
  const secondRatio = (delta.x * first.y - delta.y * first.x) / denominator
  if (
    firstRatio < 0 ||
    firstRatio > 1 ||
    secondRatio < 0 ||
    secondRatio > 1
  ) {
    return null
  }
  return {
    x: firstFrom.x + first.x * firstRatio,
    y: firstFrom.y + first.y * firstRatio,
  }
}

export function findSuzukaCrossingPoints(track: TrackDefinition) {
  if (track.id !== 'suzuka') return []
  type TrackSegment = {
    from: TrackDefinition['centerline'][number]
    to: TrackDefinition['centerline'][number]
  }
  const lowerSegments: TrackSegment[] = []
  const upperSegments: TrackSegment[] = []
  for (let index = 0; index < track.centerline.length - 1; index += 1) {
    const from = track.centerline[index]
    const to = track.centerline[index + 1]
    if (from.elevationLayer !== to.elevationLayer) continue
    const target = from.elevationLayer > 0 ? upperSegments : lowerSegments
    target.push({ from, to })
  }
  const crossings: Vector2[] = []
  for (const lower of lowerSegments) {
    for (const upper of upperSegments) {
      const crossing = segmentIntersection(
        lower.from,
        lower.to,
        upper.from,
        upper.to,
      )
      if (
        crossing &&
        crossings.every(
          (existing) =>
            Math.hypot(existing.x - crossing.x, existing.y - crossing.y) > 12,
        )
      ) {
        crossings.push(crossing)
      }
    }
  }
  return crossings
}

export function calculateSuzukaUpperLayerOpacity(
  trackId: string,
  focusedVehicle: Pick<
    InterpolatedVehicleState,
    'renderPosition' | 'trackLayer'
  >,
  crossings: Vector2[],
) {
  if (
    trackId !== 'suzuka' ||
    focusedVehicle.trackLayer > 0 ||
    crossings.length === 0
  ) {
    return 1
  }
  const distance = Math.min(
    ...crossings.map((crossing) =>
      Math.hypot(
        focusedVehicle.renderPosition.x - crossing.x,
        focusedVehicle.renderPosition.y - crossing.y,
      ),
    ),
  )
  const linearProgress = Math.max(
    0,
    Math.min(
      1,
      (SUZUKA_REVEAL_START_METERS - distance) /
        (SUZUKA_REVEAL_START_METERS - SUZUKA_REVEAL_FULL_METERS),
    ),
  )
  const easedProgress = linearProgress ** 2 * (3 - 2 * linearProgress)
  return 1 - (1 - SUZUKA_UPPER_LAYER_MINIMUM_OPACITY) * easedProgress
}

function trackCullMarginMeters(
  track: TrackDefinition,
  geometry: TrackGeometry,
) {
  return track.centerline.reduce((widest, point) => {
    const leftEnvironment = geometry.getTrackSideEnvironmentAt(
      point.distanceMeters,
      'left',
    )
    const rightEnvironment = geometry.getTrackSideEnvironmentAt(
      point.distanceMeters,
      'right',
    )
    const sideExtent = (environment: TrackSideEnvironment) =>
      trackSideEnvironmentWidth(environment) +
      BARRIER_STYLES[environment.barrier].widthMeters / 2 +
      (environment.fence ? FENCE_GAP_METERS + FENCE_STYLE.widthMeters : 0)
    return Math.max(
      widest,
      point.halfWidthMeters + sideExtent(leftEnvironment),
      point.halfWidthMeters + sideExtent(rightEnvironment),
    )
  }, 0)
}

export function calculateTrackCullMarginMeters(track: TrackDefinition) {
  return trackCullMarginMeters(track, new TrackGeometry(track))
}

export function sortVehiclesByProjectedDepth(
  vehicles: InterpolatedVehicleState[],
  transform: CameraTransform,
) {
  return [...vehicles].sort(
    (first, second) =>
      worldToCamera(first.renderPosition, transform).y -
      worldToCamera(second.renderPosition, transform).y,
  )
}

export class RaceRenderer {
  private readonly context: CanvasRenderingContext2D
  private readonly canvas: HTMLCanvasElement
  private readonly track: TrackDefinition
  private readonly geometry: TrackGeometry
  private readonly timeOfDay: TimeOfDayPreset
  private readonly quality: GraphicsQuality
  private readonly splitScreenAspectRatio: () => number
  private readonly trackCullMarginMeters: number
  private readonly suzukaCrossings: Vector2[]
  private readonly tireMarks: TireMark[] = []
  private readonly cameras = new Map<string, RaceCamera>()
  private frameCount = 0
  private renderStats: RenderStats

  constructor(
    canvas: HTMLCanvasElement,
    track: TrackDefinition,
    options: RaceRendererOptions = {},
  ) {
    this.canvas = canvas
    this.track = track
    this.geometry = new TrackGeometry(track)
    this.timeOfDay = options.timeOfDay ?? 'day'
    this.quality = options.quality ?? DEFAULT_GRAPHICS_QUALITY
    this.splitScreenAspectRatio =
      options.splitScreenAspectRatio ??
      (() => this.canvas.width / this.canvas.height)
    this.trackCullMarginMeters = trackCullMarginMeters(track, this.geometry)
    this.suzukaCrossings = findSuzukaCrossingPoints(track)
    this.renderStats = {
      totalChunks: track.chunks.length,
      visibleChunksByViewport: [],
      ambientParticlesByViewport: [],
    }
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas 2D não está disponível neste navegador.')
    this.context = context
  }

  render(
    engine: RaceEngine,
    deltaSeconds: number,
    overlayState?: LocalRaceOverlayState,
  ) {
    this.resize()
    const vehicles = engine.getInterpolatedVehicles()
    const focusIds = engine.mode === 'local' ? ['player-1', 'player-2'] : ['player-1']
    const viewports = createSplitViewports(
      this.canvas.width,
      this.canvas.height,
      focusIds.length === 1 ? 1 : 2,
      this.splitScreenAspectRatio(),
    )

    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height)
    this.collectTireMarks(vehicles)
    const visibleChunksByViewport: number[] = []
    const ambientParticlesByViewport: number[] = []
    viewports.forEach((viewport, index) => {
      const focusId = focusIds[index]
      const focusedVehicle =
        vehicles.find((vehicle) => vehicle.id === focusId) ?? vehicles[0]
      if (!focusedVehicle) return

      const camera = this.getCamera(focusedVehicle)
      const cameraState = camera.update(
        focusedVehicle.renderPosition,
        focusedVehicle.velocity,
        deltaSeconds,
      )
      const profile = PHYSICS_CONSTANTS.vehicleVisual
      const transform = createCameraTransform(
        cameraState,
        viewport,
        profile.lengthMeters,
      )
      const visibleChunks = getVisibleTrackChunks(
        this.track.chunks,
        transform,
        Math.max(24, this.trackCullMarginMeters * transform.pixelsPerMeter),
      )
      visibleChunksByViewport.push(visibleChunks.length)
      ambientParticlesByViewport.push(this.drawViewport(
        viewport,
        transform,
        visibleChunks,
        vehicles,
        focusedVehicle,
        overlayState,
      ))
    })
    this.drawSplitDivider(viewports)
    this.renderStats = {
      totalChunks: this.track.chunks.length,
      visibleChunksByViewport,
      ambientParticlesByViewport,
    }
    this.frameCount += 1
  }

  getRenderStats(): RenderStats {
    return {
      totalChunks: this.renderStats.totalChunks,
      visibleChunksByViewport: [...this.renderStats.visibleChunksByViewport],
      ambientParticlesByViewport: [
        ...this.renderStats.ambientParticlesByViewport,
      ],
    }
  }

  private resize() {
    const bounds = this.canvas.getBoundingClientRect()
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
    const width = Math.max(1, Math.round(bounds.width * pixelRatio))
    const height = Math.max(1, Math.round(bounds.height * pixelRatio))
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width
      this.canvas.height = height
    }
  }

  private getCamera(vehicle: InterpolatedVehicleState) {
    const existing = this.cameras.get(vehicle.id)
    if (existing) return existing
    const speed = magnitude(vehicle.velocity)
    const orientation =
      speed >= 1.5
        ? Math.atan2(vehicle.velocity.y, vehicle.velocity.x)
        : vehicle.renderAngle
    const camera = new RaceCamera(vehicle.renderPosition, orientation)
    this.cameras.set(vehicle.id, camera)
    return camera
  }

  private drawViewport(
    viewport: Viewport,
    transform: CameraTransform,
    visibleChunks: TrackChunk[],
    vehicles: InterpolatedVehicleState[],
    focusedVehicle: InterpolatedVehicleState,
    overlayState?: LocalRaceOverlayState,
  ) {
    const context = this.context
    context.save()
    context.beginPath()
    context.rect(viewport.x, viewport.y, viewport.width, viewport.height)
    context.clip()
    context.fillStyle = BACKGROUND_COLORS[this.track.sceneryLayout.preset]
    context.fillRect(viewport.x, viewport.y, viewport.width, viewport.height)

    const gradient = context.createRadialGradient(
      transform.anchor.x,
      transform.anchor.y,
      0,
      transform.anchor.x,
      transform.anchor.y,
      Math.max(viewport.width, viewport.height) * 0.75,
    )
    gradient.addColorStop(0, 'rgba(49, 199, 255, 0.035)')
    gradient.addColorStop(1, 'rgba(7, 11, 20, 0.32)')
    context.fillStyle = gradient
    context.fillRect(viewport.x, viewport.y, viewport.width, viewport.height)

    const visibleTrackSections = visibleChunks.flatMap((chunk) =>
      this.splitByElevationLayer(this.getChunkPoints(chunk)),
    )

    // Draw every visible section in material passes. Drawing a complete chunk at
    // a time would let a later chunk's wide runoff cover asphalt from a nearby branch
    // (Suzuka's crossover and Monaco's parallel streets are concrete examples).
    // Boundaries stay above the asphalt so walls and fences remain visible when
    // they sit directly against the track edge.
    const elevationLayers = [
      ...new Set(
        [
          ...visibleTrackSections.map((section) => section.elevationLayer),
          ...vehicles.map((vehicle) => vehicle.trackLayer),
        ],
      ),
    ].sort((first, second) => first - second)
    this.drawScenery(transform, 'ground')
    const suzukaUpperLayerOpacity = calculateSuzukaUpperLayerOpacity(
      this.track.id,
      focusedVehicle,
      this.suzukaCrossings,
    )
    for (const elevationLayer of elevationLayers) {
      const isFadedSuzukaUpperLayer =
        this.track.id === 'suzuka' &&
        elevationLayer > 0 &&
        suzukaUpperLayerOpacity < 1
      if (isFadedSuzukaUpperLayer) {
        context.save()
        context.globalAlpha *= suzukaUpperLayerOpacity
      }
      const sections = visibleTrackSections.filter(
        (section) => section.elevationLayer === elevationLayer,
      )
      if (this.track.id === 'suzuka' && elevationLayer > 0) {
        for (const { points } of sections) {
          this.drawBridgeUnderstructure(points, transform)
        }
      }
      for (const { points } of sections) {
        this.drawTrackEnvironments(points, transform)
      }
      if (elevationLayer === 0) this.drawPitInfrastructure(transform)
      for (const { points } of sections) {
        this.drawTrackAsphalt(points, transform)
      }
      for (const { points } of sections) {
        this.drawTrackFences(points, transform)
      }
      for (const { points } of sections) {
        this.drawTrackBarriers(points, transform)
      }
      for (const { points } of sections) {
        this.drawTrackDetails(points, transform)
      }
      if (elevationLayer === 0) this.drawStartFinish(transform)
      this.drawTireMarks(transform, elevationLayer)
      const vehiclesAtLayer = sortVehiclesByProjectedDepth(
        vehicles.filter((vehicle) => vehicle.trackLayer === elevationLayer),
        transform,
      )
      for (const vehicle of vehiclesAtLayer) {
        this.drawVehicle(vehicle, transform)
      }
      if (isFadedSuzukaUpperLayer) context.restore()
    }
    this.drawScenery(transform, 'overhead')
    const ambientParticleCount = this.drawAmbientParticles(
      transform,
      visibleChunks,
    )
    this.drawTimeOfDayLighting(
      viewport,
      transform,
      visibleChunks,
      visibleTrackSections,
      vehicles,
      suzukaUpperLayerOpacity,
    )
    this.drawMinimap(viewport, vehicles, focusedVehicle)
    this.drawDriverLabel(viewport, focusedVehicle.name)
    this.drawStartProcedure(viewport, focusedVehicle.id, overlayState)
    context.restore()
    return ambientParticleCount
  }

  private getChunkPoints(chunk: TrackChunk) {
    const path = this.track.centerline
    return path.filter((_, index) => {
      const previousDistance = path[Math.max(0, index - 1)].distanceMeters
      const nextDistance = path[Math.min(path.length - 1, index + 1)].distanceMeters
      return (
        nextDistance >= chunk.fromDistanceMeters &&
        previousDistance <= chunk.toDistanceMeters
      )
    })
  }

  private splitByElevationLayer(
    points: TrackDefinition['centerline'],
  ): ElevationTrackSection[] {
    const sections: ElevationTrackSection[] = []
    const appendSegment = (
      elevationLayer: number,
      from: TrackDefinition['centerline'][number],
      to: TrackDefinition['centerline'][number],
    ) => {
      const current = sections.at(-1)
      if (current?.elevationLayer === elevationLayer) {
        current.points.push(to)
        return
      }
      sections.push({ elevationLayer, points: [from, to] })
    }

    for (let index = 0; index < points.length - 1; index += 1) {
      const from = points[index]
      const to = points[index + 1]
      if (from.elevationLayer === to.elevationLayer) {
        appendSegment(from.elevationLayer, from, to)
        continue
      }

      // TrackGeometry assigns the nearest endpoint's layer, switching at
      // alpha=0.5. Split the rendered segment at that same midpoint so a car
      // cannot be projected onto one layer while its road is drawn on another.
      const midpoint = {
        x: (from.x + to.x) / 2,
        y: (from.y + to.y) / 2,
        distanceMeters: (from.distanceMeters + to.distanceMeters) / 2,
        halfWidthMeters: (from.halfWidthMeters + to.halfWidthMeters) / 2,
      }
      appendSegment(from.elevationLayer, from, {
        ...midpoint,
        elevationLayer: from.elevationLayer,
      })
      appendSegment(
        to.elevationLayer,
        { ...midpoint, elevationLayer: to.elevationLayer },
        to,
      )
    }
    return sections
  }

  private drawTrackAsphalt(
    points: TrackDefinition['centerline'],
    transform: CameraTransform,
  ) {
    for (let index = 0; index < points.length - 1; index += 1) {
      const from = points[index]
      const to = points[index + 1]
      const averageHalfWidthMeters =
        (from.halfWidthMeters + to.halfWidthMeters) / 2
      this.strokeSegment(
        worldToCamera(from, transform),
        worldToCamera(to, transform),
        projectedTrackWidth(
          from,
          to,
          averageHalfWidthMeters * 2,
          transform,
        ),
        '#29303b',
        index === 0 || index === points.length - 2 ? 'butt' : 'round',
      )
    }
  }

  private drawTrackDetails(
    points: TrackDefinition['centerline'],
    transform: CameraTransform,
  ) {
    this.drawTrackCurbs(points, transform)
    this.drawTrackEdges(points, transform)
    for (let index = 0; index < points.length - 1; index += 1) {
      const from = points[index]
      const to = points[index + 1]
      const tangentScale = projectedSegmentPixelsPerMeter(
        from,
        to,
        transform,
      )
      this.context.save()
      this.context.setLineDash([1.6 * tangentScale, 1.4 * tangentScale])
      this.context.lineDashOffset =
        -(from.distanceMeters % 3) * tangentScale
      this.strokeSegment(
        worldToCamera(from, transform),
        worldToCamera(to, transform),
        Math.max(1, projectedTrackWidth(from, to, 0.12, transform)),
        'rgba(240, 240, 250, 0.17)',
      )
      this.context.restore()
    }
  }

  private drawTrackCurbs(
    points: TrackDefinition['centerline'],
    transform: CameraTransform,
  ) {
    const visibleFrom = points[0]?.distanceMeters ?? 0
    const visibleTo = points.at(-1)?.distanceMeters ?? 0
    for (const curb of this.track.curbs) {
      const overlapFrom = Math.max(visibleFrom, curb.fromDistanceMeters)
      const overlapTo = Math.min(visibleTo, curb.toDistanceMeters)
      if (overlapTo <= overlapFrom) continue
      const colors = CURB_PALETTES[curb.palette]
      let stripeIndex = Math.floor(
        (overlapFrom - curb.fromDistanceMeters + 0.0001) /
          curb.stripeLengthMeters,
      )
      while (true) {
        const stripeFrom = Math.max(
          overlapFrom,
          curb.fromDistanceMeters + stripeIndex * curb.stripeLengthMeters,
        )
        const stripeTo = Math.min(
          overlapTo,
          curb.fromDistanceMeters +
            (stripeIndex + 1) * curb.stripeLengthMeters,
        )
        if (stripeTo <= stripeFrom + Number.EPSILON) break
        const curbPoints = this.trackPointsForRange(
          points,
          stripeFrom,
          stripeTo,
        ).map((point) =>
          this.offsetTrackPoint(
            point,
            curb.side,
            point.halfWidthMeters + curb.widthMeters / 2,
          ),
        )
        const first = curbPoints[0]
        const last = curbPoints.at(-1)
        if (first && last) {
          this.strokePolyline(
            curbPoints.map((point) => worldToCamera(point, transform)),
            Math.max(
              1.5,
              projectedTrackWidth(
                first,
                last,
                curb.widthMeters,
                transform,
              ),
            ),
            colors[stripeIndex % colors.length],
            'butt',
          )
        }
        if (stripeTo >= overlapTo - Number.EPSILON) break
        stripeIndex += 1
      }
    }
  }

  private trackPointsForRange(
    points: TrackDefinition['centerline'],
    fromDistanceMeters: number,
    toDistanceMeters: number,
  ) {
    const pointAt = (distanceMeters: number) => {
      const exact = points.find(
        (point) => Math.abs(point.distanceMeters - distanceMeters) <= 1e-6,
      )
      if (exact) return exact
      const endIndex = points.findIndex(
        (point) => point.distanceMeters > distanceMeters,
      )
      const safeEndIndex = Math.max(
        1,
        endIndex < 0 ? points.length - 1 : endIndex,
      )
      return this.interpolateTrackPointAtDistance(
        points[safeEndIndex - 1],
        points[safeEndIndex],
        distanceMeters,
      )
    }
    return [
      pointAt(fromDistanceMeters),
      ...points.filter(
        (point) =>
          point.distanceMeters > fromDistanceMeters + 1e-6 &&
          point.distanceMeters < toDistanceMeters - 1e-6,
      ),
      pointAt(toDistanceMeters),
    ]
  }

  private interpolateTrackPointAtDistance(
    from: TrackDefinition['centerline'][number],
    to: TrackDefinition['centerline'][number],
    distanceMeters: number,
  ): TrackDefinition['centerline'][number] {
    const span = to.distanceMeters - from.distanceMeters
    const ratio = span <= Number.EPSILON
      ? 0
      : (distanceMeters - from.distanceMeters) / span
    return {
      x: from.x + (to.x - from.x) * ratio,
      y: from.y + (to.y - from.y) * ratio,
      distanceMeters,
      halfWidthMeters:
        from.halfWidthMeters +
        (to.halfWidthMeters - from.halfWidthMeters) * ratio,
      elevationLayer: ratio < 0.5 ? from.elevationLayer : to.elevationLayer,
    }
  }

  private drawTrackEnvironments(
    points: TrackDefinition['centerline'],
    transform: CameraTransform,
  ) {
    for (let index = 0; index < points.length - 1; index += 1) {
      const from = points[index]
      const to = points[index + 1]
      const distanceMeters = (from.distanceMeters + to.distanceMeters) / 2
      for (const side of ['left', 'right'] as const) {
        const fromEnvironment = this.geometry.getTrackSideEnvironmentAt(
          from.distanceMeters,
          side,
        )
        const toEnvironment = this.geometry.getTrackSideEnvironmentAt(
          to.distanceMeters,
          side,
        )
        const environment = this.geometry.getTrackSideEnvironmentAt(
          distanceMeters,
          side,
        )
        const environmentWidth = trackSideEnvironmentWidth(environment)
        if (environmentWidth <= Number.EPSILON) continue
        const fromEnvironmentWidth = this.canonicalEnvironmentWidthAt(
          from,
          side,
          fromEnvironment,
        )
        const toEnvironmentWidth = this.canonicalEnvironmentWidthAt(
          to,
          side,
          toEnvironment,
        )
        let innerOffset = 0
        for (const zone of environment.zones) {
          const outerOffset = innerOffset + zone.widthMeters
          this.fillTrackZone(
            from,
            to,
            side,
            (innerOffset / environmentWidth) * fromEnvironmentWidth,
            (outerOffset / environmentWidth) * fromEnvironmentWidth,
            (innerOffset / environmentWidth) * toEnvironmentWidth,
            (outerOffset / environmentWidth) * toEnvironmentWidth,
            transform,
            SURFACE_COLORS[zone.surface],
          )
          innerOffset = outerOffset
        }
      }
    }
  }

  private canonicalEnvironmentWidthAt(
    point: TrackDefinition['centerline'][number],
    side: 'left' | 'right',
    fallback: TrackSideEnvironment,
  ) {
    const segment = this.track.barrierGeometry.segments.find(
      (candidate) =>
        candidate.side === side &&
        point.distanceMeters >= candidate.fromDistanceMeters - 1e-6 &&
        point.distanceMeters <= candidate.toDistanceMeters + 1e-6,
    )
    if (!segment) return trackSideEnvironmentWidth(fallback)
    const endIndex = segment.path.findIndex(
      (candidate) => candidate.distanceMeters >= point.distanceMeters,
    )
    const safeEndIndex = Math.max(
      1,
      endIndex < 0 ? segment.path.length - 1 : endIndex,
    )
    const from = segment.path[safeEndIndex - 1]
    const to = segment.path[safeEndIndex]
    const span = to.distanceMeters - from.distanceMeters
    const ratio = span <= Number.EPSILON
      ? 0
      : (point.distanceMeters - from.distanceMeters) / span
    const barrierPoint = {
      x: from.x + (to.x - from.x) * ratio,
      y: from.y + (to.y - from.y) * ratio,
    }
    return Math.max(
      0,
      Math.hypot(barrierPoint.x - point.x, barrierPoint.y - point.y) -
        point.halfWidthMeters,
    )
  }

  private fillTrackZone(
    from: TrackDefinition['centerline'][number],
    to: TrackDefinition['centerline'][number],
    side: 'left' | 'right',
    fromInnerOffsetMeters: number,
    fromOuterOffsetMeters: number,
    toInnerOffsetMeters: number,
    toOuterOffsetMeters: number,
    transform: CameraTransform,
    color: string,
  ) {
    const corners = [
      this.offsetTrackPoint(
        from,
        side,
        from.halfWidthMeters + fromInnerOffsetMeters,
      ),
      this.offsetTrackPoint(
        to,
        side,
        to.halfWidthMeters + toInnerOffsetMeters,
      ),
      this.offsetTrackPoint(
        to,
        side,
        to.halfWidthMeters + toOuterOffsetMeters,
      ),
      this.offsetTrackPoint(
        from,
        side,
        from.halfWidthMeters + fromOuterOffsetMeters,
      ),
    ].map((point) => worldToCamera(point, transform))

    this.context.beginPath()
    this.context.moveTo(corners[0].x, corners[0].y)
    for (const corner of corners.slice(1)) {
      this.context.lineTo(corner.x, corner.y)
    }
    this.context.closePath()
    this.context.fillStyle = color
    this.context.fill()
  }

  private drawTrackEdges(
    points: TrackDefinition['centerline'],
    transform: CameraTransform,
  ) {
    for (const side of ['left', 'right'] as const) {
      for (let index = 0; index < points.length - 1; index += 1) {
        const from = this.offsetTrackPoint(
          points[index],
          side,
          points[index].halfWidthMeters,
        )
        const to = this.offsetTrackPoint(
          points[index + 1],
          side,
          points[index + 1].halfWidthMeters,
        )
        this.strokeSegment(
          worldToCamera(from, transform),
          worldToCamera(to, transform),
          Math.max(1, projectedTrackWidth(from, to, 0.14, transform)),
          'rgba(240, 240, 250, 0.78)',
          'round',
        )
      }
    }
  }

  private drawTrackBarriers(
    points: TrackDefinition['centerline'],
    transform: CameraTransform,
  ) {
    const visibleFromDistance = points[0]?.distanceMeters ?? 0
    const visibleToDistance = points.at(-1)?.distanceMeters ?? 0
    const visibleElevationLayer = points[0]?.elevationLayer ?? 0
    for (const barrier of this.track.barrierGeometry.segments) {
      if (
        barrier.toDistanceMeters < visibleFromDistance ||
        barrier.fromDistanceMeters > visibleToDistance
      ) {
        continue
      }
      const style = BARRIER_STYLES[barrier.material]
      for (let index = 0; index < barrier.path.length - 1; index += 1) {
        const from = barrier.path[index]
        const to = barrier.path[index + 1]
        if (
          from.elevationLayer !== visibleElevationLayer ||
          to.distanceMeters < visibleFromDistance ||
          from.distanceMeters > visibleToDistance
        ) {
          continue
        }
        this.drawCanonicalBarrierSegment(
          from,
          to,
          barrier.side,
          barrier.thicknessMeters,
          style,
          transform,
          index === 0,
          index === barrier.path.length - 2,
        )
      }
    }
  }

  private drawCanonicalBarrierSegment(
    fromPoint: TrackDefinition['barrierGeometry']['segments'][number]['path'][number],
    toPoint: TrackDefinition['barrierGeometry']['segments'][number]['path'][number],
    side: 'left' | 'right',
    thicknessMeters: number,
    style: {
      color: string
      sideColor: string
      widthMeters: number
      heightMeters: number
      dashMeters?: number[]
    },
    transform: CameraTransform,
    drawStartCap: boolean,
    drawEndCap: boolean,
  ) {
    const deltaX = toPoint.x - fromPoint.x
    const deltaY = toPoint.y - fromPoint.y
    const length = Math.hypot(deltaX, deltaY)
    if (length <= Number.EPSILON) return
    const sideDirection = side === 'left' ? 1 : -1
    const outwardNormal = {
      x: (-deltaY / length) * sideDirection,
      y: (deltaX / length) * sideDirection,
    }
    const outwardPoint = (
      point: TrackDefinition['barrierGeometry']['segments'][number]['path'][number],
    ) => ({
      x: point.x + outwardNormal.x * thicknessMeters,
      y: point.y + outwardNormal.y * thicknessMeters,
    })
    const outerFrom = outwardPoint(fromPoint)
    const outerTo = outwardPoint(toPoint)
    const polygon = [fromPoint, toPoint, outerTo, outerFrom].map((point) =>
      worldToCamera(point, transform),
    )

    const height =
      style.heightMeters * transform.pixelsPerMeter * CAMERA_HEIGHT_SCALE
    const top = polygon.map((point) => ({ x: point.x, y: point.y - height }))
    const fillFace = (
      firstIndex: number,
      secondIndex: number,
      color: string,
    ) => {
      this.context.beginPath()
      this.context.moveTo(polygon[firstIndex].x, polygon[firstIndex].y)
      this.context.lineTo(polygon[secondIndex].x, polygon[secondIndex].y)
      this.context.lineTo(top[secondIndex].x, top[secondIndex].y)
      this.context.lineTo(top[firstIndex].x, top[firstIndex].y)
      this.context.closePath()
      this.context.fillStyle = color
      this.context.fill()
    }
    const innerDepth = (polygon[0].y + polygon[1].y) / 2
    const outerDepth = (polygon[2].y + polygon[3].y) / 2
    if (innerDepth >= outerDepth) fillFace(0, 1, style.sideColor)
    else fillFace(3, 2, style.sideColor)
    if (drawEndCap) fillFace(1, 2, 'rgba(64, 73, 84, 0.92)')
    if (drawStartCap) fillFace(3, 0, 'rgba(86, 96, 108, 0.86)')

    this.context.beginPath()
    this.context.moveTo(top[0].x, top[0].y)
    for (const point of top.slice(1)) this.context.lineTo(point.x, point.y)
    this.context.closePath()
    this.context.fillStyle = style.color
    this.context.fill()

    // Consecutive canonical faces turn at every sampled centerline point. A
    // small top joint masks the mathematical wedge between their normals; end
    // caps remain exclusive to the real start/end of a protection segment.
    if (!drawEndCap) {
      const joint = {
        x: (top[1].x + top[2].x) / 2,
        y: (top[1].y + top[2].y) / 2,
      }
      this.context.beginPath()
      this.context.arc(
        joint.x,
        joint.y,
        Math.max(1, thicknessMeters * transform.pixelsPerMeter * 0.58),
        0,
        Math.PI * 2,
      )
      this.context.fillStyle = style.color
      this.context.fill()
    }

    const topMiddleFrom = {
      x: (top[0].x + top[3].x) / 2,
      y: (top[0].y + top[3].y) / 2,
    }
    const topMiddleTo = {
      x: (top[1].x + top[2].x) / 2,
      y: (top[1].y + top[2].y) / 2,
    }
    this.context.save()
    if (style.dashMeters) {
      const tangentScale = projectedSegmentPixelsPerMeter(
        fromPoint,
        toPoint,
        transform,
      )
      this.context.setLineDash(
        style.dashMeters.map((dash) => dash * tangentScale),
      )
    }
    this.strokeSegment(
      topMiddleFrom,
      topMiddleTo,
      Math.max(1, thicknessMeters * transform.pixelsPerMeter * 0.42),
      style.color,
    )
    this.context.restore()
  }

  private drawTrackFences(
    points: TrackDefinition['centerline'],
    transform: CameraTransform,
  ) {
    const visibleFromDistance = points[0]?.distanceMeters ?? 0
    const visibleToDistance = points.at(-1)?.distanceMeters ?? 0
    const visibleElevationLayer = points[0]?.elevationLayer ?? 0
    for (const barrier of this.track.barrierGeometry.segments) {
      const environment = this.track.trackLimits.segments[
        barrier.trackLimitSegmentIndex
      ]?.[barrier.side]
      if (
        !environment?.fence ||
        barrier.toDistanceMeters < visibleFromDistance ||
        barrier.fromDistanceMeters > visibleToDistance
      ) {
        continue
      }
      for (let index = 0; index < barrier.path.length - 1; index += 1) {
        const from = barrier.path[index]
        const to = barrier.path[index + 1]
        if (
          from.elevationLayer !== visibleElevationLayer ||
          to.distanceMeters < visibleFromDistance ||
          from.distanceMeters > visibleToDistance
        ) {
          continue
        }
        const delta = { x: to.x - from.x, y: to.y - from.y }
        const length = Math.hypot(delta.x, delta.y)
        if (length <= Number.EPSILON) continue
        const direction = barrier.side === 'left' ? 1 : -1
        const outward = {
          x: (-delta.y / length) * direction,
          y: (delta.x / length) * direction,
        }
        const offset =
          barrier.thicknessMeters +
          FENCE_GAP_METERS +
          FENCE_STYLE.widthMeters / 2
        this.drawFenceSegment(
          { x: from.x + outward.x * offset, y: from.y + outward.y * offset },
          { x: to.x + outward.x * offset, y: to.y + outward.y * offset },
          transform,
        )
      }
    }
  }

  private drawFenceSegment(
    fromPoint: Vector2,
    toPoint: Vector2,
    transform: CameraTransform,
  ) {
    const from = worldToCamera(fromPoint, transform)
    const to = worldToCamera(toPoint, transform)
    const height =
      FENCE_HEIGHT_METERS * transform.pixelsPerMeter * CAMERA_HEIGHT_SCALE
    const topFrom = { x: from.x, y: from.y - height }
    const topTo = { x: to.x, y: to.y - height }
    this.context.beginPath()
    this.context.moveTo(from.x, from.y)
    this.context.lineTo(to.x, to.y)
    this.context.lineTo(topTo.x, topTo.y)
    this.context.lineTo(topFrom.x, topFrom.y)
    this.context.closePath()
    this.context.fillStyle = 'rgba(70, 84, 102, 0.22)'
    this.context.fill()

    this.strokeSegment(
      topFrom,
      topTo,
      Math.max(1, transform.pixelsPerMeter * 0.08),
      FENCE_STYLE.color,
    )
    this.strokeSegment(
      { x: from.x, y: from.y - height * 0.52 },
      { x: to.x, y: to.y - height * 0.52 },
      Math.max(1, transform.pixelsPerMeter * 0.045),
      'rgba(137, 150, 168, 0.62)',
    )
    const lengthMeters = Math.hypot(
      toPoint.x - fromPoint.x,
      toPoint.y - fromPoint.y,
    )
    const postCount = Math.max(
      1,
      Math.ceil(lengthMeters / FENCE_POST_SPACING_METERS),
    )
    for (let index = 0; index <= postCount; index += 1) {
      const ratio = index / postCount
      const ground = {
        x: from.x + (to.x - from.x) * ratio,
        y: from.y + (to.y - from.y) * ratio,
      }
      this.strokeSegment(
        ground,
        { x: ground.x, y: ground.y - height },
        Math.max(1, transform.pixelsPerMeter * 0.07),
        '#748194',
      )
    }
  }

  private fenceOffset(environment: TrackSideEnvironment) {
    return (
      trackSideEnvironmentWidth(environment) +
      BARRIER_STYLES[environment.barrier].widthMeters / 2 +
      FENCE_GAP_METERS +
      FENCE_STYLE.widthMeters / 2
    )
  }

  private offsetTrackPoint(
    point: TrackDefinition['centerline'][number],
    side: 'left' | 'right',
    offsetMeters: number,
  ): Vector2 {
    const tangent = this.geometry.getCenterlineTangent(point.distanceMeters)
    const normal = { x: -tangent.y, y: tangent.x }
    const direction = side === 'left' ? 1 : -1
    return {
      x: point.x + normal.x * offsetMeters * direction,
      y: point.y + normal.y * offsetMeters * direction,
    }
  }

  private strokeSegment(
    from: Vector2,
    to: Vector2,
    width: number,
    color: string,
    lineCap: CanvasLineCap = 'round',
  ) {
    this.context.beginPath()
    this.context.moveTo(from.x, from.y)
    this.context.lineTo(to.x, to.y)
    this.context.lineCap = lineCap
    this.context.lineJoin = 'round'
    this.context.lineWidth = Math.max(1, width)
    this.context.strokeStyle = color
    this.context.stroke()
  }

  private strokePolyline(
    points: Vector2[],
    width: number,
    color: string,
    lineCap: CanvasLineCap = 'round',
  ) {
    if (points.length < 2) return
    this.context.beginPath()
    this.context.moveTo(points[0].x, points[0].y)
    for (const point of points.slice(1)) this.context.lineTo(point.x, point.y)
    this.context.lineCap = lineCap
    this.context.lineJoin = 'round'
    this.context.lineWidth = Math.max(1, width)
    this.context.strokeStyle = color
    this.context.stroke()
  }

  private drawPitInfrastructure(transform: CameraTransform) {
    const path = this.track.pitLane.path
    if (path.length < 2) return
    const style = this.track.pitLane.visualStyle
    for (let index = 0; index < path.length - 1; index += 1) {
      const from = path[index]
      const to = path[index + 1]
      this.strokeSegment(
        worldToCamera(from, transform),
        worldToCamera(to, transform),
        projectedTrackWidth(from, to, PIT_LANE_WIDTH_METERS, transform),
        '#29313a',
      )
    }

    for (const sideDirection of [-1, 1]) {
      const edge = path.map((point, index) => {
        const previous = path[Math.max(0, index - 1)]
        const next = path[Math.min(path.length - 1, index + 1)]
        const delta = { x: next.x - previous.x, y: next.y - previous.y }
        const length = Math.max(Number.EPSILON, Math.hypot(delta.x, delta.y))
        return {
          x: point.x + (-delta.y / length) * sideDirection * (PIT_LANE_WIDTH_METERS / 2),
          y: point.y + (delta.x / length) * sideDirection * (PIT_LANE_WIDTH_METERS / 2),
        }
      })
      this.strokePolyline(
        edge.map((point) => worldToCamera(point, transform)),
        Math.max(1, transform.pixelsPerMeter * 0.12),
        style.roofColor,
      )
    }
    this.drawPitWall(path, transform, style)
    this.drawPitGarages(path, transform, style)
  }

  private drawPitWall(
    path: Vector2[],
    transform: CameraTransform,
    style: TrackPitVisualStyle,
  ) {
    const wallPath = path.map((point) => {
      const projection = this.geometry.project(point)
      const towardTrack = {
        x: projection.point.x - point.x,
        y: projection.point.y - point.y,
      }
      const length = Math.max(
        Number.EPSILON,
        Math.hypot(towardTrack.x, towardTrack.y),
      )
      return {
        x: point.x + (towardTrack.x / length) * (PIT_LANE_WIDTH_METERS / 2 + 0.35),
        y: point.y + (towardTrack.y / length) * (PIT_LANE_WIDTH_METERS / 2 + 0.35),
      }
    })
    const projected = wallPath.map((point) => worldToCamera(point, transform))
    this.strokePolyline(
      projected,
      Math.max(1, transform.pixelsPerMeter * 0.38),
      style.secondaryColor,
      'butt',
    )
    const wallHeight = transform.pixelsPerMeter * CAMERA_HEIGHT_SCALE * 0.72
    this.strokePolyline(
      projected.map((point) => ({ x: point.x, y: point.y - wallHeight })),
      Math.max(1, transform.pixelsPerMeter * 0.16),
      style.accentColor,
      'butt',
    )
  }

  private drawPitGarages(
    path: Vector2[],
    transform: CameraTransform,
    style: TrackPitVisualStyle,
  ) {
    const firstIndex = Math.floor(path.length * 0.27)
    const lastIndex = Math.floor(path.length * 0.73)
    const span = Math.max(1, lastIndex - firstIndex)
    for (let garageIndex = 0; garageIndex < style.garageCount; garageIndex += 1) {
      const fromIndex = Math.min(
        path.length - 2,
        firstIndex + Math.floor((span * garageIndex) / style.garageCount),
      )
      const toIndex = Math.min(
        path.length - 1,
        firstIndex + Math.ceil((span * (garageIndex + 1)) / style.garageCount),
      )
      const from = path[fromIndex]
      const to = path[toIndex]
      const delta = { x: to.x - from.x, y: to.y - from.y }
      const length = Math.hypot(delta.x, delta.y)
      if (length <= Number.EPSILON) continue
      const tangent = { x: delta.x / length, y: delta.y / length }
      const midpoint = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
      const projection = this.geometry.project(midpoint)
      const away = {
        x: midpoint.x - projection.point.x,
        y: midpoint.y - projection.point.y,
      }
      const awayLength = Math.hypot(away.x, away.y)
      const outward = awayLength > 0.2
        ? { x: away.x / awayLength, y: away.y / awayLength }
        : { x: -tangent.y, y: tangent.x }
      const boxCenter = {
        x: midpoint.x + outward.x * 1.4,
        y: midpoint.y + outward.y * 1.4,
      }
      const boxHalfLength = Math.min(3.2, length * 0.36)
      const boxHalfWidth = 1.05
      const boxCorners = this.orientedRectangle(
        boxCenter,
        tangent,
        outward,
        boxHalfLength,
        boxHalfWidth,
      )
      this.fillWorldPolygon(
        boxCorners,
        transform,
        garageIndex % 2 === 0
          ? `${style.primaryColor}55`
          : `${style.accentColor}42`,
      )
      const boxLineFrom = {
        x: boxCenter.x - tangent.x * boxHalfLength,
        y: boxCenter.y - tangent.y * boxHalfLength,
      }
      const boxLineTo = {
        x: boxCenter.x + tangent.x * boxHalfLength,
        y: boxCenter.y + tangent.y * boxHalfLength,
      }
      this.strokeSegment(
        worldToCamera(boxLineFrom, transform),
        worldToCamera(boxLineTo, transform),
        Math.max(1, transform.pixelsPerMeter * 0.1),
        style.roofColor,
        'butt',
      )

      const garageCenter = {
        x: midpoint.x + outward.x * 6.2,
        y: midpoint.y + outward.y * 6.2,
      }
      const garageCorners = this.orientedRectangle(
        garageCenter,
        tangent,
        outward,
        Math.max(3.3, Math.min(5.2, length * 0.48)),
        2.2,
      )
      this.drawExtrudedBuilding(garageCorners, transform, style, garageIndex)
    }
  }

  private orientedRectangle(
    center: Vector2,
    tangent: Vector2,
    normal: Vector2,
    halfLength: number,
    halfWidth: number,
  ) {
    return [
      { x: center.x - tangent.x * halfLength - normal.x * halfWidth, y: center.y - tangent.y * halfLength - normal.y * halfWidth },
      { x: center.x + tangent.x * halfLength - normal.x * halfWidth, y: center.y + tangent.y * halfLength - normal.y * halfWidth },
      { x: center.x + tangent.x * halfLength + normal.x * halfWidth, y: center.y + tangent.y * halfLength + normal.y * halfWidth },
      { x: center.x - tangent.x * halfLength + normal.x * halfWidth, y: center.y - tangent.y * halfLength + normal.y * halfWidth },
    ]
  }

  private fillWorldPolygon(
    points: Vector2[],
    transform: CameraTransform,
    color: string,
  ) {
    const projected = points.map((point) => worldToCamera(point, transform))
    this.context.beginPath()
    this.context.moveTo(projected[0].x, projected[0].y)
    for (const point of projected.slice(1)) this.context.lineTo(point.x, point.y)
    this.context.closePath()
    this.context.fillStyle = color
    this.context.fill()
  }

  private drawExtrudedBuilding(
    corners: Vector2[],
    transform: CameraTransform,
    style: TrackPitVisualStyle,
    garageIndex: number,
  ) {
    const base = corners.map((point) => worldToCamera(point, transform))
    const steppedHeightMultiplier =
      style.architecture === 'stepped-modern'
        ? 0.9 + (garageIndex % 4) * 0.055
        : 1
    const height =
      style.buildingHeightMeters *
      steppedHeightMultiplier *
      transform.pixelsPerMeter *
      CAMERA_HEIGHT_SCALE
    const top = base.map((point) => ({ x: point.x, y: point.y - height }))
    this.context.beginPath()
    this.context.moveTo(base[0].x, base[0].y)
    this.context.lineTo(base[1].x, base[1].y)
    this.context.lineTo(top[1].x, top[1].y)
    this.context.lineTo(top[0].x, top[0].y)
    this.context.closePath()
    this.context.fillStyle = style.primaryColor
    this.context.fill()
    this.context.beginPath()
    this.context.moveTo(base[1].x, base[1].y)
    this.context.lineTo(base[2].x, base[2].y)
    this.context.lineTo(top[2].x, top[2].y)
    this.context.lineTo(top[1].x, top[1].y)
    this.context.closePath()
    this.context.fillStyle = style.secondaryColor
    this.context.fill()
    this.context.beginPath()
    this.context.moveTo(base[2].x, base[2].y)
    this.context.lineTo(base[3].x, base[3].y)
    this.context.lineTo(top[3].x, top[3].y)
    this.context.lineTo(top[2].x, top[2].y)
    this.context.closePath()
    this.context.fillStyle = style.secondaryColor
    this.context.fill()
    this.context.beginPath()
    this.context.moveTo(top[0].x, top[0].y)
    for (const point of top.slice(1)) this.context.lineTo(point.x, point.y)
    this.context.closePath()
    this.context.fillStyle = style.roofColor
    this.context.fill()

    const frontTopLeft = {
      x: top[0].x + (top[1].x - top[0].x) * 0.12,
      y: top[0].y + (top[1].y - top[0].y) * 0.12 + height * 0.24,
    }
    const frontTopRight = {
      x: top[0].x + (top[1].x - top[0].x) * 0.88,
      y: top[0].y + (top[1].y - top[0].y) * 0.88 + height * 0.24,
    }
    const frontBottomRight = {
      x: base[0].x + (base[1].x - base[0].x) * 0.88,
      y: base[0].y + (base[1].y - base[0].y) * 0.88 - height * 0.05,
    }
    const frontBottomLeft = {
      x: base[0].x + (base[1].x - base[0].x) * 0.12,
      y: base[0].y + (base[1].y - base[0].y) * 0.12 - height * 0.05,
    }
    this.context.beginPath()
    this.context.moveTo(frontTopLeft.x, frontTopLeft.y)
    this.context.lineTo(frontTopRight.x, frontTopRight.y)
    this.context.lineTo(frontBottomRight.x, frontBottomRight.y)
    this.context.lineTo(frontBottomLeft.x, frontBottomLeft.y)
    this.context.closePath()
    this.context.fillStyle = garageIndex % 2 === 0 ? '#27313a' : '#313b45'
    this.context.fill()
    this.strokeSegment(
      {
        x: top[0].x,
        y: top[0].y + height * 0.17,
      },
      {
        x: top[1].x,
        y: top[1].y + height * 0.17,
      },
      Math.max(1, transform.pixelsPerMeter * 0.22),
      style.accentColor,
      'butt',
    )
    this.drawPitBuildingDetails(
      base,
      top,
      height,
      transform,
      style,
      garageIndex,
    )
  }

  private drawPitBuildingDetails(
    base: Vector2[],
    top: Vector2[],
    height: number,
    transform: CameraTransform,
    style: TrackPitVisualStyle,
    garageIndex: number,
  ) {
    const interpolate = (from: Vector2, to: Vector2, ratio: number) => ({
      x: from.x + (to.x - from.x) * ratio,
      y: from.y + (to.y - from.y) * ratio,
    })
    const facadeAt = (ratio: number, verticalRatio: number) => {
      const ground = interpolate(base[0], base[1], ratio)
      return { x: ground.x, y: ground.y - height * verticalRatio }
    }

    // Garage-door mullions and a number plate keep each team bay legible at
    // race zoom instead of reading as one uninterrupted rectangle.
    this.context.strokeStyle = 'rgba(211, 219, 226, 0.34)'
    this.context.lineWidth = Math.max(1, transform.pixelsPerMeter * 0.055)
    for (const ratio of [0.31, 0.5, 0.69]) {
      const from = facadeAt(ratio, 0.08)
      const to = facadeAt(ratio, 0.67)
      this.context.beginPath()
      this.context.moveTo(from.x, from.y)
      this.context.lineTo(to.x, to.y)
      this.context.stroke()
    }
    const plate = facadeAt(0.18, 0.76)
    this.context.fillStyle = style.accentColor
    this.context.fillRect(
      plate.x - transform.pixelsPerMeter * 0.32,
      plate.y - transform.pixelsPerMeter * 0.2,
      transform.pixelsPerMeter * 0.64,
      transform.pixelsPerMeter * 0.4,
    )

    if (GLAZED_PIT_ARCHITECTURES.has(style.architecture)) {
      const bandTopLeft = facadeAt(0.04, 0.92)
      const bandTopRight = facadeAt(0.96, 0.92)
      const bandBottomRight = facadeAt(0.96, 0.72)
      const bandBottomLeft = facadeAt(0.04, 0.72)
      this.context.beginPath()
      this.context.moveTo(bandTopLeft.x, bandTopLeft.y)
      this.context.lineTo(bandTopRight.x, bandTopRight.y)
      this.context.lineTo(bandBottomRight.x, bandBottomRight.y)
      this.context.lineTo(bandBottomLeft.x, bandBottomLeft.y)
      this.context.closePath()
      this.context.fillStyle = 'rgba(88, 148, 169, 0.56)'
      this.context.fill()
      for (const ratio of [0.25, 0.5, 0.75]) {
        this.strokeSegment(
          facadeAt(ratio, 0.72),
          facadeAt(ratio, 0.92),
          Math.max(1, transform.pixelsPerMeter * 0.04),
          'rgba(222, 230, 235, 0.5)',
          'butt',
        )
      }
    }

    if (
      style.architecture === 'desert-canopy' ||
      style.architecture === 'marina-canopy'
    ) {
      const canopyFrom = facadeAt(-0.08, 0.72)
      const canopyTo = facadeAt(1.08, 0.72)
      this.strokeSegment(
        canopyFrom,
        canopyTo,
        Math.max(2, transform.pixelsPerMeter * 0.34),
        style.roofColor,
        'square',
      )
      for (const ratio of [0.08, 0.92]) {
        this.strokeSegment(
          facadeAt(ratio, 0.14),
          facadeAt(ratio, 0.72),
          Math.max(1, transform.pixelsPerMeter * 0.07),
          style.secondaryColor,
          'butt',
        )
      }
    }

    if (style.architecture === 'heritage') {
      const roofMiddle = interpolate(top[0], top[1], 0.5)
      this.context.beginPath()
      this.context.moveTo(top[0].x, top[0].y)
      this.context.lineTo(roofMiddle.x, roofMiddle.y - height * 0.13)
      this.context.lineTo(top[1].x, top[1].y)
      this.context.closePath()
      this.context.fillStyle = style.roofColor
      this.context.fill()
    }

    if (style.architecture === 'wing') {
      this.context.strokeStyle = style.accentColor
      this.context.lineWidth = Math.max(1, transform.pixelsPerMeter * 0.1)
      this.context.beginPath()
      this.context.moveTo(top[0].x, top[0].y)
      for (let index = 1; index <= 6; index += 1) {
        const point = interpolate(top[0], top[1], index / 6)
        this.context.lineTo(
          point.x,
          point.y - (index % 2 === 0 ? 0 : height * 0.1),
        )
      }
      this.context.stroke()
    }

    if (style.architecture === 'temporary-modular') {
      this.strokeSegment(
        facadeAt(0.02, 0.51),
        facadeAt(0.98, 0.51),
        Math.max(1, transform.pixelsPerMeter * 0.045),
        'rgba(66, 76, 87, 0.5)',
        'butt',
      )
    }

    if (garageIndex === 0 || garageIndex === style.garageCount - 1) {
      const mastBase = facadeAt(garageIndex === 0 ? 0.1 : 0.9, 1)
      const mastTop = { x: mastBase.x, y: mastBase.y - height * 0.42 }
      this.strokeSegment(
        mastBase,
        mastTop,
        Math.max(1, transform.pixelsPerMeter * 0.07),
        style.secondaryColor,
        'butt',
      )
      this.context.fillStyle = style.accentColor
      this.context.beginPath()
      this.context.arc(
        mastTop.x,
        mastTop.y,
        Math.max(1.5, transform.pixelsPerMeter * 0.16),
        0,
        Math.PI * 2,
      )
      this.context.fill()
    }
  }

  private drawBridgeUnderstructure(
    points: TrackDefinition['centerline'],
    transform: CameraTransform,
  ) {
    if (points.length < 2) return
    const depth =
      BRIDGE_DECK_HEIGHT_METERS *
      transform.pixelsPerMeter *
      CAMERA_HEIGHT_SCALE
    for (let index = 0; index < points.length - 1; index += 1) {
      const from = points[index]
      const to = points[index + 1]
      const projectedFrom = worldToCamera(from, transform)
      const projectedTo = worldToCamera(to, transform)
      this.strokeSegment(
        { x: projectedFrom.x, y: projectedFrom.y + depth },
        { x: projectedTo.x, y: projectedTo.y + depth },
        projectedTrackWidth(
          from,
          to,
          (from.halfWidthMeters + to.halfWidthMeters) + 1.8,
          transform,
        ),
        '#111720',
      )
      if (index % 7 === 0) {
        const columnWidth = Math.max(2, transform.pixelsPerMeter * 0.7)
        this.strokeSegment(
          { x: projectedFrom.x, y: projectedFrom.y + depth * 0.55 },
          { x: projectedFrom.x, y: projectedFrom.y + depth * 2.1 },
          columnWidth,
          '#222a34',
          'butt',
        )
      }
    }
  }

  private drawStartFinish(transform: CameraTransform) {
    const gate = this.track.startFinish
    const lateral = { x: -gate.forward.y, y: gate.forward.x }
    const from = {
      x: gate.position.x - lateral.x * gate.halfWidthMeters,
      y: gate.position.y - lateral.y * gate.halfWidthMeters,
    }
    const to = {
      x: gate.position.x + lateral.x * gate.halfWidthMeters,
      y: gate.position.y + lateral.y * gate.halfWidthMeters,
    }
    const tangentScale = projectedSegmentPixelsPerMeter(from, to, transform)
    this.context.save()
    this.context.setLineDash([
      Math.max(2, tangentScale * 0.7),
      Math.max(2, tangentScale * 0.7),
    ])
    this.strokeSegment(
      worldToCamera(from, transform),
      worldToCamera(to, transform),
      Math.max(2, projectedTrackWidth(from, to, 0.45, transform)),
      '#f0f0fa',
    )
    this.context.restore()
  }

  private drawScenery(
    transform: CameraTransform,
    layer: 'ground' | 'overhead',
  ) {
    const objects = [
      ...this.track.sceneryLayout.landmarks,
      ...this.track.sceneryLayout.staticObjects,
    ].filter((object) => getSceneryRenderLayer(object.kind) === layer)
    const viewport = transform.viewport
    for (const object of objects) {
      const point = worldToCamera(object.position, transform)
      const visualRadius = Math.max(
        8,
        object.scale * transform.pixelsPerMeter * 0.9,
      )
      if (
        point.x < viewport.x - visualRadius ||
        point.x > viewport.x + viewport.width + visualRadius ||
        point.y < viewport.y - visualRadius ||
        point.y > viewport.y + viewport.height + visualRadius
      ) {
        continue
      }
      const visualRotation =
        object.rotation + getSceneryRotationOffset(object.kind)
      const direction = worldToCamera(
        {
          x: object.position.x + Math.cos(visualRotation),
          y: object.position.y + Math.sin(visualRotation),
        },
        transform,
      )
      this.context.save()
      this.context.translate(point.x, point.y)
      this.context.rotate(
        Math.atan2(direction.y - point.y, direction.x - point.x),
      )
      drawSceneryVisual({
        context: this.context,
        object,
        pixelsPerMeter: transform.pixelsPerMeter,
        preset: this.track.sceneryLayout.preset,
      })
      this.context.restore()
    }
  }

  private drawAmbientParticles(
    transform: CameraTransform,
    visibleChunks: TrackChunk[],
  ) {
    const budget = AMBIENT_PARTICLE_BUDGET[this.quality]
    if (budget === 0 || visibleChunks.length === 0) return 0

    const viewport = transform.viewport
    const candidatesPerChunk = Math.max(
      8,
      Math.ceil((budget * 3) / visibleChunks.length),
    )
    let drawn = 0
    this.context.fillStyle =
      AMBIENT_PARTICLE_COLORS[this.track.sceneryLayout.preset]

    for (const chunk of visibleChunks) {
      const points = this.getChunkPoints(chunk)
      if (points.length === 0) continue
      for (let sample = 0; sample < candidatesPerChunk; sample += 1) {
        if (drawn >= budget) return drawn
        const hash = deterministicHash(`${this.track.id}:${chunk.index}:${sample}`)
        const point = points[hash % points.length]
        const tangent = this.geometry.getCenterlineTangent(point.distanceMeters)
        const normal = { x: -tangent.y, y: tangent.x }
        const offsetRatio = ((hash >>> 8) % 2_001) / 1_000 - 1
        const offsetMeters =
          offsetRatio * (point.halfWidthMeters + 6 + ((hash >>> 20) % 18))
        const screen = worldToCamera(
          {
            x: point.x + normal.x * offsetMeters,
            y: point.y + normal.y * offsetMeters,
          },
          transform,
        )
        if (
          screen.x < viewport.x ||
          screen.x > viewport.x + viewport.width ||
          screen.y < viewport.y ||
          screen.y > viewport.y + viewport.height
        ) {
          continue
        }

        this.context.beginPath()
        this.context.arc(
          screen.x,
          screen.y,
          0.7 + ((hash >>> 16) % 12) / 10,
          0,
          Math.PI * 2,
        )
        this.context.fill()
        drawn += 1
      }
    }
    return drawn
  }

  private drawTimeOfDayLighting(
    viewport: Viewport,
    transform: CameraTransform,
    visibleChunks: TrackChunk[],
    visibleTrackSections: ElevationTrackSection[],
    vehicles: InterpolatedVehicleState[],
    suzukaUpperLayerOpacity = 1,
  ) {
    if (this.timeOfDay === 'day') return

    this.context.save()
    this.context.beginPath()
    this.context.rect(viewport.x, viewport.y, viewport.width, viewport.height)
    this.context.clip()
    this.context.fillStyle =
      this.timeOfDay === 'sunset'
        ? 'rgba(112, 48, 22, 0.2)'
        : 'rgba(3, 7, 18, 0.68)'
    this.context.fillRect(viewport.x, viewport.y, viewport.width, viewport.height)

    if (this.timeOfDay === 'night') {
      for (const vehicle of vehicles) {
        const vehicleChunk = visibleChunks.find(
          (chunk) =>
            vehicle.trackDistanceMeters >= chunk.fromDistanceMeters &&
            vehicle.trackDistanceMeters <= chunk.toDistanceMeters,
        )
        if (vehicleChunk) {
          const beamDistanceMeters = this.getHeadlightBeamLengthMeters(transform)
          const visibleBeamDistanceMeters =
            this.getHeadlightOcclusionDistanceMeters(
              vehicle,
              visibleTrackSections,
              beamDistanceMeters,
            )
          const fadeUpperSuzukaVehicle =
            this.track.id === 'suzuka' &&
            vehicle.trackLayer > 0 &&
            suzukaUpperLayerOpacity < 1
          if (fadeUpperSuzukaVehicle) {
            this.context.save()
            this.context.globalAlpha *= suzukaUpperLayerOpacity
          }
          this.drawHeadlightCone(
            vehicle,
            transform,
            visibleTrackSections,
            visibleBeamDistanceMeters,
          )
          if (fadeUpperSuzukaVehicle) this.context.restore()
        }
      }
    }
    this.context.restore()
  }

  private drawHeadlightCone(
    vehicle: InterpolatedVehicleState,
    transform: CameraTransform,
    visibleTrackSections: ElevationTrackSection[],
    maximumBeamDistanceMeters: number,
  ) {
    const profile = PHYSICS_CONSTANTS.vehicleVisual
    const beamLengthMeters = Math.min(
      this.getHeadlightBeamLengthMeters(transform),
      maximumBeamDistanceMeters,
    )
    const beamStartMeters = profile.lengthMeters * 0.35
    if (beamLengthMeters <= beamStartMeters + 0.5) return
    const forward = {
      x: Math.cos(vehicle.renderAngle),
      y: Math.sin(vehicle.renderAngle),
    }
    const lateral = { x: -forward.y, y: forward.x }
    const beamPoint = (forwardMeters: number, lateralMeters: number) =>
      worldToCamera(
        {
          x:
            vehicle.renderPosition.x +
            forward.x * forwardMeters +
            lateral.x * lateralMeters,
          y:
            vehicle.renderPosition.y +
            forward.y * forwardMeters +
            lateral.y * lateralMeters,
        },
        transform,
      )
    const startHalfWidthMeters =
      profile.lengthMeters *
      HEADLIGHT_VISUAL_SETTINGS.startHalfWidthToVehicleLengthRatio
    const endHalfWidthMeters =
      beamLengthMeters * HEADLIGHT_VISUAL_SETTINGS.widthToLengthRatio
    const startCenter = beamPoint(beamStartMeters, 0)
    const endCenter = beamPoint(beamLengthMeters, 0)
    const beamPolygon = [
      beamPoint(beamStartMeters, -startHalfWidthMeters),
      beamPoint(beamLengthMeters, -endHalfWidthMeters),
      beamPoint(beamLengthMeters, endHalfWidthMeters),
      beamPoint(beamStartMeters, startHalfWidthMeters),
    ]
    this.context.save()
    if (
      !this.clipHeadlightToVisibleTrack(
        vehicle,
        transform,
        visibleTrackSections,
      )
    ) {
      this.context.restore()
      return
    }
    const gradient = this.context.createLinearGradient(
      startCenter.x,
      startCenter.y,
      endCenter.x,
      endCenter.y,
    )
    for (const stop of HEADLIGHT_VISUAL_SETTINGS.colorStops) {
      gradient.addColorStop(stop.offset, stop.color)
    }

    this.context.fillStyle = gradient
    this.context.beginPath()
    this.context.moveTo(beamPolygon[0].x, beamPolygon[0].y)
    for (const point of beamPolygon.slice(1)) {
      this.context.lineTo(point.x, point.y)
    }
    this.context.closePath()
    this.context.fill()
    this.context.restore()
  }

  private getHeadlightBeamLengthMeters(transform: CameraTransform) {
    return (
      Math.max(
        90,
        Math.min(
          transform.viewport.height * 0.46,
          58 * transform.pixelsPerMeter,
        ),
      ) / transform.pixelsPerMeter
    )
  }

  private getHeadlightOcclusionDistanceMeters(
    vehicle: InterpolatedVehicleState,
    visibleTrackSections: ElevationTrackSection[],
    maximumDistanceMeters: number,
  ) {
    let visibleDistanceMeters = maximumDistanceMeters
    const forwardX = Math.cos(vehicle.renderAngle)
    const forwardY = Math.sin(vehicle.renderAngle)
    const overpassMarginMeters = 0.75

    for (const section of visibleTrackSections) {
      if (section.elevationLayer <= vehicle.trackLayer) continue

      for (let index = 0; index < section.points.length - 1; index += 1) {
        const from = section.points[index]
        const to = section.points[index + 1]
        const footprint = this.getTrackLayerFootprint(from, to).map((point) => {
          const relativeX = point.x - vehicle.renderPosition.x
          const relativeY = point.y - vehicle.renderPosition.y
          return {
            forward: relativeX * forwardX + relativeY * forwardY,
            lateral: -relativeX * forwardY + relativeY * forwardX,
          }
        })
        const clippedFootprint = this.clipPolygonToHeadlightCone(
          footprint,
          visibleDistanceMeters,
        )
        if (clippedFootprint.length === 0) continue

        const entryDistanceMeters = Math.min(
          ...clippedFootprint.map((point) => point.forward),
        )
        visibleDistanceMeters = Math.max(
          0,
          entryDistanceMeters - overpassMarginMeters,
        )
      }
    }

    return visibleDistanceMeters
  }

  private getTrackLayerFootprint(
    from: TrackDefinition['centerline'][number],
    to: TrackDefinition['centerline'][number],
  ) {
    const segmentX = to.x - from.x
    const segmentY = to.y - from.y
    const segmentLength = Math.hypot(segmentX, segmentY)
    if (segmentLength <= Number.EPSILON) return []

    const normal = {
      x: -segmentY / segmentLength,
      y: segmentX / segmentLength,
    }
    const offset = (point: typeof from, side: 'left' | 'right') => {
      const direction = side === 'left' ? 1 : -1
      const extent = this.getTrackLayerSideExtent(point, side)
      return {
        x: point.x + normal.x * extent * direction,
        y: point.y + normal.y * extent * direction,
      }
    }
    return [
      offset(from, 'left'),
      offset(to, 'left'),
      offset(to, 'right'),
      offset(from, 'right'),
    ]
  }

  private getTrackLayerSideExtent(
    point: TrackDefinition['centerline'][number],
    side: 'left' | 'right',
  ) {
    const environment = this.geometry.getTrackSideEnvironmentAt(
      point.distanceMeters,
      side,
    )
    const environmentWidth = trackSideEnvironmentWidth(environment)
    const barrierOuterEdge =
      environmentWidth + BARRIER_STYLES[environment.barrier].widthMeters / 2
    const fenceOuterEdge = environment.fence
      ? this.fenceOffset(environment) + FENCE_STYLE.widthMeters / 2
      : barrierOuterEdge
    return point.halfWidthMeters + Math.max(barrierOuterEdge, fenceOuterEdge)
  }

  private clipPolygonToHeadlightCone(
    polygon: Array<{ forward: number; lateral: number }>,
    maximumDistanceMeters: number,
  ) {
    const beamSlope = HEADLIGHT_VISUAL_SETTINGS.widthToLengthRatio
    const boundaries = [
      (point: (typeof polygon)[number]) => point.forward,
      (point: (typeof polygon)[number]) =>
        maximumDistanceMeters - point.forward,
      (point: (typeof polygon)[number]) =>
        beamSlope * point.forward - point.lateral,
      (point: (typeof polygon)[number]) =>
        beamSlope * point.forward + point.lateral,
    ]
    return boundaries.reduce(
      (clipped, signedDistance) =>
        this.clipPolygonToHalfPlane(clipped, signedDistance),
      polygon,
    )
  }

  private clipPolygonToHalfPlane(
    polygon: Array<{ forward: number; lateral: number }>,
    signedDistance: (point: { forward: number; lateral: number }) => number,
  ) {
    if (polygon.length === 0) return polygon
    const clipped: typeof polygon = []
    const epsilon = 1e-7

    for (let index = 0; index < polygon.length; index += 1) {
      const current = polygon[index]
      const next = polygon[(index + 1) % polygon.length]
      const currentDistance = signedDistance(current)
      const nextDistance = signedDistance(next)
      const currentInside = currentDistance >= -epsilon
      const nextInside = nextDistance >= -epsilon

      if (currentInside && nextInside) {
        clipped.push(next)
        continue
      }
      if (currentInside === nextInside) continue

      const progress = currentDistance / (currentDistance - nextDistance)
      clipped.push({
        forward: current.forward + (next.forward - current.forward) * progress,
        lateral: current.lateral + (next.lateral - current.lateral) * progress,
      })
      if (nextInside) clipped.push(next)
    }

    return clipped
  }

  private clipHeadlightToVisibleTrack(
    vehicle: InterpolatedVehicleState,
    transform: CameraTransform,
    visibleTrackSections: ElevationTrackSection[],
  ) {
    const sections = visibleTrackSections.filter(
      (section) =>
        section.elevationLayer === vehicle.trackLayer &&
        section.points.length >= 2,
    )
    if (sections.length === 0) return false

    const extraLightWidthMeters = 18
    this.context.beginPath()
    for (const { points } of sections) {
      const left = points.map((point) =>
        worldToCamera(
          this.offsetTrackPoint(
            point,
            'left',
            point.halfWidthMeters + extraLightWidthMeters,
          ),
          transform,
        ),
      )
      const right = [...points].reverse().map((point) =>
        worldToCamera(
          this.offsetTrackPoint(
            point,
            'right',
            point.halfWidthMeters + extraLightWidthMeters,
          ),
          transform,
        ),
      )
      this.context.moveTo(left[0].x, left[0].y)
      for (const point of [...left.slice(1), ...right]) {
        this.context.lineTo(point.x, point.y)
      }
      this.context.closePath()
    }
    this.context.clip()
    return true
  }

  private drawStartProcedure(
    viewport: Viewport,
    focusedRacerId: string,
    overlayState?: LocalRaceOverlayState,
  ) {
    if (!overlayState) return
    const startLights = overlayState.startLights
    const penalty = overlayState.penalties[focusedRacerId]
    if (startLights.stage === 'hidden' && !penalty?.throttleLockTicksRemaining) {
      return
    }

    const context = this.context
    const lightRadius = Math.max(8, Math.min(14, viewport.width / 55))
    const lightGap = lightRadius * 2.55
    const panelWidth = lightGap * 5 + lightRadius
    const panelX = viewport.x + (viewport.width - panelWidth) / 2
    const panelY = viewport.y + Math.max(34, viewport.height * 0.08)
    context.save()
    context.fillStyle = 'rgba(7, 11, 20, 0.9)'
    context.beginPath()
    context.roundRect(
      panelX - 12,
      panelY - lightRadius - 10,
      panelWidth + 24,
      lightRadius * 2 + 20,
      12,
    )
    context.fill()

    for (let index = 0; index < 5; index += 1) {
      context.beginPath()
      context.arc(
        panelX + lightRadius + index * lightGap,
        panelY,
        lightRadius,
        0,
        Math.PI * 2,
      )
      context.fillStyle =
        startLights.stage === 'sequence' && index < startLights.redLights
          ? '#ff4055'
          : '#2a303b'
      context.fill()
    }

    if (startLights.stage === 'lights-out') {
      context.fillStyle = '#2bd67b'
      context.font = `900 ${Math.max(16, lightRadius * 1.7)}px Barlow Condensed`
      context.textAlign = 'center'
      context.fillText('LARGUE!', viewport.x + viewport.width / 2, panelY + 48)
    }

    if (penalty?.throttleLockTicksRemaining) {
      const seconds = penalty.throttleLockTicksRemaining * PHYSICS_CONSTANTS.simulation.physicsStepSeconds
      const penaltyWidth = Math.min(
        viewport.width - 32,
        Math.max(240, viewport.width * 0.58),
      )
      const penaltyHeight = 36
      const penaltyTop =
        viewport.y + viewport.height * 0.46 - penaltyHeight / 2
      context.fillStyle = 'rgba(7, 11, 20, 0.9)'
      context.fillRect(
        viewport.x + (viewport.width - penaltyWidth) / 2,
        penaltyTop,
        penaltyWidth,
        penaltyHeight,
      )
      context.fillStyle = '#ffb82e'
      context.font = `800 ${Math.max(12, lightRadius)}px Barlow`
      context.textAlign = 'center'
      context.fillText(
        `LARGADA QUEIMADA · BLOQUEIO ${seconds.toFixed(1)}s`,
        viewport.x + viewport.width / 2,
        penaltyTop + 23,
      )
    }
    context.restore()
  }

  private collectTireMarks(vehicles: InterpolatedVehicleState[]) {
    if (this.frameCount % 3 !== 0) return
    for (const vehicle of vehicles) {
      const speed = magnitude(vehicle.velocity)
      const rearSlipAngle = Math.abs(vehicle.physicsState.rearSlipAngle)
      const saturatedRearTires = vehicle.physicsState.rearGripUtilization >= 0.96
      if (speed < 8 || (!saturatedRearTires && rearSlipAngle < 0.12)) {
        continue
      }

      const profile = PHYSICS_CONSTANTS.vehicleVisual
      const rearOffset = profile.lengthMeters * 0.34
      this.tireMarks.push({
        position: {
          x: vehicle.renderPosition.x - Math.cos(vehicle.renderAngle) * rearOffset,
          y: vehicle.renderPosition.y - Math.sin(vehicle.renderAngle) * rearOffset,
        },
        onGrass: vehicle.surface === 'grass',
        trackLayer: vehicle.trackLayer,
      })
    }
    if (this.tireMarks.length > 900) {
      this.tireMarks.splice(0, this.tireMarks.length - 900)
    }
  }

  private drawTireMarks(
    transform: CameraTransform,
    elevationLayer: number,
  ) {
    const viewport = transform.viewport
    for (const mark of this.tireMarks) {
      if (mark.trackLayer !== elevationLayer) continue
      const point = worldToCamera(mark.position, transform)
      if (
        point.x < viewport.x ||
        point.x > viewport.x + viewport.width ||
        point.y < viewport.y ||
        point.y > viewport.y + viewport.height
      ) {
        continue
      }
      this.context.fillStyle = mark.onGrass
        ? 'rgba(101, 68, 43, 0.42)'
        : 'rgba(3, 5, 9, 0.28)'
      const radius = Math.max(0.8, transform.pixelsPerMeter * 0.18)
      this.context.beginPath()
      this.context.ellipse(
        point.x,
        point.y,
        radius,
        Math.max(0.6, radius * transform.groundDepthScale),
        0,
        0,
        Math.PI * 2,
      )
      this.context.fill()
    }
  }

  private drawVehicle(
    vehicle: InterpolatedVehicleState,
    transform: CameraTransform,
  ) {
    const context = this.context
    const profile = PHYSICS_CONSTANTS.vehicleVisual
    const point = worldToCamera(vehicle.renderPosition, transform)
    const length = profile.lengthMeters * transform.pixelsPerMeter
    const width = profile.widthMeters * transform.pixelsPerMeter
    const shadowSettings = VEHICLE_SHADOW_SETTINGS[this.timeOfDay]
    const shadowDirection = worldToCamera(
      {
        x:
          vehicle.renderPosition.x +
          Math.cos(shadowSettings.worldAngleRadians),
        y:
          vehicle.renderPosition.y +
          Math.sin(shadowSettings.worldAngleRadians),
      },
      transform,
    )
    drawVehicleVisual(context, {
      color: vehicle.color,
      x: point.x,
      y: point.y,
      relativeYawRadians: vehicleYawRelativeToCamera(
        transform.orientation,
        vehicle.renderAngle,
      ),
      length,
      width,
      detail: 'race',
      damage: vehicle.damage.kind,
      groundDepthScale: transform.groundDepthScale,
      shadowAngleRadians: Math.atan2(
        shadowDirection.y - point.y,
        shadowDirection.x - point.x,
      ),
      shadowDistanceToWidthRatio: shadowSettings.distanceToWidthRatio,
      shadowOpacity: shadowSettings.opacity,
    })

    context.fillStyle = '#f0f0fa'
    context.font = `700 ${Math.max(9, 1.3 * transform.pixelsPerMeter)}px Barlow`
    context.textAlign = 'center'
    context.fillText(vehicle.name, point.x, point.y - width * 1.2)
  }

  private drawMinimap(
    viewport: Viewport,
    vehicles: InterpolatedVehicleState[],
    focusedVehicle: InterpolatedVehicleState,
  ) {
    const width = Math.min(viewport.width * 0.28, viewport.height * 0.32, 220)
    const height = Math.min(viewport.height * 0.3, 170)
    const minimapViewport = {
      x: viewport.x + viewport.width - width - 12,
      y: viewport.y + 12,
      width,
      height,
    }
    const transform = createMinimapTransform(
      this.track.bounds,
      minimapViewport,
      10,
    )
    const context = this.context
    context.save()
    context.fillStyle = 'rgba(7, 11, 20, 0.78)'
    context.strokeStyle = 'rgba(240, 240, 250, 0.18)'
    context.lineWidth = 1
    context.beginPath()
    context.roundRect(
      minimapViewport.x,
      minimapViewport.y,
      minimapViewport.width,
      minimapViewport.height,
      10,
    )
    context.fill()
    context.stroke()

    context.beginPath()
    this.track.centerline.forEach((point, index) => {
      const screen = worldToMinimap(point, transform)
      if (index === 0) context.moveTo(screen.x, screen.y)
      else context.lineTo(screen.x, screen.y)
    })
    context.strokeStyle = 'rgba(240, 240, 250, 0.65)'
    context.lineWidth = 2
    context.lineJoin = 'round'
    context.stroke()

    for (const vehicle of vehicles) {
      const point = worldToMinimap(vehicle.renderPosition, transform)
      const focused = vehicle.id === focusedVehicle.id
      context.beginPath()
      context.arc(point.x, point.y, focused ? 4 : 3, 0, Math.PI * 2)
      context.fillStyle = focused ? '#31c7ff' : vehicle.color
      context.fill()
      if (focused) {
        context.strokeStyle = '#f0f0fa'
        context.lineWidth = 1.5
        context.stroke()
      }
    }
    context.restore()
  }

  private drawDriverLabel(viewport: Viewport, name: string) {
    this.context.fillStyle = 'rgba(7, 11, 20, 0.78)'
    this.context.fillRect(viewport.x + 12, viewport.y + 12, 112, 28)
    this.context.fillStyle = '#f0f0fa'
    this.context.font = '700 12px Barlow'
    this.context.textAlign = 'left'
    this.context.fillText(name, viewport.x + 22, viewport.y + 31)
  }

  private drawSplitDivider(viewports: Viewport[]) {
    if (viewports.length < 2) return
    const context = this.context
    context.save()
    context.strokeStyle = '#070b14'
    context.lineWidth = 4
    context.beginPath()
    if (viewports[0].x === viewports[1].x) {
      const y = viewports[1].y
      context.moveTo(0, y)
      context.lineTo(this.canvas.width, y)
    } else {
      const x = viewports[1].x
      context.moveTo(x, 0)
      context.lineTo(x, this.canvas.height)
    }
    context.stroke()
    context.restore()
  }
}
