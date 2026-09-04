import * as PortableMath from '@/race/portable-math'

import physicsConstants from '../../contracts/module-2/v2/physics-constants.json'

import {
  add,
  dot,
  normalize,
  perpendicularLeft,
  rotate,
  scale,
  subtract,
} from '@/race/math'
import {
  colliderBounds,
  colliderBoundsIntersect,
  consolidateCollisionManifolds,
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

export type SweptPoseColliderBody = SweptColliderBody & {
  position: Vector2
  angularVelocity: number
}

export type TimeOfImpact = {
  timeSeconds: number
  normal: Vector2
  firstColliderId: string
  secondColliderId: string
  manifold: CollisionManifold
}

export type CompoundTimeOfImpact = {
  timeSeconds: number
  manifolds: CollisionManifold[]
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
const TIME_EPSILON_SECONDS = physicsConstants.collision.ccdTimeEpsilonSeconds
const STATIC_COLLIDER_BOUNDS = new WeakMap<
  WorldConvexCollider,
  ReturnType<typeof colliderBounds>
>()

function isStaticPoseBody(body: SweptPoseColliderBody) {
  return (
    body.velocity.x === 0 &&
    body.velocity.y === 0 &&
    body.angularVelocity === 0
  )
}

function cachedStaticColliderBounds(collider: WorldConvexCollider) {
  const cached = STATIC_COLLIDER_BOUNDS.get(collider)
  if (cached) return cached
  const bounds = colliderBounds(collider)
  STATIC_COLLIDER_BOUNDS.set(collider, bounds)
  return bounds
}

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

function colliderRadius(
  collider: WorldConvexCollider,
  body: SweptPoseColliderBody,
) {
  return collider.vertices.reduce(
    (radius, vertex) =>
      Math.max(
        radius,
        PortableMath.hypot(vertex.x - body.position.x, vertex.y - body.position.y),
      ),
    0,
  )
}

function colliderAtPoseTime(
  collider: WorldConvexCollider,
  body: SweptPoseColliderBody,
  timeSeconds: number,
): WorldConvexCollider {
  if (timeSeconds <= TIME_EPSILON_SECONDS || isStaticPoseBody(body)) {
    return collider
  }
  const translatedPosition = add(
    body.position,
    scale(body.velocity, timeSeconds),
  )
  const angularOffset = body.angularVelocity * timeSeconds
  return {
    id: collider.id,
    collisionMaterial: collider.collisionMaterial,
    vertices: collider.vertices.map((vertex) =>
      add(
        translatedPosition,
        rotate(subtract(vertex, body.position), angularOffset),
      ),
    ),
  }
}

function maximumColliderRadius(body: SweptPoseColliderBody) {
  return body.colliders.reduce(
    (maximum, collider) =>
      collider.vertices.reduce(
        (partMaximum, vertex) =>
          Math.max(
            partMaximum,
            PortableMath.hypot(
              vertex.x - body.position.x,
              vertex.y - body.position.y,
            ),
          ),
        maximum,
      ),
    0,
  )
}

function colliderMotionBounds(
  collider: WorldConvexCollider,
  body: SweptPoseColliderBody,
  maximumTimeSeconds: number,
) {
  if (isStaticPoseBody(body)) {
    return cachedStaticColliderBounds(collider)
  }
  const bounds = sweptBounds(collider, body.velocity, maximumTimeSeconds)
  const angularTravelRadians =
    Math.abs(body.angularVelocity) * maximumTimeSeconds
  const angularDisplacementMeters =
    angularTravelRadians <= Math.PI
      ? 2 *
        colliderRadius(collider, body) *
        PortableMath.sin(angularTravelRadians / 2)
      : 2 * colliderRadius(collider, body)
  bounds.minX -= angularDisplacementMeters
  bounds.minY -= angularDisplacementMeters
  bounds.maxX += angularDisplacementMeters
  bounds.maxY += angularDisplacementMeters
  return bounds
}

type PoseColliderPair = {
  first: WorldConvexCollider
  second: WorldConvexCollider
}

function candidateColliderPairs(
  first: SweptPoseColliderBody,
  second: SweptPoseColliderBody,
  maximumTimeSeconds: number,
): PoseColliderPair[] {
  const firstEntries = first.colliders.map((collider) => ({
    collider,
    bounds: colliderMotionBounds(collider, first, maximumTimeSeconds),
  }))
  const secondEntries = second.colliders.map((collider) => ({
    collider,
    bounds: colliderMotionBounds(collider, second, maximumTimeSeconds),
  }))
  const pairs: PoseColliderPair[] = []
  for (const firstEntry of firstEntries) {
    for (const secondEntry of secondEntries) {
      if (!colliderBoundsIntersect(firstEntry.bounds, secondEntry.bounds)) {
        continue
      }
      pairs.push({ first: firstEntry.collider, second: secondEntry.collider })
    }
  }
  return pairs.sort(
    (left, right) =>
      (left.first.id < right.first.id
        ? -1
        : left.first.id > right.first.id
          ? 1
          : 0) ||
      (left.second.id < right.second.id
        ? -1
        : left.second.id > right.second.id
          ? 1
          : 0),
  )
}

function pairMayOverlapDuringPoseGap(
  first: SweptPoseColliderBody,
  second: SweptPoseColliderBody,
  pair: PoseColliderPair,
  gapStartSeconds: number,
  gapDurationSeconds: number,
) {
  const firstCollider = colliderAtPoseTime(pair.first, first, gapStartSeconds)
  const secondCollider = colliderAtPoseTime(pair.second, second, gapStartSeconds)
  const firstAtGapStart: SweptPoseColliderBody = {
    colliders: [firstCollider],
    position: add(first.position, scale(first.velocity, gapStartSeconds)),
    velocity: first.velocity,
    angularVelocity: first.angularVelocity,
  }
  const secondAtGapStart: SweptPoseColliderBody = {
    colliders: [secondCollider],
    position: add(second.position, scale(second.velocity, gapStartSeconds)),
    velocity: second.velocity,
    angularVelocity: second.angularVelocity,
  }
  return colliderBoundsIntersect(
    colliderMotionBounds(firstCollider, firstAtGapStart, gapDurationSeconds),
    colliderMotionBounds(secondCollider, secondAtGapStart, gapDurationSeconds),
  )
}

function orderedUniqueProbeTimes(times: ReadonlySet<number>) {
  const ordered = [...times].sort((left, right) => left - right)
  return ordered.filter(
    (timeSeconds, index) =>
      index === 0 ||
      timeSeconds - ordered[index - 1] > TIME_EPSILON_SECONDS,
  )
}

function manifoldsForPairsAtPoseTime(
  first: SweptPoseColliderBody,
  second: SweptPoseColliderBody,
  pairs: readonly PoseColliderPair[],
  timeSeconds: number,
): CollisionManifold[] {
  const firstAtTime = new Map<string, WorldConvexCollider>()
  const secondAtTime = new Map<string, WorldConvexCollider>()
  const manifolds: CollisionManifold[] = []
  for (const pair of pairs) {
    let firstCollider = firstAtTime.get(pair.first.id)
    if (!firstCollider) {
      firstCollider = colliderAtPoseTime(pair.first, first, timeSeconds)
      firstAtTime.set(pair.first.id, firstCollider)
    }
    let secondCollider = secondAtTime.get(pair.second.id)
    if (!secondCollider) {
      secondCollider = colliderAtPoseTime(pair.second, second, timeSeconds)
      secondAtTime.set(pair.second.id, secondCollider)
    }
    const manifold = findCollisionManifold(firstCollider, secondCollider)
    if (manifold) manifolds.push(manifold)
  }
  return consolidateCollisionManifolds(manifolds)
}

function refineFirstOccupiedPose(
  first: SweptPoseColliderBody,
  second: SweptPoseColliderBody,
  pairs: readonly PoseColliderPair[],
  clearTimeSeconds: number,
  occupiedTimeSeconds: number,
  occupiedManifolds: CollisionManifold[],
) {
  let lowerTimeSeconds = clearTimeSeconds
  let upperTimeSeconds = occupiedTimeSeconds
  let upperManifolds = occupiedManifolds
  for (
    let iteration = 0;
    iteration < physicsConstants.collision.ccdTimeRefinementIterations;
    iteration += 1
  ) {
    const middleTimeSeconds = (lowerTimeSeconds + upperTimeSeconds) / 2
    const middleManifolds = manifoldsForPairsAtPoseTime(
      first,
      second,
      pairs,
      middleTimeSeconds,
    )
    if (middleManifolds.length === 0) {
      lowerTimeSeconds = middleTimeSeconds
    } else {
      upperTimeSeconds = middleTimeSeconds
      upperManifolds = middleManifolds
    }
  }
  return { timeSeconds: upperTimeSeconds, manifolds: upperManifolds }
}

function simultaneousLinearImpactManifolds(
  first: SweptPoseColliderBody,
  second: SweptPoseColliderBody,
  maximumTimeSeconds: number,
  impact: TimeOfImpact,
) {
  const manifolds: CollisionManifold[] = []
  for (const pair of candidateColliderPairs(
    first,
    second,
    maximumTimeSeconds,
  )) {
    const candidate = sweepConvexColliders(
      pair.first,
      first.velocity,
      pair.second,
      second.velocity,
      maximumTimeSeconds,
    )
    if (
      candidate &&
      Math.abs(candidate.timeSeconds - impact.timeSeconds) <=
        TIME_EPSILON_SECONDS
    ) {
      manifolds.push(candidate.manifold)
    }
  }
  const consolidated = consolidateCollisionManifolds(manifolds)
  return consolidated.length > 0 ? consolidated : [impact.manifold]
}

/**
 * Deterministic pose sweep for angular motion. Angular envelope travel splits
 * the step into contract-sized intervals. Each interval uses exact linear
 * swept SAT as a candidate generator, but only a manifold evaluated at the
 * actual translated-and-rotated pose can become a contact.
 */
export function sweepCompoundCollidersWithRotation(
  first: SweptPoseColliderBody,
  second: SweptPoseColliderBody,
  maximumTimeSeconds: number,
): CompoundTimeOfImpact | null {
  if (maximumTimeSeconds < 0) {
    throw new Error('O intervalo de CCD não pode ser negativo.')
  }
  const maximumAngularTravelMeters =
    (Math.abs(first.angularVelocity) * maximumColliderRadius(first) +
      Math.abs(second.angularVelocity) * maximumColliderRadius(second)) *
    maximumTimeSeconds
  if (maximumAngularTravelMeters <= SWEEP_EPSILON) {
    const impact = sweepCompoundColliders(first, second, maximumTimeSeconds)
    if (!impact) return null
    return {
      timeSeconds: impact.timeSeconds,
      manifolds: simultaneousLinearImpactManifolds(
        first,
        second,
        maximumTimeSeconds,
        impact,
      ),
    }
  }

  const candidatePairs = candidateColliderPairs(
    first,
    second,
    maximumTimeSeconds,
  )
  if (candidatePairs.length === 0) return null

  const initialManifolds = manifoldsForPairsAtPoseTime(
    first,
    second,
    candidatePairs,
    0,
  )
  if (initialManifolds.length > 0) {
    return { timeSeconds: 0, manifolds: initialManifolds }
  }

  const intervalCount = Math.max(
    1,
    Math.ceil(
      maximumAngularTravelMeters /
        physicsConstants.collision.ccdMaximumAngularArcStepMeters,
    ),
  )
  let clearTimeSeconds = 0
  for (let interval = 1; interval <= intervalCount; interval += 1) {
    const intervalEndSeconds =
      (maximumTimeSeconds * interval) / intervalCount
    const intervalSeconds = intervalEndSeconds - clearTimeSeconds
    const intervalAngularTravelMeters = maximumAngularTravelMeters / intervalCount
    const subdivisions = Math.max(
      1,
      Math.ceil(
        intervalAngularTravelMeters /
          (physicsConstants.collision.ccdMaximumAngularArcStepMeters /
            physicsConstants.collision
              .ccdAngularPoseSamplesPerMaximumArcStep),
      ),
    )
    const probeTimes = new Set<number>()
    for (const pair of candidatePairs) {
      const impact = sweepConvexColliders(
        colliderAtPoseTime(pair.first, first, clearTimeSeconds),
        first.velocity,
        colliderAtPoseTime(pair.second, second, clearTimeSeconds),
        second.velocity,
        intervalSeconds,
      )
      if (
        impact &&
        impact.timeSeconds > TIME_EPSILON_SECONDS &&
        impact.timeSeconds < intervalSeconds - TIME_EPSILON_SECONDS
      ) {
        probeTimes.add(clearTimeSeconds + impact.timeSeconds)
      }
    }
    for (let sample = 1; sample <= subdivisions; sample += 1) {
      probeTimes.add(
        clearTimeSeconds + (intervalSeconds * sample) / subdivisions,
      )
    }

    let previousProbeTimeSeconds = clearTimeSeconds
    for (const probeTimeSeconds of orderedUniqueProbeTimes(probeTimes)) {
      const gapDurationSeconds =
        probeTimeSeconds - previousProbeTimeSeconds
      if (
        gapDurationSeconds > TIME_EPSILON_SECONDS &&
        candidatePairs.some((pair) =>
          pairMayOverlapDuringPoseGap(
            first,
            second,
            pair,
            previousProbeTimeSeconds,
            gapDurationSeconds,
          ),
        )
      ) {
        const midpointSeconds =
          previousProbeTimeSeconds + gapDurationSeconds / 2
        const midpointManifolds = manifoldsForPairsAtPoseTime(
          first,
          second,
          candidatePairs,
          midpointSeconds,
        )
        if (midpointManifolds.length > 0) {
          return refineFirstOccupiedPose(
            first,
            second,
            candidatePairs,
            previousProbeTimeSeconds,
            midpointSeconds,
            midpointManifolds,
          )
        }
      }
      const probeManifolds = manifoldsForPairsAtPoseTime(
        first,
        second,
        candidatePairs,
        probeTimeSeconds,
      )
      if (probeManifolds.length > 0) {
        return refineFirstOccupiedPose(
          first,
          second,
          candidatePairs,
          previousProbeTimeSeconds,
          probeTimeSeconds,
          probeManifolds,
        )
      }
      previousProbeTimeSeconds = probeTimeSeconds
    }
    clearTimeSeconds = intervalEndSeconds
  }
  return null
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
    if (entryTime - exitTime > TIME_EPSILON_SECONDS) return null
  }
  if (
    entryTime < -TIME_EPSILON_SECONDS ||
    entryTime > maximumTimeSeconds + TIME_EPSILON_SECONDS
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
          impact.timeSeconds < earliest.timeSeconds - TIME_EPSILON_SECONDS ||
          (Math.abs(impact.timeSeconds - earliest.timeSeconds) <=
            TIME_EPSILON_SECONDS &&
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
