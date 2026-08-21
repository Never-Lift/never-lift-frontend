import type {
  TrackDefinition,
  TrackGate,
  TrackLimitSegment,
  TrackPathPoint,
  TrackRacingPoint,
  TrackSideEnvironment,
  TrackSurfaceMaterial,
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
  elevationLayer: number
}

export type TrackSide = 'left' | 'right'

export type TrackEnvironmentSample = {
  side: TrackSide
  environment: TrackSideEnvironment
  material: TrackSurfaceMaterial
  distanceBeyondTrackMeters: number
  totalEnvironmentWidthMeters: number
}

const LOCAL_PROJECTION_WINDOW_METERS = 40
const LOCAL_PROJECTION_RECOVERY_MARGIN_METERS = 24
const PROJECTION_DISTANCE_TOLERANCE_METERS = 0.5

export function trackSideEnvironmentWidth(environment: TrackSideEnvironment) {
  return environment.zones.reduce((sum, zone) => sum + zone.widthMeters, 0)
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

function circularDistanceMeters(
  firstDistanceMeters: number,
  secondDistanceMeters: number,
  trackLengthMeters: number,
) {
  const normalizedFirst =
    ((firstDistanceMeters % trackLengthMeters) + trackLengthMeters) %
    trackLengthMeters
  const normalizedSecond =
    ((secondDistanceMeters % trackLengthMeters) + trackLengthMeters) %
    trackLengthMeters
  const directDistance = Math.abs(normalizedFirst - normalizedSecond)
  return Math.min(directDistance, trackLengthMeters - directDistance)
}

type ProjectionCandidate = TrackProjection & {
  preferredDifferenceMeters: number
}

function elevationLayerOf(point: TrackPathPoint) {
  return (
    point as TrackPathPoint & {
      elevationLayer?: number
    }
  ).elevationLayer ?? 0
}

function projectionWithoutRanking(
  candidate: ProjectionCandidate,
): TrackProjection {
  return {
    point: candidate.point,
    distanceFromCenterMeters: candidate.distanceFromCenterMeters,
    distanceMeters: candidate.distanceMeters,
    halfWidthMeters: candidate.halfWidthMeters,
    elevationLayer: candidate.elevationLayer,
  }
}

function isBetterProjection(
  candidate: ProjectionCandidate,
  current: ProjectionCandidate | null,
) {
  if (!current) return true
  if (
    candidate.distanceFromCenterMeters <
    current.distanceFromCenterMeters - PROJECTION_DISTANCE_TOLERANCE_METERS
  ) {
    return true
  }
  return (
    Math.abs(
      candidate.distanceFromCenterMeters - current.distanceFromCenterMeters,
    ) <= PROJECTION_DISTANCE_TOLERANCE_METERS &&
    candidate.preferredDifferenceMeters < current.preferredDifferenceMeters
  )
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
    let globalBest: ProjectionCandidate | null = null
    let localBest: ProjectionCandidate | null = null
    const path = this.definition.centerline
    const localWindowMeters = Math.min(
      LOCAL_PROJECTION_WINDOW_METERS,
      this.definition.lengthMeters / 2,
    )
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
          : circularDistanceMeters(
              distanceMeters,
              preferredDistanceMeters,
              this.definition.lengthMeters,
            )
      const candidate: ProjectionCandidate = {
        point: projected.point,
        distanceFromCenterMeters: projected.distance,
        distanceMeters,
        halfWidthMeters: lerp(
          from.halfWidthMeters,
          to.halfWidthMeters,
          projected.alpha,
        ),
        elevationLayer:
          projected.alpha < 0.5
            ? elevationLayerOf(from)
            : elevationLayerOf(to),
        preferredDifferenceMeters: preferredDifference,
      }
      if (isBetterProjection(candidate, globalBest)) globalBest = candidate
      if (
        preferredDistanceMeters !== undefined &&
        preferredDifference <= localWindowMeters &&
        isBetterProjection(candidate, localBest)
      ) {
        localBest = candidate
      }
    }

    if (!globalBest) {
      throw new Error('Não foi possível projetar a posição na pista.')
    }
    if (!localBest) return projectionWithoutRanking(globalBest)

    const localSegment = this.getTrackLimitSegment(localBest.distanceMeters)
    const maximumEnvironmentWidthMeters = Math.max(
      trackSideEnvironmentWidth(localSegment.left),
      trackSideEnvironmentWidth(localSegment.right),
    )
    const maximumPlausibleLocalDistanceMeters =
      localBest.halfWidthMeters +
      maximumEnvironmentWidthMeters +
      LOCAL_PROJECTION_RECOVERY_MARGIN_METERS

    return projectionWithoutRanking(
      localBest.distanceFromCenterMeters <= maximumPlausibleLocalDistanceMeters
        ? localBest
        : globalBest,
    )
  }

  getElevationLayerAt(
    point: Vector2,
    preferredDistanceMeters?: number,
  ) {
    return this.project(point, preferredDistanceMeters).elevationLayer
  }

  getSurfaceAt(
    point: Vector2,
    preferredDistanceMeters?: number,
  ): SurfaceId {
    if (
      this.definition.pitLane.path.length >= 2 &&
      distanceToPath(point, this.definition.pitLane.path) <= 3
    ) {
      return this.definition.surfaceModel.pitLane
    }
    const material = this.getEnvironmentAt(
      point,
      preferredDistanceMeters,
    ).material
    return material === 'asphalt' ? 'asphalt' : 'grass'
  }

  getEnvironmentAt(
    point: Vector2,
    preferredDistanceMeters?: number,
  ): TrackEnvironmentSample {
    const projection = this.project(point, preferredDistanceMeters)
    const tangent = this.getCenterlineTangent(projection.distanceMeters)
    const relative = subtract(point, projection.point)
    const side: TrackSide =
      tangent.x * relative.y - tangent.y * relative.x >= 0
        ? 'left'
        : 'right'
    const environment = this.getTrackSideEnvironmentAt(
      projection.distanceMeters,
      side,
    )
    const distanceBeyondTrackMeters = Math.max(
      0,
      projection.distanceFromCenterMeters - projection.halfWidthMeters,
    )
    let material: TrackSurfaceMaterial = this.definition.surfaceModel.onTrack
    if (distanceBeyondTrackMeters > 0) {
      let zoneEnd = 0
      for (const zone of environment.zones) {
        zoneEnd += zone.widthMeters
        if (distanceBeyondTrackMeters <= zoneEnd) {
          material = zone.surface
          break
        }
      }
      if (distanceBeyondTrackMeters > zoneEnd && environment.zones.length > 0) {
        material = environment.zones.at(-1)!.surface
      }
    }
    return {
      side,
      environment,
      material,
      distanceBeyondTrackMeters,
      totalEnvironmentWidthMeters: trackSideEnvironmentWidth(environment),
    }
  }

  getTrackSideEnvironmentAt(
    distanceMeters: number,
    side: TrackSide,
  ): TrackSideEnvironment {
    const segment = this.getTrackLimitSegment(distanceMeters)
    return segment[side]
  }

  getBarrierContacts(
    point: Vector2,
    vehicleRadius: number,
    preferredDistanceMeters?: number,
  ): BarrierContact[] {
    const projection = this.project(point, preferredDistanceMeters)
    const tangent = this.getCenterlineTangent(projection.distanceMeters)
    const relative = subtract(point, projection.point)
    const side =
      tangent.x * relative.y - tangent.y * relative.x >= 0
        ? 'left'
        : 'right'
    const environment = this.getTrackSideEnvironmentAt(
      projection.distanceMeters,
      side,
    )
    const penetrationMeters =
      projection.distanceFromCenterMeters +
      vehicleRadius -
      projection.halfWidthMeters -
      trackSideEnvironmentWidth(environment)
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

  private getTrackLimitSegment(distanceMeters: number): TrackLimitSegment {
    const length = this.definition.lengthMeters
    const normalizedDistance = ((distanceMeters % length) + length) % length
    return (
      this.definition.trackLimits.segments.find(
        (segment) =>
          normalizedDistance >= segment.fromDistanceMeters &&
          normalizedDistance < segment.toDistanceMeters,
      ) ?? this.definition.trackLimits.segments.at(-1)!
    )
  }

  getCenterlineTangent(distanceMeters: number) {
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
