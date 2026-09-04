import * as PortableMath from '@/race/portable-math'

import {
  DAMAGE_EFFECTS,
  DAMAGE_THRESHOLDS,
  GRAVITY_METERS_PER_SECOND_SQUARED,
  NUMERIC_SPEED_EPSILON_METERS_PER_SECOND,
  POWERTRAIN,
  SURFACE_DYNAMICS,
  TIRE_MODEL,
  VEHICLE_DYNAMICS,
} from '@/race/constants'
import { updateAppliedControls } from '@/race/control-ramp'
import { clamp, dot, magnitude, normalizeSignedAngle } from '@/race/math'
import { bodyAxes, vectorFromBody } from '@/race/physics-utils'
import {
  updateAutomaticPowertrain,
  updateReversePowertrain,
} from '@/race/powertrain'
import {
  computeAxleTireForce,
  computeLongitudinalForceFromSlip,
  computePeakTireForce,
} from '@/race/tire-model'
import type {
  DriverInput,
  SteeringPull,
  SurfaceId,
  VehiclePhysicsState,
  VehicleState,
} from '@/race/types'

export function createInitialVehiclePhysicsState(): VehiclePhysicsState {
  return {
    yawRate: 0,
    steeringAngle: 0,
    appliedThrottle: 0,
    appliedBrake: 0,
    frontWheelAngularSpeed: 0,
    rearWheelAngularSpeed: 0,
    gear: 1,
    engineRpm: POWERTRAIN.idleRpm,
    gearShiftTimeRemaining: 0,
    longitudinalSpeed: 0,
    lateralSpeed: 0,
    longitudinalAcceleration: 0,
    lateralAcceleration: 0,
    frontSlipAngle: 0,
    rearSlipAngle: 0,
    frontGripUtilization: 0,
    rearGripUtilization: 0,
  }
}

