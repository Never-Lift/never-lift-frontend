import { POWERTRAIN, VEHICLE_DYNAMICS } from '@/race/constants'
import { clamp } from '@/race/math'
import type { VehiclePhysicsState } from '@/race/types'

const RADIANS_PER_SECOND_TO_RPM = 60 / (Math.PI * 2)

export type PowertrainOutput = {
  driveTorqueAtWheelsNewtonMeters: number
}

export type EngineOutputMultipliers = {
  torque: number
  power: number
}

function engineTorqueAtRpm(
  engineRpm: number,
  multipliers: EngineOutputMultipliers,
) {
  const angularSpeed = engineRpm / RADIANS_PER_SECOND_TO_RPM
  return Math.min(
    POWERTRAIN.maximumTorqueNewtonMeters * multipliers.torque,
    POWERTRAIN.maximumPowerWatts * multipliers.power / angularSpeed,
  )
}

function coupledEngineRpm(
  wheelAngularSpeed: number,
  ratio: number,
) {
  return Math.max(
    POWERTRAIN.idleRpm,
    Math.abs(wheelAngularSpeed) *
      ratio *
      POWERTRAIN.finalDriveRatio *
      RADIANS_PER_SECOND_TO_RPM,
  )
}

function engineRpmForGear(wheelAngularSpeed: number, gear: number) {
  return coupledEngineRpm(
    wheelAngularSpeed,
    POWERTRAIN.forwardGearRatios[gear - 1],
  )
}

function roadCoupledEngineRpm(state: VehiclePhysicsState, gear: number) {
  return engineRpmForGear(
    state.longitudinalSpeed / VEHICLE_DYNAMICS.wheelRadiusMeters,
    gear,
  )
}

/** Automatic eight-speed rear-wheel-drive powertrain. */
export function updateAutomaticPowertrain(
  state: VehiclePhysicsState,
  engineOutputMultipliers: EngineOutputMultipliers,
  deltaSeconds: number,
): PowertrainOutput {
  state.gear = clamp(
    Math.round(state.gear || 1),
    1,
    POWERTRAIN.forwardGearRatios.length,
  )
  const uncappedEngineRpm = engineRpmForGear(
    state.rearWheelAngularSpeed,
    state.gear,
  )
  state.engineRpm = clamp(
    uncappedEngineRpm,
    POWERTRAIN.idleRpm,
    POWERTRAIN.redlineRpm,
  )
  state.gearShiftTimeRemaining = Math.max(
    0,
    state.gearShiftTimeRemaining - deltaSeconds,
  )

  if (state.gearShiftTimeRemaining <= 0) {
    let nextGear = state.gear
    if (
      uncappedEngineRpm >= POWERTRAIN.upshiftRpm &&
      roadCoupledEngineRpm(state, state.gear) >=
        POWERTRAIN.upshiftRpm /
          (1 + POWERTRAIN.automaticUpshiftWheelSlipAllowance) &&
      state.gear < POWERTRAIN.forwardGearRatios.length
    ) {
      nextGear += 1
    } else if (
      roadCoupledEngineRpm(state, state.gear) <= POWERTRAIN.downshiftRpm &&
      state.gear > 1
    ) {
      nextGear -= 1
    }
    if (nextGear !== state.gear) {
      state.gear = nextGear
      state.gearShiftTimeRemaining = POWERTRAIN.gearShiftDurationSeconds
      state.engineRpm = clamp(
        engineRpmForGear(state.rearWheelAngularSpeed, state.gear),
        POWERTRAIN.idleRpm,
        POWERTRAIN.redlineRpm,
      )
    }
  }

  if (
    state.gearShiftTimeRemaining > 0 ||
    state.appliedThrottle <= 0 ||
    uncappedEngineRpm >= POWERTRAIN.redlineRpm
  ) {
    return {
      driveTorqueAtWheelsNewtonMeters: 0,
    }
  }

  const gearRatio = POWERTRAIN.forwardGearRatios[state.gear - 1]
  const driveTorqueAtWheels =
    engineTorqueAtRpm(state.engineRpm, engineOutputMultipliers) *
    gearRatio *
    POWERTRAIN.finalDriveRatio *
    POWERTRAIN.drivetrainEfficiency *
    state.appliedThrottle
  return {
    driveTorqueAtWheelsNewtonMeters: driveTorqueAtWheels,
  }
}

export function updateReversePowertrain(
  state: VehiclePhysicsState,
  engineOutputMultipliers: EngineOutputMultipliers,
): PowertrainOutput {
  state.gear = -1
  state.gearShiftTimeRemaining = 0
  const uncappedEngineRpm = coupledEngineRpm(
    state.rearWheelAngularSpeed,
    POWERTRAIN.reverseGearRatio,
  )
  state.engineRpm = clamp(
    uncappedEngineRpm,
    POWERTRAIN.idleRpm,
    POWERTRAIN.redlineRpm,
  )
  if (uncappedEngineRpm >= POWERTRAIN.redlineRpm) {
    return { driveTorqueAtWheelsNewtonMeters: 0 }
  }
  const driveTorqueAtWheels =
    -engineTorqueAtRpm(state.engineRpm, engineOutputMultipliers) *
    POWERTRAIN.reverseGearRatio *
    POWERTRAIN.finalDriveRatio *
    POWERTRAIN.drivetrainEfficiency *
    state.appliedBrake
  return { driveTorqueAtWheelsNewtonMeters: driveTorqueAtWheels }
}
