import { describe, expect, it } from 'vitest'

import {
  resolveVehicleAgainstStaticColliders,
  resolveVehicleCollision,
} from '@/race/collision'
import {
  PHYSICS_CONSTANTS,
  PHYSICS_STEP_SECONDS,
  VEHICLE_DYNAMICS,
} from '@/race/constants'
import { clamp, signedAngleDelta } from '@/race/math'
import { RaceEngine } from '@/race/RaceEngine'
import { TrackGeometry } from '@/race/TrackGeometry'
import type {
  DriverInput,
  SurfaceId,
  VehicleSetup,
  VehicleState,
} from '@/race/types'
import {
  createInitialVehiclePhysicsState,
  integrateVehicle,
  recordImpactDamage,
} from '@/race/vehicle-physics'
import { LONG_TRACK, SHORT_TRACK } from '@/test/track-fixtures'

const TRACK_GEOMETRY = new TrackGeometry(SHORT_TRACK)

function setup(id: string, kind: VehicleSetup['kind'] = 'human'): VehicleSetup {
  return {
    id,
    name: id,
    kind,
    color: '#2d7dff',
  }
}

function vehicle(
  id: string,
  options: {
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
    position,
    previousPosition: { ...position },
    velocity: {
      x: options.velocityX ?? 0,
      y: options.velocityY ?? 0,
    },
    angle: options.angle ?? 0,
    previousAngle: options.angle ?? 0,
    yawRate: 0,
    physicsState: createInitialVehiclePhysicsState(),
    surface: 'asphalt',
    trackLayer: 0,
    trackDistanceMeters: 0,
    damage: {
      kind: 'none',
      health: PHYSICS_CONSTANTS.damage.thresholds.maximumHealth,
      engineDamaged: false,
      steeringDamaged: false,
      steeringPull: 0,
      impactCount: 0,
      lastImpactSpeed: 0,
    },
    nextCheckpointIndex: 0,
    lapProgressMeters: 0,
    totalProgressMeters: 0,
    currentLap: 1,
    lapStartedAtSeconds: 0,
    bestLapTimeSeconds: null,
    finished: false,
    finishTimeSeconds: null,
  }
}

function runAtFrameRate(framesPerSecond: number) {
  const engine = new RaceEngine({
    track: SHORT_TRACK,
    mode: 'local',
    racers: [setup('player-1'), setup('player-2')],
    maximumRaceSeconds: 120,
  })
  const input: DriverInput = {
    throttle: 0.82,
    brake: 0,
    steer: 0.18,
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
  const projection = TRACK_GEOMETRY.project(state.position)
  const target = TRACK_GEOMETRY.getRacingLinePoint(
    projection.distanceMeters + 28,
  )
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
  }
}

function trackInput(state: VehicleState, geometry: TrackGeometry): DriverInput {
  const projection = geometry.project(state.position)
  const speed = Math.hypot(state.velocity.x, state.velocity.y)
  const target = geometry.getRacingLinePoint(
    projection.distanceMeters + 26 + speed * 0.5,
  )
  const desiredHeading = Math.atan2(
    target.y - state.position.y,
    target.x - state.position.x,
  )
  const headingError = signedAngleDelta(state.angle, desiredHeading)
  const targetSpeed = 94 * target.targetSpeedFactor
  const shouldBrake = speed > targetSpeed || Math.abs(headingError) > 0.8
  return {
    throttle: shouldBrake ? 0.1 : 1,
    brake: shouldBrake ? 0.5 : 0,
    steer: clamp(headingError / 0.55, -1, 1),
  }
}

