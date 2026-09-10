import { describe, expect, it, vi } from 'vitest'
import { LocalRaceRuntime } from './LocalRaceRuntime'
import { LocalWorkerSimulation } from './LocalWorkerSimulation'
import { LocalRaceSession } from './LocalRaceSession'
import { RaceEngine } from './RaceEngine'
import type { LocalWorkerRequest, LocalWorkerResponse, LocalWorkerSnapshot, RaceWorkerPort } from './local-worker-protocol'
import { SHORT_TRACK } from '@/test/track-fixtures'
import type { RaceEngineOptions } from './types'

const options: RaceEngineOptions = { track: SHORT_TRACK, mode: 'local', racers: [
  { id: 'player-1', name: 'P1', kind: 'human', color: '#2d7dff' },
  { id: 'player-2', name: 'P2', kind: 'human', color: '#ff2e88' },
  { id: 'bot-1', name: 'Bot', kind: 'bot', color: '#ffffff' },
] }
const ids = ['player-1', 'player-2']

class FakeWorker implements RaceWorkerPort {
  onmessage: RaceWorkerPort['onmessage'] = null
  onerror: RaceWorkerPort['onerror'] = null
  onmessageerror: RaceWorkerPort['onmessageerror'] = null
  postMessage = vi.fn<(request: LocalWorkerRequest) => void>()
  terminate = vi.fn()
  receive(data: LocalWorkerResponse) { this.onmessage?.({ data } as MessageEvent<LocalWorkerResponse>) }
}

function fixture() {
  let now = 1000
  const worker = new FakeWorker()
  const engine = new RaceEngine(options)
  const runtime = new LocalRaceRuntime(engine, ids, () => worker, () => now)
  const simulation = new LocalWorkerSimulation(options, ids, now)
  return { worker, engine, runtime, simulation, time: (value: number) => { now = value } }
}

describe('local worker simulation', () => {
  it('splits catch-up into single ticks without changing physics, lights or penalties', () => {
    const whole = new LocalWorkerSimulation(options, ids, 0)
    const sliced = new LocalWorkerSimulation(options, ids, 0)
    for (let timestamp = 100; timestamp <= 8000; timestamp += 100) {
      whole.tick(timestamp)
      sliced.tick(timestamp, 1 / 120)
      while (sliced.hasPendingTick()) sliced.tick(timestamp, 1 / 120)
    }
    expect(sliced.engine.getSimulationTimeSeconds()).toBe(whole.engine.getSimulationTimeSeconds())
    expect(sliced.engine.getVehicleState('bot-1')).toEqual(whole.engine.getVehicleState('bot-1'))
    expect(sliced.session.getOverlayState()).toEqual(whole.session.getOverlayState())
  })

  it('timestamps a sliced snapshot at the simulated pose rather than unfinished wall time', () => {
    const worker = new LocalWorkerSimulation(options, ids, 0)
    worker.tick(20, 1 / 120)

    expect(worker.getSnapshotTimestamp(20)).toBeCloseTo(1000 / 120, 8)

    worker.tick(20, 1 / 120)
    expect(worker.getSnapshotTimestamp(20)).toBeCloseTo(2000 / 120, 8)
  })
  it.each([30, 60, 120])('matches the same engine and start procedure exactly at %i Hz', (fps) => {
    const engine = new RaceEngine(options)
    const session = new LocalRaceSession(engine, ids)
    const worker = new LocalWorkerSimulation(options, ids, 0)
    let previous = 0
    for (let frame = 1; frame <= fps * 8; frame++) {
      const now = frame * 1000 / fps
      const inputs = {
        'player-1': { throttle: frame > fps * 6 ? 0.7 : 0, brake: 0, steer: 0.1 },
        // Also exercise the unchanged jump-start penalty.
        'player-2': { throttle: 0.5, brake: 0, steer: -0.1 },
      }
      session.advanceFrame((now - previous) / 1000, inputs)
      worker.setInputs(inputs)
      worker.tick(now)
      previous = now
    }
    expect(worker.engine.getSimulationTimeSeconds()).toBeGreaterThan(0)
    expect(worker.engine.getInterpolatedVehicles()).toEqual(engine.getInterpolatedVehicles())
    expect(worker.session.getOverlayState()).toEqual(session.getOverlayState())
    expect(worker.engine.getResults()).toEqual(engine.getResults())
  })

  it('pauses hidden tabs without accumulating catch-up or retaining pressed inputs', () => {
    const worker = new LocalWorkerSimulation(options, ids, 0)
    worker.tick(100)
    const original = worker.snapshot(100, 0)
    worker.setInputs({ 'player-1': { throttle: 1, brake: 0, steer: 1 } })
    worker.setPaused(true, 100)
    worker.tick(30000)
    worker.setPaused(false, 30000)
    worker.tick(30000)
    expect(worker.snapshot(30000, 0).vehicles).toEqual(original.vehicles)
    expect(worker.session.getPenalty('player-1').jumpStarted).toBe(false)
  })
})

