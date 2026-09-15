import type { TrackDefinition } from '@/lib/api'
import { PHYSICS_STEP_SECONDS, VEHICLE_DEFINITION } from '@/race/constants'
import { signedAngleDelta } from '@/race/math'
import { RaceEngine } from '@/race/RaceEngine'
import type { DriverInput, InterpolatedVehicleState, VehicleSetup, VehicleState } from '@/race/types'

export const RECONCILIATION_DISTANCE_METERS = 0.1
export const RECONCILIATION_SECONDS = 0.1
const MAX_PENDING_STEPS = 120
const NEUTRAL: DriverInput = { throttle: 0, brake: 0, steer: 0 }
type PendingStep = { substep: number; sequence: number; input: DriverInput }

/** One focal car, canonical physics, no remote AI or client-owned lap progress. */
export class OnlinePrediction {
  private readonly engine: RaceEngine
  private readonly playerId: string
  private pending: PendingStep[] = []
  private input: DriverInput = NEUTRAL
  private sequence = -1
  private acknowledged = -1
  private substep = 0
  private authoritativeSubstep = -1
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
      this.pending.push({ substep: ++this.substep, sequence: this.sequence, input: this.input })
      this.accumulator -= PHYSICS_STEP_SECONDS
    }
  }

  reconcile(state: VehicleState, simulationSeconds: number, acknowledged: number, reset = false) {
    const authoritativeSubstep = Math.round(simulationSeconds / PHYSICS_STEP_SECONDS)
    if (!reset && (acknowledged < this.acknowledged || authoritativeSubstep < this.authoritativeSubstep)) return
    const previous = this.initialized && !reset ? this.getVisualState() : null
    this.acknowledged = acknowledged
    this.authoritativeSubstep = authoritativeSubstep
    // An ACK identifies the last command the server started using. A held key
    // can drive many physical steps after that ACK. Only the snapshot's physical
    // clock tells us which steps are actually confirmed; keep the future horizon.
    this.pending = reset ? [] : this.pending.filter((step) => step.substep > authoritativeSubstep)
    if (reset || authoritativeSubstep > this.substep) this.accumulator = 0
    this.substep = Math.max(authoritativeSubstep, this.pending.at(-1)?.substep ?? authoritativeSubstep)
    this.engine.restorePrediction(state, simulationSeconds)
    for (const step of this.pending) {
      this.engine.setInput(this.playerId, step.input)
      this.engine.stepFixed()
    }
    this.initialized = true
    const next = this.engine.getVehicleState(this.playerId)!
    const presented = this.present(next)
    const dx = previous ? previous.renderPosition.x - presented.x : 0
    const dy = previous ? previous.renderPosition.y - presented.y : 0
    const angle = previous ? signedAngleDelta(presented.angle, previous.renderAngle) : 0
    // Angular disagreement is measured by displacement at the end of the car,
    // sharing the approved metric tolerance instead of inventing another one.
    const visibleError = Math.max(Math.hypot(dx, dy), Math.abs(angle) * VEHICLE_DEFINITION.dimensions.lengthMeters / 2)
    this.offset = visibleError > RECONCILIATION_DISTANCE_METERS
      ? { x: dx, y: dy, angle, remaining: RECONCILIATION_SECONDS }
      : { x: 0, y: 0, angle: 0, remaining: 0 }
  }

  getVisualState(): InterpolatedVehicleState {
    const state = this.engine.getVehicleState(this.playerId)!
    const presented = this.present(state)
    const fraction = this.offset.remaining / RECONCILIATION_SECONDS
    return { ...state, renderPosition: {
      x: presented.x + this.offset.x * fraction,
      y: presented.y + this.offset.y * fraction,
    }, renderAngle: presented.angle + this.offset.angle * fraction }
  }

  private present(state: VehicleState) {
    // Present the residual (< 1/120 s) continuously rather than alternating
    // one/two/three whole steps as RAF drifts relative to the physics clock.
    // This fractional projection is focal-only and never feeds physics/replay.
    return { x: state.position.x + state.velocity.x * this.accumulator,
      y: state.position.y + state.velocity.y * this.accumulator,
      angle: state.angle + state.physicsState.yawRate * this.accumulator }
  }

  getState() { return this.engine.getVehicleState(this.playerId)! }
  getPendingStepCount() { return this.pending.length }
}
