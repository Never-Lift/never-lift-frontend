import { LocalRaceSession } from './LocalRaceSession'
import { RaceEngine } from './RaceEngine'
import type { LocalWorkerSnapshot } from './local-worker-protocol'
import type { DriverInput, RaceEngineOptions } from './types'
import { PHYSICS_CONSTANTS, PHYSICS_STEP_SECONDS } from './constants'

/** Same engine/start rules, independent of the Canvas/React thread. */
export class LocalWorkerSimulation {
  readonly engine: RaceEngine
  readonly session: LocalRaceSession
  private previousTimestamp: number
  private paused = false
  private inputs: Record<string, DriverInput> = {}
  private pendingSeconds = 0

  constructor(options: RaceEngineOptions, humanIds: string[], timestamp: number) {
    this.engine = new RaceEngine(options)
    this.session = new LocalRaceSession(this.engine, humanIds)
    this.previousTimestamp = timestamp
  }

  setInputs(inputs: Record<string, DriverInput>) { this.inputs = inputs }

  setPaused(paused: boolean, timestamp: number) {
    this.paused = paused
    this.previousTimestamp = timestamp
    this.inputs = {}
    this.pendingSeconds = 0
  }

  tick(timestamp: number, maximumSliceSeconds = Number.POSITIVE_INFINITY) {
    const delta = Math.max(0, (timestamp - this.previousTimestamp) / 1000)
    this.previousTimestamp = timestamp
    if (!this.paused) {
      this.pendingSeconds = Math.min(PHYSICS_CONSTANTS.simulation.maxFrameCatchUpSeconds, this.pendingSeconds + delta)
      const slice = Math.min(this.pendingSeconds, maximumSliceSeconds)
      this.pendingSeconds = Math.max(0, this.pendingSeconds - slice)
      this.session.advanceFrame(slice, this.inputs)
    }
  }

  hasPendingTick() { return this.pendingSeconds + Number.EPSILON >= PHYSICS_STEP_SECONDS }

  snapshot(timestamp: number, physicsMilliseconds: number): LocalWorkerSnapshot {
    const status = this.engine.getStatus()
    return {
      type: 'snapshot', timestamp, physicsMilliseconds, status,
      simulationTimeSeconds: this.engine.getSimulationTimeSeconds(),
      vehicles: this.engine.getInterpolatedVehicles(),
      overlay: this.session.getOverlayState(),
      results: status === 'finished' ? this.engine.getResults() : [],
    }
  }
}
