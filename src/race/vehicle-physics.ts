import {
  DAMAGE_EFFECTS,
  DAMAGE_THRESHOLDS,
  PHYSICS_CONSTANTS,
} from '@/race/constants'
import { clamp, dot, magnitude, normalize, scale } from '@/race/math'
import type {
  DamageKind,
  DriverInput,
  SurfaceId,
  VehicleProfileId,
  VehicleState,
} from '@/race/types'

export function integrateVehicle(
  vehicle: VehicleState,
  input: DriverInput,
  surfaceId: SurfaceId,
  deltaSeconds: number,
) {
  const profile = PHYSICS_CONSTANTS.vehicleProfiles[vehicle.profileId]
  const isTotalLoss = vehicle.damage.kind === 'total-loss'
  const handlingMode = isTotalLoss
    ? vehicle.handlingMode
    : input.handlingMode
  const handling = PHYSICS_CONSTANTS.handlingModes[handlingMode]
  const surface = PHYSICS_CONSTANTS.surfaces[surfaceId]
  const accelerationDamageMultiplier =
    vehicle.damage.kind === 'engine'
      ? DAMAGE_EFFECTS.engineAccelerationMultiplier
      : 1
  const speedDamageMultiplier =
    vehicle.damage.kind === 'engine'
      ? DAMAGE_EFFECTS.engineMaxSpeedMultiplier
      : 1
  const steeringDamageMultiplier =
    vehicle.damage.kind === 'steering'
      ? DAMAGE_EFFECTS.steeringResponseMultiplier
      : 1
  const totalLossDragMultiplier = isTotalLoss
    ? DAMAGE_EFFECTS.totalLossDragMultiplier
    : 1
  const throttleInput = isTotalLoss ? 0 : input.throttle
  const brakeInput = isTotalLoss ? 0 : input.brake
  const steerInput = isTotalLoss ? 0 : input.steer
  const forward = { x: Math.cos(vehicle.angle), y: Math.sin(vehicle.angle) }
  const right = { x: -forward.y, y: forward.x }
  let longitudinalSpeed = dot(vehicle.velocity, forward)
  const lateralSpeed = dot(vehicle.velocity, right)

  const throttleAcceleration =
    clamp(throttleInput, 0, 1) *
    profile.engineAcceleration *
    surface.accelerationMultiplier *
    handling.longitudinalGripMultiplier *
    accelerationDamageMultiplier
  let longitudinalAcceleration = throttleAcceleration

  if (brakeInput > 0) {
    if (longitudinalSpeed > 0.4) {
      longitudinalAcceleration -=
        clamp(brakeInput, 0, 1) * profile.brakeDeceleration
    } else {
      longitudinalAcceleration -=
        clamp(brakeInput, 0, 1) * profile.engineAcceleration * 0.55
    }
  }

  vehicle.velocity.x += forward.x * longitudinalAcceleration * deltaSeconds
  vehicle.velocity.y += forward.y * longitudinalAcceleration * deltaSeconds

  const lateralGrip =
    profile.baseLateralGrip *
    handling.lateralGripMultiplier *
    surface.lateralGripMultiplier
  const lateralCorrection = clamp(lateralGrip * deltaSeconds, 0, 1)
  vehicle.velocity.x -= right.x * lateralSpeed * lateralCorrection
  vehicle.velocity.y -= right.y * lateralSpeed * lateralCorrection

  const speed = magnitude(vehicle.velocity)
  if (speed > Number.EPSILON) {
    const dragAcceleration =
      (profile.linearDrag * speed + profile.quadraticDrag * speed * speed) *
      surface.dragMultiplier *
      totalLossDragMultiplier
    const dragDelta = Math.min(speed, dragAcceleration * deltaSeconds)
    const velocityDirection = normalize(vehicle.velocity)
    vehicle.velocity.x -= velocityDirection.x * dragDelta
    vehicle.velocity.y -= velocityDirection.y * dragDelta
  }

  longitudinalSpeed = dot(vehicle.velocity, forward)
  const surfaceForwardLimit =
    surface.speedLimit === null
      ? profile.maxForwardSpeed
      : Math.min(profile.maxForwardSpeed, surface.speedLimit)
  const forwardLimit = surfaceForwardLimit * speedDamageMultiplier
  const reverseLimit = profile.maxReverseSpeed * speedDamageMultiplier
  if (longitudinalSpeed > forwardLimit) {
    const excess = longitudinalSpeed - forwardLimit
    vehicle.velocity.x -= forward.x * excess
    vehicle.velocity.y -= forward.y * excess
    longitudinalSpeed = forwardLimit
  } else if (longitudinalSpeed < -reverseLimit) {
    const excess = longitudinalSpeed + reverseLimit
    vehicle.velocity.x -= forward.x * excess
    vehicle.velocity.y -= forward.y * excess
    longitudinalSpeed = -reverseLimit
  }

  const speedRatio = clamp(
    Math.abs(longitudinalSpeed) / profile.maxForwardSpeed,
    0,
    1,
  )
  const highSpeedSteering = 1 - profile.highSpeedSteerReduction * speedRatio
  const direction = longitudinalSpeed < -0.25 ? -1 : 1
  const steeringAuthority = clamp(Math.abs(longitudinalSpeed) / 3, 0, 1)
  const targetYawRate =
    clamp(steerInput, -1, 1) *
    profile.maxSteerRate *
    handling.steeringMultiplier *
    steeringDamageMultiplier *
    highSpeedSteering *
    steeringAuthority *
    direction
  const yawResponse = clamp((3.5 + lateralGrip * 0.12) * deltaSeconds, 0, 1)
  vehicle.yawRate += (targetYawRate - vehicle.yawRate) * yawResponse
  if (Math.abs(steerInput) < 0.01) {
    vehicle.yawRate *= Math.exp(-handling.yawDampingPerSecond * deltaSeconds)
  }

  vehicle.angle += vehicle.yawRate * deltaSeconds
  vehicle.position.x += vehicle.velocity.x * deltaSeconds
  vehicle.position.y += vehicle.velocity.y * deltaSeconds
  vehicle.surface = surfaceId
  vehicle.handlingMode = handlingMode
}
function damagePriority(kind: DamageKind) {
  if (kind === 'total-loss') return 2
  if (kind === 'none') return 0
  return 1
}

