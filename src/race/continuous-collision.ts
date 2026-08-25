import physicsConstants from '../../contracts/module-2/v2/physics-constants.json'

import { add, dot, normalize, perpendicularLeft, scale, subtract } from '@/race/math'
import {
  colliderBounds,
  colliderBoundsIntersect,
  findCompoundCollisionManifolds,
  findCollisionManifold,
  resolveRigidBodyCollisions,
  type CollisionManifold,
  type CollisionResolution,
  type CollisionResponseOptions,
  type RigidBody2D,
} from '@/race/rigid-body-collision'
import type { Vector2 } from '@/race/types'
import type { WorldConvexCollider } from '@/race/vehicle-geometry'

export type SweptColliderBody = {
  colliders: readonly WorldConvexCollider[]
  velocity: Vector2
}

export type TimeOfImpact = {
  timeSeconds: number
  normal: Vector2
  firstColliderId: string
  secondColliderId: string
  manifold: CollisionManifold
}

export type ContinuousCollisionBody = {
  body: RigidBody2D
  colliders: readonly WorldConvexCollider[]
}

export type ContinuousCollisionStepResult = {
  impact: TimeOfImpact
  elapsedSeconds: number
  remainingSeconds: number
  resolution: CollisionResolution
}

const SWEEP_EPSILON = physicsConstants.collision.geometryEpsilon

function axesOf(vertices: readonly Vector2[]) {
  const axes: Vector2[] = []
  for (let index = 0; index < vertices.length; index += 1) {
    const edge = subtract(
      vertices[(index + 1) % vertices.length],
      vertices[index],
    )
    const axis = normalize(perpendicularLeft(edge))
    if (axis.x === 0 && axis.y === 0) continue
    if (
      axes.some(
        (candidate) => Math.abs(dot(candidate, axis)) >= 1 - SWEEP_EPSILON,
      )
    ) {
      continue
    }
    axes.push(axis)
  }
  return axes
}

function project(vertices: readonly Vector2[], axis: Vector2) {
  let minimum = dot(vertices[0], axis)
  let maximum = minimum
  for (const vertex of vertices.slice(1)) {
    const value = dot(vertex, axis)
    minimum = Math.min(minimum, value)
    maximum = Math.max(maximum, value)
  }
  return { minimum, maximum }
}

function translateCollider(
  collider: WorldConvexCollider,
  velocity: Vector2,
  timeSeconds: number,
): WorldConvexCollider {
  const offset = scale(velocity, timeSeconds)
  return {
    id: collider.id,
    collisionMaterial: collider.collisionMaterial,
    vertices: collider.vertices.map((vertex) => add(vertex, offset)),
  }
}

function sweptBounds(
  collider: WorldConvexCollider,
  velocity: Vector2,
  maximumTimeSeconds: number,
) {
  const start = colliderBounds(collider)
  const offset = scale(velocity, maximumTimeSeconds)
  return {
    minX: Math.min(start.minX, start.minX + offset.x),
    minY: Math.min(start.minY, start.minY + offset.y),
    maxX: Math.max(start.maxX, start.maxX + offset.x),
    maxY: Math.max(start.maxY, start.maxY + offset.y),
  }
}

function centerOf(collider: WorldConvexCollider) {
  return scale(
    collider.vertices.reduce(
      (sum, vertex) => add(sum, vertex),
      { x: 0, y: 0 },
    ),
    1 / collider.vertices.length,
  )
}

/**
 * Exact swept-SAT for linear motion during one fixed step. Rotation remains
 * frozen inside the sweep; callers resolve at TOI and may sweep the remaining
 * fraction again, which keeps the method deterministic and prevents linear
 * tunnelling at F1 speeds.
 */
