import { describe, expect, it } from 'vitest'

import vehicleDefinition from '../../contracts/module-2/v2/vehicle-definition.json'

import {
  resolveContinuousCollisionStep,
  sweepCompoundColliders,
  sweepConvexColliders,
} from '@/race/continuous-collision'
import {
  findCollisionManifold,
  findCompoundCollisionManifold,
  isConvexPolygon,
  resolveRigidBodyCollision,
  type CollisionManifold,
  type RigidBody2D,
} from '@/race/rigid-body-collision'
import {
  createVehicleWorldCollider,
  F1_VEHICLE_COLLIDER,
  type WorldConvexCollider,
} from '@/race/vehicle-geometry'

function rectangle(
  id: string,
  centerX: number,
  centerY: number,
  halfWidth: number,
  halfHeight: number,
): WorldConvexCollider {
  return {
    id,
    vertices: [
      { x: centerX - halfWidth, y: centerY - halfHeight },
      { x: centerX + halfWidth, y: centerY - halfHeight },
      { x: centerX + halfWidth, y: centerY + halfHeight },
      { x: centerX - halfWidth, y: centerY + halfHeight },
    ],
  }
}

function body(
  position = { x: 0, y: 0 },
  velocity = { x: 0, y: 0 },
  inverseMass = 1 / 770,
): RigidBody2D {
  return {
    position: { ...position },
    velocity: { ...velocity },
    angle: 0,
    angularVelocity: 0,
    inverseMass,
    inverseInertia: inverseMass === 0 ? 0 : 1 / 1_080,
  }
}

const RESPONSE = {
  restitution: 0.08,
  friction: 0.22,
  positionCorrectionPercent: 1,
  penetrationSlopMeters: 0,
}

describe('compound metric F1 geometry', () => {
  it('uses only convex pieces and exactly matches the visible 5.6 x 2.0 m envelope', () => {
    for (const part of F1_VEHICLE_COLLIDER.parts) {
      expect(isConvexPolygon(part.vertices), part.id).toBe(true)
    }
    const vertices = F1_VEHICLE_COLLIDER.parts.flatMap((part) => part.vertices)
    expect(Math.max(...vertices.map((point) => point.x))).toBeCloseTo(
      0.497 * 5.6,
      8,
    )
    expect(Math.min(...vertices.map((point) => point.x))).toBeCloseTo(-2.8, 8)
    expect(Math.max(...vertices.map((point) => point.y))).toBeCloseTo(1, 8)
    expect(Math.min(...vertices.map((point) => point.y))).toBeCloseTo(-1, 8)
    expect(F1_VEHICLE_COLLIDER.parts).toEqual(
      vehicleDefinition.collisionShapes.map((shape) => ({
        id: shape.id,
        material: shape.material,
        vertices: shape.vertices,
      })),
    )
  })

  it('keeps real clearance without the false contact caused by a circle', () => {
    const vehicle = createVehicleWorldCollider({
      position: { x: 0, y: 0 },
      angle: 0,
    })
    const wallWithSixCentimetresClearance = [
      rectangle('wall', 0, 1.31, 5, 0.25),
    ]
    expect(
      findCompoundCollisionManifold(
        vehicle,
        wallWithSixCentimetresClearance,
      ),
    ).toBeNull()

    const touchingWall = [rectangle('wall', 0, 1.23, 5, 0.25)]
    expect(
      findCompoundCollisionManifold(vehicle, touchingWall),
    ).not.toBeNull()
  })
})

