import { PHYSICS_CONSTANTS, PHYSICS_STEP_SECONDS } from '@/race/constants'
import { clamp } from '@/race/math'
import type { RaceEngine } from '@/race/RaceEngine'
import type { DriverInput } from '@/race/types'

export const START_LIGHT_COUNT = PHYSICS_CONSTANTS.race.startLightCount
export const START_LIGHT_TICKS = Math.round(
  PHYSICS_CONSTANTS.race.startLightStageSeconds / PHYSICS_STEP_SECONDS,
)
export const LIGHTS_OUT_DELAY_TICKS = Math.round(
  PHYSICS_CONSTANTS.race.lightsOutDelaySeconds / PHYSICS_STEP_SECONDS,
)
export const START_RELEASE_TICK =
  START_LIGHT_COUNT * START_LIGHT_TICKS + LIGHTS_OUT_DELAY_TICKS
export const JUMP_START_LOCK_TICKS = Math.round(
  PHYSICS_CONSTANTS.race.jumpStartLockSeconds / PHYSICS_STEP_SECONDS,
)

export type StartLightState = {
  stage: 'sequence' | 'lights-out' | 'hidden'
  redLights: number
}

export type DriverStartPenalty = {
  jumpStarted: boolean
  throttleLockTicksRemaining: number
}

export type LocalRaceOverlayState = {
  startLights: StartLightState
  penalties: Record<string, DriverStartPenalty>
}

const NEUTRAL_INPUT: DriverInput = {
  throttle: 0,
  brake: 0,
  steer: 0,
}

/**
 * Owns only the local start procedure. Physics remains entirely inside RaceEngine.
 * The engine is paused on the grid until lights-out, then jump-start locks are
 * decremented exclusively by fixed physics steps reported by the engine.
 */
export class LocalRaceSession {
  readonly engine: RaceEngine
  private readonly humanRacerIds: string[]
  private readonly inputs = new Map<string, DriverInput>()
  private readonly penalties = new Map<string, DriverStartPenalty>()
  private startAccumulatorSeconds = 0
  private startTick = 0
  private released = false
  private releasedTicks = 0

  constructor(engine: RaceEngine, humanRacerIds: string[]) {
    this.engine = engine
    this.humanRacerIds = [...humanRacerIds]
    for (const racerId of humanRacerIds) {
      this.inputs.set(racerId, { ...NEUTRAL_INPUT })
      this.penalties.set(racerId, {
        jumpStarted: false,
        throttleLockTicksRemaining: 0,
      })
    }
  }

  advanceFrame(
    frameDeltaSeconds: number,
    inputs: Readonly<Record<string, DriverInput>>,
  ) {
    this.captureInputs(inputs)
    if (this.released) return this.advanceReleasedFrame(frameDeltaSeconds)

    this.detectJumpStarts()
    const simulation = PHYSICS_CONSTANTS.simulation
    this.startAccumulatorSeconds += clamp(
      frameDeltaSeconds,
      0,
      simulation.maxFrameCatchUpSeconds,
    )

    let sequenceSteps = 0
    while (
      this.startAccumulatorSeconds + Number.EPSILON >= PHYSICS_STEP_SECONDS &&
      sequenceSteps < simulation.maxSubstepsPerFrame
    ) {
      this.startAccumulatorSeconds -= PHYSICS_STEP_SECONDS
      this.startTick += 1
      sequenceSteps += 1

      if (this.startTick >= START_RELEASE_TICK) {
        this.released = true
        const carriedSeconds = Math.max(0, this.startAccumulatorSeconds)
        this.startAccumulatorSeconds = 0
        return this.advanceReleasedFrame(carriedSeconds)
      }
    }

    if (
      sequenceSteps === simulation.maxSubstepsPerFrame &&
      this.startAccumulatorSeconds >= PHYSICS_STEP_SECONDS
    ) {
      this.startAccumulatorSeconds %= PHYSICS_STEP_SECONDS
    }
    return 0
  }

  getStartLightState(): StartLightState {
    if (!this.released) {
      return {
        stage: 'sequence',
        redLights: Math.min(
          START_LIGHT_COUNT,
          Math.floor(this.startTick / START_LIGHT_TICKS),
        ),
      }
    }
    if (this.releasedTicks < START_LIGHT_TICKS) {
      return { stage: 'lights-out', redLights: 0 }
    }
    return { stage: 'hidden', redLights: 0 }
  }