describe('RaceEngine fixed-step simulation', () => {
  it('derives the default race timeout from the published v2 contract', () => {
    const lapCount = 3
    const durationTrack = structuredClone(SHORT_TRACK)
    durationTrack.lengthMeters =
      PHYSICS_CONSTANTS.race.minimumRaceDurationSeconds *
      PHYSICS_CONSTANTS.race.raceDurationReferenceSpeedMetersPerSecond *
      2
    const engine = new RaceEngine({
      track: durationTrack,
      mode: 'local',
      racers: [setup('player-1'), setup('player-2')],
      lapCount,
    })

    expect(engine.maximumRaceSeconds).toBe(
      Math.max(
        PHYSICS_CONSTANTS.race.minimumRaceDurationSeconds,
        (durationTrack.lengthMeters * lapCount) /
          PHYSICS_CONSTANTS.race.raceDurationReferenceSpeedMetersPerSecond,
      ),
    )
  })

  it('keeps surface sampling on the current branch at a geometric crossing', () => {
    const crossingTrack = structuredClone(SHORT_TRACK)
    crossingTrack.lengthMeters = 120
    crossingTrack.centerline = [
      {
        x: -10,
        y: 0,
        distanceMeters: 0,
        halfWidthMeters: 1,
        elevationLayer: 0,
      },
      {
        x: 10,
        y: 0,
        distanceMeters: 20,
        halfWidthMeters: 1,
        elevationLayer: 0,
      },
      {
        x: 10,
        y: 20,
        distanceMeters: 40,
        halfWidthMeters: 1,
        elevationLayer: 0,
      },
      {
        x: 0,
        y: 20,
        distanceMeters: 50,
        halfWidthMeters: 1,
        elevationLayer: 1,
      },
      {
        x: 0,
        y: -20,
        distanceMeters: 90,
        halfWidthMeters: 1,
        elevationLayer: 1,
      },
      {
        x: -10,
        y: -20,
        distanceMeters: 100,
        halfWidthMeters: 1,
        elevationLayer: 0,
      },
      {
        x: -10,
        y: 0,
        distanceMeters: 120,
        halfWidthMeters: 1,
        elevationLayer: 0,
      },
    ]
    crossingTrack.racingLine = crossingTrack.centerline.map((point) => ({
      x: point.x,
      y: point.y,
      distanceMeters: point.distanceMeters,
      targetSpeedFactor: 0.8,
    }))
    crossingTrack.gridSlots = [
      { position: { x: 0, y: 2 }, angle: 0 },
      { position: { x: -8, y: 0 }, angle: 0 },
    ]
    crossingTrack.trackLimits.segments = [
      {
        index: 0,
        fromDistanceMeters: 0,
        toDistanceMeters: 40,
        left: {
          zones: [{ surface: 'grass', widthMeters: 2 }],
          barrier: 'guardrail',
        },
        right: { zones: [], barrier: 'guardrail' },
      },
      {
        index: 1,
        fromDistanceMeters: 40,
        toDistanceMeters: 100,
        left: {
          zones: [{ surface: 'asphalt', widthMeters: 10 }],
          barrier: 'guardrail',
        },
        right: {
          zones: [{ surface: 'asphalt', widthMeters: 10 }],
          barrier: 'guardrail',
        },
      },
      {
        index: 2,
        fromDistanceMeters: 100,
        toDistanceMeters: 120,
        left: { zones: [], barrier: 'guardrail' },
        right: { zones: [], barrier: 'guardrail' },
      },
    ]
    crossingTrack.pitLane.path = [
      { x: 100, y: 100 },
      { x: 110, y: 100 },
    ]

    const geometry = new TrackGeometry(crossingTrack)
    const globallyNearest = geometry.project({ x: 0, y: 2 })
    const progressBound = geometry.project(
      { x: 0, y: 2 },
      crossingTrack.lengthMeters - 5,
    )
    expect(globallyNearest.distanceMeters).toBeCloseTo(68)
    expect(globallyNearest.elevationLayer).toBe(1)
    expect(progressBound.distanceMeters).toBeCloseTo(10)
    expect(progressBound.elevationLayer).toBe(0)
    expect(geometry.getEnvironmentAt({ x: 0, y: 2 }, 0).material).toBe(
      'grass',
    )
    const engine = new RaceEngine({
      track: crossingTrack,
      mode: 'local',
      racers: [setup('player-1'), setup('player-2')],
    })
    engine.stepFixed()

    expect(engine.getVehicleState('player-1')?.surface).toBe('grass')

    const layeredEngine = new RaceEngine({
      track: crossingTrack,
      mode: 'local',
      racers: [setup('lower'), setup('upper')],
    })
    const layeredVehicles = (
      layeredEngine as unknown as { vehicles: VehicleState[] }
    ).vehicles
    for (const layeredVehicle of layeredVehicles) {
      layeredVehicle.position = { x: 0, y: 0 }
      layeredVehicle.previousPosition = { x: 0, y: 0 }
    }
    layeredVehicles[0].trackDistanceMeters = 10
    layeredVehicles[1].trackDistanceMeters = 70
    layeredEngine.stepFixed()

    expect(layeredVehicles.map((candidate) => candidate.trackLayer)).toEqual([
      0, 1,
    ])
    expect(layeredVehicles[0].position).toEqual(layeredVehicles[1].position)
  })

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
      track: SHORT_TRACK,
      mode: 'local',
      racers: [setup('player-1'), setup('player-2')],
    })
    engine.setInput('player-1', {
      throttle: 1,
      brake: 0,
      steer: 0,
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
        track: SHORT_TRACK,
        mode,
        racers,
        lapCount: 1,
        maximumRaceSeconds: 60,
      })

      for (let frame = 0; frame < 61 * 60 && engine.getStatus() !== 'finished'; frame += 1) {
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
      const playerOneResult = results.find(
        (result) => result.racerId === 'player-1',
      )
      expect(playerOneResult).toBeDefined()
      if (playerOneResult?.finished) {
        expect(playerOneResult.totalTimeMs).toBeGreaterThan(0)
      } else {
        expect(playerOneResult?.totalTimeMs).toBe(0)
      }
    },
    30_000,
  )

  it('uses the same contracted recovery decision on grass and gravel', () => {
    const engine = new RaceEngine({
      track: SHORT_TRACK,
      mode: 'solo',
      racers: [setup('player-1'), setup('bot-1', 'bot')],
    })
    const bot = engine.getVehicleState('bot-1')
    expect(bot).not.toBeNull()
    if (!bot) return

    const planner = engine as unknown as {
      createBotInput: (state: VehicleState) => DriverInput
    }
    const grassInput = planner.createBotInput({ ...bot, surface: 'grass' })
    const gravelInput = planner.createBotInput({ ...bot, surface: 'gravel' })

    expect(gravelInput).toEqual(grassInput)
  })
})

