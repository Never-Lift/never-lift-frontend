import type {
  TrackDefinition,
  TrackGate,
  TrackPathPoint,
  TrackRacingPoint,
} from '@/lib/api'
import { clamp, lerp, normalize, subtract } from '@/race/math'
import type { SurfaceId, Vector2 } from '@/race/types'

export type BarrierContact = {
  penetrationMeters: number
  pushNormal: Vector2
}

export type TrackProjection = {
  point: Vector2
  distanceFromCenterMeters: number
  distanceMeters: number
  halfWidthMeters: number
}

function projectOntoSegment(
  point: Vector2,
  from: Vector2,
  to: Vector2,
) {
  const segment = subtract(to, from)
  const lengthSquared = segment.x * segment.x + segment.y * segment.y
  const alpha =
    lengthSquared <= Number.EPSILON
      ? 0
      : clamp(
          ((point.x - from.x) * segment.x +
            (point.y - from.y) * segment.y) /
            lengthSquared,
          0,
          1,
        )
  const projected = {
    x: from.x + segment.x * alpha,
    y: from.y + segment.y * alpha,
  }
  return {
    alpha,
    point: projected,
    distance: Math.hypot(point.x - projected.x, point.y - projected.y),
  }
}

function distanceToPath(point: Vector2, path: Vector2[]) {
  let minimum = Number.POSITIVE_INFINITY
  for (let index = 0; index < path.length - 1; index += 1) {
    minimum = Math.min(
      minimum,
      projectOntoSegment(point, path[index], path[index + 1]).distance,
    )
  }
  return minimum
}

function pointAtDistance<T extends TrackRacingPoint>(
  path: T[],
  distanceMeters: number,
  trackLengthMeters: number,
): T {
  const normalizedDistance =
    ((distanceMeters % trackLengthMeters) + trackLengthMeters) %
    trackLengthMeters
  let low = 0
  let high = path.length - 1
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (path[middle].distanceMeters < normalizedDistance) low = middle + 1
    else high = middle
  }
  const toIndex = Math.max(1, low)
  const from = path[toIndex - 1]
  const to = path[toIndex]
  const span = Math.max(Number.EPSILON, to.distanceMeters - from.distanceMeters)
  const alpha = clamp((normalizedDistance - from.distanceMeters) / span, 0, 1)
  return {
    ...from,
    x: lerp(from.x, to.x, alpha),
    y: lerp(from.y, to.y, alpha),
    distanceMeters: normalizedDistance,
    targetSpeedFactor: lerp(
      from.targetSpeedFactor,
      to.targetSpeedFactor,
      alpha,
    ),
  }
}

export function crossesGate(
  from: Vector2,
  to: Vector2,
  gate: TrackGate,
  marginMeters = 0,
) {
  const fromRelative = subtract(from, gate.position)
  const toRelative = subtract(to, gate.position)
  const fromForward =
    fromRelative.x * gate.forward.x + fromRelative.y * gate.forward.y
  const toForward =
    toRelative.x * gate.forward.x + toRelative.y * gate.forward.y
  if (fromForward > 0 || toForward < 0 || toForward === fromForward) return false

  const crossingAlpha = clamp(
    -fromForward / (toForward - fromForward),
    0,
    1,
  )
  const crossingPoint = {
    x: lerp(from.x, to.x, crossingAlpha),
    y: lerp(from.y, to.y, crossingAlpha),
  }
  const lateral = {
    x: -gate.forward.y,
    y: gate.forward.x,
  }
  const crossingRelative = subtract(crossingPoint, gate.position)
  const lateralDistance = Math.abs(
    crossingRelative.x * lateral.x + crossingRelative.y * lateral.y,
  )
  return lateralDistance <= gate.halfWidthMeters + marginMeters
}

export class TrackGeometry {
  readonly definition: TrackDefinition

  constructor(definition: TrackDefinition) {
    if (definition.centerline.length < 2 || definition.racingLine.length < 2) {
      throw new Error('A definição da pista não possui geometria suficiente.')
    }
    this.definition = definition
  }

  project(point: Vector2, preferredDistanceMeters?: number): TrackProjection {
    let best: TrackProjection | null = null
    let bestPreferredDifference = Number.POSITIVE_INFINITY
    const path = this.definition.centerline
    for (let index = 0; index < path.length - 1; index += 1) {
      const from = path[index]
      const to = path[index + 1]
      const projected = projectOntoSegment(point, from, to)
      const distanceMeters = lerp(
        from.distanceMeters,
        to.distanceMeters,
        projected.alpha,
      )
      const preferredDifference =
        preferredDistanceMeters === undefined
          ? 0
          : Math.min(
              Math.abs(distanceMeters - preferredDistanceMeters),
              this.definition.lengthMeters -
                Math.abs(distanceMeters - preferredDistanceMeters),
            )
      const geometricallyBetter =
        !best || projected.distance < best.distanceFromCenterMeters - 0.5
      const equallyNearAndProgressivelyBetter =
        best !== null &&
        Math.abs(projected.distance - best.distanceFromCenterMeters) <= 0.5 &&
        preferredDifference < bestPreferredDifference
      if (!geometricallyBetter && !equallyNearAndProgressivelyBetter) continue
      best = {
        point: projected.point,
        distanceFromCenterMeters: projected.distance,
        distanceMeters,
        halfWidthMeters: lerp(
          from.halfWidthMeters,
          to.halfWidthMeters,
          projected.alpha,
        ),
      }
      bestPreferredDifference = preferredDifference
    }

    if (!best) throw new Error('Não foi possível projetar a posição na pista.')
    return best
  }

  getSurfaceAt(point: Vector2): SurfaceId {
    if (
      this.definition.pitLane.path.length >= 2 &&
      distanceToPath(point, this.definition.pitLane.path) <= 3
    ) {
      return this.definition.surfaceModel.pitLane
    }
    const projection = this.project(point)
    return projection.distanceFromCenterMeters <= projection.halfWidthMeters
      ? this.definition.surfaceModel.onTrack
      : this.definition.surfaceModel.offTrack
  }

  getBarrierContacts(
    point: Vector2,
    vehicleRadius: number,
  ): BarrierContact[] {
    const projection = this.project(point)
    const penetrationMeters =
      projection.distanceFromCenterMeters +
      vehicleRadius -
      projection.halfWidthMeters
    if (penetrationMeters <= 0) return []

    let pushNormal = normalize(subtract(projection.point, point))
    if (pushNormal.x === 0 && pushNormal.y === 0) {
      const tangent = this.getCenterlineTangent(projection.distanceMeters)
      pushNormal = { x: -tangent.y, y: tangent.x }
    }
    return [{ penetrationMeters, pushNormal }]
  }

  getRacingLinePoint(distanceMeters: number) {
    return pointAtDistance(
      this.definition.racingLine,
      distanceMeters,
      this.definition.lengthMeters,
    )
  }

  private getCenterlineTangent(distanceMeters: number) {
    const path = this.definition.centerline
    let nearestIndex = 1
    for (let index = 1; index < path.length; index += 1) {
      if (path[index].distanceMeters >= distanceMeters) {
        nearestIndex = index
        break
      }
    }
    const from: TrackPathPoint = path[Math.max(0, nearestIndex - 1)]
    const to: TrackPathPoint = path[nearestIndex]
    return normalize(subtract(to, from))
  }
}
