import physicsConstants from '../../contracts/module-2/v2/physics-constants.json'

import {
  add,
  clamp,
  cross,
  crossScalarVector,
  distanceSquared,
  dot,
  magnitude,
  normalize,
  perpendicularLeft,
  scale,
  subtract,
} from '@/race/math'
import type { Vector2 } from '@/race/types'
import type { WorldConvexCollider } from '@/race/vehicle-geometry'

export type CollisionManifold = {
  normal: Vector2
  penetrationMeters: number
  contacts: Vector2[]
  firstColliderId: string
  secondColliderId: string
  firstCollisionMaterial?: WorldConvexCollider['collisionMaterial']
  secondCollisionMaterial?: WorldConvexCollider['collisionMaterial']
}

export type RigidBody2D = {
  position: Vector2
  velocity: Vector2
  angle: number
  angularVelocity: number
  inverseMass: number
  inverseInertia: number
}

export type CollisionResponseOptions = {
  restitution: number
  friction: number
  positionCorrectionPercent: number
  penetrationSlopMeters: number
}

export type CollisionResolution = {
  impactSpeed: number
  normalImpulse: number
  frictionImpulse: number
  firstDeltaVelocityMetersPerSecond: number
  secondDeltaVelocityMetersPerSecond: number
}

const GEOMETRY_EPSILON = physicsConstants.collision.geometryEpsilon
const CONTACT_MERGE_DISTANCE_SQUARED =
  physicsConstants.collision.contactMergeDistanceMeters ** 2
const MAXIMUM_CONTACT_POINTS =
  physicsConstants.collision.maximumContactPoints
const MANIFOLD_NORMAL_MERGE_COSINE =
  physicsConstants.collision.manifoldNormalMergeCosine

export type ColliderBounds = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export function colliderBounds(
  collider: WorldConvexCollider,
): ColliderBounds {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const vertex of collider.vertices) {
    minX = Math.min(minX, vertex.x)
    minY = Math.min(minY, vertex.y)
    maxX = Math.max(maxX, vertex.x)
    maxY = Math.max(maxY, vertex.y)
  }
  return { minX, minY, maxX, maxY }
}

export function colliderBoundsIntersect(
  first: ColliderBounds,
  second: ColliderBounds,
) {
  return !(
    first.maxX < second.minX - GEOMETRY_EPSILON ||
    first.minX > second.maxX + GEOMETRY_EPSILON ||
    first.maxY < second.minY - GEOMETRY_EPSILON ||
    first.minY > second.maxY + GEOMETRY_EPSILON
  )
}

function compoundBounds(
  colliders: readonly WorldConvexCollider[],
): ColliderBounds | null {
  if (colliders.length === 0) return null
  const bounds = colliderBounds(colliders[0])
  for (const collider of colliders.slice(1)) {
    const part = colliderBounds(collider)
    bounds.minX = Math.min(bounds.minX, part.minX)
    bounds.minY = Math.min(bounds.minY, part.minY)
    bounds.maxX = Math.max(bounds.maxX, part.maxX)
    bounds.maxY = Math.max(bounds.maxY, part.maxY)
  }
  return bounds
}

type Projection = {
  minimum: number
  maximum: number
}

function polygonCenter(vertices: readonly Vector2[]): Vector2 {
  const sum = vertices.reduce(
    (center, vertex) => add(center, vertex),
    { x: 0, y: 0 },
  )
  return scale(sum, 1 / vertices.length)
}

function projectPolygon(
  vertices: readonly Vector2[],
  axis: Vector2,
): Projection {
  let minimum = dot(vertices[0], axis)
  let maximum = minimum
  for (const vertex of vertices.slice(1)) {
    const projected = dot(vertex, axis)
    minimum = Math.min(minimum, projected)
    maximum = Math.max(maximum, projected)
  }
  return { minimum, maximum }
}

function polygonAxes(vertices: readonly Vector2[]) {
  const axes: Vector2[] = []
  for (let index = 0; index < vertices.length; index += 1) {
    const edge = subtract(
      vertices[(index + 1) % vertices.length],
      vertices[index],
    )
    if (magnitude(edge) <= GEOMETRY_EPSILON) continue
    const axis = normalize(perpendicularLeft(edge))
    if (
      axes.some(
        (candidate) => Math.abs(dot(candidate, axis)) >= 1 - GEOMETRY_EPSILON,
      )
    ) {
      continue
    }
    axes.push(axis)
  }
  return axes
}

