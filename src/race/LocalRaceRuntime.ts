import { LocalRaceSession } from './LocalRaceSession'
import { lerp, lerpAngle } from './math'
import type { RaceEngine } from './RaceEngine'
import type { LocalWorkerSnapshot, RaceWorkerPort } from './local-worker-protocol'
import type { DriverInput } from './types'
import { LocalInputBuffer, sameInput } from './LocalInputBuffer'

const clock = () => performance.timeOrigin + performance.now()
// Continuous bounded snapshot pulls no longer wait for the next RAF round trip.
// Four physics ticks cover measured split-screen delivery jitter without the
// old 50ms visual delay. Do not reduce this from FPS averages alone.
export const LOCAL_INTERPOLATION_DELAY_MS = 1000 / 30

/** One local simulation owner, bounded messages, no React position updates. */
export class LocalRaceRuntime {
  readonly mode: RaceEngine['mode']
  private readonly engine: RaceEngine
  private readonly session: LocalRaceSession
  private worker: RaceWorkerPort | undefined
  private snapshots: LocalWorkerSnapshot[] = []
  private inFlight = true
  private disposed = false
  private paused = false
  private failure: string | null = null
  private diagnosticError: string | null = null
  private interpolationSamples = 0
  private interpolationUnderruns = 0
  private movingInterpolationUnderruns = 0
  private maximumInterpolationUnderrunMs = 0
  private readonly started: number
  private lastResponseAt: number
  private readonly now: () => number
  private presentationTimestamp: number | undefined
  private lastInputs: Record<string, DriverInput> = {}
  private readonly fallbackInputs = new LocalInputBuffer()

  constructor(engine: RaceEngine, humanIds: string[], createWorker?: () => RaceWorkerPort, now = clock) {
    this.engine = engine
    this.mode = engine.mode
    this.session = new LocalRaceSession(engine, humanIds)
    this.now = now
    this.started = now()
    this.lastResponseAt = this.started
    // A running engine must never be silently reconstructed on the grid.
    if (!createWorker || engine.getSimulationTimeSeconds() !== 0) return
    try {
      this.worker = createWorker()
      this.worker.onmessage = ({ data }) => {
        if (this.disposed) return
        if (data.type === 'failure') { this.handleFailure(data.message); return }
        this.snapshots.push(data)
        if (this.snapshots.length > 8) this.snapshots.shift()
        this.inFlight = false
        this.lastResponseAt = this.now()
        this.requestSnapshot()
      }
      this.worker.onerror = (event) => this.handleFailure(event.message)
      this.worker.onmessageerror = () => this.handleFailure('Worker message could not be decoded')
      this.worker.postMessage({ type: 'init', humanIds, options: {
        track: engine.track, mode: engine.mode, lapCount: engine.lapCount,
        maximumRaceSeconds: engine.maximumRaceSeconds,
        racers: engine.getInterpolatedVehicles().map(({ id, name, kind, color, botDifficulty }) =>
          ({ id, name, kind, color, botDifficulty })),
      } })
    } catch (error) { this.handleFailure(String(error)) }
  }

  private handleFailure(message = 'Worker startup timed out') {
    if (this.disposed) return
    this.diagnosticError = message
    this.stopWorker()
    // The worker may fail after receiving a key but before its first snapshot.
    // Re-send the held state to the fallback instead of suppressing it as a duplicate.
    this.lastInputs = {}
    // Safe fallback ONLY before any worker state has been displayed.
    // After start, fail visibly instead of resetting/losing the active race.
    if (this.snapshots.length > 0) this.failure = 'A simulação foi interrompida. Pressione R para reiniciar a corrida.'
  }

  private requestSnapshot() {
    if (!this.worker || this.inFlight || this.paused || this.disposed || this.failure) return
    this.inFlight = true
    try { this.worker.postMessage({ type: 'frame' }) }
    catch (error) { this.handleFailure(String(error)) }
  }

  /** Input changes do not wait for a visual frame or a snapshot acknowledgement. */
  setInputs(inputs: Record<string, DriverInput>) {
    if (this.disposed || this.failure || this.paused) return
    const changes: Record<string, DriverInput> = {}
    for (const [id, input] of Object.entries(inputs)) {
      if (sameInput(this.lastInputs[id], input)) continue
      changes[id] = { ...input }
      this.lastInputs[id] = { ...input }
    }
    if (!Object.keys(changes).length) return
    try {
      if (this.worker) this.worker.postMessage({ type: 'input', inputs: changes })
      else this.fallbackInputs.enqueue(changes)
    } catch (error) { this.handleFailure(String(error)) }
  }

