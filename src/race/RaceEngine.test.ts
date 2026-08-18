import { describe, expect, it } from 'vitest'

import { resolveVehicleCollision } from '@/race/collision'
import { PHYSICS_STEP_SECONDS } from '@/race/constants'
import { clamp, signedAngleDelta } from '@/race/math'
import { RaceEngine } from '@/race/RaceEngine'
import {
  getBarrierContacts,
  getCenterlinePoint,
  getTrackAngle,
} from '@/race/test-oval'
import type {
  DriverInput,
  HandlingMode,
  SurfaceId,
  VehicleProfileId,
  VehicleSetup,
  VehicleState,
} from '@/race/types'
import {
  applyBarrierResponse,
  integrateVehicle,
  recordCosmeticImpact,
} from '@/race/vehicle-physics'

function setup(id: string, kind: VehicleSetup['kind'] = 'human'): VehicleSetup {
  return {
    id,
    name: id,
    kind,
    profileId: 'formula',
    color: '#2d7dff',
    handlingMode: 'normal',
  }
}

function vehicle(
  id: string,
  options: {
    profileId?: VehicleProfileId
    handlingMode?: HandlingMode
    x?: number
    y?: number
    velocityX?: number
    velocityY?: number
    angle?: number
  } = {},
): VehicleState {
  const position = { x: options.x ?? 0, y: options.y ?? 0 }
  return {
    ...setup(id),
    profileId: options.profileId ?? 'formula',
    handlingMode: options.handlingMode ?? 'normal',
    position,
    previousPosition: { ...position },
    velocity: {
      x: options.velocityX ?? 0,
      y: options.velocityY ?? 0,
    },
    angle: options.angle ?? 0,
    previousAngle: options.angle ?? 0,
    yawRate: 0,
    surface: 'asphalt',
    damage: { kind: 'none', points: 0, lastImpactSpeed: 0 },
    progressRadians: 0,
    previousTrackAngle: 0,
    currentLap: 1,
    lapStartedAtSeconds: 0,
    bestLapTimeSeconds: null,
    finished: false,
    finishTimeSeconds: null,
  }
}

function runAtFrameRate(framesPerSecond: number) {
  const engine = new RaceEngine({
    mode: 'local',
    racers: [setup('player-1'), setup('player-2')],
    maximumRaceSeconds: 120,
  })
  const input: DriverInput = {
    throttle: 0.82,
    brake: 0,
    steer: 0.18,
    handlingMode: 'normal',
  }
  engine.setInput('player-1', input)
  const seconds = 6
  for (let frame = 0; frame < framesPerSecond * seconds; frame += 1) {
    engine.advanceFrame(1 / framesPerSecond)
  }
  return engine.getVehicleState('player-1')
}

function integrateFor(
  state: VehicleState,
  input: DriverInput,
  surface: SurfaceId,
  steps: number,
) {
  for (let step = 0; step < steps; step += 1) {
    integrateVehicle(state, input, surface, PHYSICS_STEP_SECONDS)
  }
  return state
}

function automaticInput(state: VehicleState): DriverInput {
  const trackAngle = getTrackAngle(state.position)
  const target = getCenterlinePoint(trackAngle + 0.18)
  const desiredHeading = Math.atan2(
    target.y - state.position.y,
    target.x - state.position.x,
  )
  const headingError = signedAngleDelta(state.angle, desiredHeading)
  const speed = Math.hypot(state.velocity.x, state.velocity.y)
  const brake = Math.abs(headingError) > 0.75 && speed > 32
  return {
    throttle: brake ? 0.15 : 0.9,
    brake: brake ? 0.6 : 0,
    steer: clamp(headingError / 0.58, -1, 1),
    handlingMode: state.handlingMode,
  }
}