function pointInConvexPolygon(
  point: Vector2,
  polygon: readonly Vector2[],
) {
  let sign = 0
  for (let index = 0; index < polygon.length; index += 1) {
    const from = polygon[index]
    const to = polygon[(index + 1) % polygon.length]
    const side = cross(subtract(to, from), subtract(point, from))
    if (Math.abs(side) <= GEOMETRY_EPSILON) continue
    const currentSign = Math.sign(side)
    if (sign !== 0 && currentSign !== sign) return false
    sign = currentSign
  }
  return true
}

function segmentIntersection(
  firstFrom: Vector2,
  firstTo: Vector2,
  secondFrom: Vector2,
  secondTo: Vector2,
): Vector2 | null {
  const firstDirection = subtract(firstTo, firstFrom)
  const secondDirection = subtract(secondTo, secondFrom)
  const denominator = cross(firstDirection, secondDirection)
  if (Math.abs(denominator) <= GEOMETRY_EPSILON) return null
  const betweenOrigins = subtract(secondFrom, firstFrom)
  const firstAlpha = cross(betweenOrigins, secondDirection) / denominator
  const secondAlpha = cross(betweenOrigins, firstDirection) / denominator
  if (
    firstAlpha < -GEOMETRY_EPSILON ||
    firstAlpha > 1 + GEOMETRY_EPSILON ||
    secondAlpha < -GEOMETRY_EPSILON ||
    secondAlpha > 1 + GEOMETRY_EPSILON
  ) {
    return null
  }
  return add(firstFrom, scale(firstDirection, clamp(firstAlpha, 0, 1)))
}

function uniquePoints(points: Vector2[]) {
  const unique: Vector2[] = []
  for (const point of points) {
    if (
      unique.every(
        (candidate) =>
          distanceSquared(candidate, point) > CONTACT_MERGE_DISTANCE_SQUARED,
      )
    ) {
      unique.push(point)
    }
  }
  return unique
}

function supportPoint(vertices: readonly Vector2[], direction: Vector2) {
  return vertices.reduce((best, vertex) =>
    dot(vertex, direction) > dot(best, direction) ? vertex : best,
  )
}

function collisionContacts(
  first: readonly Vector2[],
  second: readonly Vector2[],
  normal: Vector2,
) {
  const candidates: Vector2[] = []
  for (const vertex of first) {
    if (pointInConvexPolygon(vertex, second)) candidates.push(vertex)
  }
  for (const vertex of second) {
    if (pointInConvexPolygon(vertex, first)) candidates.push(vertex)
  }
  for (let firstIndex = 0; firstIndex < first.length; firstIndex += 1) {
    const firstFrom = first[firstIndex]
    const firstTo = first[(firstIndex + 1) % first.length]
    for (let secondIndex = 0; secondIndex < second.length; secondIndex += 1) {
      const intersection = segmentIntersection(
        firstFrom,
        firstTo,
        second[secondIndex],
        second[(secondIndex + 1) % second.length],
      )
      if (intersection) candidates.push(intersection)
    }
  }

  const contacts = uniquePoints(candidates)
  if (contacts.length === 0) {
    return [
      scale(
        add(
          supportPoint(first, normal),
          supportPoint(second, scale(normal, -1)),
        ),
        0.5,
      ),
    ]
  }
  const planarContactLimit = Math.min(2, MAXIMUM_CONTACT_POINTS)
  if (contacts.length <= planarContactLimit) return contacts

  const tangent = perpendicularLeft(normal)
  const sorted = [...contacts].sort(
    (left, right) => dot(left, tangent) - dot(right, tangent),
  )
  if (planarContactLimit === 1) return [sorted[0]]
  return Array.from({ length: planarContactLimit }, (_, index) =>
    sorted[
      Math.round(
        (index * (sorted.length - 1)) /
          (planarContactLimit - 1),
      )
    ],
  )
}

