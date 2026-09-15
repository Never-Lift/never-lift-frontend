import type { TrackDefinition } from '@/lib/api'
import { PHYSICS_STEP_SECONDS, VEHICLE_DEFINITION } from '@/race/constants'
import { signedAngleDelta } from '@/race/math'
import { RaceEngine } from '@/race/RaceEngine'
import type { DriverInput, InterpolatedVehicleState, VehicleSetup, VehicleState } from '@/race/types'

export const RECONCILIATION_DISTANCE_METERS = 0.1
export const RECONCILIATION_SECONDS = 0.1
const MAX_PENDING_STEPS = 120
const NEUTRAL: DriverInput = { throttle: 0, brake: 0, steer: 0 }
type PendingStep = { sequence: number; input: DriverInput }

/** One focal car, canonical physics, no remote AI or client-owned lap progress. */
export class OnlinePrediction {
  private readonly engine: RaceEngine
  private readonly playerId: string
  private pending: PendingStep[] = []
  private input: DriverInput = NEUTRAL
  private sequence = -1
  private acknowledged = -1
  private accumulator = 0
  private initialized = false
  private offset = { x: 0, y: 0, angle: 0, remaining: 0 }

  constructor(track: TrackDefinition, player: VehicleSetup) {
    this.playerId = player.id
    this.engine = new RaceEngine({ track, mode: 'solo', racers: [{ ...player, kind: 'human' }], prediction: true })
  }

  setInput(sequence: number, input: DriverInput) {
    this.sequence = sequence
    this.input = { ...input }
  }

  advance(deltaSeconds: number) {
    if (!this.initialized) return
    const delta = Math.max(0, Math.min(deltaSeconds, 0.1))
    this.offset.remaining = Math.max(0, this.offset.remaining - delta)
    this.accumulator += delta
    while (this.accumulator + 1e-12 >= PHYSICS_STEP_SECONDS) {
      // A missing acknowledgement must not grow memory/replay cost indefinitely.
      if (this.pending.length >= MAX_PENDING_STEPS) { this.accumulator = 0; break }
      this.engine.setInput(this.playerId, this.input)
      this.engine.stepFixed()
      this.pending.push({ sequence: this.sequence, input: this.input })
      this.accumulator -= PHYSICS_STEP_SECONDS
    }
  }

  reconcile(state: VehicleState, simulationSeconds: number, acknowledged: number, reset = false) {
    if (!reset && acknowledged < this.acknowledged) return
    const previous = this.initialized && !reset ? this.getVisualState() : null
    this.acknowledged = acknowledged
    this.pending = reset ? [] : this.pending.filter((step) => step.sequence > acknowledged)
    this.engine.restorePrediction(state, simulationSeconds)
    for (const step of this.pending) {
      this.engine.setInput(this.playerId, step.input)
      this.engine.stepFixed()
    }
    this.accumulator = 0
    this.initialized = true
    const next = this.engine.getVehicleState(this.playerId)!
    const dx = previous ? previous.renderPosition.x - next.position.x : 0
    const dy = previous ? previous.renderPosition.y - next.position.y : 0
    const angle = previous ? signedAngleDelta(next.angle, previous.renderAngle) : 0
    // Angular disagreement is measured by displacement at the end of the car,
    // sharing the approved metric tolerance instead of inventing another one.
    const visibleError = Math.max(Math.hypot(dx, dy), Math.abs(angle) * VEHICLE_DEFINITION.dimensions.lengthMeters / 2)
    this.offset = visibleError > RECONCILIATION_DISTANCE_METERS
      ? { x: dx, y: dy, angle, remaining: RECONCILIATION_SECONDS }
      : { x: 0, y: 0, angle: 0, remaining: 0 }
  }

  getVisualState(): InterpolatedVehicleState {
    const state = this.engine.getVehicleState(this.playerId)!
    const fraction = this.offset.remaining / RECONCILIATION_SECONDS
    return { ...state, renderPosition: {
      x: state.position.x + this.offset.x * fraction,
      y: state.position.y + this.offset.y * fraction,
    }, renderAngle: state.angle + this.offset.angle * fraction }
  }

  getState() { return this.engine.getVehicleState(this.playerId)! }
  getPendingStepCount() { return this.pending.length }
}