describe('local worker lifecycle and render view', () => {
  it('posts complete setup once and never queues unbounded frame/input messages', () => {
    const { worker, engine, runtime, simulation } = fixture()
    expect(worker.postMessage.mock.calls[0][0]).toMatchObject({ type: 'init', options, humanIds: ids })
    for (let frame = 0; frame < 100; frame++) runtime.advanceFrame(1 / 60, {})
    expect(worker.postMessage).toHaveBeenCalledTimes(1)
    worker.receive(simulation.snapshot(1000, 0))
    runtime.advanceFrame(1 / 60, { 'player-1': { throttle: 1, brake: 0, steer: 0 } })
    for (let frame = 0; frame < 100; frame++) runtime.advanceFrame(1 / 60, {})
    expect(worker.postMessage).toHaveBeenCalledTimes(2)
    expect(engine.getSimulationTimeSeconds()).toBe(0)
    runtime.dispose()
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    expect(worker.onmessage).toBeNull()
    runtime.advanceFrame(10, {})
    expect(worker.postMessage).toHaveBeenCalledTimes(2)
  })

  it('interpolates render poses only, keeps physics untouched and never extrapolates', () => {
    const { worker, runtime, simulation, time } = fixture()
    const first = simulation.snapshot(1000, 0)
    const second = structuredClone(first)
    second.timestamp = 1020
    first.vehicles[0].renderPosition = { x: 0, y: 0 }
    first.vehicles[0].renderAngle = Math.PI - 0.1
    second.vehicles[0].renderPosition = { x: 10, y: 20 }
    second.vehicles[0].renderAngle = -Math.PI + 0.1
    worker.receive(first)
    worker.receive(second)
    time(1010 + 1000 / 20)
    const displayed = runtime.getInterpolatedVehicles()[0]
    expect(displayed.renderPosition.x).toBeCloseTo(5)
    expect(displayed.renderPosition.y).toBeCloseTo(10)
    expect(Math.abs(displayed.renderAngle)).toBeCloseTo(Math.PI)
    expect(displayed.position).toEqual(second.vehicles[0].position)
    time(3000)
    expect(runtime.getInterpolatedVehicles()[0].renderPosition).toEqual({ x: 10, y: 20 })
    expect(first.vehicles[0].renderPosition).toEqual({ x: 0, y: 0 })
  })

  it('keeps camera poses advancing when 30 Hz snapshots arrive one visual frame late', () => {
    const { worker, runtime, simulation, time } = fixture()
    const snapshotAt = (timestamp: number, x: number) => {
      const snapshot = simulation.snapshot(timestamp, 0)
      snapshot.vehicles[0].renderPosition = { x, y: 0 }
      snapshot.vehicles[0].velocity = { x: 20, y: x / 10 }
      return snapshot
    }

    worker.receive(snapshotAt(1000, 0))
    worker.receive(snapshotAt(1000 + 1000 / 30, 10))

    // The next worker result is delayed past one RAF. A one-frame jitter buffer
    // used to reach the latest pose here, hold the camera, then jump on receipt.
    time(1000 + 1000 / 15)
    const first = runtime.getInterpolatedVehicles()[0]
    time(1000 + 1000 / 12)
    const second = runtime.getInterpolatedVehicles()[0]

    worker.receive(snapshotAt(1000 + 1000 / 15, 20))
    time(1100)
    const third = runtime.getInterpolatedVehicles()[0]

    expect(first.renderPosition.x).toBeGreaterThan(0)
    expect(second.renderPosition.x).toBeGreaterThan(first.renderPosition.x)
    expect(third.renderPosition.x).toBeGreaterThan(second.renderPosition.x)
    expect(second.velocity.y).toBeGreaterThan(first.velocity.y)
    expect(third.velocity.y).toBeGreaterThan(second.velocity.y)
    expect(runtime.getDiagnostics().interpolationUnderruns).toBe(0)
  })

  it('falls back safely on startup error/timeout, but never resets an active worker race', () => {
    for (const started of [false, true]) {
      const { worker, runtime, simulation, time } = fixture()
      if (started) worker.receive(simulation.snapshot(1000, 0))
      worker.receive({ type: 'failure', message: 'test' })
      expect(worker.terminate).toHaveBeenCalledTimes(1)
      expect(Boolean(runtime.getFailure())).toBe(started)
      time(2000)
      runtime.advanceFrame(1 / 60, {})
      expect(worker.postMessage).toHaveBeenCalledTimes(1)
    }
    const { worker, runtime, time } = fixture()
    time(10000)
    runtime.advanceFrame(0, {})
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    expect(runtime.getFailure()).toBeNull()
  })

  it('exposes worker results, start penalties, errors, and forwards visibility', () => {
    const { worker, runtime, simulation } = fixture()
    const snapshot: LocalWorkerSnapshot = { ...simulation.snapshot(1000, 3), status: 'finished',
      results: [{ racerId: 'player-1', racerName: 'P1', position: 1, totalTimeMs: 1000, bestLapTimeMs: 1000, finished: true }] }
    worker.receive(snapshot)
    expect(runtime.getResults()).toEqual(snapshot.results)
    expect(runtime.getStatus()).toBe('finished')
    expect(runtime.getOverlayState(true).showDriverNames).toBe(true)
    runtime.setPaused(true)
    expect(worker.postMessage).toHaveBeenLastCalledWith({ type: 'visibility', paused: true })
    worker.onerror?.(new ErrorEvent('error'))
    expect(runtime.getFailure()).toMatch(/reiniciar/)
  })

  it('detects a stalled simulation instead of rendering a frozen race indefinitely', () => {
    const { worker, runtime, simulation, time } = fixture()
    worker.receive(simulation.snapshot(1000, 0))
    time(7000)
    runtime.advanceFrame(1 / 60, {})
    expect(runtime.getFailure()).toMatch(/interrompida/)
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })

  it('does not mistake time in a hidden tab for a worker failure', () => {
    const { worker, runtime, simulation, time } = fixture()
    worker.receive(simulation.snapshot(1000, 0))
    runtime.setPaused(true)
    time(30000)
    runtime.advanceFrame(10, {})
    runtime.setPaused(false)
    runtime.advanceFrame(0, {})
    expect(runtime.getFailure()).toBeNull()
    expect(worker.terminate).not.toHaveBeenCalled()
  })
})
