import { describe, expect, it } from 'vitest'

import {
  PHYSICS_STEP_SECONDS,
  POWERTRAIN,
  VEHICLE_DYNAMICS,
} from '@/race/constants'
import type {
  DriverInput,
  SurfaceId,
  VehicleState,
} from '@/race/types'
import {
  createInitialVehiclePhysicsState,
  integrateVehicle,
} from '@/race/vehicle-physics'

const NEUTRAL_INPUT: DriverInput = { throttle: 0, brake: 0, steer: 0 }

function createVehicle(
  velocity = { x: 0, y: 0 },
  angle = 0,
): VehicleState {
  return {
    id: 'physics-reference',
    name: 'Physics reference',
    kind: 'human',
    color: '#2d7dff',
    position: { x: 0, y: 0 },
    previousPosition: { x: 0, y: 0 },
    velocity: { ...velocity },
    angle,
    previousAngle: angle,
    yawRate: 0,
    physicsState: createInitialVehiclePhysicsState(),
    surface: 'asphalt',
    trackLayer: 0,
    trackDistanceMeters: 0,
    damage: {
      kind: 'none',
      health: 100,
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

function simulate(
  vehicle: VehicleState,
  seconds: number,
  input: DriverInput,
  surface: SurfaceId = 'asphalt',
) {
  const steps = Math.round(seconds / PHYSICS_STEP_SECONDS)
  for (let step = 0; step < steps; step += 1) {
    integrateVehicle(vehicle, input, surface, PHYSICS_STEP_SECONDS)
  }
  return vehicle
}

function speedMetersPerSecond(vehicle: VehicleState) {
  return Math.hypot(vehicle.velocity.x, vehicle.velocity.y)
}

function initializeRollingWheels(vehicle: VehicleState) {
  const wheelAngularSpeed =
    vehicle.physicsState.longitudinalSpeed === 0
      ? speedMetersPerSecond(vehicle) /
        VEHICLE_DYNAMICS.wheelRadiusMeters
      : vehicle.physicsState.longitudinalSpeed /
        VEHICLE_DYNAMICS.wheelRadiusMeters
  vehicle.physicsState.longitudinalSpeed = vehicle.velocity.x
  vehicle.physicsState.frontWheelAngularSpeed = wheelAngularSpeed
  vehicle.physicsState.rearWheelAngularSpeed = wheelAngularSpeed
  return vehicle
}

function runAtRenderedFrameRate(framesPerSecond: number) {
  const vehicle = createVehicle({ x: 18, y: 0 })
  initializeRollingWheels(vehicle)
  const input = { throttle: 0.78, brake: 0, steer: 0.32 }
  let accumulator = 0
  for (let frame = 0; frame < framesPerSecond * 8; frame += 1) {
    accumulator += 1 / framesPerSecond
    while (accumulator + Number.EPSILON >= PHYSICS_STEP_SECONDS) {
      integrateVehicle(vehicle, input, 'asphalt', PHYSICS_STEP_SECONDS)
      accumulator -= PHYSICS_STEP_SECONDS
    }
  }
  return vehicle
}

describe('F1 v2 longitudinal dynamics', () => {
  it('reaches 100, 200 and 300 km/h in calibrated progressive ranges', () => {
    const vehicle = createVehicle()
    const targets = [100 / 3.6, 200 / 3.6, 300 / 3.6]
    const crossingTimes: number[] = []
    for (let tick = 0; tick < 15 / PHYSICS_STEP_SECONDS; tick += 1) {
      integrateVehicle(
        vehicle,
        { throttle: 1, brake: 0, steer: 0 },
        'asphalt',
        PHYSICS_STEP_SECONDS,
      )
      if (
        crossingTimes.length < targets.length &&
        speedMetersPerSecond(vehicle) >= targets[crossingTimes.length]
      ) {
        crossingTimes.push((tick + 1) * PHYSICS_STEP_SECONDS)
      }
    }

    expect(crossingTimes).toHaveLength(3)
    expect(crossingTimes[0]).toBeGreaterThanOrEqual(2.3)
    expect(crossingTimes[0]).toBeLessThanOrEqual(3.4)
    expect(crossingTimes[1]).toBeGreaterThanOrEqual(4.3)
    expect(crossingTimes[1]).toBeLessThanOrEqual(6.2)
    expect(crossingTimes[2]).toBeGreaterThanOrEqual(8)
    expect(crossingTimes[2]).toBeLessThanOrEqual(11.5)
    expect(vehicle.physicsState.gear).toBeGreaterThan(1)
    expect(vehicle.physicsState.engineRpm).toBeGreaterThanOrEqual(
      POWERTRAIN.idleRpm,
    )
  })

  it('approaches terminal speed through power and drag without a hard cap', () => {
    const accelerating = simulate(
      createVehicle(),
      45,
      { throttle: 1, brake: 0, steer: 0 },
    )
    const terminalKph = speedMetersPerSecond(accelerating) * 3.6
    expect(terminalKph).toBeGreaterThanOrEqual(330)
    expect(terminalKph).toBeLessThanOrEqual(352)

    const aboveReference = initializeRollingWheels(
      createVehicle({ x: 110, y: 0 }),
    )
    integrateVehicle(
      aboveReference,
      NEUTRAL_INPUT,
      'asphalt',
      PHYSICS_STEP_SECONDS,
    )
    expect(speedMetersPerSecond(aboveReference)).toBeGreaterThan(100)
    expect(speedMetersPerSecond(aboveReference)).toBeLessThan(110)
  })

  it('brakes from 320 to 78 km/h with progressive lock and no ABS', () => {
    const vehicle = initializeRollingWheels(
      createVehicle({ x: 320 / 3.6, y: 0 }),
    )
    let brakingTime = 0
    while (speedMetersPerSecond(vehicle) > 78 / 3.6 && brakingTime < 6) {
      integrateVehicle(
        vehicle,
        { throttle: 0, brake: 1, steer: 0 },
        'asphalt',
        PHYSICS_STEP_SECONDS,
      )
      brakingTime += PHYSICS_STEP_SECONDS
    }

    expect(brakingTime).toBeGreaterThanOrEqual(2)
    expect(brakingTime).toBeLessThanOrEqual(4.2)
    expect(vehicle.position.x).toBeGreaterThanOrEqual(100)
    expect(vehicle.position.x).toBeLessThanOrEqual(190)
    const roadWheelAngularSpeed =
      speedMetersPerSecond(vehicle) /
      VEHICLE_DYNAMICS.wheelRadiusMeters
    expect(vehicle.physicsState.frontWheelAngularSpeed).toBeLessThan(
      roadWheelAngularSpeed * 0.65,
    )
  })

  it('spins the driven rear wheels under excessive launch torque', () => {
    const vehicle = simulate(
      createVehicle(),
      0.75,
      { throttle: 1, brake: 0, steer: 0 },
    )
    const roadWheelAngularSpeed =
      speedMetersPerSecond(vehicle) /
      VEHICLE_DYNAMICS.wheelRadiusMeters
    expect(vehicle.physicsState.rearWheelAngularSpeed).toBeGreaterThan(
      roadWheelAngularSpeed * 1.08,
    )
    expect(vehicle.physicsState.rearGripUtilization).toBeGreaterThan(0.9)
  })

  it('uses brake as reverse only after the car is nearly stopped', () => {
    const moving = initializeRollingWheels(createVehicle({ x: 12, y: 0 }))
    simulate(moving, 0.25, { throttle: 0, brake: 1, steer: 0 })
    expect(moving.physicsState.gear).not.toBe(-1)
    expect(moving.velocity.x).toBeGreaterThan(0)

    const stopped = simulate(
      createVehicle(),
      1.2,
      { throttle: 0, brake: 1, steer: 0 },
    )
    expect(stopped.physicsState.gear).toBe(-1)
    expect(stopped.velocity.x).toBeLessThan(0)
  })
})

describe('F1 v2 lateral and combined grip dynamics', () => {
  function corneringVehicle(speed: number) {
    return initializeRollingWheels(createVehicle({ x: speed, y: 0 }))
  }

  it('turns through tire force and yaw inertia instead of rotating directly', () => {
    const vehicle = corneringVehicle(35)
    const initialAngle = vehicle.angle
    integrateVehicle(
      vehicle,
      { throttle: 0.3, brake: 0, steer: 1 },
      'asphalt',
      PHYSICS_STEP_SECONDS,
    )
    expect(vehicle.physicsState.steeringAngle).toBeGreaterThan(0)
    expect(Math.abs(vehicle.angle - initialAngle)).toBeLessThan(0.001)

    simulate(vehicle, 1.2, { throttle: 0.3, brake: 0, steer: 1 })
    expect(vehicle.physicsState.yawRate).toBeGreaterThan(0)
    expect(vehicle.angle).not.toBe(initialAngle)
  })

  it('saturates the front and makes extra steering authority sublinear at speed', () => {
    const halfSteer = simulate(
      corneringVehicle(78),
      1.5,
      { throttle: 0, brake: 0, steer: 0.35 },
    )
    const tooFast = simulate(
      corneringVehicle(78),
      1.5,
      { throttle: 0, brake: 0, steer: 0.7 },
    )

    expect(tooFast.physicsState.frontGripUtilization).toBeGreaterThan(0.98)
    expect(Math.abs(tooFast.physicsState.frontSlipAngle)).toBeGreaterThan(
      Math.abs(halfSteer.physicsState.frontSlipAngle),
    )
    expect(Math.abs(tooFast.physicsState.yawRate)).toBeLessThan(
      Math.abs(halfSteer.physicsState.yawRate) * 2,
    )
  })

  it('shares rear grip between cornering and throttle and permits power oversteer', () => {
    const base = simulate(
      corneringVehicle(42),
      1.5,
      { throttle: 0.35, brake: 0, steer: 0.65 },
    )
    const powered = simulate(
      structuredClone(base),
      1,
      { throttle: 1, brake: 0, steer: 0.65 },
    )
    const balanced = simulate(
      structuredClone(base),
      1,
      { throttle: 0.35, brake: 0, steer: 0.65 },
    )
    expect(powered.physicsState.rearGripUtilization).toBeGreaterThan(0.99)
    expect(Math.abs(powered.physicsState.rearSlipAngle)).toBeGreaterThan(
      Math.abs(balanced.physicsState.rearSlipAngle),
    )
  })

  it('rotates more on lift-off than under balanced throttle', () => {
    const base = simulate(
      corneringVehicle(42),
      1,
      { throttle: 0.35, brake: 0, steer: 0.12 },
    )
    const lifted = simulate(
      structuredClone(base),
      0.6,
      { throttle: 0, brake: 0, steer: 0.12 },
    )
    const balanced = simulate(
      structuredClone(base),
      0.6,
      { throttle: 0.35, brake: 0, steer: 0.12 },
    )
    expect(Math.abs(lifted.physicsState.yawRate)).toBeGreaterThan(
      Math.abs(balanced.physicsState.yawRate),
    )
  })
})

describe('F1 v2 surfaces, ramps and determinism', () => {
  it('applies distinct grip and resistance on every contracted surface', () => {
    const speeds = Object.fromEntries(
      (['asphalt', 'pit-lane', 'curb', 'grass', 'gravel'] as const).map(
        (surface) => {
          const vehicle = initializeRollingWheels(
            createVehicle({ x: 30, y: 0 }),
          )
          simulate(
            vehicle,
            2,
            { throttle: 0.45, brake: 0, steer: 0 },
            surface,
          )
          return [surface, speedMetersPerSecond(vehicle)]
        },
      ),
    )

    expect(speeds.asphalt).toBeGreaterThan(speeds.curb)
    expect(speeds['pit-lane']).toBeGreaterThan(speeds.curb)
    expect(speeds.curb).toBeGreaterThan(speeds.grass)
    expect(speeds.grass).toBeGreaterThan(speeds.gravel)
  })

  it('ramps digital throttle, brake and steering only on fixed ticks', () => {
    const vehicle = createVehicle()
    simulate(
      vehicle,
      0.25,
      { throttle: 1, brake: 1, steer: 1 },
    )
    expect(vehicle.physicsState.appliedThrottle).toBeCloseTo(0.6, 10)
    expect(vehicle.physicsState.appliedBrake).toBeCloseTo(1, 10)
    expect(vehicle.physicsState.steeringAngle).toBeCloseTo(0.55, 10)

    simulate(vehicle, 0.1, NEUTRAL_INPUT)
    expect(vehicle.physicsState.appliedThrottle).toBeCloseTo(0.1, 10)
    expect(vehicle.physicsState.appliedBrake).toBeCloseTo(0.4, 10)
    expect(vehicle.physicsState.steeringAngle).toBeCloseTo(0.1, 10)
  })

  it('produces an identical full physics state at 30, 60 and 120 FPS', () => {
    const at30 = runAtRenderedFrameRate(30)
    const at60 = runAtRenderedFrameRate(60)
    const at120 = runAtRenderedFrameRate(120)

    expect(at60.position).toEqual(at30.position)
    expect(at120.position).toEqual(at30.position)
    expect(at60.velocity).toEqual(at30.velocity)
    expect(at120.velocity).toEqual(at30.velocity)
    expect(at60.angle).toBe(at30.angle)
    expect(at120.angle).toBe(at30.angle)
    expect(at60.physicsState).toEqual(at30.physicsState)
    expect(at120.physicsState).toEqual(at30.physicsState)
  })
})