export function integrateVehicle(
  vehicle: VehicleState,
  input: DriverInput,
  surfaceId: SurfaceId,
  deltaSeconds: number,
) {
  const isTotalLoss = vehicle.damage.kind === 'total-loss'
  const state = vehicle.physicsState ?? createInitialVehiclePhysicsState()
  vehicle.physicsState = state
  const steeringPull = vehicle.damage.steeringDamaged
    ? vehicle.damage.steeringPull * DAMAGE_EFFECTS.steeringPullStrength
    : 0
  updateAppliedControls(
    state,
    input,
    steeringPull,
    isTotalLoss,
    deltaSeconds,
  )

  const { forward, left } = bodyAxes(vehicle.angle)
  const longitudinalSpeed = dot(vehicle.velocity, forward)
  const lateralSpeed = dot(vehicle.velocity, left)
  const previousLongitudinalAcceleration = state.longitudinalAcceleration
  const absoluteSpeed = magnitude(vehicle.velocity)
  state.longitudinalSpeed = longitudinalSpeed
  state.lateralSpeed = lateralSpeed

  const engineOutputMultipliers = vehicle.damage.engineDamaged
    ? {
        torque: DAMAGE_EFFECTS.engineTorqueMultiplier,
        power: DAMAGE_EFFECTS.enginePowerMultiplier,
      }
    : { torque: 1, power: 1 }
  const reverseInputRequested =
    state.appliedBrake > POWERTRAIN.reverseInputThreshold &&
    state.appliedThrottle < POWERTRAIN.reverseInputThreshold
  const reversing =
    reverseInputRequested &&
    (state.gear === -1 ||
      Math.abs(longitudinalSpeed) <
        POWERTRAIN.reverseEngageSpeedMetersPerSecond)
  const powertrain = reversing
    ? updateReversePowertrain(state, engineOutputMultipliers)
    : updateAutomaticPowertrain(
        state,
        engineOutputMultipliers,
        deltaSeconds,
      )

  const aerodynamicPressure =
    0.5 *
    VEHICLE_DYNAMICS.airDensityKgPerCubicMeter *
    absoluteSpeed *
    absoluteSpeed
  const aerodynamicDrag =
    aerodynamicPressure *
    VEHICLE_DYNAMICS.frontalAerodynamicAreaCoefficient *
    (isTotalLoss ? VEHICLE_DYNAMICS.totalLossDragMultiplier : 1)
  const totalDownforce =
    aerodynamicPressure * VEHICLE_DYNAMICS.downforceAreaCoefficient
  const brakeDemand = reversing
    ? 0
    : state.appliedBrake * POWERTRAIN.maximumBrakeForceNewtons
  const rollingResistance =
    VEHICLE_DYNAMICS.rollingResistanceCoefficient *
    VEHICLE_DYNAMICS.massKg *
    GRAVITY_METERS_PER_SECOND_SQUARED *
    SURFACE_DYNAMICS[surfaceId].rollingResistanceMultiplier
  const roughnessResistance =
    SURFACE_DYNAMICS[surfaceId].roughnessDragNewtonSecondsPerMeter *
    Math.abs(longitudinalSpeed)
  const totalLossLongitudinalResistance = isTotalLoss
    ? DAMAGE_EFFECTS.totalLossLinearDragNewtonSecondsPerMeter *
      longitudinalSpeed
    : 0
  const totalLossLateralResistance = isTotalLoss
    ? DAMAGE_EFFECTS.totalLossLinearDragNewtonSecondsPerMeter * lateralSpeed
    : 0
  const longitudinalResistance =
    Math.abs(longitudinalSpeed) >
    NUMERIC_SPEED_EPSILON_METERS_PER_SECOND
      ? Math.sign(longitudinalSpeed) *
        (rollingResistance + roughnessResistance)
      : 0
  const aerodynamicLongitudinalResistance =
    absoluteSpeed > NUMERIC_SPEED_EPSILON_METERS_PER_SECOND
      ? aerodynamicDrag * longitudinalSpeed / absoluteSpeed
      : 0
  const aerodynamicLateralResistance =
    absoluteSpeed > NUMERIC_SPEED_EPSILON_METERS_PER_SECOND
      ? aerodynamicDrag * lateralSpeed / absoluteSpeed
      : 0

  const weight =
    VEHICLE_DYNAMICS.massKg * GRAVITY_METERS_PER_SECOND_SQUARED
  const staticFrontLoad =
    weight *
    VEHICLE_DYNAMICS.centerOfMassToRearAxleMeters /
    VEHICLE_DYNAMICS.wheelbaseMeters
  const staticRearLoad = weight - staticFrontLoad
  const longitudinalLoadTransfer =
    VEHICLE_DYNAMICS.massKg *
    previousLongitudinalAcceleration *
    VEHICLE_DYNAMICS.centerOfMassHeightMeters /
    VEHICLE_DYNAMICS.wheelbaseMeters
  const frontNormalLoad = Math.max(
    0,
    staticFrontLoad -
      longitudinalLoadTransfer +
      totalDownforce * VEHICLE_DYNAMICS.aerodynamicBalanceFront,
  )
  const rearNormalLoad = Math.max(
    0,
    staticRearLoad +
      longitudinalLoadTransfer +
      totalDownforce * (1 - VEHICLE_DYNAMICS.aerodynamicBalanceFront),
  )

  const slipReferenceSpeed = Math.max(
    Math.abs(longitudinalSpeed),
    TIRE_MODEL.minimumSlipSpeedMetersPerSecond,
  )
  state.frontSlipAngle =
    PortableMath.atan2(
      lateralSpeed +
        VEHICLE_DYNAMICS.centerOfMassToFrontAxleMeters * state.yawRate,
      slipReferenceSpeed,
    ) -
    state.steeringAngle
  state.rearSlipAngle = PortableMath.atan2(
    lateralSpeed -
      VEHICLE_DYNAMICS.centerOfMassToRearAxleMeters * state.yawRate,
    slipReferenceSpeed,
  )
  const frontPeakForce = computePeakTireForce(
    frontNormalLoad,
    staticFrontLoad,
    surfaceId,
  )
  const rearPeakForce = computePeakTireForce(
    rearNormalLoad,
    staticRearLoad,
    surfaceId,
  )
  const frontLongitudinalSlip =
    (state.frontWheelAngularSpeed * VEHICLE_DYNAMICS.wheelRadiusMeters -
      longitudinalSpeed) /
    slipReferenceSpeed
  const rearLongitudinalSlip =
    (state.rearWheelAngularSpeed * VEHICLE_DYNAMICS.wheelRadiusMeters -
      longitudinalSpeed) /
    slipReferenceSpeed
  const frontPureLongitudinalForce = computeLongitudinalForceFromSlip(
    frontLongitudinalSlip,
    frontPeakForce,
  )
  const rearPureLongitudinalForce = computeLongitudinalForceFromSlip(
    rearLongitudinalSlip,
    rearPeakForce,
  )
  const frontTire = computeAxleTireForce({
    normalLoadNewtons: frontNormalLoad,
    referenceLoadNewtons: staticFrontLoad,
    slipAngleRadians: state.frontSlipAngle,
    longitudinalForceDemandNewtons: frontPureLongitudinalForce,
    corneringStiffnessNewtonsPerRadian:
      TIRE_MODEL.frontCorneringStiffnessNewtonsPerRadian,
    surface: surfaceId,
  })
  const rearTire = computeAxleTireForce({
    normalLoadNewtons: rearNormalLoad,
    referenceLoadNewtons: staticRearLoad,
    slipAngleRadians: state.rearSlipAngle,
    longitudinalForceDemandNewtons: rearPureLongitudinalForce,
    corneringStiffnessNewtonsPerRadian:
      TIRE_MODEL.rearCorneringStiffnessNewtonsPerRadian,
    surface: surfaceId,
  })
  state.frontGripUtilization = frontTire.utilization
  state.rearGripUtilization = rearTire.utilization

  const steeringCosine = PortableMath.cos(state.steeringAngle)
  const steeringSine = PortableMath.sin(state.steeringAngle)
  const frontLongitudinalBody =
    frontTire.longitudinalNewtons * steeringCosine -
    frontTire.lateralNewtons * steeringSine
  const frontLateralBody =
    frontTire.longitudinalNewtons * steeringSine +
    frontTire.lateralNewtons * steeringCosine
  const rearLongitudinalBody = rearTire.longitudinalNewtons
  const rearLateralBody = rearTire.lateralNewtons
  const totalLongitudinalForce =
    frontLongitudinalBody +
    rearLongitudinalBody -
    longitudinalResistance -
    aerodynamicLongitudinalResistance -
    totalLossLongitudinalResistance
  const totalLateralForce =
    frontLateralBody +
    rearLateralBody -
    aerodynamicLateralResistance -
    totalLossLateralResistance

  state.longitudinalAcceleration =
    totalLongitudinalForce / VEHICLE_DYNAMICS.massKg
  state.lateralAcceleration =
    totalLateralForce / VEHICLE_DYNAMICS.massKg
  const worldAcceleration = vectorFromBody(
    state.longitudinalAcceleration,
    state.lateralAcceleration,
    vehicle.angle,
  )
  vehicle.velocity.x += worldAcceleration.x * deltaSeconds
  vehicle.velocity.y += worldAcceleration.y * deltaSeconds

  const yawTorque =
    VEHICLE_DYNAMICS.centerOfMassToFrontAxleMeters * frontLateralBody -
    VEHICLE_DYNAMICS.centerOfMassToRearAxleMeters * rearLateralBody
  state.yawRate +=
    yawTorque / VEHICLE_DYNAMICS.yawInertiaKgMetersSquared * deltaSeconds
  vehicle.yawRate = state.yawRate
  vehicle.angle = normalizeSignedAngle(
    vehicle.angle + state.yawRate * deltaSeconds,
  )
  vehicle.position.x += vehicle.velocity.x * deltaSeconds
  vehicle.position.y += vehicle.velocity.y * deltaSeconds
  vehicle.surface = surfaceId

  const frontBrakeTorque =
    brakeDemand *
    POWERTRAIN.frontBrakeBias *
    VEHICLE_DYNAMICS.wheelRadiusMeters
  const rearBrakeTorque =
    brakeDemand *
    (1 - POWERTRAIN.frontBrakeBias) *
    VEHICLE_DYNAMICS.wheelRadiusMeters
  const brakeSignFor = (wheelAngularSpeed: number) => {
    const angularEpsilon =
      NUMERIC_SPEED_EPSILON_METERS_PER_SECOND /
      VEHICLE_DYNAMICS.wheelRadiusMeters
    if (Math.abs(wheelAngularSpeed) > angularEpsilon) {
      return Math.sign(wheelAngularSpeed)
    }
    if (
      Math.abs(longitudinalSpeed) >
      NUMERIC_SPEED_EPSILON_METERS_PER_SECOND
    ) {
      return Math.sign(longitudinalSpeed)
    }
    return 0
  }
  const previousFrontWheelAngularSpeed = state.frontWheelAngularSpeed
  const previousRearWheelAngularSpeed = state.rearWheelAngularSpeed
  const frontWheelTorque =
    -frontTire.longitudinalNewtons * VEHICLE_DYNAMICS.wheelRadiusMeters -
    brakeSignFor(previousFrontWheelAngularSpeed) * frontBrakeTorque
  const rearWheelTorque =
    powertrain.driveTorqueAtWheelsNewtonMeters -
    rearTire.longitudinalNewtons * VEHICLE_DYNAMICS.wheelRadiusMeters -
    brakeSignFor(previousRearWheelAngularSpeed) * rearBrakeTorque
  state.frontWheelAngularSpeed +=
    frontWheelTorque /
    POWERTRAIN.frontAxleRotationalInertiaKgMetersSquared *
    deltaSeconds
  state.rearWheelAngularSpeed +=
    rearWheelTorque /
    POWERTRAIN.rearAxleRotationalInertiaKgMetersSquared *
    deltaSeconds
  if (
    frontBrakeTorque > 0 &&
    previousFrontWheelAngularSpeed * state.frontWheelAngularSpeed < 0
  ) {
    state.frontWheelAngularSpeed = 0
  }
  if (
    rearBrakeTorque > 0 &&
    powertrain.driveTorqueAtWheelsNewtonMeters === 0 &&
    previousRearWheelAngularSpeed * state.rearWheelAngularSpeed < 0
  ) {
    state.rearWheelAngularSpeed = 0
  }
}