export function sweepConvexColliders(
  first: WorldConvexCollider,
  firstVelocity: Vector2,
  second: WorldConvexCollider,
  secondVelocity: Vector2,
  maximumTimeSeconds: number,
): TimeOfImpact | null {
  if (maximumTimeSeconds < 0) {
    throw new Error('O intervalo de CCD não pode ser negativo.')
  }
  const relativeVelocity = subtract(secondVelocity, firstVelocity)
  if (
    !colliderBoundsIntersect(
      sweptBounds(first, firstVelocity, maximumTimeSeconds),
      sweptBounds(second, secondVelocity, maximumTimeSeconds),
    )
  ) {
    return null
  }
  const initialManifold = findCollisionManifold(first, second)
  if (initialManifold) {
    if (
      initialManifold.penetrationMeters <= SWEEP_EPSILON &&
      dot(relativeVelocity, initialManifold.normal) >= 0
    ) {
      return null
    }
    return {
      timeSeconds: 0,
      normal: initialManifold.normal,
      firstColliderId: first.id,
      secondColliderId: second.id,
      manifold: initialManifold,
    }
  }

  let entryTime = 0
  let exitTime = maximumTimeSeconds
  let entryAxis: Vector2 | null = null
  for (const axis of [
    ...axesOf(first.vertices),
    ...axesOf(second.vertices),
  ]) {
    const firstProjection = project(first.vertices, axis)
    const secondProjection = project(second.vertices, axis)
    const relativeAxisVelocity = dot(relativeVelocity, axis)
    if (Math.abs(relativeAxisVelocity) <= SWEEP_EPSILON) {
      if (
        firstProjection.maximum < secondProjection.minimum ||
        secondProjection.maximum < firstProjection.minimum
      ) {
        return null
      }
      continue
    }

    const firstCrossing =
      (firstProjection.minimum - secondProjection.maximum) /
      relativeAxisVelocity
    const secondCrossing =
      (firstProjection.maximum - secondProjection.minimum) /
      relativeAxisVelocity
    const axisEntry = Math.min(firstCrossing, secondCrossing)
    const axisExit = Math.max(firstCrossing, secondCrossing)
    if (axisEntry > entryTime) {
      entryTime = axisEntry
      entryAxis = axis
    }
    exitTime = Math.min(exitTime, axisExit)
    if (entryTime - exitTime > SWEEP_EPSILON) return null
  }
  if (
    entryTime < -SWEEP_EPSILON ||
    entryTime > maximumTimeSeconds + SWEEP_EPSILON
  ) {
    return null
  }

  const impactTime = Math.max(0, Math.min(maximumTimeSeconds, entryTime))
  const impactFirst = translateCollider(first, firstVelocity, impactTime)
  const impactSecond = translateCollider(second, secondVelocity, impactTime)
  const firstCenter = centerOf(impactFirst)
  const secondCenter = centerOf(impactSecond)
  let normal = entryAxis ?? normalize(subtract(secondCenter, firstCenter))
  if (dot(subtract(secondCenter, firstCenter), normal) < 0) {
    normal = scale(normal, -1)
  }
  const manifold = findCollisionManifold(impactFirst, impactSecond) ?? {
    normal,
    penetrationMeters: 0,
    contacts: [scale(add(firstCenter, secondCenter), 0.5)],
    firstColliderId: first.id,
    secondColliderId: second.id,
    firstCollisionMaterial: first.collisionMaterial,
    secondCollisionMaterial: second.collisionMaterial,
  }
  return {
    timeSeconds: impactTime,
    normal: manifold.normal,
    firstColliderId: first.id,
    secondColliderId: second.id,
    manifold,
  }
}

export function sweepCompoundColliders(
  first: SweptColliderBody,
  second: SweptColliderBody,
  maximumTimeSeconds: number,
) {
  const firstSweptBounds = first.colliders.map((collider) => ({
    collider,
    bounds: sweptBounds(collider, first.velocity, maximumTimeSeconds),
  }))
  const secondSweptBounds = second.colliders.map((collider) => ({
    collider,
    bounds: sweptBounds(collider, second.velocity, maximumTimeSeconds),
  }))
  let earliest: TimeOfImpact | null = null
  for (const firstEntry of firstSweptBounds) {
    for (const secondEntry of secondSweptBounds) {
      if (!colliderBoundsIntersect(firstEntry.bounds, secondEntry.bounds)) {
        continue
      }
      const impact = sweepConvexColliders(
        firstEntry.collider,
        first.velocity,
        secondEntry.collider,
        second.velocity,
        maximumTimeSeconds,
      )
      if (
        impact &&
        (!earliest ||
          impact.timeSeconds < earliest.timeSeconds - SWEEP_EPSILON ||
          (Math.abs(impact.timeSeconds - earliest.timeSeconds) <=
            SWEEP_EPSILON &&
            `${impact.firstColliderId}:${impact.secondColliderId}` <
              `${earliest.firstColliderId}:${earliest.secondColliderId}`))
      ) {
        earliest = impact
      }
    }
  }
  return earliest
}

/**
 * Advances two bodies only to their earliest impact and resolves every
 * compound contact present at that instant. The caller owns integration of
 * `remainingSeconds`, allowing repeated CCD inside the same fixed tick.
 */
export function resolveContinuousCollisionStep(
  first: ContinuousCollisionBody,
  second: ContinuousCollisionBody,
  maximumTimeSeconds: number,
  options: CollisionResponseOptions,
  iterations = physicsConstants.collision.solverIterations,
): ContinuousCollisionStepResult | null {
  const impact = sweepCompoundColliders(
    { colliders: first.colliders, velocity: first.body.velocity },
    { colliders: second.colliders, velocity: second.body.velocity },
    maximumTimeSeconds,
  )
  if (!impact) return null

  const elapsedSeconds = impact.timeSeconds
  first.body.position.x += first.body.velocity.x * elapsedSeconds
  first.body.position.y += first.body.velocity.y * elapsedSeconds
  second.body.position.x += second.body.velocity.x * elapsedSeconds
  second.body.position.y += second.body.velocity.y * elapsedSeconds
  const firstAtImpact = first.colliders.map((collider) =>
    translateCollider(collider, first.body.velocity, elapsedSeconds),
  )
  const secondAtImpact = second.colliders.map((collider) =>
    translateCollider(collider, second.body.velocity, elapsedSeconds),
  )
  const manifolds = findCompoundCollisionManifolds(
    firstAtImpact,
    secondAtImpact,
  )
  const resolution = resolveRigidBodyCollisions(
    first.body,
    second.body,
    manifolds.length > 0 ? manifolds : [impact.manifold],
    options,
    iterations,
  )
  return {
    impact,
    elapsedSeconds,
    remainingSeconds: Math.max(0, maximumTimeSeconds - elapsedSeconds),
    resolution,
  }
}
