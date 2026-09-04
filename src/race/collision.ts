import * as PortableMath from '@/race/portable-math'

import { sweepCompoundCollidersWithRotation } from '@/race/continuous-collision'
import { PHYSICS_CONSTANTS } from '@/race/constants'
import {
  lerp,
  lerpAngle,
  magnitude,
  normalizeAngle,
  signedAngleDelta,
  subtract,
} from '@/race/math'
import {
  findCompoundCollisionManifolds,
  resolveRigidBodyCollisions,
  type CollisionManifold,
  type CollisionResolution,
  type CollisionResponseOptions,
  type RigidBody2D,
} from '@/race/rigid-body-collision'
import type { TrackGeometry } from '@/race/TrackGeometry'
import type { VehicleState } from '@/race/types'
import { recordImpactDamage } from '@/race/vehicle-physics'
import {
  createVehicleWorldCollider,
  F1_VEHICLE_COLLIDER,
  type WorldConvexCollider,
} from '@/race/vehicle-geometry'

type CollisionBounds = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

type StaticColliderProvider = (
  bounds: CollisionBounds,
) => readonly WorldConvexCollider[]

const VEHICLE_MAXIMUM_AXIS_EXTENT_METERS = PortableMath.hypot(
  F1_VEHICLE_COLLIDER.lengthMeters / 2,
  F1_VEHICLE_COLLIDER.widthMeters / 2,
)
const COLLISION_TIME_EPSILON_SECONDS =
  PHYSICS_CONSTANTS.collision.ccdTimeEpsilonSeconds
const COLLISION_ANGULAR_MOTION_EPSILON_RADIANS =
  PHYSICS_CONSTANTS.collision.ccdAngularMotionEpsilonRadians

function vehicleBody(vehicle: VehicleState): RigidBody2D {
  return {
    position: vehicle.position,
    velocity: vehicle.velocity,
    angle: vehicle.angle,
    angularVelocity: vehicle.physicsState.yawRate,
    inverseMass: 1 / F1_VEHICLE_COLLIDER.massKg,
    inverseInertia: 1 / F1_VEHICLE_COLLIDER.yawInertiaKgM2,
  }
}

function staticBody(): RigidBody2D {
  return {
    position: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    angle: 0,
    angularVelocity: 0,
    inverseMass: 0,
    inverseInertia: 0,
  }
}

function responseOptions(
  restitution: number,
  friction: number,
): CollisionResponseOptions {
  const collision = PHYSICS_CONSTANTS.collision
  return {
    restitution,
    friction,
    positionCorrectionPercent: collision.positionCorrectionPercent,
    penetrationSlopMeters: collision.penetrationSlopMeters,
  }
}

function carResponseOptions() {
  return responseOptions(
    PHYSICS_CONSTANTS.collision.carRestitution,
    PHYSICS_CONSTANTS.collision.carTangentialFriction,
  )
}

function barrierResponseOptions(manifold: CollisionManifold) {
  const material = manifold.secondCollisionMaterial
  if (!material) {
    throw new Error(
      'Collider de barreira sem material físico canônico do contrato v2.',
    )
  }
  const calibration =
    PHYSICS_CONSTANTS.collision.barrierMaterials[material]
  return responseOptions(
    calibration.restitution,
    calibration.tangentialFriction,
  )
}

function synchronizeResolvedBody(vehicle: VehicleState, body: RigidBody2D) {
  vehicle.position = { ...body.position }
  vehicle.velocity = { ...body.velocity }
  vehicle.angle = normalizeAngle(body.angle)
  vehicle.yawRate = body.angularVelocity
  vehicle.physicsState.yawRate = body.angularVelocity
  const cosine = PortableMath.cos(vehicle.angle)
  const sine = PortableMath.sin(vehicle.angle)
  vehicle.physicsState.longitudinalSpeed =
    vehicle.velocity.x * cosine + vehicle.velocity.y * sine
  vehicle.physicsState.lateralSpeed =
    vehicle.velocity.x * -sine + vehicle.velocity.y * cosine
}

function primaryManifold(manifolds: readonly CollisionManifold[]) {
  return manifolds.reduce((deepest, manifold) =>
    manifold.penetrationMeters > deepest.penetrationMeters
      ? manifold
      : deepest,
  )
}

