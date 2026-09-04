import { describe, expect, it, vi } from 'vitest'
import * as portable from './portable-math'
import { PHYSICS_REFERENCE_SCENARIOS, runPhysicsReferenceScenario } from './physics-reference-runner'

describe('portable-f64-v1 numerical kernel', () => {
  it('retains double-precision accuracy over the physical angle/slip domain', () => {
    for (let i = -2048; i <= 2048; i++) {
      const x = i / 32
      expect(Math.abs(portable.sin(x) - Math.sin(x))).toBeLessThan(1e-13)
      expect(Math.abs(portable.cos(x) - Math.cos(x))).toBeLessThan(1e-13)
      expect(Math.abs(portable.tanh(x) - Math.tanh(x))).toBeLessThan(2e-15)
      expect(portable.sin(-x)).toBe(-portable.sin(x))
      expect(portable.cos(-x)).toBe(portable.cos(x))
    }
  })

  it('handles quadrants, near-zero directions and signed zero', () => {
    const values = [-Infinity, -100, -1, -1e-20, -0, 0, 1e-20, 1, 100, Infinity]
    for (const y of values) for (const x of values) {
      expect(Math.abs(portable.atan2(y, x) - Math.atan2(y, x))).toBeLessThan(1e-15)
    }
    expect(Object.is(portable.atan2(-0, 1), -0)).toBe(true)
    expect(Object.is(portable.sin(-0), -0)).toBe(true)
    expect(Object.is(portable.tanh(-0), -0)).toBe(true)
    expect(portable.atan2(NaN, 1)).toBeNaN()
    expect(portable.sin(Infinity)).toBeNaN()
    expect(portable.hypot(Infinity, NaN)).toBe(Infinity)
    expect(portable.hypot(0, 0)).toBe(0)
  })

  it('computes nonnegative load/speed powers without native pow', () => {
    for (let i = -120; i <= 120; i++) for (const exponent of [0, 0.9, 1.45, -0.5, 2]) {
      const base = 2 ** (i / 8), expected = Math.pow(base, exponent)
      expect(Math.abs(portable.pow(base, exponent) - expected) / expected).toBeLessThan(2e-14)
    }
    expect(portable.pow(0, 0.9)).toBe(0)
    expect(portable.pow(-1, 0.9)).toBeNaN()
    expect(portable.pow(2, 1024)).toBe(Infinity)
    expect(portable.pow(2, -1075)).toBe(0)
  })

  it('runs the real vehicle integrator with all platform transcendental calls disabled', () => {
    const spies = (['sin', 'cos', 'tanh', 'atan2', 'hypot', 'pow'] as const).map(name =>
      vi.spyOn(Math, name).mockImplementation(() => { throw new Error(`Platform Math.${name} entered physics`) }),
    )
    try {
      const scenario = PHYSICS_REFERENCE_SCENARIOS.find(value => value.id === 'power-oversteer-no-tc')!
      const { vehicle } = runPhysicsReferenceScenario(scenario)
      expect(Number.isFinite(vehicle.position.x)).toBe(true)
      expect(Number.isFinite(vehicle.physicsState.engineRpm)).toBe(true)
    } finally { spies.forEach(spy => spy.mockRestore()) }
  })
})