describe('SAT manifold and rigid-body impulses', () => {
  it('returns a stable normal, depth and two edge contacts', () => {
    const manifold = findCollisionManifold(
      rectangle('first', 0, 0, 1, 1),
      rectangle('second', 1.5, 0, 1, 1),
    )

    expect(manifold).not.toBeNull()
    expect(manifold?.normal.x).toBeCloseTo(1, 8)
    expect(manifold?.normal.y).toBeCloseTo(0, 8)
    expect(manifold?.penetrationMeters).toBeCloseTo(0.5, 8)
    expect(manifold?.contacts).toHaveLength(2)
  })

  it('turns an off-centre impact into yaw instead of a centre-only bounce', () => {
    const first = body({ x: 0, y: 0 }, { x: 12, y: 0 })
    const second = body({ x: 2, y: 0 }, { x: 0, y: 0 }, 0)
    const manifold: CollisionManifold = {
      normal: { x: 1, y: 0 },
      penetrationMeters: 0.05,
      contacts: [{ x: 1, y: 0.72 }],
      firstColliderId: 'car',
      secondColliderId: 'wall',
    }

    const resolution = resolveRigidBodyCollision(
      first,
      second,
      manifold,
      RESPONSE,
    )

    expect(resolution.impactSpeed).toBeCloseTo(12, 8)
    expect(resolution.normalImpulse).toBeGreaterThan(0)
    expect(Math.abs(first.angularVelocity)).toBeGreaterThan(0.1)
  })

  it('allows a shallow wall scrape to continue without snagging or reversing', () => {
    const car = body({ x: 0, y: 0 }, { x: 24, y: 1 })
    const wall = body({ x: 0, y: 1 }, { x: 0, y: 0 }, 0)
    const manifold: CollisionManifold = {
      normal: { x: 0, y: 1 },
      penetrationMeters: 0.015,
      contacts: [{ x: 0.3, y: 1 }],
      firstColliderId: 'car',
      secondColliderId: 'wall',
    }

    resolveRigidBodyCollision(car, wall, manifold, RESPONSE)

    expect(car.velocity.x).toBeGreaterThan(23.5)
    expect(car.velocity.y).toBeLessThanOrEqual(0)
    expect(Number.isFinite(car.angularVelocity)).toBe(true)
  })
})

describe('continuous collision detection', () => {
  it('finds a thin wall crossed entirely within one physics step', () => {
    const impact = sweepConvexColliders(
      rectangle('car', 0, 0, 0.5, 0.5),
      { x: 200, y: 0 },
      rectangle('thin-wall', 10, 0, 0.05, 4),
      { x: 0, y: 0 },
      0.1,
    )

    expect(impact).not.toBeNull()
    expect(impact?.timeSeconds).toBeCloseTo(0.04725, 5)
    expect(impact?.normal.x).toBeCloseTo(1, 8)
  })

  it('advances only to TOI, resolves there and returns the fixed-step remainder', () => {
    const movingBody = body({ x: 0, y: 0 }, { x: 200, y: 0 })
    const wallBody = body({ x: 10, y: 0 }, { x: 0, y: 0 }, 0)
    const result = resolveContinuousCollisionStep(
      {
        body: movingBody,
        colliders: [rectangle('car', 0, 0, 0.5, 0.5)],
      },
      {
        body: wallBody,
        colliders: [rectangle('thin-wall', 10, 0, 0.05, 4)],
      },
      0.1,
      RESPONSE,
    )

    expect(result).not.toBeNull()
    expect(movingBody.position.x).toBeCloseTo(9.45, 5)
    expect(movingBody.velocity.x).toBeLessThanOrEqual(0)
    expect(result?.remainingSeconds).toBeCloseTo(0.05275, 5)
    expect(result?.resolution.normalImpulse).toBeGreaterThan(0)
  })

  it('detects front-wing/nose contact before two fast cars can overlap', () => {
    const first = createVehicleWorldCollider({
      position: { x: 0, y: 0 },
      angle: 0,
    })
    const second = createVehicleWorldCollider({
      position: { x: 20, y: 0 },
      angle: Math.PI,
    })
    const impact = sweepCompoundColliders(
      { colliders: first, velocity: { x: 120, y: 0 } },
      { colliders: second, velocity: { x: 0, y: 0 } },
      0.2,
    )

    expect(impact).not.toBeNull()
    expect(impact?.timeSeconds).toBeLessThan(0.13)
    expect(impact?.firstColliderId).toContain('front-wing')
    expect(impact?.secondColliderId).toContain('front-wing')
  })
})
