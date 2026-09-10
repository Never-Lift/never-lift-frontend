import { LocalRaceSession } from './LocalRaceSession'
import { RaceEngine } from './RaceEngine'
import type { LocalWorkerSnapshot } from './local-worker-protocol'
import type { DriverInput, RaceEngineOptions } from './types'
import { PHYSICS_CONSTANTS, PHYSICS_STEP_SECONDS } from './constants'
import { LocalInputBuffer } from './LocalInputBuffer'

/** Same engine/start rules, independent of the Canvas/React thread. */
export class LocalWorkerSimulation {
  readonly engine: RaceEngine
  readonly session: LocalRaceSession
  private previousTimestamp: number
  private paused = false
  private inputs: Record<string, DriverInput> = {}
  private pendingSeconds = 0
  private readonly inputBuffer = new LocalInputBuffer()
  private bufferedInput = false

  constructor(options: RaceEngineOptions, humanIds: string[], timestamp: number) {
    this.engine = new RaceEngine(options)
    this.session = new LocalRaceSession(this.engine, humanIds)
    this.previousTimestamp = timestamp
  }

  setInputs(inputs: Record<string, DriverInput>) { this.inputs = inputs }

  enqueueInputs(inputs: Record<string, DriverInput>) {
    if (this.paused) return
    this.bufferedInput = true
    this.inputBuffer.enqueue(inputs)
  }

  setPaused(paused: boolean, timestamp: number) {
    this.paused = paused
    this.previousTimestamp = timestamp
    this.inputs = {}
    this.pendingSeconds = 0
    this.inputBuffer.clear()
  }

  tick(timestamp: number, maximumSliceSeconds = Number.POSITIVE_INFINITY) {
    const delta = Math.max(0, (timestamp - this.previousTimestamp) / 1000)
    this.previousTimestamp = timestamp
    if (!this.paused) {
      this.pendingSeconds = Math.min(PHYSICS_CONSTANTS.simulation.maxFrameCatchUpSeconds, this.pendingSeconds + delta)
      const slice = Math.min(this.pendingSeconds, maximumSliceSeconds)
      this.pendingSeconds = Math.max(0, this.pendingSeconds - slice)
      if (this.bufferedInput) this.inputBuffer.advance(slice, (seconds, inputs) => this.session.advanceFrame(seconds, inputs))
      else this.session.advanceFrame(slice, this.inputs)
    }
  }

  hasPendingTick() { return this.pendingSeconds + Number.EPSILON >= PHYSICS_STEP_SECONDS }

  getSnapshotTimestamp() {
    // The pose represents the time sampled BEFORE physics, not its completion.
    // Adding computation time here makes identical motion speed up/slow down
    // with collision/bot cost even when the render loop runs at a steady 60 Hz.
    return this.previousTimestamp - this.pendingSeconds * 1000
  }

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