describe('official-size track completion', () => {
  it.each([
    ['short', SHORT_TRACK],
    ['long', LONG_TRACK],
  ] as const)(
    'completes a %s catalog circuit using ordered directional gates',
    (_, track) => {
      const engine = new RaceEngine({
        track,
        mode: 'solo',
        racers: [setup('player-1'), setup('bot-1', 'bot')],
        lapCount: 1,
        maximumRaceSeconds: 240,
      })
      const geometry = new TrackGeometry(track)

      for (
        let frame = 0;
        frame < 240 * 60 && engine.getStatus() !== 'finished';
        frame += 1
      ) {
        const state = engine.getVehicleState('player-1')
        if (state) engine.setInput('player-1', trackInput(state, geometry))
        engine.advanceFrame(1 / 60)
      }

      const playerResult = engine
        .getResults()
        .find((result) => result.racerId === 'player-1')
      expect(engine.getStatus()).toBe('finished')
      expect(playerResult?.finished).toBe(true)
      expect(playerResult?.totalTimeMs).toBeGreaterThan(0)
    },
    90_000,
  )
})

describe('canonical vehicle physics', () => {
  const accelerating: DriverInput = {
    throttle: 1,
    brake: 0,
    steer: 0,
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

  it('uses identical v2 physics for a human and a bot given the same input', () => {
    const input: DriverInput = {
      throttle: 0.6,
      brake: 0,
      steer: 0,
    }
    const human = integrateFor(
      vehicle('human', {
        velocityX: 25,
        velocityY: 8,
      }),
      input,
      'asphalt',
      45,
    )
    const bot = vehicle('bot', {
      velocityX: 25,
      velocityY: 8,
    })
    bot.kind = 'bot'
    bot.botDifficulty = 'hard'
    integrateFor(bot, input, 'asphalt', 45)

    expect(bot.position).toEqual(human.position)
    expect(bot.velocity).toEqual(human.velocity)
    expect(bot.angle).toBe(human.angle)
    expect(bot.yawRate).toBe(human.yawRate)
    expect(bot.physicsState).toEqual(human.physicsState)
  })
})

describe('collisions and v2 cumulative mechanical damage', () => {
  it('separates colliding cars, applies impulse and classifies the impact', () => {
    const first = vehicle('first', { x: -2.75, velocityX: 18 })
    const second = vehicle('second', {
      x: 2.75,
      velocityX: -18,
      angle: Math.PI,
    })

    expect(resolveVehicleCollision(first, second)).toBe(true)
    expect(first.velocity.x).toBeLessThan(18)
    expect(second.velocity.x).toBeGreaterThan(-18)
    expect(first.damage.kind).toBe('engine-and-steering')
    expect(second.damage.kind).toBe('engine-and-steering')
    expect(first.damage.health).toBeGreaterThan(0)
    expect(second.damage.health).toBeGreaterThan(0)
    expect(second.position.x - first.position.x).toBeGreaterThan(5.5)
  })

  it('modestly reduces rolling acceleration after engine damage', () => {
    const accelerationInput: DriverInput = {
      throttle: 1,
      brake: 0,
      steer: 0,
    }
    const healthy = vehicle('healthy-engine', { velocityX: 60 })
    const damaged = vehicle('damaged-engine', { velocityX: 60 })
    for (const state of [healthy, damaged]) {
      state.physicsState.longitudinalSpeed = 60
      state.physicsState.frontWheelAngularSpeed =
        60 / VEHICLE_DYNAMICS.wheelRadiusMeters
      state.physicsState.rearWheelAngularSpeed =
        60 / VEHICLE_DYNAMICS.wheelRadiusMeters
      state.physicsState.gear = 5
      state.physicsState.engineRpm = 12_000
    }
    recordImpactDamage(damaged, { x: -1, y: 0 }, 12)

    expect(damaged.damage.kind).toBe('engine')
    integrateFor(healthy, accelerationInput, 'asphalt', 240)
    integrateFor(damaged, accelerationInput, 'asphalt', 240)

    expect(damaged.velocity.x).toBeLessThan(healthy.velocity.x)
    expect(damaged.velocity.x).toBeGreaterThan(healthy.velocity.x * 0.9)
  })

  it('ignores low-speed contacts and applies the gentler cumulative damage calibration', () => {
    const state = vehicle('gentler-damage')

    recordImpactDamage(state, { x: -1, y: 0 }, 4.99)

    expect(state.damage.kind).toBe('none')
    expect(state.damage.health).toBe(100)
    expect(state.damage.impactCount).toBe(0)

    recordImpactDamage(state, { x: -1, y: 0 }, 6)

    expect(state.damage.kind).toBe('steering')
    expect(state.damage.health).toBe(91)
    expect(PHYSICS_CONSTANTS.damage.thresholds.totalLossImpactSpeed).toBe(30)
    expect(PHYSICS_CONSTANTS.damage.effects.steeringPullStrength).toBe(0.005)
  })

  it('applies a persistent slight steering pull without removing steering authority', () => {
    const neutralSteeringInput: DriverInput = {
      throttle: 0.4,
      brake: 0,
      steer: 0,
    }
    const healthy = vehicle('healthy-steering', { velocityX: 24 })
    const damaged = vehicle('damaged-steering', { velocityX: 24 })
    recordImpactDamage(damaged, { x: 0, y: 1 }, 6)

    expect(damaged.damage.kind).toBe('steering')
    expect(Math.abs(damaged.damage.steeringPull)).toBe(1)
    integrateFor(healthy, neutralSteeringInput, 'asphalt', 45)
    integrateFor(damaged, neutralSteeringInput, 'asphalt', 45)

    expect(Math.abs(healthy.yawRate)).toBeCloseTo(0, 6)
    expect(Math.abs(damaged.yawRate)).toBeGreaterThan(0)
    expect(Math.abs(damaged.physicsState.steeringAngle)).toBeLessThanOrEqual(
      VEHICLE_DYNAMICS.maximumSteeringAngleRadians * 0.005,
    )

    const longStraight = vehicle('damaged-long-straight', { velocityX: 24 })
    recordImpactDamage(longStraight, { x: 0, y: 1 }, 6)
    integrateFor(longStraight, neutralSteeringInput, 'asphalt', 480)

    expect(Math.abs(longStraight.position.y)).toBeGreaterThan(
      Math.abs(damaged.position.y),
    )

    const healthyWithSteering = vehicle('healthy-full-steering', { velocityX: 24 })
    const damagedWithSteering = vehicle('damaged-full-steering', { velocityX: 24 })
    recordImpactDamage(damagedWithSteering, { x: 0, y: 1 }, 6)
    const fullSteeringInput = { ...neutralSteeringInput, steer: 1 }
    integrateFor(healthyWithSteering, fullSteeringInput, 'asphalt', 45)
    integrateFor(damagedWithSteering, fullSteeringInput, 'asphalt', 45)

    expect(Math.abs(damagedWithSteering.yawRate)).toBeGreaterThan(
      Math.abs(healthyWithSteering.yawRate) * 0.85,
    )
  })

  it('keeps prior damage and combines engine and steering failures', () => {
    const state = vehicle('combined')
    recordImpactDamage(state, { x: 0, y: 1 }, 6)
    const healthAfterWeakImpact = state.damage.health
    recordImpactDamage(state, { x: -1, y: 0 }, 12)

    expect(state.damage.kind).toBe('engine-and-steering')
    expect(state.damage.engineDamaged).toBe(true)
    expect(state.damage.steeringDamaged).toBe(true)
    expect(state.damage.health).toBeLessThan(healthAfterWeakImpact)
  })

  it('classifies a high non-critical impact as combined damage', () => {
    const state = vehicle('high-impact')
    recordImpactDamage(state, { x: -1, y: 0 }, 24)

    expect(state.damage.kind).toBe('engine-and-steering')
    expect(state.damage.health).toBeGreaterThan(0)
  })

  it('turns repeated weak impacts into cumulative total loss', () => {
    const state = vehicle('repeated-weak')
    for (let impact = 0; impact < 12; impact += 1) {
      recordImpactDamage(state, { x: 0, y: 1 }, 6)
    }

    expect(state.damage.kind).toBe('total-loss')
    expect(state.damage.health).toBe(0)
  })

  it('disables driver input and coasts under the contracted total-loss drag', () => {
    const state = vehicle('totaled', { velocityX: 18 })
    recordImpactDamage(state, { x: -1, y: 0 }, 36)

    expect(state.damage.kind).toBe('total-loss')
    integrateFor(
      state,
      {
        throttle: 1,
        brake: 0,
        steer: 1,
      },
      'asphalt',
      120,
    )

    expect(Math.hypot(state.velocity.x, state.velocity.y)).toBeLessThan(6)
    expect(state.angle).toBeCloseTo(0, 6)
  })

  it('stops a swept nose at the canonical wall face and reflects it', () => {
    const state = vehicle('barrier', {
      x: 0.25,
      velocityX: 24,
    })
    state.previousPosition = { x: 0, y: 0 }
    const wall = {
      id: 'canonical-concrete-wall',
      collisionMaterial: 'concrete-wall' as const,
      vertices: [
        { x: 3, y: -10 },
        { x: 3.4, y: -10 },
        { x: 3.4, y: 10 },
        { x: 3, y: 10 },
      ],
    }
    expect(
      resolveVehicleAgainstStaticColliders(
        state,
        PHYSICS_STEP_SECONDS,
        () => [wall],
      ),
    ).toBe(true)

    expect(state.position.x).toBeLessThanOrEqual(0.22)
    expect(state.velocity.x).toBeLessThanOrEqual(0)
    expect(state.damage.kind).not.toBe('none')
  })

  it('uses the published response for each canonical barrier material', () => {
    const reboundSpeed = (
      material: 'concrete-wall' | 'guardrail' | 'tecpro' | 'tyre-barrier',
    ) => {
      const state = vehicle(`barrier-${material}`, {
        x: 0.25,
        velocityX: 24,
      })
      state.previousPosition = { x: 0, y: 0 }
      resolveVehicleAgainstStaticColliders(
        state,
        PHYSICS_STEP_SECONDS,
        () => [
          {
            id: material,
            collisionMaterial: material,
            vertices: [
              { x: 3, y: -10 },
              { x: 3.4, y: -10 },
              { x: 3.4, y: 10 },
              { x: 3, y: 10 },
            ],
          },
        ],
      )
      return Math.abs(Math.min(0, state.velocity.x))
    }

    const tecpro = reboundSpeed('tecpro')
    const concrete = reboundSpeed('concrete-wall')
    const guardrail = reboundSpeed('guardrail')
    const tyreBarrier = reboundSpeed('tyre-barrier')
    expect(tecpro).toBeLessThan(concrete)
    expect(concrete).toBeLessThan(guardrail)
    expect(guardrail).toBeLessThan(tyreBarrier)
  })
})
