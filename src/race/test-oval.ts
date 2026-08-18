import { TEST_OVAL } from '@/race/constants'
import { normalize } from '@/race/math'
import type { SurfaceId, Vector2 } from '@/race/types'

type Ellipse = {
  radiusX: number
  radiusY: number
}
export type BarrierContact = {
  penetrationMeters: number
  pushNormal: Vector2
}

function ellipseValue(point: Vector2, ellipse: Ellipse) {
  return Math.hypot(point.x / ellipse.radiusX, point.y / ellipse.radiusY)
}

function ellipseContact(
  point: Vector2,
  ellipse: Ellipse,
  vehicleRadius: number,
  allowedSide: 'inside' | 'outside',
): BarrierContact | null {
  const value = ellipseValue(point, ellipse)
  if (value <= Number.EPSILON) {
    return allowedSide === 'outside'
      ? { penetrationMeters: ellipse.radiusX + vehicleRadius, pushNormal: { x: 1, y: 0 } }
      : null
  }

  const boundary = { x: point.x / value, y: point.y / value }
  const outwardNormal = normalize({
    x: boundary.x / (ellipse.radiusX * ellipse.radiusX),
    y: boundary.y / (ellipse.radiusY * ellipse.radiusY),
  })
  const signedDistance =
    (point.x - boundary.x) * outwardNormal.x +
    (point.y - boundary.y) * outwardNormal.y

  if (allowedSide === 'inside') {
    const penetrationMeters = signedDistance + vehicleRadius
    return penetrationMeters > 0
      ? {
          penetrationMeters,
          pushNormal: { x: -outwardNormal.x, y: -outwardNormal.y },
        }
      : null
  }

  const penetrationMeters = vehicleRadius - signedDistance
  return penetrationMeters > 0
    ? { penetrationMeters, pushNormal: outwardNormal }
    : null
}

export function getSurfaceAt(point: Vector2): SurfaceId {
  const outsideInnerAsphalt =
    ellipseValue(point, {
      radiusX: TEST_OVAL.asphalt.innerRadiusX,
      radiusY: TEST_OVAL.asphalt.innerRadiusY,
    }) >= 1
  const insideOuterAsphalt =
    ellipseValue(point, {
      radiusX: TEST_OVAL.asphalt.outerRadiusX,
      radiusY: TEST_OVAL.asphalt.outerRadiusY,
    }) <= 1

  return outsideInnerAsphalt && insideOuterAsphalt ? 'asphalt' : 'grass'
}

export function getBarrierContacts(
  point: Vector2,
  vehicleRadius: number,
): BarrierContact[] {
  const outerContact = ellipseContact(
    point,
    {
      radiusX: TEST_OVAL.barriers.outerRadiusX,
      radiusY: TEST_OVAL.barriers.outerRadiusY,
    },
    vehicleRadius,
    'inside',
  )
  const innerContact = ellipseContact(
    point,
    {
      radiusX: TEST_OVAL.barriers.innerRadiusX,
      radiusY: TEST_OVAL.barriers.innerRadiusY,
    },
    vehicleRadius,
    'outside',
  )

  return [outerContact, innerContact].filter(
    (contact): contact is BarrierContact => contact !== null,
  )
}

export function getTrackAngle(point: Vector2) {
  return Math.atan2(
    point.y / TEST_OVAL.centerline.radiusY,
    point.x / TEST_OVAL.centerline.radiusX,
  )
}

export function getCenterlinePoint(angle: number): Vector2 {
  return {
    x: Math.cos(angle) * TEST_OVAL.centerline.radiusX,
    y: Math.sin(angle) * TEST_OVAL.centerline.radiusY,
  }
}