export function isConvexPolygon(vertices: readonly Vector2[]) {
  if (vertices.length < 3) return false
  let turnSign = 0
  for (let index = 0; index < vertices.length; index += 1) {
    const first = vertices[index]
    const second = vertices[(index + 1) % vertices.length]
    const third = vertices[(index + 2) % vertices.length]
    const turn = cross(subtract(second, first), subtract(third, second))
    if (Math.abs(turn) <= GEOMETRY_EPSILON) continue
    const currentSign = Math.sign(turn)
    if (turnSign !== 0 && currentSign !== turnSign) return false
    turnSign = currentSign
  }
  return turnSign !== 0
}

/** SAT narrowphase for two convex polygons. Normal always points A -> B. */
export function findCollisionManifold(
  first: WorldConvexCollider,
  second: WorldConvexCollider,
): CollisionManifold | null {
  if (
    first.vertices.length < 3 ||
    second.vertices.length < 3 ||
    !isConvexPolygon(first.vertices) ||
    !isConvexPolygon(second.vertices)
  ) {
    throw new Error('SAT exige dois polígonos convexos válidos.')
  }

  let minimumOverlap = Number.POSITIVE_INFINITY
  let minimumAxis: Vector2 | null = null
  const axes = [
    ...polygonAxes(first.vertices),
    ...polygonAxes(second.vertices),
  ]
  for (const axis of axes) {
    const firstProjection = projectPolygon(first.vertices, axis)
    const secondProjection = projectPolygon(second.vertices, axis)
    const overlap =
      Math.min(firstProjection.maximum, secondProjection.maximum) -
      Math.max(firstProjection.minimum, secondProjection.minimum)
    if (overlap < -GEOMETRY_EPSILON) return null
    if (overlap < minimumOverlap) {
      minimumOverlap = Math.max(0, overlap)
      minimumAxis = axis
    }
  }
  if (!minimumAxis) return null

  const centerDelta = subtract(
    polygonCenter(second.vertices),
    polygonCenter(first.vertices),
  )
  const normal =
    dot(centerDelta, minimumAxis) < 0
      ? scale(minimumAxis, -1)
      : minimumAxis
  return {
    normal,
    penetrationMeters: minimumOverlap,
    contacts: collisionContacts(first.vertices, second.vertices, normal),
    firstColliderId: first.id,
    secondColliderId: second.id,
    firstCollisionMaterial: first.collisionMaterial,
    secondCollisionMaterial: second.collisionMaterial,
  }
}

function reducedContactSet(
  contacts: Vector2[],
  normal: Vector2,
) {
  const unique = uniquePoints(contacts)
  if (unique.length <= 2) return unique
  const tangent = perpendicularLeft(normal)
  const ordered = [...unique].sort(
    (left, right) =>
      dot(left, tangent) - dot(right, tangent) ||
      left.x - right.x ||
      left.y - right.y,
  )
  return [ordered[0], ordered.at(-1)!]
}

/**
 * Treats overlapping convex pieces as one physical union. Contacts with the
 * same normal are merged before the impulse solver, so overlapping floor,
 * body, tyre and wing pieces cannot multiply collision energy.
 */
export function consolidateCollisionManifolds(
  manifolds: readonly CollisionManifold[],
) {
  const clusters: CollisionManifold[][] = []
  for (const manifold of [...manifolds].sort(
    (left, right) =>
      left.firstColliderId.localeCompare(right.firstColliderId) ||
      left.secondColliderId.localeCompare(right.secondColliderId),
  )) {
    const cluster = clusters.find(
      (candidate) =>
        dot(candidate[0].normal, manifold.normal) >=
          MANIFOLD_NORMAL_MERGE_COSINE &&
        candidate[0].secondCollisionMaterial ===
          manifold.secondCollisionMaterial,
    )
    if (cluster) cluster.push(manifold)
    else clusters.push([manifold])
  }

  return clusters
    .map((cluster) => {
      const representative = cluster.reduce((best, candidate) =>
        candidate.penetrationMeters > best.penetrationMeters +
        GEOMETRY_EPSILON
          ? candidate
          : best,
      )
      return {
        ...representative,
        contacts: reducedContactSet(
          cluster.flatMap((manifold) => manifold.contacts),
          representative.normal,
        ),
      }
    })
    .sort(
      (left, right) =>
        left.firstColliderId.localeCompare(right.firstColliderId) ||
        left.secondColliderId.localeCompare(right.secondColliderId),
    )
}

