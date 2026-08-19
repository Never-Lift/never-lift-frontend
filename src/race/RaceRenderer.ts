import { PHYSICS_CONSTANTS, TEST_OVAL } from '@/race/constants'
import { dot, magnitude } from '@/race/math'
import type { InterpolatedVehicleState, Vector2 } from '@/race/types'
import type { RaceEngine } from '@/race/RaceEngine'

type TireMark = {
  position: Vector2
  onGrass: boolean
}

export class RaceRenderer {
  private readonly context: CanvasRenderingContext2D
  private readonly canvas: HTMLCanvasElement
  private readonly tireMarks: TireMark[] = []
  private frameCount = 0
  private scale = 1
  private center = { x: 0, y: 0 }

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas 2D não está disponível neste navegador.')
    this.context = context
  }

  render(engine: RaceEngine) {
    this.resize()
    const vehicles = engine.getInterpolatedVehicles()
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height)
    this.drawTrack()
    this.collectTireMarks(vehicles)
    this.drawTireMarks()
    for (const vehicle of vehicles) this.drawVehicle(vehicle)
    this.frameCount += 1
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

    this.scale = Math.min(width / 156, height / 108)
    this.center = { x: width / 2, y: height / 2 }
  }

  private world(point: Vector2): Vector2 {
    return {
      x: this.center.x + point.x * this.scale,
      y: this.center.y - point.y * this.scale,
    }
  }

  private drawTrack() {
    const context = this.context
    context.save()
    context.fillStyle = '#162c24'
    context.fillRect(0, 0, this.canvas.width, this.canvas.height)

    const backgroundGradient = context.createRadialGradient(
      this.center.x,
      this.center.y,
      0,
      this.center.x,
      this.center.y,
      Math.max(this.canvas.width, this.canvas.height) * 0.7,
    )
    backgroundGradient.addColorStop(0, 'rgba(49, 199, 255, 0.05)')
    backgroundGradient.addColorStop(1, 'rgba(7, 11, 20, 0.42)')
    context.fillStyle = backgroundGradient
    context.fillRect(0, 0, this.canvas.width, this.canvas.height)

    context.beginPath()
    context.ellipse(
      this.center.x,
      this.center.y,
      TEST_OVAL.asphalt.outerRadiusX * this.scale,
      TEST_OVAL.asphalt.outerRadiusY * this.scale,
      0,
      0,
      Math.PI * 2,
    )
    context.ellipse(
      this.center.x,
      this.center.y,
      TEST_OVAL.asphalt.innerRadiusX * this.scale,
      TEST_OVAL.asphalt.innerRadiusY * this.scale,
      0,
      0,
      Math.PI * 2,
      true,
    )
    context.fillStyle = '#29303b'
    context.fill('evenodd')

    context.setLineDash([1.4 * this.scale, 1.1 * this.scale])
    context.lineWidth = Math.max(1, 0.16 * this.scale)
    context.strokeStyle = 'rgba(240, 240, 250, 0.25)'
    context.beginPath()
    context.ellipse(
      this.center.x,
      this.center.y,
      TEST_OVAL.centerline.radiusX * this.scale,
      TEST_OVAL.centerline.radiusY * this.scale,
      0,
      0,
      Math.PI * 2,
    )
    context.stroke()
    context.setLineDash([])

    this.drawBarrier(
      TEST_OVAL.barriers.outerRadiusX,
      TEST_OVAL.barriers.outerRadiusY,
    )
    this.drawBarrier(
      TEST_OVAL.barriers.innerRadiusX,
      TEST_OVAL.barriers.innerRadiusY,
    )
    this.drawStartLine()
    context.restore()
  }

  private drawBarrier(radiusX: number, radiusY: number) {
    const context = this.context
    context.lineWidth = Math.max(2, 0.55 * this.scale)
    context.strokeStyle = '#e8edf8'
    context.beginPath()
    context.ellipse(
      this.center.x,
      this.center.y,
      radiusX * this.scale,
      radiusY * this.scale,
      0,
      0,
      Math.PI * 2,
    )
    context.stroke()
    context.lineWidth = Math.max(1, 0.22 * this.scale)
    context.strokeStyle = '#ff4055'
    context.setLineDash([2.2 * this.scale, 2.2 * this.scale])
    context.stroke()
    context.setLineDash([])
  }

  private drawStartLine() {
    const context = this.context
    const from = this.world({ x: TEST_OVAL.asphalt.innerRadiusX, y: 0 })
    const to = this.world({ x: TEST_OVAL.asphalt.outerRadiusX, y: 0 })
    const tile = Math.max(2, (to.x - from.x) / 10)
    for (let index = 0; index < 10; index += 1) {
      context.fillStyle = index % 2 === 0 ? '#f0f0fa' : '#070b14'
      context.fillRect(from.x + tile * index, from.y - tile, tile, tile * 2)
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
      if (
        speed < 8 ||
        (vehicle.handlingMode !== 'drift' && lateralSpeed < 3.5)
      ) {
        continue
      }

      const profile = PHYSICS_CONSTANTS.vehicleProfiles[vehicle.profileId]
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

  private drawTireMarks() {
    const context = this.context
    for (const mark of this.tireMarks) {
      const point = this.world(mark.position)
      context.fillStyle = mark.onGrass
        ? 'rgba(101, 68, 43, 0.42)'
        : 'rgba(3, 5, 9, 0.28)'
      context.beginPath()
      context.arc(point.x, point.y, Math.max(0.8, this.scale * 0.18), 0, Math.PI * 2)
      context.fill()
    }
  }

  private drawVehicle(vehicle: InterpolatedVehicleState) {
    const context = this.context
    const profile = PHYSICS_CONSTANTS.vehicleProfiles[vehicle.profileId]
    const point = this.world(vehicle.renderPosition)
    const length = profile.lengthMeters * this.scale
    const width = profile.widthMeters * this.scale
    context.save()
    context.translate(point.x, point.y)
    context.rotate(-vehicle.renderAngle)
    context.shadowColor = 'rgba(0, 0, 0, 0.55)'
    context.shadowBlur = 6 * this.scale
    context.shadowOffsetY = 1.2 * this.scale

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
      context.lineWidth = Math.max(1, this.scale * 0.18)
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
    context.font = `700 ${Math.max(9, 1.3 * this.scale)}px Barlow`
    context.textAlign = 'center'
    context.fillText(vehicle.name, point.x, point.y - width * 1.05)
  }
}