function recordPairDamage(
  first: VehicleState,
  second: VehicleState,
  manifolds: readonly CollisionManifold[],
  resolution: CollisionResolution,
) {
  const primary = primaryManifold(manifolds)
  recordImpactDamage(
    first,
    { x: -primary.normal.x, y: -primary.normal.y },
    resolution.firstNormalDeltaVelocityMetersPerSecond,
  )
  recordImpactDamage(
    second,
    primary.normal,
    resolution.secondNormalDeltaVelocityMetersPerSecond,
  )
}

function solveVehiclePair(
  first: VehicleState,
  second: VehicleState,
  manifolds: readonly CollisionManifold[],
) {
  const firstBody = vehicleBody(first)
  const secondBody = vehicleBody(second)
  const resolution = resolveRigidBodyCollisions(
    firstBody,
    secondBody,
    manifolds,
    carResponseOptions(),
    PHYSICS_CONSTANTS.collision.solverIterations,
  )
  synchronizeResolvedBody(first, firstBody)
  synchronizeResolvedBody(second, secondBody)
  recordPairDamage(first, second, manifolds, resolution)
  return resolution
}

function motionVelocity(vehicle: VehicleState, deltaSeconds: number) {
  return {
    x: (vehicle.position.x - vehicle.previousPosition.x) / deltaSeconds,
    y: (vehicle.position.y - vehicle.previousPosition.y) / deltaSeconds,
  }
}

function sweptVehicleBounds(
  from: VehicleState['position'],
  to: VehicleState['position'],
): CollisionBounds {
  return {
    minX:
      Math.min(from.x, to.x) - VEHICLE_MAXIMUM_AXIS_EXTENT_METERS,
    minY:
      Math.min(from.y, to.y) - VEHICLE_MAXIMUM_AXIS_EXTENT_METERS,
    maxX:
      Math.max(from.x, to.x) + VEHICLE_MAXIMUM_AXIS_EXTENT_METERS,
    maxY:
      Math.max(from.y, to.y) + VEHICLE_MAXIMUM_AXIS_EXTENT_METERS,
  }
}

function boundsIntersect(first: CollisionBounds, second: CollisionBounds) {
  return !(
    first.maxX < second.minX ||
    first.minX > second.maxX ||
    first.maxY < second.minY ||
    first.minY > second.maxY
  )
}

function advanceBody(body: RigidBody2D, deltaSeconds: number) {
  body.position.x += body.velocity.x * deltaSeconds
  body.position.y += body.velocity.y * deltaSeconds
  body.angle = normalizeAngle(
    body.angle + body.angularVelocity * deltaSeconds,
  )
}

function vehicleColliders(body: RigidBody2D) {
  return createVehicleWorldCollider({
    position: body.position,
    angle: body.angle,
  })
}

function completeSimultaneousImpactManifolds(
  current: readonly CollisionManifold[],
  reportedAtImpact: readonly CollisionManifold[],
) {
  const completed = new Map(
    current.map((manifold) => [
      `${manifold.firstColliderId}:${manifold.secondColliderId}`,
      manifold,
    ]),
  )
  for (const manifold of reportedAtImpact) {
    const key = `${manifold.firstColliderId}:${manifold.secondColliderId}`
    if (!completed.has(key)) completed.set(key, manifold)
  }
  return [...completed.values()].sort(
    (left, right) =>
      (left.firstColliderId < right.firstColliderId
        ? -1
        : left.firstColliderId > right.firstColliderId
          ? 1
          : 0) ||
      (left.secondColliderId < right.secondColliderId
        ? -1
        : left.secondColliderId > right.secondColliderId
          ? 1
          : 0),
  )
}

function collidersAtVehiclePose(vehicle: VehicleState) {
  return createVehicleWorldCollider({
    position: vehicle.position,
    angle: vehicle.angle,
  })
}

/**
 * Resolves a moving vehicle against canonical static colliders. CCD is
 * repeated for the fixed-step remainder, so a rebound can hit a second face
 * in the same tick without tunnelling through corners.
 */
