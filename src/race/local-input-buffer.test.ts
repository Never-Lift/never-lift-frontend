import { describe, expect, it, vi } from 'vitest'
import { LocalInputBuffer } from './LocalInputBuffer'
import { KeyboardControls } from './KeyboardControls'
import { LocalWorkerSimulation } from './LocalWorkerSimulation'
import { SHORT_TRACK } from '@/test/track-fixtures'
import { PHYSICS_STEP_SECONDS as STEP } from './constants'
import type { DriverInput } from './types'

const neutral = { throttle: 0, brake: 0, steer: 0 }
const pressed = { throttle: 0, brake: 0, steer: 1 }

describe('lossless local input edges', () => {
  it('delivers a short press then release even when both precede the next tick', () => {
    const buffer = new LocalInputBuffer()
    buffer.enqueue({ p1: pressed })
    buffer.enqueue({ p1: neutral })
    const steps: { seconds: number; input: DriverInput }[] = []
    buffer.advance(STEP * 3, (seconds, inputs) => steps.push({ seconds, input: { ...inputs.p1 } }))
    expect(steps.map(step => step.input)).toEqual([pressed, neutral])
    expect(steps[0].seconds).toBeCloseTo(STEP, 14)
    expect(steps[1].seconds).toBeCloseTo(STEP * 2, 14)
  })

  it('does not turn repeated samples into latency or serialize two players', () => {
    const buffer = new LocalInputBuffer()
    for (let i = 0; i < 1000; i++) buffer.enqueue({ p1: pressed, p2: { ...pressed, steer: -1 } })
    buffer.enqueue({ p1: neutral, p2: neutral })
    const simulate = vi.fn()
    buffer.advance(STEP, (seconds, inputs) => simulate(seconds, structuredClone(inputs)))
    buffer.advance(STEP, (seconds, inputs) => simulate(seconds, structuredClone(inputs)))
    expect(simulate).toHaveBeenNthCalledWith(1, STEP, { p1: pressed, p2: { ...pressed, steer: -1 } })
    expect(simulate).toHaveBeenNthCalledWith(2, STEP, { p1: neutral, p2: neutral })
  })

  it('holds each edge for one physics tick across fractional wake-ups', () => {
    const buffer = new LocalInputBuffer()
    buffer.enqueue({ p1: pressed })
    buffer.enqueue({ p1: neutral })
    let pressSeconds = 0
    for (let i = 0; i < 100; i++) buffer.advance(0.001, (seconds, inputs) => {
      if (inputs.p1.steer) pressSeconds += seconds
    })
    expect(pressSeconds).toBeCloseTo(STEP, 12)
  })

  it('clears pending taps on pause and rejects overflow explicitly', () => {
    const buffer = new LocalInputBuffer()
    buffer.enqueue({ p1: pressed })
    buffer.clear()
    const simulate = vi.fn()
    buffer.advance(STEP, simulate)
    expect(simulate).toHaveBeenCalledWith(STEP, {})
    for (let i = 0; i < 256; i++) buffer.enqueue({ p1: i % 2 ? neutral : pressed })
    expect(() => buffer.enqueue({ p1: pressed })).toThrow('Local input queue overflow')
  })

  it.each(['wasd', 'arrows', 'ijkl'] as const)('forwards %s edges without waiting for RAF; clears on blur', scheme => {
    let controls: KeyboardControls
    const states: DriverInput[] = []
    controls = new KeyboardControls(window, () => states.push(controls.getInput(scheme)))
    const code = { wasd: 'KeyA', arrows: 'ArrowLeft', ijkl: 'KeyJ' }[scheme]
    const down = new KeyboardEvent('keydown', { code, cancelable: true })
    window.dispatchEvent(down)
    window.dispatchEvent(new KeyboardEvent('keydown', { code, repeat: true }))
    window.dispatchEvent(new KeyboardEvent('keyup', { code }))
    expect(down.defaultPrevented).toBe(true)
    expect(states).toEqual([pressed, neutral])
    window.dispatchEvent(new KeyboardEvent('keydown', { code }))
    window.dispatchEvent(new Event('blur'))
    expect(states.at(-1)).toEqual(neutral)
    controls.destroy()
    window.dispatchEvent(new KeyboardEvent('keydown', { code }))
    expect(states).toHaveLength(4)
  })

  it('applies a queued tap to the real engine without bots and does not retain it after pausing', () => {
    const simulation = new LocalWorkerSimulation({ track: SHORT_TRACK, mode: 'solo', racers: [
      { id: 'p1', name: 'P1', kind: 'human', color: '#ffffff' },
    ] }, ['p1'], 0)
    for (let tick = 1; tick <= 840; tick++) simulation.tick(tick * 1000 / 120)
    simulation.enqueueInputs({ p1: pressed })
    simulation.enqueueInputs({ p1: neutral })
    const apply = vi.spyOn(simulation.engine, 'setInput')
    simulation.tick(7010)
    expect(apply).toHaveBeenCalledWith('p1', pressed)
    simulation.tick(7020)
    expect(apply).toHaveBeenLastCalledWith('p1', neutral)
    simulation.enqueueInputs({ p1: pressed })
    simulation.setPaused(true, 7020)
    simulation.enqueueInputs({ p1: pressed })
    simulation.setPaused(false, 8000)
    simulation.tick(8010)
    expect(apply).toHaveBeenLastCalledWith('p1', neutral)
  })
})