export function findCompoundCollisionManifolds(
  firstParts: readonly WorldConvexCollider[],
  secondParts: readonly WorldConvexCollider[],
) {
  const firstBounds = compoundBounds(firstParts)
  const secondBounds = compoundBounds(secondParts)
  if (
    !firstBounds ||
    !secondBounds ||
    !colliderBoundsIntersect(firstBounds, secondBounds)
  ) {
    return []
  }
  const manifolds: CollisionManifold[] = []
  for (const first of firstParts) {
    const firstPartBounds = colliderBounds(first)
    for (const second of secondParts) {
      if (
        !colliderBoundsIntersect(
          firstPartBounds,
          colliderBounds(second),
        )
      ) {
        continue
      }
      const manifold = findCollisionManifold(first, second)
      if (manifold) manifolds.push(manifold)
    }
  }
  return consolidateCollisionManifolds(manifolds)
}

export function findCompoundCollisionManifold(
  firstParts: readonly WorldConvexCollider[],
  secondParts: readonly WorldConvexCollider[],
) {
  return findCompoundCollisionManifolds(firstParts, secondParts).reduce<
    CollisionManifold | null
  >(
    (deepest, manifold) =>
      !deepest || manifold.penetrationMeters > deepest.penetrationMeters
        ? manifold
        : deepest,
    null,
  )
}

function velocityAtPoint(body: RigidBody2D, radius: Vector2) {
  return add(
    body.velocity,
    crossScalarVector(body.angularVelocity, radius),
  )
}

function applyImpulse(
  body: RigidBody2D,
  impulse: Vector2,
  radius: Vector2,
) {
  body.velocity.x += impulse.x * body.inverseMass
  body.velocity.y += impulse.y * body.inverseMass
  body.angularVelocity += cross(radius, impulse) * body.inverseInertia
}

/** Resolves one deterministic manifold using impulses at its real contacts. */
export function resolveRigidBodyCollision(
  first: RigidBody2D,
  second: RigidBody2D,
  manifold: CollisionManifold,
  options: CollisionResponseOptions,
): CollisionResolution {
  const firstVelocityBefore = { ...first.velocity }
  const secondVelocityBefore = { ...second.velocity }
  const inverseMassSum = first.inverseMass + second.inverseMass
  if (inverseMassSum <= Number.EPSILON) {
    return {
      impactSpeed: 0,
      normalImpulse: 0,
      frictionImpulse: 0,
      firstDeltaVelocityMetersPerSecond: 0,
      secondDeltaVelocityMetersPerSecond: 0,
    }
  }

  const correctionMagnitude =
    (Math.max(
      manifold.penetrationMeters - options.penetrationSlopMeters,
      0,
    ) *
      options.positionCorrectionPercent) /
    inverseMassSum
  const correction = scale(manifold.normal, correctionMagnitude)
  first.position.x -= correction.x * first.inverseMass
  first.position.y -= correction.y * first.inverseMass
  second.position.x += correction.x * second.inverseMass
  second.position.y += correction.y * second.inverseMass

  let maximumImpactSpeed = 0
  let totalNormalImpulse = 0
  let totalFrictionImpulse = 0
  const contact =
    manifold.contacts.length === 0
      ? scale(add(first.position, second.position), 0.5)
      : scale(
          manifold.contacts.reduce(
            (sum, candidate) => add(sum, candidate),
            { x: 0, y: 0 },
          ),
          1 / manifold.contacts.length,
        )
  const firstRadius = subtract(contact, first.position)
  const secondRadius = subtract(contact, second.position)
  const relativeVelocity = subtract(
    velocityAtPoint(second, secondRadius),
    velocityAtPoint(first, firstRadius),
  )
  const velocityAlongNormal = dot(relativeVelocity, manifold.normal)
  maximumImpactSpeed = Math.max(maximumImpactSpeed, -velocityAlongNormal)

  const firstNormalLever = cross(firstRadius, manifold.normal)
  const secondNormalLever = cross(secondRadius, manifold.normal)
  const normalDenominator =
    inverseMassSum +
    firstNormalLever ** 2 * first.inverseInertia +
    secondNormalLever ** 2 * second.inverseInertia
  if (
    velocityAlongNormal < 0 &&
    normalDenominator > Number.EPSILON
  ) {
    const normalImpulseMagnitude =
      (-(1 + options.restitution) * velocityAlongNormal) /
      normalDenominator
    const normalImpulse = scale(manifold.normal, normalImpulseMagnitude)
    applyImpulse(first, scale(normalImpulse, -1), firstRadius)
    applyImpulse(second, normalImpulse, secondRadius)
    totalNormalImpulse += normalImpulseMagnitude

    const postNormalRelativeVelocity = subtract(
      velocityAtPoint(second, secondRadius),
      velocityAtPoint(first, firstRadius),
    )
    const rawTangent = subtract(
      postNormalRelativeVelocity,
      scale(manifold.normal, dot(postNormalRelativeVelocity, manifold.normal)),
    )
    if (magnitude(rawTangent) > GEOMETRY_EPSILON) {
      const tangent = normalize(rawTangent)
      const firstTangentLever = cross(firstRadius, tangent)
      const secondTangentLever = cross(secondRadius, tangent)
      const tangentDenominator =
        inverseMassSum +
        firstTangentLever ** 2 * first.inverseInertia +
        secondTangentLever ** 2 * second.inverseInertia
      if (tangentDenominator > Number.EPSILON) {
        const rawFrictionImpulse =
          -dot(postNormalRelativeVelocity, tangent) /
          tangentDenominator
        const frictionLimit = normalImpulseMagnitude * options.friction
        const frictionMagnitude = clamp(
          rawFrictionImpulse,
          -frictionLimit,
          frictionLimit,
        )
        const frictionImpulse = scale(tangent, frictionMagnitude)
        applyImpulse(first, scale(frictionImpulse, -1), firstRadius)
        applyImpulse(second, frictionImpulse, secondRadius)
        totalFrictionImpulse += Math.abs(frictionMagnitude)
      }
    }
  }

  return {
    impactSpeed: maximumImpactSpeed,
    normalImpulse: totalNormalImpulse,
    frictionImpulse: totalFrictionImpulse,
    firstDeltaVelocityMetersPerSecond: magnitude(
      subtract(first.velocity, firstVelocityBefore),
    ),
    secondDeltaVelocityMetersPerSecond: magnitude(
      subtract(second.velocity, secondVelocityBefore),
    ),
  }
}