export function resolveVehicleAgainstStaticColliders(
  vehicle: VehicleState,
  deltaSeconds: number,
  colliderProvider: StaticColliderProvider,
) {
  const intendedPosition = { ...vehicle.position }
  const intendedAngle = vehicle.angle
  const initialVelocity =
    deltaSeconds > 0
      ? motionVelocity(vehicle, deltaSeconds)
      : { ...vehicle.velocity }
  const initialAngularVelocity =
    deltaSeconds > 0
      ? signedAngleDelta(vehicle.previousAngle, intendedAngle) / deltaSeconds
      : vehicle.physicsState.yawRate
  const initialBounds = sweptVehicleBounds(
    vehicle.previousPosition,
    intendedPosition,
  )
  if (colliderProvider(initialBounds).length === 0) return false

  if (deltaSeconds <= 0) {
    const colliders = colliderProvider(
      sweptVehicleBounds(vehicle.position, vehicle.position),
    )
    const manifolds = findCompoundCollisionManifolds(
      collidersAtVehiclePose(vehicle),
      colliders,
    )
    if (manifolds.length === 0) return false
    const body = vehicleBody(vehicle)
    const resolution = resolveRigidBodyCollisions(
      body,
      staticBody(),
      manifolds,
      barrierResponseOptions,
      PHYSICS_CONSTANTS.collision.solverIterations,
    )
    synchronizeResolvedBody(vehicle, body)
    const primary = primaryManifold(manifolds)
    recordImpactDamage(
      vehicle,
      { x: -primary.normal.x, y: -primary.normal.y },
      resolution.firstNormalDeltaVelocityMetersPerSecond,
    )
    return true
  }

  const body = vehicleBody(vehicle)
  body.position = { ...vehicle.previousPosition }
  body.angle = normalizeAngle(vehicle.previousAngle)
  let travelVelocity = initialVelocity
  let travelAngularVelocity = initialAngularVelocity
  let remainingSeconds = deltaSeconds
  let collided = false

  for (
    let eventIndex = 0;
    eventIndex < PHYSICS_CONSTANTS.collision.maximumCcdEventsPerStep &&
    remainingSeconds > COLLISION_TIME_EPSILON_SECONDS;
    eventIndex += 1
  ) {
    const predictedPosition = {
      x: body.position.x + travelVelocity.x * remainingSeconds,
      y: body.position.y + travelVelocity.y * remainingSeconds,
    }
    const bounds = sweptVehicleBounds(body.position, predictedPosition)
    const barriers = [...colliderProvider(bounds)]
    if (barriers.length === 0) {
      body.position = predictedPosition
      body.angle = normalizeAngle(
        body.angle + travelAngularVelocity * remainingSeconds,
      )
      remainingSeconds = 0
      break
    }

    const startColliders = vehicleColliders(body)
    const startManifolds = findCompoundCollisionManifolds(
      startColliders,
      barriers,
    )
    const shouldSweep =
      magnitude(travelVelocity) >=
        PHYSICS_CONSTANTS.collision.ccdMinimumSpeedMetersPerSecond ||
      Math.abs(travelAngularVelocity) * remainingSeconds >
        COLLISION_ANGULAR_MOTION_EPSILON_RADIANS
    const impact =
      startManifolds.length === 0
        && shouldSweep
        ? sweepCompoundCollidersWithRotation(
            {
              colliders: startColliders,
              position: body.position,
              velocity: travelVelocity,
              angularVelocity: travelAngularVelocity,
            },
            {
              colliders: barriers,
              position: { x: 0, y: 0 },
              velocity: { x: 0, y: 0 },
              angularVelocity: 0,
            },
            remainingSeconds,
          )
        : null

    if (startManifolds.length === 0 && !impact) {
      body.position = predictedPosition
      body.angle = normalizeAngle(
        body.angle + travelAngularVelocity * remainingSeconds,
      )
      const endManifolds = findCompoundCollisionManifolds(
        vehicleColliders(body),
        barriers,
      )
      if (endManifolds.length > 0) {
        const resolution = resolveRigidBodyCollisions(
          body,
          staticBody(),
          endManifolds,
          barrierResponseOptions,
          PHYSICS_CONSTANTS.collision.solverIterations,
        )
        const primary = primaryManifold(endManifolds)
        recordImpactDamage(
          vehicle,
          { x: -primary.normal.x, y: -primary.normal.y },
          resolution.firstNormalDeltaVelocityMetersPerSecond,
        )
        collided = true
      }
      remainingSeconds = 0
      break
    }

    const elapsedSeconds = impact?.timeSeconds ?? 0
    body.position.x += travelVelocity.x * elapsedSeconds
    body.position.y += travelVelocity.y * elapsedSeconds
    body.angle = normalizeAngle(
      body.angle + travelAngularVelocity * elapsedSeconds,
    )
    remainingSeconds = Math.max(0, remainingSeconds - elapsedSeconds)
    let manifolds: readonly CollisionManifold[] =
      startManifolds.length > 0
        ? startManifolds
        : findCompoundCollisionManifolds(
            vehicleColliders(body),
            barriers,
          )
    if (impact && startManifolds.length === 0) {
      manifolds = completeSimultaneousImpactManifolds(
        manifolds,
        impact.manifolds,
      )
    }
    const resolvedManifolds =
      manifolds.length > 0 ? manifolds : impact!.manifolds
    const resolution = resolveRigidBodyCollisions(
      body,
      staticBody(),
      resolvedManifolds,
      barrierResponseOptions,
      PHYSICS_CONSTANTS.collision.solverIterations,
    )
    const primary = primaryManifold(resolvedManifolds)
    recordImpactDamage(
      vehicle,
      { x: -primary.normal.x, y: -primary.normal.y },
      resolution.firstNormalDeltaVelocityMetersPerSecond,
    )
    collided = true
    travelVelocity = { ...body.velocity }
    travelAngularVelocity = body.angularVelocity

    if (elapsedSeconds <= COLLISION_TIME_EPSILON_SECONDS) {
      const escapeSeconds = Math.min(
        remainingSeconds,
        COLLISION_TIME_EPSILON_SECONDS,
      )
      advanceBody(body, escapeSeconds)
      remainingSeconds -= escapeSeconds
    }
  }

  if (remainingSeconds > 0) advanceBody(body, remainingSeconds)
  synchronizeResolvedBody(vehicle, body)
  return collided
}

