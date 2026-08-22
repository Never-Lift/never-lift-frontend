import type {
  TrackBarrierType,
  TrackChunk,
  TrackDefinition,
  TrackSideEnvironment,
  TrackSurfaceMaterial,
} from '@/lib/api'
import {
  createCameraTransform,
  createMinimapTransform,
  createSplitViewports,
  getVisibleTrackChunks,
  RaceCamera,
  type CameraTransform,
  type Viewport,
  worldToCamera,
  worldToMinimap,
} from '@/race/camera'
import { PHYSICS_CONSTANTS } from '@/race/constants'
import type { LocalRaceOverlayState } from '@/race/LocalRaceSession'
import { dot, magnitude } from '@/race/math'
import type { RaceEngine } from '@/race/RaceEngine'
import {
  TrackGeometry,
  trackSideEnvironmentWidth,
} from '@/race/TrackGeometry'
import type { InterpolatedVehicleState, Vector2 } from '@/race/types'
import {
  AMBIENT_PARTICLE_BUDGET,
  DEFAULT_GRAPHICS_QUALITY,
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

export class RaceRenderer {
  private readonly context: CanvasRenderingContext2D
  private readonly canvas: HTMLCanvasElement
  private readonly track: TrackDefinition
  private readonly geometry: TrackGeometry
  private readonly timeOfDay: TimeOfDayPreset
  private readonly quality: GraphicsQuality
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
        focusedVehicle.renderAngle,
        deltaSeconds,
      )
      const profile =
        PHYSICS_CONSTANTS.vehicleVisualProfiles[focusedVehicle.profileId]
      const transform = createCameraTransform(
        cameraState,
        viewport,
        profile.lengthMeters,
      )
      const visibleChunks = getVisibleTrackChunks(
        this.track.chunks,
        transform,
        12,
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
    this.drawScenery(transform)
    for (const elevationLayer of elevationLayers) {
      const sections = visibleTrackSections.filter(
        (section) => section.elevationLayer === elevationLayer,
      )
      for (const { points } of sections) {
        this.drawTrackEnvironments(points, transform)
      }
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
      for (const vehicle of vehicles) {
        if (vehicle.trackLayer === elevationLayer) {
          this.drawVehicle(vehicle, transform)
        }
      }
    }
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
        averageHalfWidthMeters * 2 * transform.pixelsPerMeter,
        '#29303b',
        index === 0 || index === points.length - 2 ? 'butt' : 'round',
      )
    }
  }

  private drawTrackDetails(
    points: TrackDefinition['centerline'],
    transform: CameraTransform,
  ) {
    const screenPoints = points.map((point) => worldToCamera(point, transform))
    this.drawTrackEdges(points, transform)
    this.context.save()
    this.context.setLineDash([
      1.6 * transform.pixelsPerMeter,
      1.4 * transform.pixelsPerMeter,
    ])
    this.strokePolyline(
      screenPoints,
      Math.max(1, 0.12 * transform.pixelsPerMeter),
      'rgba(240, 240, 250, 0.17)',
    )
    this.context.restore()
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
        const environment = this.geometry.getTrackSideEnvironmentAt(
          distanceMeters,
          side,
        )
        let innerOffset = 0
        for (const zone of environment.zones) {
          this.fillTrackZone(
            from,
            to,
            side,
            innerOffset,
            innerOffset + zone.widthMeters,
            transform,
            SURFACE_COLORS[zone.surface],
          )
          innerOffset += zone.widthMeters
        }
      }
    }
  }

  private fillTrackZone(
    from: TrackDefinition['centerline'][number],
    to: TrackDefinition['centerline'][number],
    side: 'left' | 'right',
    innerOffsetMeters: number,
    outerOffsetMeters: number,
    transform: CameraTransform,
    color: string,
  ) {
    const corners = [
      this.offsetTrackPoint(
        from,
        side,
        from.halfWidthMeters + innerOffsetMeters,
      ),
      this.offsetTrackPoint(
        to,
        side,
        to.halfWidthMeters + innerOffsetMeters,
      ),
      this.offsetTrackPoint(
        to,
        side,
        to.halfWidthMeters + outerOffsetMeters,
      ),
      this.offsetTrackPoint(
        from,
        side,
        from.halfWidthMeters + outerOffsetMeters,
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
      const edge = points.map((point) =>
        worldToCamera(
          this.offsetTrackPoint(point, side, point.halfWidthMeters),
          transform,
        ),
      )
      this.strokePolyline(
        edge,
        Math.max(1, 0.14 * transform.pixelsPerMeter),
        'rgba(240, 240, 250, 0.78)',
      )
    }
  }

  private drawTrackBarriers(
    points: TrackDefinition['centerline'],
    transform: CameraTransform,
  ) {
    for (const side of ['left', 'right'] as const) {
      for (let index = 0; index < points.length - 1; index += 1) {
        const from = points[index]
        const to = points[index + 1]
        const { fromPoint, toPoint, style } = this.getBarrierSegment(
          from,
          to,
          side,
          transform,
        )
        this.drawStyledBoundary(fromPoint, toPoint, style, transform)
      }
    }
  }

  private drawTrackFences(
    points: TrackDefinition['centerline'],
    transform: CameraTransform,
  ) {
    for (const side of ['left', 'right'] as const) {
      for (let index = 0; index < points.length - 1; index += 1) {
        const from = points[index]
        const to = points[index + 1]
        const fromEnvironment = this.geometry.getTrackSideEnvironmentAt(
          from.distanceMeters,
          side,
        )
        const toEnvironment = this.geometry.getTrackSideEnvironmentAt(
          to.distanceMeters,
          side,
        )
        const segmentEnvironment = this.geometry.getTrackSideEnvironmentAt(
          (from.distanceMeters + to.distanceMeters) / 2,
          side,
        )
        if (!segmentEnvironment.fence) continue
        const fromPoint = worldToCamera(
          this.offsetTrackPoint(
            from,
            side,
            from.halfWidthMeters + this.fenceOffset(fromEnvironment),
          ),
          transform,
        )
        const toPoint = worldToCamera(
          this.offsetTrackPoint(
            to,
            side,
            to.halfWidthMeters + this.fenceOffset(toEnvironment),
          ),
          transform,
        )
        this.drawStyledBoundary(fromPoint, toPoint, FENCE_STYLE, transform)
      }
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

  private getBarrierSegment(
    from: TrackDefinition['centerline'][number],
    to: TrackDefinition['centerline'][number],
    side: 'left' | 'right',
    transform: CameraTransform,
  ) {
    const fromEnvironment = this.geometry.getTrackSideEnvironmentAt(
      from.distanceMeters,
      side,
    )
    const toEnvironment = this.geometry.getTrackSideEnvironmentAt(
      to.distanceMeters,
      side,
    )
    const styleEnvironment = this.geometry.getTrackSideEnvironmentAt(
      (from.distanceMeters + to.distanceMeters) / 2,
      side,
    )
    const style = BARRIER_STYLES[styleEnvironment.barrier]
    const fromPoint = worldToCamera(
      this.offsetTrackPoint(
        from,
        side,
        from.halfWidthMeters + trackSideEnvironmentWidth(fromEnvironment),
      ),
      transform,
    )
    const toPoint = worldToCamera(
      this.offsetTrackPoint(
        to,
        side,
        to.halfWidthMeters + trackSideEnvironmentWidth(toEnvironment),
      ),
      transform,
    )
    return { fromPoint, toPoint, style }
  }

  private drawStyledBoundary(
    fromPoint: Vector2,
    toPoint: Vector2,
    style: { color: string; widthMeters: number; dashMeters?: number[] },
    transform: CameraTransform,
  ) {
    this.context.save()
    if (style.dashMeters) {
      this.context.setLineDash(
        style.dashMeters.map((length) => length * transform.pixelsPerMeter),
      )
    }
    this.strokeSegment(
      fromPoint,
      toPoint,
      Math.max(1.5, style.widthMeters * transform.pixelsPerMeter),
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

  private strokePolyline(points: Vector2[], width: number, color: string) {
    if (points.length < 2) return
    this.context.beginPath()
    this.context.moveTo(points[0].x, points[0].y)
    for (const point of points.slice(1)) this.context.lineTo(point.x, point.y)
    this.context.lineCap = 'round'
    this.context.lineJoin = 'round'
    this.context.lineWidth = Math.max(1, width)
    this.context.strokeStyle = color
    this.context.stroke()
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

  private drawStartFinish(transform: CameraTransform) {
    const gate = this.track.startFinish
    const lateral = { x: -gate.forward.y, y: gate.forward.x }
    const from = worldToCamera(
      {
        x: gate.position.x - lateral.x * gate.halfWidthMeters,
        y: gate.position.y - lateral.y * gate.halfWidthMeters,
      },
      transform,
    )
    const to = worldToCamera(
      {
        x: gate.position.x + lateral.x * gate.halfWidthMeters,
        y: gate.position.y + lateral.y * gate.halfWidthMeters,
      },
      transform,
    )
    this.context.save()
    this.context.setLineDash([
      Math.max(2, transform.pixelsPerMeter * 0.7),
      Math.max(2, transform.pixelsPerMeter * 0.7),
    ])
    this.strokeSegment(
      from,
      to,
      Math.max(2, transform.pixelsPerMeter * 0.45),
      '#f0f0fa',
    )
    this.context.restore()
  }

  private drawScenery(transform: CameraTransform) {
    const objects = [
      ...this.track.sceneryLayout.landmarks,
      ...this.track.sceneryLayout.staticObjects,
    ]
    const viewport = transform.viewport
    for (const object of objects) {
      const point = worldToCamera(object.position, transform)
      if (
        point.x < viewport.x - 30 ||
        point.x > viewport.x + viewport.width + 30 ||
        point.y < viewport.y - 30 ||
        point.y > viewport.y + viewport.height + 30
      ) {
        continue
      }
      const size = Math.max(2, object.scale * transform.pixelsPerMeter)
      this.context.save()
      this.context.translate(point.x, point.y)
      this.context.rotate(-object.rotation)
      this.context.fillStyle = object.kind.includes('tree')
        ? 'rgba(49, 92, 62, 0.82)'
        : 'rgba(111, 126, 143, 0.68)'
      this.context.fillRect(-size / 2, -size / 2, size, size)
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
            vehicleChunk,
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
    chunk: TrackChunk,
    maximumBeamDistanceMeters: number,
  ) {
    const profile = PHYSICS_CONSTANTS.vehicleVisualProfiles[vehicle.profileId]
    const point = worldToCamera(vehicle.renderPosition, transform)
    const forwardPoint = worldToCamera(
      {
        x: vehicle.renderPosition.x + Math.cos(vehicle.renderAngle),
        y: vehicle.renderPosition.y + Math.sin(vehicle.renderAngle),
      },
      transform,
    )
    const screenAngle = Math.atan2(
      forwardPoint.y - point.y,
      forwardPoint.x - point.x,
    )
    const vehicleLength = profile.lengthMeters * transform.pixelsPerMeter
    const beamLength = Math.min(
      this.getHeadlightBeamLengthMeters(transform) * transform.pixelsPerMeter,
      maximumBeamDistanceMeters * transform.pixelsPerMeter,
    )
    const beamWidth = beamLength * 0.34
    const beamStart = vehicleLength * 0.35
    if (beamLength <= beamStart + 2) return
    this.context.save()
    if (!this.clipHeadlightToChunk(vehicle, transform, chunk)) {
      this.context.restore()
      return
    }
    this.context.translate(point.x, point.y)
    this.context.rotate(screenAngle)
    const gradient = this.context.createLinearGradient(
      beamStart,
      0,
      beamLength,
      0,
    )
    gradient.addColorStop(0, 'rgba(255, 244, 196, 0.3)')
    gradient.addColorStop(0.55, 'rgba(255, 236, 174, 0.13)')
    gradient.addColorStop(1, 'rgba(255, 229, 158, 0)')

    this.context.fillStyle = gradient
    this.context.beginPath()
    this.context.moveTo(beamStart, -vehicleLength * 0.08)
    this.context.lineTo(beamLength, -beamWidth)
    this.context.lineTo(beamLength, beamWidth)
    this.context.lineTo(beamStart, vehicleLength * 0.08)
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
    const sampleSpacingMeters = 2
    const overpassMarginMeters = 0.75

    for (const section of visibleTrackSections) {
      if (section.elevationLayer <= vehicle.trackLayer) continue

      for (let index = 0; index < section.points.length - 1; index += 1) {
        const from = section.points[index]
        const to = section.points[index + 1]
        const segmentLength = Math.hypot(to.x - from.x, to.y - from.y)
        const sampleCount = Math.max(
          1,
          Math.ceil(segmentLength / sampleSpacingMeters),
        )

        for (let sample = 0; sample <= sampleCount; sample += 1) {
          const progress = sample / sampleCount
          const x = from.x + (to.x - from.x) * progress
          const y = from.y + (to.y - from.y) * progress
          const relativeX = x - vehicle.renderPosition.x
          const relativeY = y - vehicle.renderPosition.y
          const forwardDistance =
            relativeX * forwardX + relativeY * forwardY
          const roadHalfWidth =
            from.halfWidthMeters +
            (to.halfWidthMeters - from.halfWidthMeters) * progress
          if (
            forwardDistance + roadHalfWidth < 0 ||
            forwardDistance - roadHalfWidth > visibleDistanceMeters
          ) {
            continue
          }

          const lateralDistance = Math.abs(
            -relativeX * forwardY + relativeY * forwardX,
          )
          const beamHalfWidth = Math.max(0, forwardDistance) * 0.34
          if (lateralDistance > roadHalfWidth + beamHalfWidth) continue

          visibleDistanceMeters = Math.max(
            0,
            forwardDistance - roadHalfWidth - overpassMarginMeters,
          )
        }
      }
    }

    return visibleDistanceMeters
  }

  private clipHeadlightToChunk(
    vehicle: InterpolatedVehicleState,
    transform: CameraTransform,
    chunk: TrackChunk,
  ) {
    const points = this.getChunkPoints(chunk).filter(
      (point) => point.elevationLayer === vehicle.trackLayer,
    )
    if (points.length < 2) return false

    const extraLightWidthMeters = 18
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
    this.context.beginPath()
    this.context.moveTo(left[0].x, left[0].y)
    for (const point of [...left.slice(1), ...right]) {
      this.context.lineTo(point.x, point.y)
    }
    this.context.closePath()
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
      context.fillStyle = 'rgba(7, 11, 20, 0.9)'
      context.fillRect(
        viewport.x + viewport.width * 0.2,
        viewport.y + viewport.height - 54,
        viewport.width * 0.6,
        36,
      )
      context.fillStyle = '#ffb82e'
      context.font = `800 ${Math.max(12, lightRadius)}px Barlow`
      context.textAlign = 'center'
      context.fillText(
        `LARGADA QUEIMADA · ACELERADOR BLOQUEADO ${seconds.toFixed(1)}s`,
        viewport.x + viewport.width / 2,
        viewport.y + viewport.height - 31,
      )
    }
    context.restore()
  }

  private collectTireMarks(vehicles: InterpolatedVehicleState[]) {
    if (this.frameCount % 3 !== 0) return
    for (const vehicle of vehicles) {
      const right = {
        x: -Math.sin(vehicle.renderAngle),
        y: Math.cos(vehicle.renderAngle),
      }
      const lateralSpeed = Math.abs(dot(vehicle.velocity, right))
      const speed = magnitude(vehicle.velocity)
      if (speed < 8 || (vehicle.handlingMode !== 'drift' && lateralSpeed < 3.5)) {
        continue
      }

      const profile = PHYSICS_CONSTANTS.vehicleVisualProfiles[vehicle.profileId]
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
      this.context.beginPath()
      this.context.arc(
        point.x,
        point.y,
        Math.max(0.8, transform.pixelsPerMeter * 0.18),
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
    const profile = PHYSICS_CONSTANTS.vehicleVisualProfiles[vehicle.profileId]
    const point = worldToCamera(vehicle.renderPosition, transform)
    const forwardPoint = worldToCamera(
      {
        x: vehicle.renderPosition.x + Math.cos(vehicle.renderAngle),
        y: vehicle.renderPosition.y + Math.sin(vehicle.renderAngle),
      },
      transform,
    )
    const screenAngle = Math.atan2(
      forwardPoint.y - point.y,
      forwardPoint.x - point.x,
    )
    const length = profile.lengthMeters * transform.pixelsPerMeter
    const width = profile.widthMeters * transform.pixelsPerMeter
    context.save()
    context.translate(point.x, point.y)
    context.rotate(screenAngle)
    context.shadowColor = 'rgba(0, 0, 0, 0.55)'
    context.shadowBlur = Math.max(2, 0.7 * transform.pixelsPerMeter)
    context.shadowOffsetY = Math.max(1, 0.12 * transform.pixelsPerMeter)

    context.fillStyle = vehicle.color
    if (vehicle.profileId === 'formula') {
      context.fillRect(-length * 0.5, -width * 0.19, length, width * 0.38)
      context.fillRect(-length * 0.4, -width * 0.5, length * 0.2, width)
      context.fillRect(length * 0.34, -width * 0.52, length * 0.12, width * 1.04)
      context.beginPath()
      context.arc(-length * 0.05, 0, width * 0.24, 0, Math.PI * 2)
      context.fill()
    } else {
      context.beginPath()
      context.roundRect(-length / 2, -width / 2, length, width, width * 0.28)
      context.fill()
    }

    context.shadowColor = 'transparent'
    context.fillStyle = '#101726'
    context.fillRect(-length * 0.13, -width * 0.32, length * 0.28, width * 0.64)
    if (vehicle.profileId === 'formula') {
      context.fillStyle = vehicle.color
      context.beginPath()
      context.arc(0, 0, width * 0.2, 0, Math.PI * 2)
      context.fill()
    }
    if (vehicle.damage.kind !== 'none') {
      context.strokeStyle = 'rgba(7, 11, 20, 0.78)'
      context.lineWidth = Math.max(1, transform.pixelsPerMeter * 0.18)
      context.beginPath()
      context.moveTo(-length * 0.25, -width * 0.38)
      context.lineTo(-length * 0.05, width * 0.32)
      if (vehicle.damage.kind === 'total-loss') {
        context.moveTo(length * 0.25, -width * 0.38)
        context.lineTo(length * 0.02, width * 0.35)
      }
      context.stroke()
    }
    context.restore()

    context.fillStyle = '#f0f0fa'
    context.font = `700 ${Math.max(9, 1.3 * transform.pixelsPerMeter)}px Barlow`
    context.textAlign = 'center'
    context.fillText(vehicle.name, point.x, point.y - width * 1.05)
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