function chooseSteeringPull(
  vehicle: VehicleState,
  impactSpeed: number,
): SteeringPull {
  let idSignature = 17
  for (let index = 0; index < vehicle.id.length; index += 1) {
    idSignature =
      (Math.imul(idSignature, 31) + vehicle.id.charCodeAt(index)) | 0
  }
  const roundedDeltaV = Math.floor(impactSpeed * 10 + 0.5)
  return (
    (idSignature + vehicle.damage.impactCount + roundedDeltaV) %
      2 ===
    0
  )
    ? -1
    : 1
}

function updateDamageKind(vehicle: VehicleState) {
  if (vehicle.damage.health <= 0) {
    vehicle.damage.kind = 'total-loss'
  } else if (vehicle.damage.engineDamaged && vehicle.damage.steeringDamaged) {
    vehicle.damage.kind = 'engine-and-steering'
  } else if (vehicle.damage.engineDamaged) {
    vehicle.damage.kind = 'engine'
  } else if (vehicle.damage.steeringDamaged) {
    vehicle.damage.kind = 'steering'
  } else {
    vehicle.damage.kind = 'none'
  }
}

export function recordImpactDamage(
  vehicle: VehicleState,
  _pushNormal: { x: number; y: number },
  impactSpeed: number,
) {
  if (
    impactSpeed < DAMAGE_THRESHOLDS.minimumImpactSpeed ||
    vehicle.damage.kind === 'total-loss'
  ) {
    return
  }

  vehicle.damage.impactCount += 1
  vehicle.damage.lastImpactSpeed = impactSpeed
  vehicle.damage.health = clamp(
    vehicle.damage.health -
      impactSpeed * DAMAGE_THRESHOLDS.healthDamagePerImpactSpeed,
    0,
    DAMAGE_THRESHOLDS.maximumHealth,
  )

  if (
    impactSpeed >= DAMAGE_THRESHOLDS.totalLossImpactSpeed ||
    vehicle.damage.health <= 0
  ) {
    vehicle.damage.health = 0
    vehicle.damage.engineDamaged = true
    vehicle.damage.steeringDamaged = true
    updateDamageKind(vehicle)
    return
  }

  if (impactSpeed >= DAMAGE_THRESHOLDS.combinedImpactSpeed) {
    vehicle.damage.engineDamaged = true
    vehicle.damage.steeringDamaged = true
    vehicle.damage.steeringPull = chooseSteeringPull(vehicle, impactSpeed)
  } else if (impactSpeed >= DAMAGE_THRESHOLDS.mediumImpactSpeed) {
    vehicle.damage.engineDamaged = true
  } else {
    vehicle.damage.steeringDamaged = true
    vehicle.damage.steeringPull = chooseSteeringPull(vehicle, impactSpeed)
  }
  updateDamageKind(vehicle)
}
