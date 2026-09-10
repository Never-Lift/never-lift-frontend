import { LocalRaceSession } from './LocalRaceSession'
import { lerp, lerpAngle } from './math'
import type { RaceEngine } from './RaceEngine'
import type { LocalWorkerSnapshot, RaceWorkerPort } from './local-worker-protocol'
import type { DriverInput } from './types'

const clock = () => performance.timeOrigin + performance.now()
// Keep three 60 Hz visual frames buffered. A single-frame buffer sits exactly on
// the worker/RAF boundary: one late message makes the camera hold the newest
// pose for a frame and then jump, which is especially visible while turning.
const INTERPOLATION_DELAY_MS = 1000 / 20

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
  private readonly started: number
  private lastResponseAt: number
  private readonly now: () => number

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
        if (this.snapshots.length > 6) this.snapshots.shift()
        this.inFlight = false
        this.lastResponseAt = this.now()
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
    // Safe fallback ONLY before any worker state has been displayed.
    // After start, fail visibly instead of resetting/losing the active race.
    if (this.snapshots.length > 0) this.failure = 'A simulação foi interrompida. Pressione R para reiniciar a corrida.'
  }

  advanceFrame(deltaSeconds: number, inputs: Record<string, DriverInput>) {
    if (this.disposed || this.failure || this.paused) return
    if (this.worker && this.snapshots.length === 0 && this.now() - this.started > 8000) this.handleFailure()
    if (this.worker && this.snapshots.length > 0 && this.now() - this.lastResponseAt > 5000) {
      this.handleFailure('Worker stopped responding')
      return
    }
    if (!this.worker) { this.session.advanceFrame(deltaSeconds, inputs); return }
    if (!this.inFlight) {
      this.inFlight = true
      try { this.worker.postMessage({ type: 'frame', inputs }) }
      catch (error) { this.handleFailure(String(error)) }
    }
  }

  setPaused(paused: boolean) {
    this.paused = paused
    this.lastResponseAt = this.now()
    try { this.worker?.postMessage({ type: 'visibility', paused }) }
    catch (error) { this.handleFailure(String(error)) }
    if (paused) this.snapshots = this.snapshots.slice(-1)
  }

  private latest() { return this.snapshots.at(-1) }

  getInterpolatedVehicles() {
    const latest = this.latest()
    if (!latest) return this.engine.getInterpolatedVehicles()
    const target = this.now() - INTERPOLATION_DELAY_MS
    this.interpolationSamples += 1
    if (target - latest.timestamp > 0.5) this.interpolationUnderruns += 1
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
      interpolationUnderruns: this.interpolationUnderruns }
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