describe('RaceEngine fixed-step simulation', () => {
  it('produces the same physical state at 30, 60 and 120 FPS', () => {
    const at30 = runAtFrameRate(30)
    const at60 = runAtFrameRate(60)
    const at120 = runAtFrameRate(120)

    expect(at30).not.toBeNull()
    for (const state of [at60, at120]) {
      expect(state?.position.x).toBeCloseTo(at30?.position.x ?? 0, 6)
      expect(state?.position.y).toBeCloseTo(at30?.position.y ?? 0, 6)
      expect(state?.velocity.x).toBeCloseTo(at30?.velocity.x ?? 0, 6)
      expect(state?.velocity.y).toBeCloseTo(at30?.velocity.y ?? 0, 6)
      expect(state?.angle).toBeCloseTo(at30?.angle ?? 0, 6)
    }
  })

  it('exposes interpolation between the previous and current fixed ticks', () => {
    const engine = new RaceEngine({
      mode: 'local',
      racers: [setup('player-1'), setup('player-2')],
    })
    engine.setInput('player-1', {
      throttle: 1,
      brake: 0,
      steer: 0,
      handlingMode: 'normal',
    })
    engine.advanceFrame(PHYSICS_STEP_SECONDS * 1.5)

    expect(engine.getInterpolationAlpha()).toBeCloseTo(0.5, 6)
    const physical = engine.getVehicleState('player-1')
    const rendered = engine
      .getInterpolatedVehicles()
      .find((candidate) => candidate.id === 'player-1')
    expect(rendered?.renderPosition.y).toBeGreaterThanOrEqual(
      physical?.previousPosition.y ?? 0,
    )
    expect(rendered?.renderPosition.y).toBeLessThanOrEqual(
      physical?.position.y ?? 0,
    )
  })

  it.each(['solo', 'local'] as const)(
    'runs a %s race from start to classified results',
    (mode) => {
      const racers =
        mode === 'solo'
          ? [setup('player-1'), setup('bot-1', 'bot'), setup('bot-2', 'bot')]
          : [setup('player-1'), setup('player-2')]
      const engine = new RaceEngine({
        mode,
        racers,
        lapCount: 1,
        maximumRaceSeconds: 60,
      })

      for (let frame = 0; frame < 60 * 60 && engine.getStatus() !== 'finished'; frame += 1) {
        for (const racerId of mode === 'solo'
          ? ['player-1']
          : ['player-1', 'player-2']) {
          const state = engine.getVehicleState(racerId)
          if (state) engine.setInput(racerId, automaticInput(state))
        }
        engine.advanceFrame(1 / 60)
      }

      expect(engine.getStatus()).toBe('finished')
      const results = engine.getResults()
      expect(results).toHaveLength(racers.length)
      expect(results.map((result) => result.position)).toEqual(
        racers.map((_, index) => index + 1),
      )
      expect(
        results.find((result) => result.racerId === 'player-1')?.finished,
      ).toBe(true)
      expect(
        results.find((result) => result.racerId === 'player-1')?.totalTimeMs,
      ).toBeGreaterThan(0)
      if (mode === 'local') {
        expect(
          results.find((result) => result.racerId === 'player-2')?.finished,
        ).toBe(true)
      }
    },
  )
})

describe('canonical vehicle physics', () => {
  const accelerating: DriverInput = {
    throttle: 1,
    brake: 0,
    steer: 0,
    handlingMode: 'normal',
  }

  it('accelerates less and loses more speed on grass than on asphalt', () => {
    const asphalt = integrateFor(
      vehicle('asphalt', { velocityX: 35 }),
      accelerating,
      'asphalt',
      120,
    )
    const grass = integrateFor(
      vehicle('grass', { velocityX: 35 }),
      accelerating,
      'grass',
      120,
    )

    expect(grass.velocity.x).toBeLessThan(asphalt.velocity.x)
    expect(grass.surface).toBe('grass')
  })

  it('retains more lateral slip in drift mode than normal mode', () => {
    const input: DriverInput = {
      throttle: 0.6,
      brake: 0,
      steer: 0,
      handlingMode: 'normal',
    }
    const normal = integrateFor(
      vehicle('normal', {
        profileId: 'drift',
        velocityX: 25,
        velocityY: 8,
      }),
      input,
      'asphalt',
      45,
    )
    const drift = integrateFor(
      vehicle('drift', {
        profileId: 'drift',
        handlingMode: 'drift',
        velocityX: 25,
        velocityY: 8,
      }),
      { ...input, handlingMode: 'drift' },
      'asphalt',
      45,
    )

    expect(Math.abs(drift.velocity.y)).toBeGreaterThan(
      Math.abs(normal.velocity.y),
    )
  })
})

describe('collisions and v1 cosmetic damage', () => {
  it('separates colliding cars, applies impulse and classifies the impact', () => {
    const first = vehicle('first', { x: -0.5, velocityX: 18 })
    const second = vehicle('second', { x: 0.5, velocityX: -18 })

    expect(resolveVehicleCollision(first, second)).toBe(true)
    expect(first.velocity.x).toBeLessThan(18)
    expect(second.velocity.x).toBeGreaterThan(-18)
    expect(first.damage.kind).toBe('total-loss')
    expect(second.damage.kind).toBe('total-loss')
    expect(second.position.x - first.position.x).toBeGreaterThan(1)
  })

  it('keeps total-loss cosmetic and does not disable acceleration in contract v1', () => {
    const state = vehicle('damaged')
    recordCosmeticImpact(state, { x: -1, y: 0 }, 30)
    expect(state.damage.kind).toBe('total-loss')

    integrateFor(
      state,
      {
        throttle: 1,
        brake: 0,
        steer: 0,
        handlingMode: 'normal',
      },
      'asphalt',
      60,
    )
    expect(state.velocity.x).toBeGreaterThan(0)
  })

  it('pushes a car out of the outer barrier and reflects its velocity', () => {
    const state = vehicle('barrier', { x: 70.5, velocityX: 24 })
    const [contact] = getBarrierContacts(state.position, 1.24)
    expect(contact).toBeDefined()
    if (!contact) return

    applyBarrierResponse(state, contact.pushNormal, contact.penetrationMeters)

    expect(state.position.x).toBeLessThan(70.5)
    expect(state.velocity.x).toBeLessThanOrEqual(0)
    expect(state.damage.kind).not.toBe('none')
  })
})