export function recordImpactDamage(
  vehicle: VehicleState,
  pushNormal: { x: number; y: number },
  impactSpeed: number,
) {
  if (impactSpeed < DAMAGE_THRESHOLDS.minimumImpactSpeed) return

  const forward = { x: Math.cos(vehicle.angle), y: Math.sin(vehicle.angle) }
  const alignment = Math.abs(dot(forward, pushNormal))
  const weightedImpact = impactSpeed * (0.75 + alignment * 0.5)
  vehicle.damage.points += weightedImpact
  vehicle.damage.lastImpactSpeed = impactSpeed

  let nextKind: DamageKind =
    alignment >= DAMAGE_THRESHOLDS.powertrainAlignment
      ? 'engine'
      : 'steering'
  if (
    weightedImpact >= DAMAGE_THRESHOLDS.totalLossImpactSpeed ||
    vehicle.damage.points >=
      DAMAGE_THRESHOLDS.accumulatedTotalLossPoints
  ) {
    nextKind = 'total-loss'
  }

  if (damagePriority(nextKind) >= damagePriority(vehicle.damage.kind)) {
    vehicle.damage.kind = nextKind
  }
}

export function getCollisionRadius(profileId: VehicleProfileId) {
  const profile = PHYSICS_CONSTANTS.vehicleProfiles[profileId]
  return profile.widthMeters * 0.62
}

export function applyBarrierResponse(
  vehicle: VehicleState,
  pushNormal: { x: number; y: number },
  penetrationMeters: number,
) {
  const collision = PHYSICS_CONSTANTS.collision
  vehicle.position.x +=
    pushNormal.x * penetrationMeters * collision.positionCorrectionPercent
  vehicle.position.y +=
    pushNormal.y * penetrationMeters * collision.positionCorrectionPercent

  const incomingSpeed = -dot(vehicle.velocity, pushNormal)
  if (incomingSpeed <= 0) return

  const normalVelocity = scale(pushNormal, dot(vehicle.velocity, pushNormal))
  const tangentialVelocity = {
    x: vehicle.velocity.x - normalVelocity.x,
    y: vehicle.velocity.y - normalVelocity.y,
  }
  const bouncedNormal = scale(
    pushNormal,
    incomingSpeed * collision.barrierRestitution,
  )
  vehicle.velocity = {
    x:
      tangentialVelocity.x * collision.tangentialFriction + bouncedNormal.x,
    y:
      tangentialVelocity.y * collision.tangentialFriction + bouncedNormal.y,
  }
  recordImpactDamage(vehicle, pushNormal, incomingSpeed)
}