  advanceFrame(deltaSeconds: number, inputs: Record<string, DriverInput>, presentationTimestamp = this.now()) {
    if (this.disposed || this.failure || this.paused) return
    // RAF's display clock is stable; performance.now() varies with task/GC cost
    // ahead of this callback. All viewports sample the same display instant.
    this.presentationTimestamp = presentationTimestamp
    if (this.worker && this.snapshots.length === 0 && this.now() - this.started > 8000) this.handleFailure()
    if (this.worker && this.snapshots.length > 0 && this.now() - this.lastResponseAt > 5000) {
      this.handleFailure('Worker stopped responding')
      return
    }
    this.setInputs(inputs)
    if (!this.worker) {
      this.fallbackInputs.advance(deltaSeconds, (seconds, held) => this.session.advanceFrame(seconds, held))
      return
    }
    this.requestSnapshot()
  }

  setPaused(paused: boolean) {
    this.paused = paused
    this.lastResponseAt = this.now()
    this.lastInputs = {}
    this.fallbackInputs.clear()
    this.presentationTimestamp = undefined
    try { this.worker?.postMessage({ type: 'visibility', paused }) }
    catch (error) { this.handleFailure(String(error)) }
    if (paused) this.snapshots = this.snapshots.slice(-1)
    else this.requestSnapshot()
  }

  private latest() { return this.snapshots.at(-1) }

  getInterpolatedVehicles() {
    const latest = this.latest()
    if (!latest) return this.engine.getInterpolatedVehicles()
    const target = (this.presentationTimestamp ?? this.now()) - LOCAL_INTERPOLATION_DELAY_MS
    this.interpolationSamples += 1
    if (target - latest.timestamp > 0.5) {
      this.interpolationUnderruns += 1
      if (latest.vehicles.some(vehicle => Math.hypot(vehicle.velocity.x, vehicle.velocity.y) > 1)) {
        this.movingInterpolationUnderruns += 1
        this.maximumInterpolationUnderrunMs = Math.max(this.maximumInterpolationUnderrunMs, target - latest.timestamp)
      }
    }
    let before = this.snapshots[0]
    let after = before
    for (const snapshot of this.snapshots) {
      after = snapshot
      if (snapshot.timestamp >= target) break
      before = snapshot
    }
    const duration = after.timestamp - before.timestamp
    const alpha = duration > 0 ? Math.max(0, Math.min(1, (target - before.timestamp) / duration)) : 1
    return after.vehicles.map((vehicle, index) => {
      const previous = before.vehicles[index]
      return { ...vehicle,
        renderPosition: {
          x: lerp(previous.renderPosition.x, vehicle.renderPosition.x, alpha),
          y: lerp(previous.renderPosition.y, vehicle.renderPosition.y, alpha),
        },
        renderAngle: lerpAngle(previous.renderAngle, vehicle.renderAngle, alpha),
        // RaceCamera follows movement direction. Interpolating the render pose
        // but stepping its velocity once per worker message still makes the
        // scenery rotate unevenly through corners.
        velocity: {
          x: lerp(previous.velocity.x, vehicle.velocity.x, alpha),
          y: lerp(previous.velocity.y, vehicle.velocity.y, alpha),
        },
      }
    })
  }

  getVehicleState(id: string) { return this.latest()?.vehicles.find(vehicle => vehicle.id === id) ?? this.engine.getVehicleState(id) }
  getStatus() { return this.latest()?.status ?? this.engine.getStatus() }
  getResults() { return this.latest()?.results ?? this.engine.getResults() }
  getSimulationTimeSeconds() { return this.latest()?.simulationTimeSeconds ?? this.engine.getSimulationTimeSeconds() }
  getFailure() { return this.failure }
  getDiagnostics() {
    const snapshot = this.latest()
    return { worker: Boolean(this.worker), diagnosticError: this.diagnosticError, snapshotTimestamp: snapshot?.timestamp ?? 0,
      snapshotAgeMs: snapshot ? Math.max(0, this.now() - snapshot.timestamp) : 0,
      physicsMilliseconds: snapshot?.physicsMilliseconds ?? 0,
      interpolationSamples: this.interpolationSamples,
      interpolationUnderruns: this.interpolationUnderruns,
      movingInterpolationUnderruns: this.movingInterpolationUnderruns,
      maximumInterpolationUnderrunMs: this.maximumInterpolationUnderrunMs }
  }
  getOverlayState(showDriverNames = false) {
    return { ...(this.latest()?.overlay ?? this.session.getOverlayState()), showDriverNames }
  }
  getStartLightState() { return this.getOverlayState().startLights }
  getPenalty(id: string) { return this.getOverlayState().penalties[id] ?? this.session.getPenalty(id) }

  private stopWorker() {
    if (!this.worker) return
    this.worker.onmessage = null
    this.worker.onerror = null
    this.worker.onmessageerror = null
    this.worker.terminate()
    this.worker = undefined
  }

  dispose() { this.disposed = true; this.stopWorker(); this.snapshots = [] }
}
