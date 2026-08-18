import { PHYSICS_CONSTANTS } from '@/race/constants'
import { clamp, dot, magnitude, normalize, scale, subtract } from '@/race/math'
import type { VehicleState } from '@/race/types'
import {
  getCollisionRadius,
  recordCosmeticImpact,
} from '@/race/vehicle-physics'

export function resolveVehicleCollision(
  first: VehicleState,
  second: VehicleState,
) {
  const delta = subtract(second.position, first.position)
  const distance = magnitude(delta)
  const minimumDistance =
    getCollisionRadius(first.profileId) +
    getCollisionRadius(second.profileId)
  if (distance >= minimumDistance) return false

  const normal = distance <= Number.EPSILON ? { x: 1, y: 0 } : normalize(delta)
  const collision = PHYSICS_CONSTANTS.collision
  const firstProfile = PHYSICS_CONSTANTS.vehicleProfiles[first.profileId]
  const secondProfile = PHYSICS_CONSTANTS.vehicleProfiles[second.profileId]
  const firstInverseMass = 1 / firstProfile.massKg
  const secondInverseMass = 1 / secondProfile.massKg
  const inverseMassSum = firstInverseMass + secondInverseMass
  const penetration = minimumDistance - distance
  const correctionMagnitude =
    (Math.max(penetration - collision.penetrationSlopMeters, 0) *
      collision.positionCorrectionPercent) /
    inverseMassSum
  const correction = scale(normal, correctionMagnitude)
  first.position.x -= correction.x * firstInverseMass
  first.position.y -= correction.y * firstInverseMass
  second.position.x += correction.x * secondInverseMass
  second.position.y += correction.y * secondInverseMass

  const relativeVelocity = subtract(second.velocity, first.velocity)
  const velocityAlongNormal = dot(relativeVelocity, normal)
  if (velocityAlongNormal >= 0) return true

  const impulseMagnitude =
    (-(1 + collision.carRestitution) * velocityAlongNormal) / inverseMassSum
  const impulse = scale(normal, impulseMagnitude)
  first.velocity.x -= impulse.x * firstInverseMass
  first.velocity.y -= impulse.y * firstInverseMass
  second.velocity.x += impulse.x * secondInverseMass
  second.velocity.y += impulse.y * secondInverseMass

  const tangentVelocity = {
    x: relativeVelocity.x - normal.x * velocityAlongNormal,
    y: relativeVelocity.y - normal.y * velocityAlongNormal,
  }
  if (magnitude(tangentVelocity) > Number.EPSILON) {
    const tangent = normalize(tangentVelocity)
    const rawFrictionImpulse = -dot(relativeVelocity, tangent) / inverseMassSum
    const frictionLimit = impulseMagnitude * collision.tangentialFriction
    const frictionImpulse = scale(
      tangent,
      clamp(rawFrictionImpulse, -frictionLimit, frictionLimit),
    )
    first.velocity.x -= frictionImpulse.x * firstInverseMass
    first.velocity.y -= frictionImpulse.y * firstInverseMass
    second.velocity.x += frictionImpulse.x * secondInverseMass
    second.velocity.y += frictionImpulse.y * secondInverseMass
  }

  const impactSpeed = -velocityAlongNormal
  recordCosmeticImpact(first, scale(normal, -1), impactSpeed)
  recordCosmeticImpact(second, normal, impactSpeed)
  return true
}
