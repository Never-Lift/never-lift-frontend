import type {
  TrackBarrierType,
  TrackChunk,
  TrackCurbPalette,
  TrackDefinition,
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

const BARRIER_STYLES: Record<
  TrackBarrierType,
  { color: string; widthMeters: number; dashMeters?: number[] }
> = {
  'concrete-wall': { color: '#d7dce5', widthMeters: 0.48 },
  guardrail: { color: '#9aa6b8', widthMeters: 0.32 },
  tecpro: { color: '#5c7da7', widthMeters: 0.62 },
  'tyre-barrier': {
    color: '#171b21',
    widthMeters: 0.72,
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
const PIT_BUILDING_HEIGHT_METERS = 3.2
const BRIDGE_DECK_HEIGHT_METERS = 2.4

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
    for (const elevationLayer of elevationLayers) {
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
        )
      }
    }
  }

  private drawCanonicalBarrierSegment(
    fromPoint: TrackDefinition['barrierGeometry']['segments'][number]['path'][number],
    toPoint: TrackDefinition['barrierGeometry']['segments'][number]['path'][number],
    side: 'left' | 'right',
    thicknessMeters: number,
    style: { color: string; widthMeters: number; dashMeters?: number[] },
    transform: CameraTransform,
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

    this.context.beginPath()
    this.context.moveTo(polygon[0].x, polygon[0].y)
    for (const point of polygon.slice(1)) this.context.lineTo(point.x, point.y)
    this.context.closePath()
    this.context.fillStyle = style.color
    this.context.fill()

    const middleFrom = {
      x: (fromPoint.x + outerFrom.x) / 2,
      y: (fromPoint.y + outerFrom.y) / 2,
    }
    const middleTo = {
      x: (toPoint.x + outerTo.x) / 2,
      y: (toPoint.y + outerTo.y) / 2,
    }
    this.drawStyledBoundary(
      middleFrom,
      middleTo,
      { ...style, widthMeters: thicknessMeters },
      transform,
    )
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

  private drawStyledBoundary(
    fromPoint: Vector2,
    toPoint: Vector2,
    style: { color: string; widthMeters: number; dashMeters?: number[] },
    transform: CameraTransform,
  ) {
    this.context.save()
    if (style.dashMeters) {
      const tangentScale = projectedSegmentPixelsPerMeter(
        fromPoint,
        toPoint,
        transform,
      )
      this.context.setLineDash(
        style.dashMeters.map((length) => length * tangentScale),
      )
    }
    this.strokeSegment(
      worldToCamera(fromPoint, transform),
      worldToCamera(toPoint, transform),
      Math.max(
        1.5,
        projectedTrackWidth(
          fromPoint,
          toPoint,
          style.widthMeters,
          transform,
        ),
      ),
      style.color,
    )
    this.context.restore()
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
    for (let index = 0; index < path.length - 1; index += 1) {
      const from = path[index]
      const to = path[index + 1]
      this.strokeSegment(
        worldToCamera(from, transform),
        worldToCamera(to, transform),
        projectedTrackWidth(from, to, PIT_LANE_WIDTH_METERS, transform),
        '#2d3540',
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
        'rgba(229, 233, 239, 0.82)',
      )
    }
    this.drawPitGarages(path, transform)
  }

  private drawPitGarages(path: Vector2[], transform: CameraTransform) {
    const firstIndex = Math.floor(path.length * 0.27)
    const lastIndex = Math.floor(path.length * 0.73)
    const step = Math.max(1, Math.floor((lastIndex - firstIndex) / 10))
    for (let index = firstIndex; index < lastIndex; index += step) {
      const from = path[index]
      const to = path[Math.min(path.length - 1, index + step)]
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
      this.fillWorldPolygon(boxCorners, transform, 'rgba(218, 224, 233, 0.28)')

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
      this.drawExtrudedBuilding(garageCorners, transform)
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
  ) {
    const base = corners.map((point) => worldToCamera(point, transform))
    const height =
      PIT_BUILDING_HEIGHT_METERS * transform.pixelsPerMeter * CAMERA_HEIGHT_SCALE
    const top = base.map((point) => ({ x: point.x, y: point.y - height }))
    this.context.beginPath()
    this.context.moveTo(base[1].x, base[1].y)
    this.context.lineTo(base[2].x, base[2].y)
    this.context.lineTo(top[2].x, top[2].y)
    this.context.lineTo(top[1].x, top[1].y)
    this.context.closePath()
    this.context.fillStyle = '#313a46'
    this.context.fill()
    this.context.beginPath()
    this.context.moveTo(base[2].x, base[2].y)
    this.context.lineTo(base[3].x, base[3].y)
    this.context.lineTo(top[3].x, top[3].y)
    this.context.lineTo(top[2].x, top[2].y)
    this.context.closePath()
    this.context.fillStyle = '#252d37'
    this.context.fill()
    this.context.beginPath()
    this.context.moveTo(top[0].x, top[0].y)
    for (const point of top.slice(1)) this.context.lineTo(point.x, point.y)
    this.context.closePath()
    this.context.fillStyle = '#596575'
    this.context.fill()
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
          this.drawHeadlightCone(
            vehicle,
            transform,
            visibleTrackSections,
            visibleBeamDistanceMeters,
          )
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