export function resolveVehicleCollision(
  first: VehicleState,
  second: VehicleState,
  deltaSeconds = 0,
) {
  const firstEndBounds = sweptVehicleBounds(first.position, first.position)
  const secondEndBounds = sweptVehicleBounds(second.position, second.position)
  const firstSweptBounds = sweptVehicleBounds(
    first.previousPosition,
    first.position,
  )
  const secondSweptBounds = sweptVehicleBounds(
    second.previousPosition,
    second.position,
  )
  if (
    !boundsIntersect(firstEndBounds, secondEndBounds) &&
    (deltaSeconds <= 0 ||
      !boundsIntersect(firstSweptBounds, secondSweptBounds))
  ) {
    return false
  }

  const firstAtEnd = collidersAtVehiclePose(first)
  const secondAtEnd = collidersAtVehiclePose(second)
  if (deltaSeconds <= 0) {
    const manifolds = findCompoundCollisionManifolds(
      firstAtEnd,
      secondAtEnd,
    )
    if (manifolds.length === 0) return false
    solveVehiclePair(first, second, manifolds)
    return true
  }

  const firstMotion = motionVelocity(first, deltaSeconds)
  const secondMotion = motionVelocity(second, deltaSeconds)
  const firstAngularMotion =
    signedAngleDelta(first.previousAngle, first.angle) / deltaSeconds
  const secondAngularMotion =
    signedAngleDelta(second.previousAngle, second.angle) / deltaSeconds
  const relativeSpeed = magnitude(subtract(firstMotion, secondMotion))
  const firstAtStart = createVehicleWorldCollider({
    position: first.previousPosition,
    angle: first.previousAngle,
  })
  const secondAtStart = createVehicleWorldCollider({
    position: second.previousPosition,
    angle: second.previousAngle,
  })
  const shouldSweep =
    relativeSpeed >=
      PHYSICS_CONSTANTS.collision.ccdMinimumSpeedMetersPerSecond ||
    (Math.abs(firstAngularMotion) + Math.abs(secondAngularMotion)) *
      deltaSeconds >
      COLLISION_ANGULAR_MOTION_EPSILON_RADIANS
  const impact = shouldSweep
    ? sweepCompoundCollidersWithRotation(
        {
          colliders: firstAtStart,
          position: first.previousPosition,
          velocity: firstMotion,
          angularVelocity: firstAngularMotion,
        },
        {
          colliders: secondAtStart,
          position: second.previousPosition,
          velocity: secondMotion,
          angularVelocity: secondAngularMotion,
        },
        deltaSeconds,
      )
    : null

  if (!impact) {
    const manifolds = findCompoundCollisionManifolds(
      firstAtEnd,
      secondAtEnd,
    )
    if (manifolds.length === 0) return false
    solveVehiclePair(first, second, manifolds)
    return true
  }

  const impactAlpha = impact.timeSeconds / deltaSeconds
  const firstBody = vehicleBody(first)
  const secondBody = vehicleBody(second)
  firstBody.position = {
    x: lerp(first.previousPosition.x, first.position.x, impactAlpha),
    y: lerp(first.previousPosition.y, first.position.y, impactAlpha),
  }
  secondBody.position = {
    x: lerp(second.previousPosition.x, second.position.x, impactAlpha),
    y: lerp(second.previousPosition.y, second.position.y, impactAlpha),
  }
  firstBody.angle = lerpAngle(
    first.previousAngle,
    first.angle,
    impactAlpha,
  )
  secondBody.angle = lerpAngle(
    second.previousAngle,
    second.angle,
    impactAlpha,
  )

  let remainingSeconds = deltaSeconds - impact.timeSeconds
  let eventIndex = 0
  let pendingManifolds: CollisionManifold[] | null = impact.manifolds
  while (
    pendingManifolds &&
    eventIndex < PHYSICS_CONSTANTS.collision.maximumCcdEventsPerStep
  ) {
    let impactManifolds: readonly CollisionManifold[] = findCompoundCollisionManifolds(
      vehicleColliders(firstBody),
      vehicleColliders(secondBody),
    )
    impactManifolds = completeSimultaneousImpactManifolds(
      impactManifolds,
      pendingManifolds,
    )
    const manifolds =
      impactManifolds.length > 0
        ? impactManifolds
        : pendingManifolds
    const resolution = resolveRigidBodyCollisions(
      firstBody,
      secondBody,
      manifolds,
      carResponseOptions(),
      PHYSICS_CONSTANTS.collision.solverIterations,
    )
    synchronizeResolvedBody(first, firstBody)
    synchronizeResolvedBody(second, secondBody)
    recordPairDamage(first, second, manifolds, resolution)
    eventIndex += 1
    if (remainingSeconds <= COLLISION_TIME_EPSILON_SECONDS) break

    const nextImpact = sweepCompoundCollidersWithRotation(
      {
        colliders: vehicleColliders(firstBody),
        position: firstBody.position,
        velocity: firstBody.velocity,
        angularVelocity: firstBody.angularVelocity,
      },
      {
        colliders: vehicleColliders(secondBody),
        position: secondBody.position,
        velocity: secondBody.velocity,
        angularVelocity: secondBody.angularVelocity,
      },
      remainingSeconds,
    )
    if (!nextImpact) {
      advanceBody(firstBody, remainingSeconds)
      advanceBody(secondBody, remainingSeconds)
      remainingSeconds = 0
      pendingManifolds = null
      break
    }
    advanceBody(firstBody, nextImpact.timeSeconds)
    advanceBody(secondBody, nextImpact.timeSeconds)
    remainingSeconds -= nextImpact.timeSeconds
    pendingManifolds = nextImpact.manifolds
    if (nextImpact.timeSeconds <= COLLISION_TIME_EPSILON_SECONDS) {
      const escapeSeconds = Math.min(
        remainingSeconds,
        COLLISION_TIME_EPSILON_SECONDS,
      )
      advanceBody(firstBody, escapeSeconds)
      advanceBody(secondBody, escapeSeconds)
      remainingSeconds -= escapeSeconds
    }
  }
  if (remainingSeconds > 0) {
    advanceBody(firstBody, remainingSeconds)
    advanceBody(secondBody, remainingSeconds)
  }
  synchronizeResolvedBody(first, firstBody)
  synchronizeResolvedBody(second, secondBody)
  return true
}

export function resolveVehicleBarrierCollisions(
  vehicle: VehicleState,
  geometry: TrackGeometry,
  deltaSeconds: number,
) {
  return resolveVehicleAgainstStaticColliders(
    vehicle,
    deltaSeconds,
    (bounds) => geometry.getBarrierColliders(vehicle.trackLayer, bounds),
  )
}

export { F1_VEHICLE_COLLIDER }
