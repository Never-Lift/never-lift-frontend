import {
  CONTROL_RAMP_RATES,
  VEHICLE_DYNAMICS,
} from '@/race/constants'
import { clamp } from '@/race/math'
import { moveTowards } from '@/race/physics-utils'
import type {
  DriverInput,
  VehiclePhysicsState,
} from '@/race/types'

export function updateAppliedControls(
  state: VehiclePhysicsState,
  rawInput: DriverInput,
  steeringPull: number,
  controlsDisabled: boolean,
  deltaSeconds: number,
) {
  const throttleTarget = controlsDisabled
    ? 0
    : clamp(rawInput.throttle, 0, 1)
  const brakeTarget = controlsDisabled ? 0 : clamp(rawInput.brake, 0, 1)
  const steerTarget = controlsDisabled
    ? 0
    : clamp(rawInput.steer + steeringPull, -1, 1) *
      VEHICLE_DYNAMICS.maximumSteeringAngleRadians

  state.appliedThrottle = moveTowards(
    state.appliedThrottle,
    throttleTarget,
    (throttleTarget > state.appliedThrottle
      ? CONTROL_RAMP_RATES.throttleRisePerSecond
      : CONTROL_RAMP_RATES.throttleFallPerSecond) * deltaSeconds,
  )
  state.appliedBrake = moveTowards(
    state.appliedBrake,
    brakeTarget,
    (brakeTarget > state.appliedBrake
      ? CONTROL_RAMP_RATES.brakeRisePerSecond
      : CONTROL_RAMP_RATES.brakeFallPerSecond) * deltaSeconds,
  )
  const returningSteering =
    Math.abs(steerTarget) < Math.abs(state.steeringAngle)
  state.steeringAngle = moveTowards(
    state.steeringAngle,
    steerTarget,
    (returningSteering
      ? CONTROL_RAMP_RATES.steeringReturnRadiansPerSecond
      : CONTROL_RAMP_RATES.steeringActuationRadiansPerSecond) * deltaSeconds,
  )
}
