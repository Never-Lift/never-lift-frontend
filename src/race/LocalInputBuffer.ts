import { PHYSICS_STEP_SECONDS } from './constants'
import type { DriverInput } from './types'

export function sameInput(a: DriverInput | undefined, b: DriverInput) {
  return a?.throttle === b.throttle && a.brake === b.brake && a.steer === b.steer
}

/** Preserve down/up edges, including taps delivered together between physics ticks. */
export class LocalInputBuffer {
  private readonly queues = new Map<string, DriverInput[]>()
  private readonly last = new Map<string, DriverInput>()
  private readonly heldSeconds = new Map<string, number>()
  private inputs: Record<string, DriverInput> = {}

  enqueue(inputs: Record<string, DriverInput>) {
    for (const [id, input] of Object.entries(inputs)) {
      if (sameInput(this.last.get(id) ?? { throttle: 0, brake: 0, steer: 0 }, input)) continue
      const queue = this.queues.get(id) ?? []
      // Real keyboard changes are sparse; repeats/unchanged RAF samples never
      // enter the queue. Fail explicitly instead of silently losing controls.
      if (queue.length >= 256) throw new Error('Local input queue overflow')
      queue.push({ ...input })
      this.queues.set(id, queue)
      this.last.set(id, { ...input })
    }
  }

  advance(seconds: number, simulate: (seconds: number, inputs: Record<string, DriverInput>) => void) {
    let remaining = seconds
    while (remaining > Number.EPSILON) {
      let slice = remaining
      for (const [id, queue] of this.queues) {
        const held = this.heldSeconds.get(id) ?? PHYSICS_STEP_SECONDS
        if (queue.length && held + Number.EPSILON >= PHYSICS_STEP_SECONDS) {
          this.inputs[id] = queue.shift()!
          this.heldSeconds.set(id, 0)
        }
        if (queue.length) slice = Math.min(slice, PHYSICS_STEP_SECONDS - (this.heldSeconds.get(id) ?? 0))
      }
      simulate(slice, this.inputs)
      for (const id of this.heldSeconds.keys()) this.heldSeconds.set(id, this.heldSeconds.get(id)! + slice)
      remaining -= slice
    }
  }

  clear() { this.queues.clear(); this.last.clear(); this.heldSeconds.clear(); this.inputs = {} }
}
