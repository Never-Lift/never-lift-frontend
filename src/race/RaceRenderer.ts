import type {
  TrackBarrierType,
  TrackBarrierPathPoint,
  TrackBrakingMarker,
  TrackChunk,
  TrackCurbPalette,
  TrackDefinition,
  TrackEscapeRoad,
  TrackFenceVisualStyle,
  TrackPitVisualStyle,
  TrackSceneryObject,
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
  classifySceneryKind,
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

const FENCE_WIDTH_METERS = 0.22
const FENCE_GAP_METERS = 0.18
// A small opaque fascia makes the roof/body junction readable in the 2.5D
// projection.  Without it, the top cap can look detached when a garage is
// viewed from the lane side (especially on the heritage and stepped presets).
const PIT_ROOF_FASCIA_HEIGHT_RATIO = 0.055
const PIT_ROOF_EDGE_WIDTH_METERS = 0.08
const DEFAULT_FENCE_VISUAL_STYLE: TrackFenceVisualStyle = {
  heightMeters: 2.6,
  postSpacingMeters: 3,
  postColor: '#748194',
  meshColor: '#697789',
  meshOpacity: 0.22,
  cantileverMeters: 0,
}
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

const TRACK_ASPHALT_COLOR = '#29303b'

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

type SceneryVisualMetrics = {
  scale: number
  depthScale: number
  cullRadiusMeters: number
}

/**
 * Converts authored metric structure dimensions to the legacy visual's local
 * scale. Keeping the conversion here lets old catalog objects retain their
 * `scale` fallback while 2026.12 structures use their real footprint for both
 * drawing and culling.
 */
export function sceneryVisualMetrics(
  object: TrackSceneryObject,
): SceneryVisualMetrics {
  const dimensions = object.dimensions
  if (!dimensions) {
    return {
      scale: object.scale,
      depthScale: 1,
      cullRadiusMeters: object.scale * 0.9,
    }
  }

  const category = classifySceneryKind(object.kind)
  const widthFactor =
    category === 'grandstand'
      ? 1.65
      : category === 'building'
        ? object.kind.toLowerCase().includes('stadium')
          ? 1.65
          : 1.35
        : category === 'tower'
          ? 0.65
          : 1
  const depthFactor =
    category === 'grandstand'
      ? 0.82
      : category === 'building'
        ? object.kind.toLowerCase().includes('wing')
          ? 0.65
          : 0.82
        : category === 'tower'
          ? 0.65
          : 1
  const scale = dimensions.lengthMeters / widthFactor
  const renderedDepthMeters = Math.max(Number.EPSILON, scale * depthFactor)
  const footprintRadiusMeters = Math.hypot(
    dimensions.lengthMeters / 2,
    dimensions.depthMeters / 2,
  )
  return {
    scale,
    depthScale: dimensions.depthMeters / renderedDepthMeters,
    cullRadiusMeters:
      footprintRadiusMeters + dimensions.heightMeters * CAMERA_HEIGHT_SCALE,
  }
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
      (environment.fence
        ? FENCE_GAP_METERS +
          FENCE_WIDTH_METERS +
          (environment.fenceVisualStyle?.cantileverMeters ??
            DEFAULT_FENCE_VISUAL_STYLE.cantileverMeters)
        : 0)
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
  private readonly outputContext: CanvasRenderingContext2D
  private activeContext: CanvasRenderingContext2D
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
  private opacityLayerCanvas?: HTMLCanvasElement
  private opacityLayerContext?: CanvasRenderingContext2D
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
    this.outputContext = context
    this.activeContext = context
  }

  private get context() {
    return this.activeContext
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
          ...this.track.sceneryLayout.escapeRoads.map(
            (road) => road.elevationLayer,
          ),
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
      const sections = visibleTrackSections.filter(
        (section) => section.elevationLayer === elevationLayer,
      )
      const drawElevationLayer = () => {
        if (this.track.id === 'suzuka' && elevationLayer > 0) {
          for (const { points } of sections) {
            this.drawBridgeUnderstructure(points, transform)
          }
        }
        for (const { points } of sections) {
          this.drawTrackEnvironments(points, transform)
        }
        this.drawEscapeRoadSurfaces(transform, elevationLayer)
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
        this.drawBrakingMarkers(transform, elevationLayer)
        if (elevationLayer === 0) this.drawStartFinish(transform)
        this.drawTireMarks(transform, elevationLayer)
        this.drawEscapeRoadObstacleRows(transform, elevationLayer)
        const vehiclesAtLayer = sortVehiclesByProjectedDepth(
          vehicles.filter((vehicle) => vehicle.trackLayer === elevationLayer),
          transform,
        )
        for (const vehicle of vehiclesAtLayer) {
          this.drawVehicle(vehicle, transform)
        }
      }
      if (isFadedSuzukaUpperLayer) {
        this.drawIsolatedOpacityLayer(
          viewport,
          suzukaUpperLayerOpacity,
          drawElevationLayer,
        )
      } else {
        drawElevationLayer()
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
      suzukaUpperLayerOpacity,
    )
    this.drawMinimap(viewport, vehicles, focusedVehicle)
    this.drawDriverLabel(viewport, focusedVehicle.name)
    this.drawStartProcedure(viewport, focusedVehicle.id, overlayState)
    context.restore()
    return ambientParticleCount
  }

  private drawIsolatedOpacityLayer(
    viewport: Viewport,
    opacity: number,
    draw: () => void,
  ) {
    const layer = this.getOpacityLayer()
    if (!layer) {
      // A second 2D context is available in every supported browser. This
      // fallback keeps the race visible in reduced test/browser shims.
      this.context.save()
      this.context.globalAlpha *= opacity
      draw()
      this.context.restore()
      return
    }

    const { canvas, context } = layer
    if (canvas.width !== this.canvas.width || canvas.height !== this.canvas.height) {
      canvas.width = this.canvas.width
      canvas.height = this.canvas.height
    }
    context.clearRect(viewport.x, viewport.y, viewport.width, viewport.height)
    context.save()
    context.beginPath()
    context.rect(viewport.x, viewport.y, viewport.width, viewport.height)
    context.clip()

    const previousContext = this.activeContext
    this.activeContext = context
    try {
      draw()
    } finally {
      this.activeContext = previousContext
      context.restore()
    }

    this.outputContext.save()
    this.outputContext.globalAlpha *= opacity
    this.outputContext.drawImage(
      canvas,
      viewport.x,
      viewport.y,
      viewport.width,
      viewport.height,
      viewport.x,
      viewport.y,
      viewport.width,
      viewport.height,
    )
    this.outputContext.restore()
  }

  private getOpacityLayer() {
    if (this.opacityLayerCanvas && this.opacityLayerContext) {
      return {
        canvas: this.opacityLayerCanvas,
        context: this.opacityLayerContext,
      }
    }
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) return undefined
    this.opacityLayerCanvas = canvas
    this.opacityLayerContext = context
    return { canvas, context }
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
        TRACK_ASPHALT_COLOR,
        index === 0 || index === points.length - 2 ? 'butt' : 'round',
      )
    }
  }

  private isProjectedSegmentVisible(
    from: Vector2,
    to: Vector2,
    halfWidthPixels: number,
    viewport: Viewport,
  ) {
    return !(
      Math.max(from.x, to.x) < viewport.x - halfWidthPixels ||
      Math.min(from.x, to.x) >
        viewport.x + viewport.width + halfWidthPixels ||
      Math.max(from.y, to.y) < viewport.y - halfWidthPixels ||
      Math.min(from.y, to.y) >
        viewport.y + viewport.height + halfWidthPixels
    )
  }

  private drawEscapeRoadSurfaces(
    transform: CameraTransform,
    elevationLayer: number,
  ) {
    for (const road of this.track.sceneryLayout.escapeRoads) {
      if (road.elevationLayer !== elevationLayer) continue
      const projectedPath = road.path.map((point) =>
        worldToCamera(point, transform),
      )
      const segmentWidths = road.path.slice(0, -1).map((_, index) =>
        projectedTrackWidth(
          road.path[index],
          road.path[index + 1],
          road.widthMeters,
          transform,
        ),
      )
      const width = Math.max(...segmentWidths, 0)
      const visible = road.path.slice(0, -1).some((_, index) =>
        this.isProjectedSegmentVisible(
          projectedPath[index],
          projectedPath[index + 1],
          width / 2,
          transform.viewport,
        ),
      )
      if (!visible) continue
      this.strokePolyline(
        projectedPath,
        width + Math.max(1, transform.pixelsPerMeter * 0.18),
        '#8d949d',
        'butt',
      )
      this.strokePolyline(projectedPath, width, TRACK_ASPHALT_COLOR, 'butt')
      if (road.edgeMaterial === 'concrete-wall') {
        this.drawEscapeRoadEdges(road, transform)
      }
    }
  }

  private drawEscapeRoadEdges(
    road: TrackEscapeRoad,
    transform: CameraTransform,
  ) {
    const edgeHeight = transform.pixelsPerMeter * CAMERA_HEIGHT_SCALE * 0.55
    for (const side of road.edgeSides ?? (['left', 'right'] as const)) {
      const edge = this.offsetPolyline(road.path, side, road.widthMeters / 2)
      const projected = edge.map((point) => worldToCamera(point, transform))
      this.strokePolyline(
        projected,
        Math.max(1, transform.pixelsPerMeter * 0.42),
        '#242b32',
        'butt',
      )
      this.strokePolyline(
        projected.map((point) => ({ x: point.x, y: point.y - edgeHeight })),
        Math.max(1, transform.pixelsPerMeter * 0.16),
        '#89939d',
        'butt',
      )
    }
  }

  private drawEscapeRoadObstacleRows(
    transform: CameraTransform,
    elevationLayer: number,
  ) {
    for (const road of this.track.sceneryLayout.escapeRoads) {
      if (road.elevationLayer !== elevationLayer) continue
      for (const row of road.obstacleRows) {
        const projectedFrom = worldToCamera(row.from, transform)
        const projectedTo = worldToCamera(row.to, transform)
        const blockDepthMeters = Math.min(0.85, row.blockLengthMeters * 0.8)
        const projectedDepth = projectedTrackWidth(
          row.from,
          row.to,
          blockDepthMeters,
          transform,
        )
        if (
          !this.isProjectedSegmentVisible(
            projectedFrom,
            projectedTo,
            projectedDepth / 2,
            transform.viewport,
          )
        ) {
          continue
        }
        this.drawEscapeRoadObstacleRow(row, transform, blockDepthMeters)
      }
    }
  }

  private drawEscapeRoadObstacleRow(
    row: TrackEscapeRoad['obstacleRows'][number],
    transform: CameraTransform,
    blockDepthMeters: number,
  ) {
    const delta = { x: row.to.x - row.from.x, y: row.to.y - row.from.y }
    const lengthMeters = Math.hypot(delta.x, delta.y)
    if (lengthMeters <= 1e-9) return
    const tangent = { x: delta.x / lengthMeters, y: delta.y / lengthMeters }
    const normal = { x: -tangent.y, y: tangent.x }
    const blockCount = Math.max(
      1,
      Math.ceil(lengthMeters / row.blockLengthMeters),
    )
    for (let index = 0; index < blockCount; index += 1) {
      const fromDistance = (lengthMeters * index) / blockCount
      const toDistance = (lengthMeters * (index + 1)) / blockCount
      const from = {
        x: row.from.x + tangent.x * fromDistance,
        y: row.from.y + tangent.y * fromDistance,
      }
      const to = {
        x: row.from.x + tangent.x * toDistance,
        y: row.from.y + tangent.y * toDistance,
      }
      const halfDepth = blockDepthMeters / 2
      const block = [
        { x: from.x - normal.x * halfDepth, y: from.y - normal.y * halfDepth },
        { x: to.x - normal.x * halfDepth, y: to.y - normal.y * halfDepth },
        { x: to.x + normal.x * halfDepth, y: to.y + normal.y * halfDepth },
        { x: from.x + normal.x * halfDepth, y: from.y + normal.y * halfDepth },
      ]
      const shadow = block.map((point) => ({
        x: point.x + normal.x * 0.12,
        y: point.y + normal.y * 0.12,
      }))
      this.fillWorldPolygon(shadow, transform, '#353b40')
      this.fillWorldPolygon(block, transform, '#f0f0fa')

      const blockLength = toDistance - fromDistance
      const blockPoint = (longitudinalRatio: number, lateralRatio: number) => ({
        x:
          from.x +
          tangent.x * blockLength * longitudinalRatio +
          normal.x * halfDepth * lateralRatio,
        y:
          from.y +
          tangent.y * blockLength * longitudinalRatio +
          normal.y * halfDepth * lateralRatio,
      })
      this.fillWorldPolygon(
        [
          blockPoint(0.16, -0.72),
          blockPoint(0.34, -0.72),
          blockPoint(0.75, -0.08),
          blockPoint(0.62, 0.1),
        ],
        transform,
        '#d9283b',
      )
      this.fillWorldPolygon(
        [
          blockPoint(0.16, 0.72),
          blockPoint(0.34, 0.72),
          blockPoint(0.75, 0.08),
          blockPoint(0.62, -0.1),
        ],
        transform,
        '#d9283b',
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
      const outerColor = curb.outerColor
      const outerWidthMeters = curb.outerWidthMeters
      if (outerColor && outerWidthMeters) {
        const outerPoints = this.trackPointsForRange(
          points,
          overlapFrom,
          overlapTo,
        ).map((point) =>
          this.offsetTrackPoint(
            point,
            curb.side,
            point.halfWidthMeters +
              curb.widthMeters +
              outerWidthMeters / 2,
          ),
        )
        const first = outerPoints[0]
        const last = outerPoints.at(-1)
        if (first && last) {
          this.strokePolyline(
            outerPoints.map((point) => worldToCamera(point, transform)),
            Math.max(
              1,
              projectedTrackWidth(
                first,
                last,
                outerWidthMeters,
                transform,
              ),
            ),
            outerColor,
            'butt',
          )
        }
      }
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
      const firstVisibleSegment = barrier.path.findIndex(
        (point, index) =>
          index < barrier.path.length - 1 &&
          point.elevationLayer === visibleElevationLayer &&
          barrier.path[index + 1].distanceMeters >= visibleFromDistance,
      )
      if (firstVisibleSegment < 0) continue
      let lastVisibleSegment = firstVisibleSegment
      while (
        lastVisibleSegment < barrier.path.length - 1 &&
        barrier.path[lastVisibleSegment].distanceMeters <= visibleToDistance
      ) {
        lastVisibleSegment += 1
      }
      const path = barrier.path.slice(
        firstVisibleSegment,
        Math.min(barrier.path.length, lastVisibleSegment + 1),
      )
      this.drawCanonicalBarrierPath(
        path,
        barrier.side,
        barrier.thicknessMeters,
        style,
        transform,
        firstVisibleSegment === 0,
        lastVisibleSegment >= barrier.path.length - 1,
      )
    }
  }

  private drawBrakingMarkers(
    transform: CameraTransform,
    elevationLayer: number,
  ) {
    for (const marker of this.track.sceneryLayout.brakingMarkers) {
      if (marker.elevationLayer !== elevationLayer) continue
      this.drawBrakingMarker(marker, transform)
    }
  }

  private drawBrakingMarker(
    marker: TrackBrakingMarker,
    transform: CameraTransform,
  ) {
    const tangent = {
      x: Math.cos(marker.rotation),
      y: Math.sin(marker.rotation),
    }
    const lateral = { x: -tangent.y, y: tangent.x }
    const halfWidthMeters = 1.5
    const leftWorld = {
      x: marker.position.x - lateral.x * halfWidthMeters,
      y: marker.position.y - lateral.y * halfWidthMeters,
    }
    const rightWorld = {
      x: marker.position.x + lateral.x * halfWidthMeters,
      y: marker.position.y + lateral.y * halfWidthMeters,
    }
    const leftGround = worldToCamera(leftWorld, transform)
    const rightGround = worldToCamera(rightWorld, transform)
    const centerGround = worldToCamera(marker.position, transform)
    const viewport = transform.viewport
    const cullMargin = transform.pixelsPerMeter * 3
    if (
      centerGround.x < viewport.x - cullMargin ||
      centerGround.x > viewport.x + viewport.width + cullMargin ||
      centerGround.y < viewport.y - cullMargin ||
      centerGround.y > viewport.y + viewport.height + cullMargin
    ) {
      return
    }

    const pixelsPerHeightMeter =
      transform.pixelsPerMeter * CAMERA_HEIGHT_SCALE
    const boardBottomOffset = pixelsPerHeightMeter * 0.9
    const boardTopOffset = pixelsPerHeightMeter * 3
    const leftBottom = { x: leftGround.x, y: leftGround.y - boardBottomOffset }
    const rightBottom = { x: rightGround.x, y: rightGround.y - boardBottomOffset }
    const leftTop = { x: leftGround.x, y: leftGround.y - boardTopOffset }
    const rightTop = { x: rightGround.x, y: rightGround.y - boardTopOffset }

    this.strokeSegment(
      centerGround,
      {
        x: centerGround.x,
        y: centerGround.y - boardBottomOffset,
      },
      Math.max(1, transform.pixelsPerMeter * 0.09),
      '#34383f',
      'butt',
    )
    this.context.beginPath()
    this.context.moveTo(leftBottom.x, leftBottom.y)
    this.context.lineTo(rightBottom.x, rightBottom.y)
    this.context.lineTo(rightTop.x, rightTop.y)
    this.context.lineTo(leftTop.x, leftTop.y)
    this.context.closePath()
    this.context.fillStyle = '#f5f4ef'
    this.context.fill()
    this.context.strokeStyle = '#1d2025'
    this.context.lineWidth = Math.max(1, transform.pixelsPerMeter * 0.055)
    this.context.stroke()

    const center = {
      x: (leftBottom.x + rightTop.x) / 2,
      y: (leftBottom.y + rightTop.y) / 2,
    }
    const screenAngle = Math.atan2(
      rightBottom.y - leftBottom.y,
      rightBottom.x - leftBottom.x,
    )
    this.context.save()
    this.context.translate(center.x, center.y)
    this.context.rotate(screenAngle)
    this.context.fillStyle = '#17191d'
    this.context.font = `800 ${Math.max(12, transform.pixelsPerMeter * 1.15)}px Barlow, sans-serif`
    this.context.textAlign = 'center'
    this.context.textBaseline = 'middle'
    this.context.fillText(String(marker.distanceToCornerMeters), 0, 0)
    this.context.restore()
  }

  private offsetPolyline(
    path: Vector2[],
    side: 'left' | 'right',
    offsetMeters: number,
  ): Vector2[] {
    if (path.length < 2) return path
    const direction = side === 'left' ? 1 : -1
    const normals = path.slice(0, -1).map((point, index) => {
      const next = path[index + 1]
      const delta = { x: next.x - point.x, y: next.y - point.y }
      const length = Math.hypot(delta.x, delta.y) || 1
      return {
        x: (-delta.y / length) * direction,
        y: (delta.x / length) * direction,
      }
    })
    return path.map((point, index) => {
      if (index === 0) {
        return {
          x: point.x + normals[0].x * offsetMeters,
          y: point.y + normals[0].y * offsetMeters,
        }
      }
      if (index === path.length - 1) {
        const normal = normals.at(-1)!
        return {
          x: point.x + normal.x * offsetMeters,
          y: point.y + normal.y * offsetMeters,
        }
      }
      const previous = normals[index - 1]
      const next = normals[index]
      const sum = { x: previous.x + next.x, y: previous.y + next.y }
      const sumLength = Math.hypot(sum.x, sum.y)
      const miter = sumLength <= 1e-6
        ? next
        : { x: sum.x / sumLength, y: sum.y / sumLength }
      const denominator = Math.max(0.45, miter.x * next.x + miter.y * next.y)
      const miterLength = Math.min(
        offsetMeters * 2.15,
        offsetMeters / denominator,
      )
      return {
        x: point.x + miter.x * miterLength,
        y: point.y + miter.y * miterLength,
      }
    })
  }

  private drawCanonicalBarrierPath(
    path: TrackBarrierPathPoint[],
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
    if (path.length < 2) return
    const outerPath = this.offsetPolyline(path, side, thicknessMeters)
    const height =
      style.heightMeters * transform.pixelsPerMeter * CAMERA_HEIGHT_SCALE
    const inner = path.map((point) => worldToCamera(point, transform))
    const outer = outerPath.map((point) => worldToCamera(point, transform))
    const innerTop = inner.map((point) => ({ x: point.x, y: point.y - height }))
    const outerTop = outer.map((point) => ({ x: point.x, y: point.y - height }))
    const fillFace = (from: Vector2, to: Vector2, topTo: Vector2, topFrom: Vector2, color: string) => {
      this.context.beginPath()
      this.context.moveTo(from.x, from.y)
      this.context.lineTo(to.x, to.y)
      this.context.lineTo(topTo.x, topTo.y)
      this.context.lineTo(topFrom.x, topFrom.y)
      this.context.closePath()
      this.context.fillStyle = color
      this.context.fill()
    }

    for (let index = 0; index < path.length - 1; index += 1) {
      const innerDepth = (inner[index].y + inner[index + 1].y) / 2
      const outerDepth = (outer[index].y + outer[index + 1].y) / 2
      if (innerDepth >= outerDepth) {
        fillFace(
          inner[index],
          inner[index + 1],
          innerTop[index + 1],
          innerTop[index],
          style.sideColor,
        )
      } else {
        fillFace(
          outer[index],
          outer[index + 1],
          outerTop[index + 1],
          outerTop[index],
          style.sideColor,
        )
      }
    }
    if (drawEndCap) {
      const last = path.length - 1
      fillFace(
        inner[last],
        outer[last],
        outerTop[last],
        innerTop[last],
        'rgba(64, 73, 84, 0.92)',
      )
    }
    if (drawStartCap) {
      fillFace(
        outer[0],
        inner[0],
        innerTop[0],
        outerTop[0],
        'rgba(86, 96, 108, 0.86)',
      )
    }

    this.context.beginPath()
    this.context.moveTo(innerTop[0].x, innerTop[0].y)
    for (const point of innerTop.slice(1)) this.context.lineTo(point.x, point.y)
    for (const point of [...outerTop].reverse()) this.context.lineTo(point.x, point.y)
    this.context.closePath()
    this.context.fillStyle = style.color
    this.context.fill()
    const topMiddle = innerTop.map((point, index) => ({
      x: (point.x + outerTop[index].x) / 2,
      y: (point.y + outerTop[index].y) / 2,
    }))
    this.context.save()
    if (style.dashMeters) {
      const tangentScale = projectedSegmentPixelsPerMeter(
        path[0],
        path.at(-1)!,
        transform,
      )
      this.context.setLineDash(
        style.dashMeters.map((dash) => dash * tangentScale),
      )
    }
    this.strokePolyline(
      topMiddle,
      Math.max(1, thicknessMeters * transform.pixelsPerMeter * 0.42),
      style.color,
      'butt',
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
      const visualStyle =
        environment.fenceVisualStyle ?? DEFAULT_FENCE_VISUAL_STYLE
      const visiblePath = barrier.path.filter(
        (point) =>
          point.elevationLayer === visibleElevationLayer &&
          point.distanceMeters >= visibleFromDistance - 6 &&
          point.distanceMeters <= visibleToDistance + 6,
      )
      if (visiblePath.length < 2) continue
      const offset =
        barrier.thicknessMeters +
        FENCE_GAP_METERS +
        FENCE_WIDTH_METERS / 2
      this.drawFencePath(
        visiblePath,
        this.offsetPolyline(visiblePath, barrier.side, offset),
        transform,
        visualStyle,
      )
    }
  }

  private drawFencePath(
    barrierPath: TrackBarrierPathPoint[],
    fencePath: Vector2[],
    transform: CameraTransform,
    style: TrackFenceVisualStyle,
  ) {
    if (fencePath.length < 2) return
    const ground = fencePath.map((point) => worldToCamera(point, transform))
    const leaned = fencePath.map((point, index) => {
      const towardBarrier = {
        x: barrierPath[index].x - point.x,
        y: barrierPath[index].y - point.y,
      }
      const length = Math.hypot(towardBarrier.x, towardBarrier.y) || 1
      return worldToCamera(
        {
          x: point.x + towardBarrier.x / length * style.cantileverMeters,
          y: point.y + towardBarrier.y / length * style.cantileverMeters,
        },
        transform,
      )
    })
    const height =
      style.heightMeters * transform.pixelsPerMeter * CAMERA_HEIGHT_SCALE
    const top = leaned.map((point) => ({ x: point.x, y: point.y - height }))
    for (let index = 0; index < fencePath.length - 1; index += 1) {
      this.context.beginPath()
      this.context.moveTo(ground[index].x, ground[index].y)
      this.context.lineTo(ground[index + 1].x, ground[index + 1].y)
      this.context.lineTo(top[index + 1].x, top[index + 1].y)
      this.context.lineTo(top[index].x, top[index].y)
      this.context.closePath()
      this.context.save()
      this.context.globalAlpha *= style.meshOpacity
      this.context.fillStyle = style.meshColor
      this.context.fill()
      this.context.restore()
    }

    this.strokePolyline(
      top,
      Math.max(1, transform.pixelsPerMeter * 0.08),
      style.postColor,
      'butt',
    )
    this.strokePolyline(
      ground.map((point, index) => ({
        x: point.x + (top[index].x - point.x) * 0.52,
        y: point.y + (top[index].y - point.y) * 0.52,
      })),
      Math.max(1, transform.pixelsPerMeter * 0.045),
      style.meshColor,
      'butt',
    )
    for (let segmentIndex = 0; segmentIndex < fencePath.length - 1; segmentIndex += 1) {
      const lengthMeters = Math.hypot(
        fencePath[segmentIndex + 1].x - fencePath[segmentIndex].x,
        fencePath[segmentIndex + 1].y - fencePath[segmentIndex].y,
      )
      const postCount = Math.max(1, Math.ceil(lengthMeters / style.postSpacingMeters))
      for (let postIndex = segmentIndex === 0 ? 0 : 1; postIndex <= postCount; postIndex += 1) {
        const ratio = postIndex / postCount
        const postGround = {
          x: ground[segmentIndex].x + (ground[segmentIndex + 1].x - ground[segmentIndex].x) * ratio,
          y: ground[segmentIndex].y + (ground[segmentIndex + 1].y - ground[segmentIndex].y) * ratio,
        }
        const postTop = {
          x: top[segmentIndex].x + (top[segmentIndex + 1].x - top[segmentIndex].x) * ratio,
          y: top[segmentIndex].y + (top[segmentIndex + 1].y - top[segmentIndex].y) * ratio,
        }
        this.strokeSegment(
          postGround,
          postTop,
          Math.max(1, transform.pixelsPerMeter * 0.07),
          style.postColor,
          'butt',
        )
      }
    }
  }

  private fenceOffset(environment: TrackSideEnvironment) {
    return (
      trackSideEnvironmentWidth(environment) +
      BARRIER_STYLES[environment.barrier].widthMeters / 2 +
      FENCE_GAP_METERS +
      FENCE_WIDTH_METERS / 2
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
    const laneWidthMeters = style.laneWidthMeters
    for (let index = 0; index < path.length - 1; index += 1) {
      const from = path[index]
      const to = path[index + 1]
      this.strokeSegment(
        worldToCamera(from, transform),
        worldToCamera(to, transform),
        projectedTrackWidth(from, to, laneWidthMeters, transform),
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
          x: point.x + (-delta.y / length) * sideDirection * (laneWidthMeters / 2),
          y: point.y + (delta.x / length) * sideDirection * (laneWidthMeters / 2),
        }
      })
      this.strokePolyline(
        edge.map((point) => worldToCamera(point, transform)),
        Math.max(1, transform.pixelsPerMeter * 0.12),
        style.roofColor,
      )
    }
    const wallFromIndex = Math.max(
      0,
      Math.floor((path.length - 1) * style.garageStartRatio),
    )
    const wallToIndex = Math.min(
      path.length - 1,
      Math.ceil((path.length - 1) * style.garageEndRatio),
    )
    // The divider is present only alongside the garage block.  The entry and
    // exit transitions remain visually open, matching the physical openings
    // published in barrierOpenings and keeping the pit lane drivable.
    this.drawPitWall(
      path.slice(wallFromIndex, wallToIndex + 1),
      transform,
      style,
    )
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
        x:
          point.x +
          (towardTrack.x / length) * (style.laneWidthMeters / 2 + 0.35),
        y:
          point.y +
          (towardTrack.y / length) * (style.laneWidthMeters / 2 + 0.35),
      }
    })
    const projected = wallPath.map((point) => worldToCamera(point, transform))
    this.strokePolyline(
      projected,
      Math.max(1, transform.pixelsPerMeter * 0.38),
      style.secondaryColor,
      'butt',
    )
    const wallHeight =
      transform.pixelsPerMeter *
      CAMERA_HEIGHT_SCALE *
      style.pitWallHeightMeters
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
    const cumulativeDistances = [0]
    for (let index = 1; index < path.length; index += 1) {
      cumulativeDistances.push(
        cumulativeDistances[index - 1] +
          Math.hypot(
            path[index].x - path[index - 1].x,
            path[index].y - path[index - 1].y,
          ),
      )
    }
    const totalLengthMeters = cumulativeDistances.at(-1) ?? 0
    if (totalLengthMeters <= Number.EPSILON) return

    const samplePath = (distanceMeters: number) => {
      const clampedDistance = Math.max(
        0,
        Math.min(totalLengthMeters, distanceMeters),
      )
      let toIndex = cumulativeDistances.findIndex(
        (distance) => distance >= clampedDistance,
      )
      if (toIndex <= 0) toIndex = 1
      const fromIndex = toIndex - 1
      const from = path[fromIndex]
      const to = path[toIndex]
      const segmentLength = Math.max(
        Number.EPSILON,
        cumulativeDistances[toIndex] - cumulativeDistances[fromIndex],
      )
      const ratio =
        (clampedDistance - cumulativeDistances[fromIndex]) / segmentLength
      const tangent = {
        x: (to.x - from.x) / segmentLength,
        y: (to.y - from.y) / segmentLength,
      }
      return {
        point: {
          x: from.x + (to.x - from.x) * ratio,
          y: from.y + (to.y - from.y) * ratio,
        },
        tangent,
      }
    }

    const garageFromMeters = totalLengthMeters * style.garageStartRatio
    const garageToMeters = totalLengthMeters * style.garageEndRatio
    const garageSpanMeters = garageToMeters - garageFromMeters
    const slotLengthMeters = garageSpanMeters / style.garageCount
    for (let garageIndex = 0; garageIndex < style.garageCount; garageIndex += 1) {
      const centerDistanceMeters =
        garageFromMeters + slotLengthMeters * (garageIndex + 0.5)
      const { point: midpoint, tangent } = samplePath(centerDistanceMeters)
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
        x: midpoint.x + outward.x * style.pitBoxCenterOffsetMeters,
        y: midpoint.y + outward.y * style.pitBoxCenterOffsetMeters,
      }
      const boxHalfLength = style.pitBoxLengthMeters / 2
      const boxHalfWidth = style.pitBoxDepthMeters / 2
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
        x: midpoint.x + outward.x * style.garageCenterOffsetMeters,
        y: midpoint.y + outward.y * style.garageCenterOffsetMeters,
      }
      const garageCorners = this.orientedRectangle(
        garageCenter,
        tangent,
        outward,
        // Adjacent bays deliberately meet edge-to-edge.  The continuous
        // shell is then articulated by opaque pillars instead of transparent
        // gaps or disconnected floating buildings.
        slotLengthMeters * 0.5,
        style.garageDepthMeters / 2,
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
    this.drawPitRoofFascia(top, height, style)

    if (style.canopyDepthMeters > Number.EPSILON) {
      const frontMiddle = {
        x: (corners[0].x + corners[1].x) / 2,
        y: (corners[0].y + corners[1].y) / 2,
      }
      const rearMiddle = {
        x: (corners[2].x + corners[3].x) / 2,
        y: (corners[2].y + corners[3].y) / 2,
      }
      const towardLane = {
        x: frontMiddle.x - rearMiddle.x,
        y: frontMiddle.y - rearMiddle.y,
      }
      const towardLaneLength = Math.max(
        Number.EPSILON,
        Math.hypot(towardLane.x, towardLane.y),
      )
      const canopyWorld = [
        {
          x:
            corners[0].x +
            (towardLane.x / towardLaneLength) * style.canopyDepthMeters,
          y:
            corners[0].y +
            (towardLane.y / towardLaneLength) * style.canopyDepthMeters,
        },
        {
          x:
            corners[1].x +
            (towardLane.x / towardLaneLength) * style.canopyDepthMeters,
          y:
            corners[1].y +
            (towardLane.y / towardLaneLength) * style.canopyDepthMeters,
        },
        corners[1],
        corners[0],
      ]
      const canopyHeight = height * 0.72
      const canopy = canopyWorld.map((point) => {
        const projected = worldToCamera(point, transform)
        return { x: projected.x, y: projected.y - canopyHeight }
      })
      this.context.beginPath()
      this.context.moveTo(canopy[0].x, canopy[0].y)
      for (const point of canopy.slice(1)) {
        this.context.lineTo(point.x, point.y)
      }
      this.context.closePath()
      this.context.fillStyle = style.roofColor
      this.context.fill()
      this.strokeSegment(
        canopy[0],
        canopy[1],
        Math.max(1, transform.pixelsPerMeter * 0.08),
        style.accentColor,
        'butt',
      )
    }

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
    // The bay is an opaque recess: it reads as an open garage from the race
    // camera while the rear wall and side returns stay fully solid.
    this.context.fillStyle = '#182027'
    this.context.fill()
    const openingTopLeft = {
      x: frontTopLeft.x + (frontTopRight.x - frontTopLeft.x) * 0.12,
      y: frontTopLeft.y + (frontTopRight.y - frontTopLeft.y) * 0.12 + height * 0.08,
    }
    const openingTopRight = {
      x: frontTopRight.x - (frontTopRight.x - frontTopLeft.x) * 0.12,
      y: frontTopRight.y + (frontTopLeft.y - frontTopRight.y) * 0.12 + height * 0.08,
    }
    const openingBottomRight = {
      x: frontBottomRight.x - (frontBottomRight.x - frontBottomLeft.x) * 0.12,
      y: frontBottomRight.y + (frontBottomLeft.y - frontBottomRight.y) * 0.12,
    }
    const openingBottomLeft = {
      x: frontBottomLeft.x + (frontBottomRight.x - frontBottomLeft.x) * 0.12,
      y: frontBottomLeft.y + (frontBottomRight.y - frontBottomLeft.y) * 0.12,
    }
    this.context.beginPath()
    this.context.moveTo(openingTopLeft.x, openingTopLeft.y)
    this.context.lineTo(openingTopRight.x, openingTopRight.y)
    this.context.lineTo(openingBottomRight.x, openingBottomRight.y)
    this.context.lineTo(openingBottomLeft.x, openingBottomLeft.y)
    this.context.closePath()
    this.context.fillStyle = '#0c1218'
    this.context.fill()
    this.strokeSegment(
      openingTopLeft,
      openingBottomLeft,
      Math.max(1, transform.pixelsPerMeter * 0.12),
      style.secondaryColor,
      'butt',
    )
    this.strokeSegment(
      openingTopRight,
      openingBottomRight,
      Math.max(1, transform.pixelsPerMeter * 0.12),
      style.secondaryColor,
      'butt',
    )
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
    if ((garageIndex + 1) % 2 === 0) {
      const dividerBase = {
        x: (base[0].x + base[1].x) / 2,
        y: (base[0].y + base[1].y) / 2 - height * 0.04,
      }
      const dividerTop = {
        x: (top[0].x + top[1].x) / 2,
        y: (top[0].y + top[1].y) / 2 + height * 0.18,
      }
      this.strokeSegment(
        dividerBase,
        dividerTop,
        Math.max(1, transform.pixelsPerMeter * 0.18),
        style.accentColor,
        'butt',
      )
    }
    this.drawPitBuildingDetails(
      base,
      top,
      height,
      transform,
      style,
      garageIndex,
    )
    // Details such as the heritage ridge are intentionally drawn above the
    // cap.  Re-stroking the perimeter afterwards guarantees an opaque,
    // connected roof silhouette even when adjacent bays overlap in projection.
    this.drawPitRoofOutline(top, transform, style)
  }

  private drawPitRoofFascia(
    top: Vector2[],
    height: number,
    style: TrackPitVisualStyle,
  ) {
    if (top.length < 2) return
    const fasciaHeight = Math.max(1.5, height * PIT_ROOF_FASCIA_HEIGHT_RATIO)
    this.context.beginPath()
    this.context.moveTo(top[0].x, top[0].y)
    this.context.lineTo(top[1].x, top[1].y)
    this.context.lineTo(top[1].x, top[1].y + fasciaHeight)
    this.context.lineTo(top[0].x, top[0].y + fasciaHeight)
    this.context.closePath()
    this.context.fillStyle = style.secondaryColor
    this.context.fill()
  }

  private drawPitRoofOutline(
    top: Vector2[],
    transform: CameraTransform,
    style: TrackPitVisualStyle,
  ) {
    if (top.length < 2) return
    this.context.save()
    this.context.beginPath()
    this.context.moveTo(top[0].x, top[0].y)
    for (const point of top.slice(1)) this.context.lineTo(point.x, point.y)
    this.context.closePath()
    this.context.strokeStyle = style.secondaryColor
    this.context.lineWidth = Math.max(
      1,
      transform.pixelsPerMeter * PIT_ROOF_EDGE_WIDTH_METERS,
    )
    this.context.lineJoin = 'round'
    this.context.stroke()
    this.context.restore()
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
    this.context.strokeStyle = '#9aa6b3'
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

    if (
      style.architecture === 'permanent-modern' ||
      style.architecture === 'stepped-modern' ||
      style.architecture === 'wing' ||
      style.architecture === 'stadium' ||
      style.architecture === 'exhibition' ||
      style.architecture === 'marina-canopy'
    ) {
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
      // Opaque window band; transparent walls make the bay depth and team
      // separation disappear on dark tracks.
      this.context.fillStyle = '#36505f'
      this.context.fill()
      for (const ratio of [0.25, 0.5, 0.75]) {
        this.strokeSegment(
          facadeAt(ratio, 0.72),
          facadeAt(ratio, 0.92),
          Math.max(1, transform.pixelsPerMeter * 0.04),
          '#c9d1d8',
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
        '#424c57',
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
        'butt',
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
      const metrics = sceneryVisualMetrics(object)
      const visualRadius = Math.max(
        8,
        metrics.cullRadiusMeters * transform.pixelsPerMeter,
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
      this.context.scale(1, metrics.depthScale)
      drawSceneryVisual({
        context: this.context,
        object:
          metrics.scale === object.scale
            ? object
            : { ...object, scale: metrics.scale },
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
      ? this.fenceOffset(environment) + FENCE_WIDTH_METERS / 2
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
