import { describe, expect, it } from 'vitest'
import { OnlinePrediction } from '@/online/OnlinePrediction'
import { RemoteSnapshotBuffer, MAX_REMOTE_SNAPSHOTS } from '@/online/RemoteSnapshotBuffer'
import { snapshotVehicle } from '@/online/race-protocol'
import { onlineFrame } from '@/test/online-race-fixtures'
import { SHORT_TRACK } from '@/test/track-fixtures'
import { RaceEngine } from '@/race/RaceEngine'
import { PHYSICS_STEP_SECONDS } from '@/race/constants'

function setup() {
  const car = snapshotVehicle(onlineFrame().cars[0])
  const prediction = new OnlinePrediction(SHORT_TRACK, car)
  prediction.reconcile(car, 0, -1, true)
  return { car, prediction }
}

describe('online prediction and rollback', () => {
  it('applies a new input on the next physical step without a server response', () => {
    const { prediction } = setup()
    prediction.setInput(0, { throttle: 1, brake: 0, steer: 1 })
    prediction.advance(PHYSICS_STEP_SECONDS)
    expect(prediction.getState().physicsState.appliedThrottle).toBeGreaterThan(0)
    expect(prediction.getState().physicsState.steeringAngle).toBeGreaterThan(0)
  })

  it('restores the full state and replays only unacknowledged inputs using the same engine', () => {
    const { prediction, car } = setup()
    prediction.setInput(0, { throttle: 1, brake: 0, steer: 0 })
    prediction.advance(1/30)
    const authority = prediction.getState()
    prediction.setInput(1, { throttle: 0.4, brake: 0, steer: 0.5 })
    prediction.advance(1/30)
    const expected = prediction.getState()
    prediction.reconcile(authority, 1/30, 0)
    expect(prediction.getState()).toEqual(expected)
    expect(prediction.getPendingStepCount()).toBe(4)
    prediction.reconcile(car, 0, -1)
    expect(prediction.getState()).toEqual(expected)
  })

  it('corrects physical error immediately but moves the visible correction over 100 ms', () => {
    const { prediction, car } = setup()
    const before = prediction.getVisualState().renderPosition
    car.position.x += 1
    prediction.reconcile(car, 0, 0)
    expect(prediction.getState().position.x).toBe(car.position.x)
    expect(prediction.getVisualState().renderPosition.x).toBe(before.x)
    prediction.advance(0.05)
    expect(prediction.getVisualState().renderPosition.x - prediction.getState().position.x).toBeCloseTo(-0.5)
    prediction.advance(0.05)
    expect(prediction.getVisualState().renderPosition.x).toBeCloseTo(prediction.getState().position.x)
  })

  it('does not start visual smoothing below the 10 cm threshold', () => {
    const { prediction, car } = setup()
    car.position.x += 0.05
    prediction.reconcile(car, 0, 0)
    expect(prediction.getVisualState().renderPosition).toEqual(prediction.getState().position)
  })

  it('limits speculative work and resets history on resynchronization', () => {
    const { prediction, car } = setup()
    prediction.setInput(1, { throttle: 1, brake: 0, steer: 0 })
    for (let i=0; i<60; i++) prediction.advance(0.1)
    expect(prediction.getPendingStepCount()).toBe(120)
    prediction.reconcile(car, 0, 1, true)
    expect(prediction.getPendingStepCount()).toBe(0)
  })

  it('keeps the new restoration API unavailable to solo/local lifecycle', () => {
    const { car } = setup()
    const engine = new RaceEngine({ track: SHORT_TRACK, mode: 'solo', racers: [car] })
    expect(() => engine.restorePrediction(car, 0)).toThrow()
    expect(() => new RaceEngine({ track: SHORT_TRACK, mode: 'solo', racers: [car, { ...car, id:'another' }], prediction: true })).toThrow()
  })
})

describe('remote snapshot interpolation', () => {
  it('uses the two frames around now minus 100 ms, including wrapped angles', () => {
    const buffer = new RemoteSnapshotBuffer()
    const car = snapshotVehicle(onlineFrame().cars[0])
    for (let i=0; i<6; i++) buffer.push({ time: i*50, cars: [{ ...car, position: {x:i*10,y:0}, angle: i < 3 ? 3.1 : -3.1 }] })
    const sample = buffer.sample(225)[0]
    expect(sample.renderPosition.x).toBeCloseTo(25)
    expect(Math.abs(sample.renderAngle)).toBeCloseTo(Math.PI)
    expect(sample.renderPosition.x).not.toBe(50)
  })

  it('clamps packet gaps and bounds history instead of extrapolating remote collisions', () => {
    const buffer = new RemoteSnapshotBuffer()
    const car = snapshotVehicle(onlineFrame().cars[0])
    for (let i=0; i<40; i++) buffer.push({ time: i*50, cars: [{ ...car, position:{x:i,y:0} }] })
    expect(buffer.getSize()).toBe(MAX_REMOTE_SNAPSHOTS)
    expect(buffer.push({ time: 50, cars:[car] })).toBe(false)
    expect(buffer.sample(10000)[0].renderPosition.x).toBe(39)
  })
})
