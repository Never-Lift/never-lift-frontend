import { lerp, lerpAngle } from '@/race/math'
import type { InterpolatedVehicleState } from '@/race/types'

export const REMOTE_DELAY_MS = 100
export const MAX_REMOTE_SNAPSHOTS = 12
export type RemoteFrame = { time: number; cars: InterpolatedVehicleState[] }

/** Short bounded history; each draw interpolates exactly one bracketing pair. */
export class RemoteSnapshotBuffer {
  private frames: RemoteFrame[] = []

  push(frame: RemoteFrame) {
    const last = this.frames.at(-1)
    if (last && frame.time <= last.time) return false
    this.frames.push(frame)
    if (this.frames.length > MAX_REMOTE_SNAPSHOTS) this.frames.shift()
    return true
  }

  sample(serverNow: number) {
    if (!this.frames.length) return []
    const target = serverNow - REMOTE_DELAY_MS
    let first = this.frames[0]
    let second = first
    for (let i = 1; i < this.frames.length; i++) {
      second = this.frames[i]
      if (second.time >= target) break
      first = second
    }
    const alpha = second.time === first.time ? 0 : Math.max(0, Math.min(1, (target - first.time) / (second.time - first.time)))
    const nextById = new Map(second.cars.map((car) => [car.id, car]))
    return first.cars.map((car) => {
      const next = nextById.get(car.id) ?? car
      // Discrete flags change at the authoritative sample, never midway.
      const discrete = alpha === 1 ? next : car
      return { ...discrete,
        velocity: { x: lerp(car.velocity.x, next.velocity.x, alpha), y: lerp(car.velocity.y, next.velocity.y, alpha) },
        renderPosition: { x: lerp(car.position.x, next.position.x, alpha), y: lerp(car.position.y, next.position.y, alpha) },
        renderAngle: lerpAngle(car.angle, next.angle, alpha),
      }
    })
  }

  clear() { this.frames = [] }
  getSize() { return this.frames.length }
}
