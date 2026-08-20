import type { TrackChunk, TrackDefinition } from '@/lib/api'
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
import { dot, magnitude } from '@/race/math'
import type { RaceEngine } from '@/race/RaceEngine'
import type { InterpolatedVehicleState, Vector2 } from '@/race/types'

type TireMark = {
  position: Vector2
  onGrass: boolean
}

export type RenderStats = {
  totalChunks: number
  visibleChunksByViewport: number[]
}

export class RaceRenderer {
  private readonly context: CanvasRenderingContext2D
  private readonly canvas: HTMLCanvasElement
  private readonly track: TrackDefinition
  private readonly tireMarks: TireMark[] = []
  private readonly cameras = new Map<string, RaceCamera>()
  private frameCount = 0
  private renderStats: RenderStats

  constructor(canvas: HTMLCanvasElement, track: TrackDefinition) {
    this.canvas = canvas
    this.track = track
    this.renderStats = {
      totalChunks: track.chunks.length,
      visibleChunksByViewport: [],
    }
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas 2D não está disponível neste navegador.')
    this.context = context
  }

  render(engine: RaceEngine, deltaSeconds: number) {
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
        this.maximumTrackMarginPixels(transform),
      )
      visibleChunksByViewport.push(visibleChunks.length)
      this.drawViewport(
        viewport,
        transform,
        visibleChunks,
        vehicles,
        focusedVehicle,
      )
    })
    this.drawSplitDivider(viewports)
    this.renderStats = {
      totalChunks: this.track.chunks.length,
      visibleChunksByViewport,
    }
    this.frameCount += 1
  }

  getRenderStats(): RenderStats {
    return {
      totalChunks: this.renderStats.totalChunks,
      visibleChunksByViewport: [...this.renderStats.visibleChunksByViewport],
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

  private maximumTrackMarginPixels(transform: CameraTransform) {
    const maximumHalfWidth = Math.max(
      ...this.track.centerline.map((point) => point.halfWidthMeters),
    )
    return maximumHalfWidth * transform.pixelsPerMeter + 12
  }

  private drawViewport(
    viewport: Viewport,
    transform: CameraTransform,
    visibleChunks: TrackChunk[],
    vehicles: InterpolatedVehicleState[],
    focusedVehicle: InterpolatedVehicleState,
  ) {
    const context = this.context
    context.save()
    context.beginPath()
    context.rect(viewport.x, viewport.y, viewport.width, viewport.height)
    context.clip()
    context.fillStyle = '#132820'
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

    for (const chunk of visibleChunks) this.drawTrackChunk(chunk, transform)
    this.drawStartFinish(transform)
    this.drawScenery(transform)
    this.drawTireMarks(transform)
    for (const vehicle of vehicles) this.drawVehicle(vehicle, transform)
    this.drawMinimap(viewport, vehicles, focusedVehicle)
    this.drawDriverLabel(viewport, focusedVehicle.name)
    context.restore()
  }

  private drawTrackChunk(chunk: TrackChunk, transform: CameraTransform) {
    const path = this.track.centerline
    const chunkPoints = path.filter((_, index) => {
      const previousDistance = path[Math.max(0, index - 1)].distanceMeters
      const nextDistance = path[Math.min(path.length - 1, index + 1)].distanceMeters
      return (
        nextDistance >= chunk.fromDistanceMeters &&
        previousDistance <= chunk.toDistanceMeters
      )
    })
    if (chunkPoints.length < 2) return
    const screenPoints = chunkPoints.map((point) => worldToCamera(point, transform))
    const averageHalfWidthMeters =
      chunkPoints.reduce((sum, point) => sum + point.halfWidthMeters, 0) /
      chunkPoints.length

    this.strokePolyline(
      screenPoints,
      (averageHalfWidthMeters * 2 + 0.8) * transform.pixelsPerMeter,
      '#e8edf8',
    )
    this.strokePolyline(
      screenPoints,
      averageHalfWidthMeters * 2 * transform.pixelsPerMeter,
      '#29303b',
    )
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
  ) {
    this.context.beginPath()
    this.context.moveTo(from.x, from.y)
    this.context.lineTo(to.x, to.y)
    this.context.lineCap = 'round'
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
      })
    }
    if (this.tireMarks.length > 900) {
      this.tireMarks.splice(0, this.tireMarks.length - 900)
    }
  }

  private drawTireMarks(transform: CameraTransform) {
    const viewport = transform.viewport
    for (const mark of this.tireMarks) {
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
