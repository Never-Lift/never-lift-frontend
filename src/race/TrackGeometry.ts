import * as PortableMath from '@/race/portable-math'

import type {
  TrackBarrierGeometrySegment,
  TrackBounds,
  TrackChunk,
  TrackDefinition,
  TrackGate,
  TrackLimitSegment,
  TrackPathPoint,
  TrackPitGarageBarrier,
  TrackRacingPoint,
  TrackSideEnvironment,
  TrackSurfaceMaterial,
  TrackEscapeRoad,
} from '@/lib/api'
import {
  add,
  clamp,
  lerp,
  normalize,
  perpendicularLeft,
  scale,
  subtract,
} from '@/race/math'
import {
  colliderBounds,
  colliderBoundsIntersect,
  findCompoundCollisionManifolds,
  type ColliderBounds,
  type CollisionManifold,
} from '@/race/rigid-body-collision'
import { PHYSICS_CONSTANTS } from '@/race/constants'
import type { SurfaceId, Vector2 } from '@/race/types'
import type { WorldConvexCollider } from '@/race/vehicle-geometry'

export type BarrierFaceSegment = {
  id: string
  barrierIndex: number
  side: TrackSide
  material: TrackBarrierGeometrySegment['material']
  collisionLayer: 'track-barrier'
  chunkIndexes: number[]
  elevationLayer: number
  fromDistanceMeters: number
  toDistanceMeters: number
  thicknessMeters: number
  from: Vector2
  to: Vector2
  inwardNormal: Vector2
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

const {
  localProjectionWindowMeters: LOCAL_PROJECTION_WINDOW_METERS,
  localProjectionRecoveryMarginMeters:
    LOCAL_PROJECTION_RECOVERY_MARGIN_METERS,
  projectionDistanceToleranceMeters: PROJECTION_DISTANCE_TOLERANCE_METERS,
  barrierBroadphaseCellMeters: BARRIER_BROADPHASE_CELL_METERS,
} = PHYSICS_CONSTANTS.race

type BarrierColliderRecord = {
  face: BarrierFaceSegment
  collider: WorldConvexCollider
  bounds: ColliderBounds
}

type CenterlineProjectionBlock = {
  indexes: number[]
  bounds: TrackBounds
}

const CENTERLINE_PROJECTION_BLOCK_SEGMENTS = 32

export function trackSideEnvironmentWidth(environment: TrackSideEnvironment) {
  return environment.zones.reduce((sum, zone) => sum + zone.widthMeters, 0)
}

function boundsIntersect(first: TrackBounds, second: TrackBounds) {
  return !(
    first.maxX < second.minX ||
    first.minX > second.maxX ||
    first.maxY < second.minY ||
    first.minY > second.maxY
  )
}

function barrierSegmentNormal(side: TrackSide, from: Vector2, to: Vector2) {
  const leftNormal = normalize(perpendicularLeft(subtract(to, from)))
  return side === 'left' ? scale(leftNormal, -1) : leftNormal
}

/** Builds barrier thickness away from the track-facing canonical path. */
export function barrierFaceSegmentCollider(
  segment: BarrierFaceSegment,
): WorldConvexCollider {
  const outward = scale(segment.inwardNormal, -segment.thicknessMeters)
  return {
    id: segment.id,
    collisionMaterial: segment.material,
    vertices: [
      segment.from,
      add(segment.from, outward),
      add(segment.to, outward),
      segment.to,
    ],
  }
}

function buildBarrierFaceSegments(
  barriers: readonly TrackBarrierGeometrySegment[],
  chunks: readonly TrackChunk[],
) {
  const segments: BarrierFaceSegment[] = []
  for (const barrier of barriers) {
    for (let pathIndex = 0; pathIndex < barrier.path.length - 1; pathIndex += 1) {
      const from = barrier.path[pathIndex]
      const to = barrier.path[pathIndex + 1]
      const inwardNormal = barrierSegmentNormal(barrier.side, from, to)
      if (inwardNormal.x === 0 && inwardNormal.y === 0) continue
      const localChunkIndexes = chunks
        .filter(
          (chunk) =>
            chunk.toDistanceMeters >= from.distanceMeters &&
            chunk.fromDistanceMeters <= to.distanceMeters,
        )
        .map((chunk) => chunk.index)
      segments.push({
        id: `barrier-${barrier.index}-${pathIndex}`,
        barrierIndex: barrier.index,
        side: barrier.side,
        material: barrier.material,
        collisionLayer: barrier.collisionLayer,
        chunkIndexes:
          localChunkIndexes.length > 0
            ? localChunkIndexes
            : barrier.chunkIndexes,
        elevationLayer: from.elevationLayer,
        fromDistanceMeters: from.distanceMeters,
        toDistanceMeters: to.distanceMeters,
        thicknessMeters: barrier.thicknessMeters,
        from: { x: from.x, y: from.y },
        to: { x: to.x, y: to.y },
        inwardNormal,
      })
    }
  }
  return segments
}

function buildPitGarageBarrierFaceSegments(
  garageBarrier: TrackPitGarageBarrier,
  trackLengthMeters: number,
  chunks: readonly TrackChunk[],
): BarrierFaceSegment[] {
  const segments: BarrierFaceSegment[] = []
  for (let pathIndex = 0; pathIndex < garageBarrier.path.length - 1; pathIndex += 1) {
    const from = garageBarrier.path[pathIndex]
    const to = garageBarrier.path[pathIndex + 1]
    const inwardNormal = barrierSegmentNormal(garageBarrier.side, from, to)
    if (inwardNormal.x === 0 && inwardNormal.y === 0) continue
    segments.push({
      id: `garage-barrier-${pathIndex}`,
      barrierIndex: -1,
      side: garageBarrier.side,
      material: garageBarrier.material,
      collisionLayer: 'track-barrier',
      chunkIndexes: chunks.map((chunk) => chunk.index),
      elevationLayer: 0,
      fromDistanceMeters: 0,
      toDistanceMeters: trackLengthMeters,
      thicknessMeters: garageBarrier.thicknessMeters,
      from,
      to,
      inwardNormal,
    })
  }
  return segments
}

function orientedSegmentCollider(
  id: string,
  from: Vector2,
  to: Vector2,
  halfDepthMeters: number,
  collisionMaterial: WorldConvexCollider['collisionMaterial'],
): WorldConvexCollider {
  const tangent = normalize(subtract(to, from))
  const normal = perpendicularLeft(tangent)
  const halfLength = Math.max(Number.EPSILON, PortableMath.hypot(to.x - from.x, to.y - from.y) / 2)
  const center = {
    x: (from.x + to.x) / 2,
    y: (from.y + to.y) / 2,
  }
  const extendedFrom = {
    x: center.x - tangent.x * halfLength,
    y: center.y - tangent.y * halfLength,
  }
  const extendedTo = {
    x: center.x + tangent.x * halfLength,
    y: center.y + tangent.y * halfLength,
  }
  return {
    id,
    collisionMaterial,
    vertices: [
      {
        x: extendedFrom.x - normal.x * halfDepthMeters,
        y: extendedFrom.y - normal.y * halfDepthMeters,
      },
      {
        x: extendedTo.x - normal.x * halfDepthMeters,
        y: extendedTo.y - normal.y * halfDepthMeters,
      },
      {
        x: extendedTo.x + normal.x * halfDepthMeters,
        y: extendedTo.y + normal.y * halfDepthMeters,
      },
      {
        x: extendedFrom.x + normal.x * halfDepthMeters,
        y: extendedFrom.y + normal.y * halfDepthMeters,
      },
    ],
  }
}

function buildEscapeRoadColliderRecords(
  roads: readonly TrackEscapeRoad[],
  chunks: readonly TrackChunk[],
): BarrierColliderRecord[] {
  const records: BarrierColliderRecord[] = []
  const chunkIndexes = chunks.map((chunk) => chunk.index)
  for (const road of roads) {
    if (!road.affectsPhysics || road.path.length < 2) continue
    for (let rowIndex = 0; rowIndex < road.obstacleRows.length; rowIndex += 1) {
      const row = road.obstacleRows[rowIndex]
      const delta = subtract(row.to, row.from)
      const lengthMeters = PortableMath.hypot(delta.x, delta.y)
      if (lengthMeters <= Number.EPSILON) continue
      const blockCount = Math.max(1, Math.ceil(lengthMeters / row.blockLengthMeters))
      const blockDepthMeters = Math.min(0.85, row.blockLengthMeters * 0.8)
      for (let blockIndex = 0; blockIndex < blockCount; blockIndex += 1) {
        const fromDistance = (lengthMeters * blockIndex) / blockCount
        const toDistance = (lengthMeters * (blockIndex + 1)) / blockCount
        const from = {
          x: row.from.x + (delta.x / lengthMeters) * fromDistance,
          y: row.from.y + (delta.y / lengthMeters) * fromDistance,
        }
        const to = {
          x: row.from.x + (delta.x / lengthMeters) * toDistance,
          y: row.from.y + (delta.y / lengthMeters) * toDistance,
        }
        const id = `escape-${road.id}-row-${rowIndex}-block-${blockIndex}`
        const collider = orientedSegmentCollider(
          id,
          from,
          to,
          blockDepthMeters / 2,
          row.collisionMaterial ?? 'concrete-wall',
        )
        records.push({
          face: {
            id,
            barrierIndex: -1,
            side: 'left',
            material: row.collisionMaterial ?? 'concrete-wall',
            collisionLayer: 'track-barrier',
            chunkIndexes,
            elevationLayer: road.elevationLayer,
            fromDistanceMeters: 0,
            toDistanceMeters: 0,
            thicknessMeters: blockDepthMeters,
            from,
            to,
            inwardNormal: normalize(perpendicularLeft(subtract(to, from))),
          },
          collider,
          bounds: colliderBounds(collider),
        })
      }
    }
    if (road.edgeMaterial !== 'concrete-wall') continue
    const edgeThicknessMeters = 0.35
    for (let pathIndex = 0; pathIndex < road.path.length - 1; pathIndex += 1) {
      const from = road.path[pathIndex]
      const to = road.path[pathIndex + 1]
      const tangent = normalize(subtract(to, from))
      if (tangent.x === 0 && tangent.y === 0) continue
      const normal = perpendicularLeft(tangent)
      for (const side of road.edgeSides ?? (['left', 'right'] as const)) {
        const direction = side === 'left' ? 1 : -1
        const offset = road.widthMeters / 2
        const edgeFrom = {
          x: from.x + normal.x * direction * offset,
          y: from.y + normal.y * direction * offset,
        }
        const edgeTo = {
          x: to.x + normal.x * direction * offset,
          y: to.y + normal.y * direction * offset,
        }
        const id = `escape-${road.id}-edge-${side}-${pathIndex}`
        const collider = orientedSegmentCollider(
          id,
          edgeFrom,
          edgeTo,
          edgeThicknessMeters / 2,
          road.edgeMaterial,
        )
        records.push({
          face: {
            id,
            barrierIndex: -1,
            side,
            material: road.edgeMaterial,
            collisionLayer: 'track-barrier',
            chunkIndexes,
            elevationLayer: road.elevationLayer,
            fromDistanceMeters: 0,
            toDistanceMeters: 0,
            thicknessMeters: edgeThicknessMeters,
            from: edgeFrom,
            to: edgeTo,
            inwardNormal: scale(normal, -direction),
          },
          collider,
          bounds: colliderBounds(collider),
        })
      }
    }
  }
  return records
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
    distance: PortableMath.hypot(point.x - projected.x, point.y - projected.y),
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

function pointAtDistance<T extends TrackRacingPoint | TrackPathPoint>(
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
  const interpolated = {
    ...from,
    x: lerp(from.x, to.x, alpha),
    y: lerp(from.y, to.y, alpha),
    distanceMeters: normalizedDistance,
  }
  if ('targetSpeedFactor' in from && 'targetSpeedFactor' in to) {
    return {
      ...interpolated,
      targetSpeedFactor: lerp(
        from.targetSpeedFactor,
        to.targetSpeedFactor,
        alpha,
      ),
    } as T
  }
  if ('halfWidthMeters' in from && 'halfWidthMeters' in to) {
    return {
      ...interpolated,
      halfWidthMeters: lerp(from.halfWidthMeters, to.halfWidthMeters, alpha),
      elevationLayer: alpha < 0.5 ? from.elevationLayer : to.elevationLayer,
    } as T
  }
  return interpolated as T
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
  private readonly barrierFaces: readonly TrackBarrierGeometrySegment[]
  private readonly explicitBarrierFaceSegments: BarrierFaceSegment[]
  private readonly barrierColliderRecords: BarrierColliderRecord[]
  private readonly barrierRecordsByCell = new Map<string, BarrierColliderRecord[]>()
  private readonly expandedChunkBounds = new Map<number, TrackBounds>()
  private readonly centerlineProjectionBlocks: CenterlineProjectionBlock[]

  constructor(definition: TrackDefinition) {
    if (definition.centerline.length < 2 || definition.racingLine.length < 2) {
      throw new Error('A definição da pista não possui geometria suficiente.')
    }
    this.definition = definition
    this.centerlineProjectionBlocks = []
    for (
      let firstIndex = 0;
      firstIndex < definition.centerline.length - 1;
      firstIndex += CENTERLINE_PROJECTION_BLOCK_SEGMENTS
    ) {
      const lastIndex = Math.min(
        definition.centerline.length - 2,
        firstIndex + CENTERLINE_PROJECTION_BLOCK_SEGMENTS - 1,
      )
      const indexes = Array.from(
        { length: lastIndex - firstIndex + 1 },
        (_, offset) => firstIndex + offset,
      )
      const points = definition.centerline.slice(firstIndex, lastIndex + 2)
      this.centerlineProjectionBlocks.push({
        indexes,
        bounds: {
          minX: Math.min(...points.map((point) => point.x)),
          minY: Math.min(...points.map((point) => point.y)),
          maxX: Math.max(...points.map((point) => point.x)),
          maxY: Math.max(...points.map((point) => point.y)),
        },
      })
    }
    this.barrierFaces = definition.barrierGeometry.segments
    if (this.barrierFaces.length === 0) {
      throw new Error('A definição v2 não possui faces canônicas de barreira.')
    }
    this.explicitBarrierFaceSegments = buildBarrierFaceSegments(
      this.barrierFaces,
      definition.chunks,
    )
    this.barrierColliderRecords = [
      ...this.explicitBarrierFaceSegments.map(
      (face) => {
        const collider = barrierFaceSegmentCollider(face)
        return { face, collider, bounds: colliderBounds(collider) }
      },
      ),
      ...buildPitGarageBarrierFaceSegments(
        definition.pitLane.garageBarrier,
        definition.lengthMeters,
        definition.chunks,
      ).map((face) => {
        const collider = barrierFaceSegmentCollider(face)
        return { face, collider, bounds: colliderBounds(collider) }
      }),
      ...buildEscapeRoadColliderRecords(
        definition.sceneryLayout.escapeRoads,
        definition.chunks,
      ),
    ]
    for (const chunk of definition.chunks) {
      this.expandedChunkBounds.set(chunk.index, { ...chunk.bounds })
    }
    for (const record of this.barrierColliderRecords) {
      for (const chunkIndex of record.face.chunkIndexes) {
        const chunkBounds = this.expandedChunkBounds.get(chunkIndex)
        if (chunkBounds) {
          chunkBounds.minX = Math.min(chunkBounds.minX, record.bounds.minX)
          chunkBounds.minY = Math.min(chunkBounds.minY, record.bounds.minY)
          chunkBounds.maxX = Math.max(chunkBounds.maxX, record.bounds.maxX)
          chunkBounds.maxY = Math.max(chunkBounds.maxY, record.bounds.maxY)
        }
      }
      const minimumCellX = Math.floor(
        record.bounds.minX / BARRIER_BROADPHASE_CELL_METERS,
      )
      const maximumCellX = Math.floor(
        record.bounds.maxX / BARRIER_BROADPHASE_CELL_METERS,
      )
      const minimumCellY = Math.floor(
        record.bounds.minY / BARRIER_BROADPHASE_CELL_METERS,
      )
      const maximumCellY = Math.floor(
        record.bounds.maxY / BARRIER_BROADPHASE_CELL_METERS,
      )
      for (let cellX = minimumCellX; cellX <= maximumCellX; cellX += 1) {
        for (let cellY = minimumCellY; cellY <= maximumCellY; cellY += 1) {
          const key = `${cellX}:${cellY}`
          const bucket = this.barrierRecordsByCell.get(key) ?? []
          bucket.push(record)
          this.barrierRecordsByCell.set(key, bucket)
        }
      }
    }
  }

  private centerlineSegmentIndexesNear(
    preferredDistanceMeters: number,
    windowMeters: number,
  ) {
    const path = this.definition.centerline
    const length = this.definition.lengthMeters
    const normalized = ((preferredDistanceMeters % length) + length) % length
    const ranges: Array<{ from: number; to: number }> = []
    const from = normalized - windowMeters
    const to = normalized + windowMeters
    if (from < 0) ranges.push({ from: length + from, to: length })
    if (to > length) ranges.push({ from: 0, to: to - length })
    ranges.push({ from: Math.max(0, from), to: Math.min(length, to) })

    const indexes = new Set<number>()
    for (const range of ranges) {
      let low = 0
      let high = path.length
      while (low < high) {
        const middle = Math.floor((low + high) / 2)
        if (path[middle].distanceMeters < range.from) low = middle + 1
        else high = middle
      }
      for (
        let index = Math.max(0, low - 1);
        index < path.length - 1 &&
        path[index].distanceMeters <= range.to;
        index += 1
      ) {
        if (path[index + 1].distanceMeters >= range.from) indexes.add(index)
      }
    }
    return [...indexes].sort((first, second) => first - second)
  }

  project(point: Vector2, preferredDistanceMeters?: number): TrackProjection {
    const path = this.definition.centerline
    const localWindowMeters = Math.min(
      LOCAL_PROJECTION_WINDOW_METERS,
      this.definition.lengthMeters / 2,
    )
    const projectIndexes = (
      indexes: readonly number[],
      maximumPreferredDifferenceMeters?: number,
      initialBest: ProjectionCandidate | null = null,
    ) => {
      let best: ProjectionCandidate | null = initialBest
      for (const index of indexes) {
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
        if (
          maximumPreferredDifferenceMeters !== undefined &&
          preferredDifference > maximumPreferredDifferenceMeters
        ) {
          continue
        }
        if (isBetterProjection(candidate, best)) best = candidate
      }
      return best
    }

    if (preferredDistanceMeters !== undefined) {
      const localBest = projectIndexes(
        this.centerlineSegmentIndexesNear(
          preferredDistanceMeters,
          localWindowMeters,
        ),
        localWindowMeters,
      )
      if (localBest) {
        const localSegment = this.getTrackLimitSegment(localBest.distanceMeters)
        const maximumEnvironmentWidthMeters = Math.max(
          trackSideEnvironmentWidth(localSegment.left),
          trackSideEnvironmentWidth(localSegment.right),
        )
        const maximumPlausibleLocalDistanceMeters =
          localBest.halfWidthMeters +
          maximumEnvironmentWidthMeters +
          LOCAL_PROJECTION_RECOVERY_MARGIN_METERS

        if (
          localBest.distanceFromCenterMeters <=
          maximumPlausibleLocalDistanceMeters
        ) {
          return projectionWithoutRanking(localBest)
        }
      }
    }

    let globalBest: ProjectionCandidate | null = null
    // Keep canonical segment order: the tolerance-based tie break is order
    // sensitive. Bounds may skip impossible candidates, never reorder them.
    for (const block of this.centerlineProjectionBlocks) {
      const deltaX = Math.max(
        block.bounds.minX - point.x,
        0,
        point.x - block.bounds.maxX,
      )
      const deltaY = Math.max(
        block.bounds.minY - point.y,
        0,
        point.y - block.bounds.maxY,
      )
      const minimumDistance = PortableMath.hypot(deltaX, deltaY)
      if (
        globalBest &&
        minimumDistance >
          globalBest.distanceFromCenterMeters +
            PROJECTION_DISTANCE_TOLERANCE_METERS +
            Number.EPSILON
      ) {
        continue
      }
      globalBest = projectIndexes(
        block.indexes,
        undefined,
        globalBest,
      )
    }
    if (!globalBest) {
      throw new Error('Não foi possível projetar a posição na pista.')
    }
    return projectionWithoutRanking(globalBest)
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
      distanceToPath(point, this.definition.pitLane.path) <=
        PHYSICS_CONSTANTS.race.pitLaneHalfWidthMeters
    ) {
      return this.definition.surfaceModel.pitLane
    }
    const physicalEscapeRoad = this.definition.sceneryLayout.escapeRoads.find(
      (road) =>
        road.affectsPhysics &&
        road.path.length >= 2 &&
        distanceToPath(point, road.path) <= road.widthMeters / 2,
    )
    if (physicalEscapeRoad) return this.definition.surfaceModel.onTrack
    const projection = this.project(point, preferredDistanceMeters)
    const environment = this.environmentForProjection(point, projection)
    const curb = this.definition.curbs.find(
      (candidate) =>
        candidate.side === environment.side &&
        projection.distanceMeters >= candidate.fromDistanceMeters &&
        projection.distanceMeters <= candidate.toDistanceMeters &&
        projection.distanceFromCenterMeters >=
          projection.halfWidthMeters &&
        projection.distanceFromCenterMeters <=
          projection.halfWidthMeters + candidate.widthMeters,
    )
    if (curb) return 'curb'
    return environment.material
  }

  getEnvironmentAt(
    point: Vector2,
    preferredDistanceMeters?: number,
  ): TrackEnvironmentSample {
    const projection = this.project(point, preferredDistanceMeters)
    return this.environmentForProjection(point, projection)
  }

  private environmentForProjection(
    point: Vector2,
    projection: TrackProjection,
  ): TrackEnvironmentSample {
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

  getBarrierFaces(): readonly TrackBarrierGeometrySegment[] {
    return this.barrierFaces
  }

  getBarrierFaceSegments(bounds?: TrackBounds): BarrierFaceSegment[] {
    return this.getBarrierRecords(bounds).map((record) => record.face)
  }

  getBarrierChunkIndexes(bounds: TrackBounds) {
    return [...this.expandedChunkBounds.entries()]
      .filter(([, chunkBounds]) => boundsIntersect(chunkBounds, bounds))
      .map(([chunkIndex]) => chunkIndex)
      .sort((first, second) => first - second)
  }

  private getBarrierRecords(bounds?: TrackBounds) {
    if (!bounds) return this.barrierColliderRecords
    const allowedChunks = new Set(this.getBarrierChunkIndexes(bounds))
    const minimumCellX = Math.floor(
      bounds.minX / BARRIER_BROADPHASE_CELL_METERS,
    )
    const maximumCellX = Math.floor(
      bounds.maxX / BARRIER_BROADPHASE_CELL_METERS,
    )
    const minimumCellY = Math.floor(
      bounds.minY / BARRIER_BROADPHASE_CELL_METERS,
    )
    const maximumCellY = Math.floor(
      bounds.maxY / BARRIER_BROADPHASE_CELL_METERS,
    )
    const records = new Map<string, BarrierColliderRecord>()
    for (let cellX = minimumCellX; cellX <= maximumCellX; cellX += 1) {
      for (let cellY = minimumCellY; cellY <= maximumCellY; cellY += 1) {
        for (const record of this.barrierRecordsByCell.get(`${cellX}:${cellY}`) ?? []) {
          if (
            record.face.chunkIndexes.some((index) => allowedChunks.has(index)) &&
            colliderBoundsIntersect(record.bounds, bounds)
          ) {
            records.set(record.face.id, record)
          }
        }
      }
    }
    return [...records.values()].sort((first, second) =>
      first.face.id.localeCompare(second.face.id),
    )
  }

  getBarrierCollisionManifolds(
    vehicleParts: readonly WorldConvexCollider[],
    elevationLayer: number,
    bounds?: TrackBounds,
  ): CollisionManifold[] {
    const resolvedBounds = bounds ?? {
      minX: Math.min(
        ...vehicleParts.flatMap((part) => part.vertices.map((point) => point.x)),
      ),
      minY: Math.min(
        ...vehicleParts.flatMap((part) => part.vertices.map((point) => point.y)),
      ),
      maxX: Math.max(
        ...vehicleParts.flatMap((part) => part.vertices.map((point) => point.x)),
      ),
      maxY: Math.max(
        ...vehicleParts.flatMap((part) => part.vertices.map((point) => point.y)),
      ),
    }
    return findCompoundCollisionManifolds(
      vehicleParts,
      this.getBarrierColliders(elevationLayer, resolvedBounds),
    )
  }

  getBarrierColliders(
    elevationLayer: number,
    bounds?: TrackBounds,
  ): WorldConvexCollider[] {
    return this.getBarrierRecords(bounds)
      .filter((record) => record.face.elevationLayer === elevationLayer)
      .map((record) => record.collider)
  }

  getBarrierMaterial(colliderId: string) {
    return this.barrierColliderRecords.find(
      (record) => record.collider.id === colliderId,
    )?.face.material
  }

  getRacingLinePoint(distanceMeters: number) {
    return pointAtDistance(
      this.definition.racingLine,
      distanceMeters,
      this.definition.lengthMeters,
    )
  }

  getCenterlinePoint(distanceMeters: number) {
    return pointAtDistance(
      this.definition.centerline,
      distanceMeters,
      this.definition.lengthMeters,
    )
  }

  private getTrackLimitSegment(distanceMeters: number): TrackLimitSegment {
    const length = this.definition.lengthMeters
    const normalizedDistance = ((distanceMeters % length) + length) % length
    const segments = this.definition.trackLimits.segments
    let low = 0
    let high = segments.length
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      if (segments[middle].fromDistanceMeters <= normalizedDistance) {
        low = middle + 1
      } else {
        high = middle
      }
    }
    const candidate = segments[Math.max(0, low - 1)]
    return candidate &&
      normalizedDistance >= candidate.fromDistanceMeters &&
      normalizedDistance < candidate.toDistanceMeters
      ? candidate
      : segments.at(-1)!
  }

  getCenterlineTangent(distanceMeters: number) {
    const path = this.definition.centerline
    const length = this.definition.lengthMeters
    const normalizedDistance = ((distanceMeters % length) + length) % length
    let low = 1
    let high = path.length - 1
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      if (path[middle].distanceMeters < normalizedDistance) low = middle + 1
      else high = middle
    }
    const from: TrackPathPoint = path[Math.max(0, low - 1)]
    const to: TrackPathPoint = path[low]
    return normalize(subtract(to, from))
  }
}
