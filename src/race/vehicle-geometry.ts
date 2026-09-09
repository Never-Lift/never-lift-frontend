import vehicleDefinition from '../../contracts/module-2/v2/vehicle-definition.json'

import * as PortableMath from '@/race/portable-math'
import { polygonGeometry, resetPolygonGeometry } from '@/race/polygon-cache'
import type { Vector2 } from '@/race/types'

export type LocalConvexCollider = {
  id: string
  material?: 'carbon-body' | 'front-wing' | 'rear-wing' | 'tyre'
  vertices: readonly Vector2[]
}

export type WorldConvexCollider = {
  id: string
  /** Public poses are immutable; collision-owned caches may rewrite private buffers. */
  readonly vertices: readonly Readonly<Vector2>[]
  /** Present only for canonical static track barriers. */
  collisionMaterial?:
    | 'concrete-wall'
    | 'guardrail'
    | 'tecpro'
    | 'tyre-barrier'
}

export type CompoundVehicleCollider = {
  lengthMeters: number
  widthMeters: number
  massKg: number
  yawInertiaKgM2: number
  parts: readonly LocalConvexCollider[]
}

export type ColliderTransform = {
  position: Vector2
  angle: number
}

type VehicleDefinitionContract = {
  version: '2.0.0'
  dimensions: {
    lengthMeters: number
    widthMeters: number
  }
  massProperties: {
    massKg: number
    yawInertiaKgM2: number
  }
  collisionShapes: Array<{
    id: string
    material: 'carbon-body' | 'front-wing' | 'rear-wing' | 'tyre'
    vertices: Vector2[]
  }>
  visualToleranceMeters: number
}

function convex(vertices: readonly Vector2[]) {
  if (vertices.length < 3) return false
  let sign = 0
  for (let index = 0; index < vertices.length; index += 1) {
    const first = vertices[index]
    const second = vertices[(index + 1) % vertices.length]
    const third = vertices[(index + 2) % vertices.length]
    const turn =
      (second.x - first.x) * (third.y - second.y) -
      (second.y - first.y) * (third.x - second.x)
    if (Math.abs(turn) <= 1e-8) continue
    const currentSign = Math.sign(turn)
    if (sign !== 0 && currentSign !== sign) return false
    sign = currentSign
  }
  return sign !== 0
}

function validatedVehicleDefinition(payload: unknown) {
  const definition = payload as Partial<VehicleDefinitionContract>
  if (
    definition.version !== '2.0.0' ||
    !definition.dimensions ||
    definition.dimensions.lengthMeters <= 0 ||
    definition.dimensions.widthMeters <= 0 ||
    !definition.massProperties ||
    definition.massProperties.massKg <= 0 ||
    definition.massProperties.yawInertiaKgM2 <= 0 ||
    !Array.isArray(definition.collisionShapes) ||
    definition.collisionShapes.length < 5 ||
    definition.collisionShapes.some(
      (shape) =>
        typeof shape.id !== 'string' ||
        !Array.isArray(shape.vertices) ||
        !convex(shape.vertices),
    ) ||
    typeof definition.visualToleranceMeters !== 'number' ||
    definition.visualToleranceMeters < 0.02 ||
    definition.visualToleranceMeters > 0.05
  ) {
    throw new Error('A definição métrica do monoposto v2 é inválida.')
  }
  const identifiers = definition.collisionShapes.map((shape) => shape.id)
  if (new Set(identifiers).size !== identifiers.length) {
    throw new Error('A definição do monoposto repete identificadores de collider.')
  }
  return definition as VehicleDefinitionContract
}

export const F1_VEHICLE_DEFINITION = validatedVehicleDefinition(
  vehicleDefinition,
)

/** Runtime geometry has one source: the published v2 vehicle definition. */
export const F1_VEHICLE_COLLIDER: CompoundVehicleCollider = {
  lengthMeters: F1_VEHICLE_DEFINITION.dimensions.lengthMeters,
  widthMeters: F1_VEHICLE_DEFINITION.dimensions.widthMeters,
  massKg: F1_VEHICLE_DEFINITION.massProperties.massKg,
  yawInertiaKgM2: F1_VEHICLE_DEFINITION.massProperties.yawInertiaKgM2,
  parts: F1_VEHICLE_DEFINITION.collisionShapes.map((shape) => ({
    id: shape.id,
    material: shape.material,
    vertices: shape.vertices.map((vertex) => ({ ...vertex })),
  })),
}

export function transformConvexCollider(
  part: LocalConvexCollider,
  transform: ColliderTransform,
  cosine = PortableMath.cos(transform.angle),
  sine = PortableMath.sin(transform.angle),
): WorldConvexCollider {
  const vertices = part.vertices.map((vertex) => ({
    x: transform.position.x + (vertex.x * cosine - vertex.y * sine),
    y: transform.position.y + (vertex.x * sine + vertex.y * cosine),
  }))
  const geometry = polygonGeometry(vertices)
  geometry.convex = true
  return {
    id: part.id,
    vertices,
  }
}

export function createVehicleWorldCollider(
  transform: ColliderTransform,
  definition = F1_VEHICLE_COLLIDER,
): WorldConvexCollider[] {
  const cosine = PortableMath.cos(transform.angle)
  const sine = PortableMath.sin(transform.angle)
  return definition.parts.map((part) =>
    transformConvexCollider(part, transform, cosine, sine),
  )
}

/** Rewrites a collision-owned pose without publishing mutable geometry. */
export function updateVehicleWorldCollider(
  colliders: WorldConvexCollider[],
  transform: ColliderTransform,
  definition = F1_VEHICLE_COLLIDER,
) {
  if (colliders.length !== definition.parts.length) {
    return createVehicleWorldCollider(transform, definition)
  }
  const cosine = PortableMath.cos(transform.angle)
  const sine = PortableMath.sin(transform.angle)
  for (let partIndex = 0; partIndex < definition.parts.length; partIndex += 1) {
    const part = definition.parts[partIndex]
    const collider = colliders[partIndex]
    const vertices = collider.vertices as Vector2[]
    if (collider.id !== part.id || vertices.length !== part.vertices.length) {
      return createVehicleWorldCollider(transform, definition)
    }
    const previousRadius = polygonGeometry(vertices).radius?.value
    resetPolygonGeometry(vertices)
    for (let vertexIndex = 0; vertexIndex < vertices.length; vertexIndex += 1) {
      const source = part.vertices[vertexIndex]
      const target = vertices[vertexIndex]
      target.x =
        transform.position.x +
        (source.x * cosine - source.y * sine)
      target.y =
        transform.position.y +
        (source.x * sine + source.y * cosine)
    }
    const geometry = polygonGeometry(vertices)
    geometry.convex = true
    if (previousRadius !== undefined) {
      geometry.radius = {
        x: transform.position.x,
        y: transform.position.y,
        value: previousRadius,
      }
    }
  }
  return colliders
}

export function vehicleYawInertia(
  massKg: number,
  definition = F1_VEHICLE_COLLIDER,
) {
  return definition.yawInertiaKgM2 * (massKg / definition.massKg)
}