  getPenalty(racerId: string): DriverStartPenalty {
    const penalty = this.penalties.get(racerId)
    return penalty
      ? { ...penalty }
      : { jumpStarted: false, throttleLockTicksRemaining: 0 }
  }

  getOverlayState(): LocalRaceOverlayState {
    return {
      startLights: this.getStartLightState(),
      penalties: Object.fromEntries(
        [...this.penalties].map(([racerId, penalty]) => [
          racerId,
          { ...penalty },
        ]),
      ),
    }
  }

  isReleased() {
    return this.released
  }

  private captureInputs(inputs: Readonly<Record<string, DriverInput>>) {
    for (const racerId of this.humanRacerIds) {
      const input = inputs[racerId] ?? NEUTRAL_INPUT
      this.inputs.set(racerId, {
        throttle: clamp(input.throttle, 0, 1),
        brake: clamp(input.brake, 0, 1),
        steer: clamp(input.steer, -1, 1),
      })
    }
  }

  private detectJumpStarts() {
    for (const racerId of this.humanRacerIds) {
      const input = this.inputs.get(racerId) ?? NEUTRAL_INPUT
      const penalty = this.penalties.get(racerId)
      if (
        penalty &&
        !penalty.jumpStarted &&
        input.throttle > PHYSICS_CONSTANTS.race.jumpStartThrottleThreshold
      ) {
        penalty.jumpStarted = true
        penalty.throttleLockTicksRemaining = JUMP_START_LOCK_TICKS
      }
    }
  }

  private advanceReleasedFrame(frameDeltaSeconds: number) {
    const simulation = PHYSICS_CONSTANTS.simulation
    let remainingSeconds = clamp(
      frameDeltaSeconds,
      0,
      simulation.maxFrameCatchUpSeconds,
    )
    let remainingStepBudget = simulation.maxSubstepsPerFrame
    let totalPhysicsSteps = 0

    while (remainingSeconds > Number.EPSILON && remainingStepBudget > 0) {
      this.applyCurrentInputs()
      const accumulatedSeconds =
        this.engine.getInterpolationAlpha() * PHYSICS_STEP_SECONDS
      const rawAvailableSteps = Math.floor(
        (accumulatedSeconds + remainingSeconds + Number.EPSILON) /
          PHYSICS_STEP_SECONDS,
      )
      const availableSteps = Math.min(
        remainingStepBudget,
        rawAvailableSteps,
      )
      const nextLockExpiry = Math.min(
        ...[...this.penalties.values()]
          .map((penalty) => penalty.throttleLockTicksRemaining)
          .filter((ticks) => ticks > 0),
        Number.POSITIVE_INFINITY,
      )
      const crossesLockBoundary = nextLockExpiry < availableSteps
      let segmentSeconds = remainingSeconds
      if (crossesLockBoundary) {
        segmentSeconds = Math.max(
          Number.EPSILON,
          nextLockExpiry * PHYSICS_STEP_SECONDS - accumulatedSeconds,
        )
      } else if (rawAvailableSteps > remainingStepBudget) {
        const fractionalSeconds =
          accumulatedSeconds +
          remainingSeconds -
          rawAvailableSteps * PHYSICS_STEP_SECONDS
        segmentSeconds = Math.max(
          Number.EPSILON,
          remainingStepBudget * PHYSICS_STEP_SECONDS -
            accumulatedSeconds +
            fractionalSeconds,
        )
      }
      const physicsSteps = this.engine.advanceFrame(segmentSeconds)
      this.decrementPenalties(physicsSteps)
      this.releasedTicks += physicsSteps
      totalPhysicsSteps += physicsSteps
      remainingStepBudget -= physicsSteps

      if (!crossesLockBoundary) break
      remainingSeconds = Math.max(0, remainingSeconds - segmentSeconds)
    }
    return totalPhysicsSteps
  }

  private applyCurrentInputs() {
    for (const racerId of this.humanRacerIds) {
      const input = this.inputs.get(racerId) ?? NEUTRAL_INPUT
      const penalty = this.penalties.get(racerId)
      this.engine.setInput(
        racerId,
        penalty && penalty.throttleLockTicksRemaining > 0
          ? { ...input, throttle: 0 }
          : input,
      )
    }
  }

  private decrementPenalties(physicsSteps: number) {
    for (const penalty of this.penalties.values()) {
      penalty.throttleLockTicksRemaining = Math.max(
        0,
        penalty.throttleLockTicksRemaining - physicsSteps,
      )
    }
  }
}