/**
 * Sequential impulse solver for compound contacts. A stable feature-id order
 * makes the same manifold set resolve identically in prediction and authority.
 */
export function resolveRigidBodyCollisions(
  first: RigidBody2D,
  second: RigidBody2D,
  manifolds: readonly CollisionManifold[],
  options: CollisionResponseOptions,
  iterations = physicsConstants.collision.solverIterations,
): CollisionResolution {
  if (iterations < 1 || !Number.isInteger(iterations)) {
    throw new Error('O solver de contato exige pelo menos uma iteração inteira.')
  }
  const ordered = [...manifolds].sort(
    (left, right) =>
      left.firstColliderId.localeCompare(right.firstColliderId) ||
      left.secondColliderId.localeCompare(right.secondColliderId),
  )
  const total: CollisionResolution = {
    impactSpeed: 0,
    normalImpulse: 0,
    frictionImpulse: 0,
    firstDeltaVelocityMetersPerSecond: 0,
    secondDeltaVelocityMetersPerSecond: 0,
  }
  const firstVelocityBefore = { ...first.velocity }
  const secondVelocityBefore = { ...second.velocity }
  const iterationOptions = {
    ...options,
    positionCorrectionPercent:
      options.positionCorrectionPercent / iterations,
  }
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (const manifold of ordered) {
      const resolution = resolveRigidBodyCollision(
        first,
        second,
        manifold,
        iterationOptions,
      )
      total.impactSpeed = Math.max(
        total.impactSpeed,
        resolution.impactSpeed,
      )
      total.normalImpulse += resolution.normalImpulse
      total.frictionImpulse += resolution.frictionImpulse
    }
  }
  total.firstDeltaVelocityMetersPerSecond = magnitude(
    subtract(first.velocity, firstVelocityBefore),
  )
  total.secondDeltaVelocityMetersPerSecond = magnitude(
    subtract(second.velocity, secondVelocityBefore),
  )
  return total
}
