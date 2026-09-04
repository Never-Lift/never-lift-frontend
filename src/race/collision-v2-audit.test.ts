import { describe, expect, it } from 'vitest'

import {
  resolveVehicleAgainstStaticColliders,
  resolveVehicleCollision,
} from '@/race/collision'
import {
  sweepCompoundColliders,
  sweepCompoundCollidersWithRotation,
} from '@/race/continuous-collision'
import { PHYSICS_CONSTANTS, PHYSICS_STEP_SECONDS } from '@/race/constants'
import {
  consolidateCollisionManifolds,
  findCompoundCollisionManifolds,
  type CollisionManifold,
} from '@/race/rigid-body-collision'
import type { VehicleState } from '@/race/types'
import { createInitialVehiclePhysicsState } from '@/race/vehicle-physics'
import {
  createVehicleWorldCollider,
  type WorldConvexCollider,
} from '@/race/vehicle-geometry'

type VehicleOptions = {
  x?: number
  y?: number
  velocityX?: number
  velocityY?: number
  angle?: number
}

function vehicle(id: string, options: VehicleOptions = {}): VehicleState {
  const position = { x: options.x ?? 0, y: options.y ?? 0 }
  return {
    id,
    name: id,
    kind: 'human',
    color: '#365f82',
    position,
    previousPosition: { ...position },
    velocity: {
      x: options.velocityX ?? 0,
      y: options.velocityY ?? 0,
    },
    angle: options.angle ?? 0,
    previousAngle: options.angle ?? 0,
    yawRate: 0,
    physicsState: createInitialVehiclePhysicsState(),
    surface: 'asphalt',
    trackLayer: 0,
    trackDistanceMeters: 0,
    damage: {
      kind: 'none',
      health: PHYSICS_CONSTANTS.damage.thresholds.maximumHealth,
      engineDamaged: false,
      steeringDamaged: false,
      steeringPull: 0,
      impactCount: 0,
      lastImpactSpeed: 0,
    },
    nextCheckpointIndex: 0,
    lapProgressMeters: 0,
    totalProgressMeters: 0,
    currentLap: 1,
    lapStartedAtSeconds: 0,
    bestLapTimeSeconds: null,
    finished: false,
    finishTimeSeconds: null,
  }
}

function rectangle(
  id: string,
  centerX: number,
  centerY: number,
  halfWidth: number,
  halfHeight: number,
  collisionMaterial?: WorldConvexCollider['collisionMaterial'],
): WorldConvexCollider {
  return {
    id,
    collisionMaterial,
    vertices: [
      { x: centerX - halfWidth, y: centerY - halfHeight },
      { x: centerX + halfWidth, y: centerY - halfHeight },
      { x: centerX + halfWidth, y: centerY + halfHeight },
      { x: centerX - halfWidth, y: centerY + halfHeight },
    ],
  }
}

function concreteWall(
  id: string,
  centerX: number,
  centerY: number,
  halfWidth: number,
  halfHeight: number,
) {
  return rectangle(
    id,
    centerX,
    centerY,
    halfWidth,
    halfHeight,
    'concrete-wall',
  )
}

function vehicleColliders(options: VehicleOptions = {}) {
  return createVehicleWorldCollider({
    position: { x: options.x ?? 0, y: options.y ?? 0 },
    angle: options.angle ?? 0,
  })
}

function rotateColliderAroundOrigin(
  collider: WorldConvexCollider,
  angle: number,
): WorldConvexCollider {
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  return {
    ...collider,
    vertices: collider.vertices.map((vertex) => ({
      x: vertex.x * cosine - vertex.y * sine,
      y: vertex.x * sine + vertex.y * cosine,
    })),
  }
}

function setIntegratedMotion(
  state: VehicleState,
  previousPosition: VehicleState['position'],
  previousAngle = state.angle,
) {
  state.previousPosition = { ...previousPosition }
  state.previousAngle = previousAngle
}

describe('v2 compound-collider contact audit', () => {
  it('keeps separated same-normal contacts as distinct manifolds', () => {
    const contacts: CollisionManifold[] = [
      {
        normal: { x: 0, y: 1 },
        penetrationMeters: 0.02,
        contacts: [{ x: -1.5, y: 1 }],
        firstColliderId: 'rear-wheel',
        secondColliderId: 'wall',
        secondCollisionMaterial: 'concrete-wall',
      },
      {
        normal: { x: 0, y: 1 },
        penetrationMeters: 0.02,
        contacts: [{ x: 1.5, y: 1 }],
        firstColliderId: 'front-wheel',
        secondColliderId: 'wall',
        secondCollisionMaterial: 'concrete-wall',
      },
    ]

    expect(consolidateCollisionManifolds(contacts)).toHaveLength(2)
  })

  it('still merges duplicate contacts from overlapping compound pieces', () => {
    const contacts: CollisionManifold[] = [
      {
        normal: { x: 1, y: 0 },
        penetrationMeters: 0.01,
        contacts: [{ x: 2.7, y: 0.1 }],
        firstColliderId: 'nose',
        secondColliderId: 'wall-a',
        secondCollisionMaterial: 'concrete-wall',
      },
      {
        normal: { x: 1, y: 0 },
        penetrationMeters: 0.02,
        contacts: [{ x: 2.70005, y: 0.10005 }],
        firstColliderId: 'front-wing-centre',
        secondColliderId: 'wall-a',
        secondCollisionMaterial: 'concrete-wall',
      },
    ]

    const consolidated = consolidateCollisionManifolds(contacts)
    expect(consolidated).toHaveLength(1)
    expect(consolidated[0].penetrationMeters).toBe(0.02)
  })

  it('does not collide with empty space between the exposed wheels', () => {
    const colliders = vehicleColliders()
    const probeInOpenWheelGap = rectangle('gap-probe', 0, 0.93, 0.08, 0.04)
    const probeOnFloorEdge = rectangle('floor-probe', 0, 0.79, 0.08, 0.04)

    expect(
      findCompoundCollisionManifolds(colliders, [probeInOpenWheelGap]),
    ).toHaveLength(0)
    expect(
      findCompoundCollisionManifolds(colliders, [probeOnFloorEdge]),
    ).not.toHaveLength(0)
  })

  it.each([
    [
      'front wing',
      rectangle('front-probe', 2.79, 0.965, 0.02, 0.015),
      'front-wing-left-endplate',
    ],
    ['front wheel', rectangle('front-wheel-probe', 1.5, 1.02, 0.08, 0.02), 'front-left-wheel'],
    ['rear wheel', rectangle('rear-wheel-probe', -1.7, 1.02, 0.08, 0.02), 'rear-left-wheel'],
    ['rear wing', rectangle('rear-probe', -2.82, 0.5, 0.02, 0.08), 'rear-wing-left'],
  ])('detects contact on the %s envelope', (_label, probe, expectedPart) => {
    const manifolds = findCompoundCollisionManifolds(vehicleColliders(), [probe])

    expect(manifolds.some((manifold) => manifold.firstColliderId.includes(expectedPart))).toBe(true)
  })
})

describe('v2 car-to-car collision audit', () => {
  it('invalidates cached poses after an in-place position or angle change', () => {
    const first = vehicle('cached-first')
    const second = vehicle('cached-second', { x: 5.9 })
    expect(resolveVehicleCollision(first, second)).toBe(false)
    second.position.x = 5.4
    expect(resolveVehicleCollision(first, second)).toBe(true)
    second.position.x = 50
    second.angle = Math.PI / 2
    expect(resolveVehicleCollision(first, second)).toBe(false)
  })
  it('resolves a central head-on impact without artificial yaw', () => {
    const first = vehicle('central-first', {
      x: -2.75,
      velocityX: 18,
    })
    const second = vehicle('central-second', {
      x: 2.75,
      velocityX: -18,
      angle: Math.PI,
    })

    expect(resolveVehicleCollision(first, second)).toBe(true)
    expect(first.velocity.x).toBeLessThan(0)
    expect(second.velocity.x).toBeGreaterThan(0)
    expect(Math.abs(first.physicsState.yawRate)).toBeLessThan(1e-8)
    expect(Math.abs(second.physicsState.yawRate)).toBeLessThan(1e-8)
  })

  it('transfers speed in a centred rear impact without inventing lateral motion', () => {
    const leader = vehicle('rear-leader', { velocityX: 10 })
    const follower = vehicle('rear-follower', {
      x: -5.45,
      velocityX: 30,
    })

    expect(resolveVehicleCollision(follower, leader)).toBe(true)
    expect(follower.velocity.x).toBeLessThan(30)
    expect(leader.velocity.x).toBeGreaterThan(10)
    expect(Math.abs(leader.velocity.y)).toBeLessThan(1e-8)
    expect(Math.abs(follower.velocity.y)).toBeLessThan(1e-8)
  })

  it('turns an off-centre lateral impact into opposite finite yaw responses', () => {
    const target = vehicle('lateral-target')
    const striker = vehicle('lateral-striker', {
      x: 1.2,
      y: 3.7,
      velocityY: -20,
      angle: -Math.PI / 2,
    })

    expect(resolveVehicleCollision(striker, target)).toBe(true)
    expect(Math.abs(target.physicsState.yawRate)).toBeGreaterThan(0.01)
    expect(Math.abs(striker.physicsState.yawRate)).toBeGreaterThan(0.01)
    expect(Number.isFinite(target.physicsState.yawRate)).toBe(true)
    expect(Number.isFinite(striker.physicsState.yawRate)).toBe(true)
  })

  it('resolves an oblique impact with impulse, separation and yaw', () => {
    const first = vehicle('oblique-first', {
      x: -2.5,
      y: 0.65,
      velocityX: 22,
      velocityY: -2,
      angle: -0.12,
    })
    const second = vehicle('oblique-second', {
      x: 2.5,
      velocityX: -8,
      angle: Math.PI - 0.25,
    })

    expect(resolveVehicleCollision(first, second)).toBe(true)
    expect(first.velocity.x).toBeLessThan(22)
    expect(second.velocity.x).toBeGreaterThan(-8)
    expect(
      Math.abs(first.physicsState.yawRate) +
        Math.abs(second.physicsState.yawRate),
    ).toBeGreaterThan(0.02)
  })

  it('uses CCD for two closing cars within one 120 Hz step', () => {
    const travel = 96 * PHYSICS_STEP_SECONDS
    const first = vehicle('ccd-first', {
      x: -3.05 + travel,
      velocityX: 96,
    })
    const second = vehicle('ccd-second', {
      x: 3.05 - travel,
      velocityX: -96,
      angle: Math.PI,
    })
    setIntegratedMotion(first, { x: -3.05, y: 0 })
    setIntegratedMotion(second, { x: 3.05, y: 0 }, Math.PI)

    expect(resolveVehicleCollision(first, second, PHYSICS_STEP_SECONDS)).toBe(true)
    expect(first.position.x).toBeLessThan(second.position.x)
    expect(first.velocity.x).toBeLessThanOrEqual(0)
    expect(second.velocity.x).toBeGreaterThanOrEqual(0)
    expect(Math.abs(first.physicsState.yawRate)).toBeLessThan(1e-6)
    expect(Math.abs(second.physicsState.yawRate)).toBeLessThan(1e-6)
    expect(
      findCompoundCollisionManifolds(
        vehicleColliders({ x: first.position.x, y: first.position.y, angle: first.angle }),
        vehicleColliders({ x: second.position.x, y: second.position.y, angle: second.angle }),
      )[0]?.penetrationMeters ?? 0,
    ).toBeLessThan(0.01)
  })

  it('detects a translating rotational car-to-car sweep between clear endpoint poses', () => {
    const angularVelocity = 0.16 / PHYSICS_STEP_SECONDS
    const first = vehicle('angular-ccd-first', {
      x: 0.02,
      velocityX: 0.04 / PHYSICS_STEP_SECONDS,
      angle: 0.08,
    })
    setIntegratedMotion(first, { x: -0.02, y: 0 }, -0.08)
    first.yawRate = angularVelocity
    first.physicsState.yawRate = angularVelocity
    const second = vehicle('angular-ccd-second', {
      x: 4.8,
      y: -2,
    })

    expect(
      findCompoundCollisionManifolds(
        vehicleColliders({ x: -0.02, angle: -0.08 }),
        vehicleColliders({ x: 4.8, y: -2 }),
      ),
    ).toHaveLength(0)
    expect(
      findCompoundCollisionManifolds(
        vehicleColliders({ x: 0.02, angle: 0.08 }),
        vehicleColliders({ x: 4.8, y: -2 }),
      ),
    ).toHaveLength(0)
    expect(resolveVehicleCollision(first, second, PHYSICS_STEP_SECONDS)).toBe(
      true,
    )
    expect(first.physicsState.yawRate).not.toBe(angularVelocity)
    expect(Number.isFinite(first.physicsState.yawRate)).toBe(true)
    expect(Number.isFinite(second.physicsState.yawRate)).toBe(true)
  })
})

describe('v2 canonical-barrier collision audit', () => {
  it('reuses angular geometry only for the same pivot and query inputs', () => {
    const first = {
      colliders: vehicleColliders({ angle: -0.08 }),
      position: { x: 0, y: 0 },
      velocity: { x: 0, y: 0 },
      angularVelocity: 0.16 / PHYSICS_STEP_SECONDS,
    }
    const second = {
      colliders: [concreteWall('pivot-wall', -2.9, -3.3, 0.125, 2.5)],
      position: { x: 0, y: 0 },
      velocity: { x: 0, y: 0 },
      angularVelocity: 0,
    }
    expect(sweepCompoundCollidersWithRotation(first, second, PHYSICS_STEP_SECONDS)).not.toBeNull()
    for (const pivot of [1, -3, 0]) {
      first.position.x = pivot
      first.velocity.y = pivot * 2
      const expected = sweepCompoundCollidersWithRotation(
        structuredClone(first), structuredClone(second), PHYSICS_STEP_SECONDS,
      )
      expect(sweepCompoundCollidersWithRotation(first, second, PHYSICS_STEP_SECONDS)).toEqual(expected)
    }
  })

  it('stops a 350 km/h nose at a 25 cm wall during one 120 Hz step', () => {
    const speed = 350 / 3.6
    const travel = speed * PHYSICS_STEP_SECONDS
    const state = vehicle('wall-ccd', {
      x: travel,
      velocityX: speed,
    })
    setIntegratedMotion(state, { x: 0, y: 0 })
    const wall = concreteWall('thin-canonical-wall', 3.325, 0, 0.125, 10)

    expect(
      resolveVehicleAgainstStaticColliders(
        state,
        PHYSICS_STEP_SECONDS,
        () => [wall],
      ),
    ).toBe(true)
    expect(state.position.x).toBeLessThanOrEqual(0.43)
    expect(state.velocity.x).toBeLessThanOrEqual(0)
    expect(Math.abs(state.physicsState.yawRate)).toBeLessThan(1e-6)
    expect(state.damage.lastImpactSpeed).toBeGreaterThan(0)
  })

  it('lets a shallow wall scrape continue without snagging or reversing', () => {
    const state = vehicle('wall-scrape', {
      x: 24 * PHYSICS_STEP_SECONDS,
      y: 0.01,
      velocityX: 24,
      velocityY: 1.2,
    })
    setIntegratedMotion(state, { x: 0, y: 0 })
    const wall = concreteWall('scrape-wall', 0, 1.13, 100, 0.125)

    expect(
      resolveVehicleAgainstStaticColliders(
        state,
        PHYSICS_STEP_SECONDS,
        () => [wall],
      ),
    ).toBe(true)
    expect(state.velocity.x).toBeGreaterThan(20)
    expect(state.position.x).toBeGreaterThan(0)
    expect(state.velocity.y).toBeLessThanOrEqual(0)
    expect(Number.isFinite(state.physicsState.yawRate)).toBe(true)
  })

  it('detects translation plus rotation through a barrier between clear endpoint poses', () => {
    const angularVelocity = 0.16 / PHYSICS_STEP_SECONDS
    const state = vehicle('angular-wall-ccd', {
      x: 0.02,
      velocityX: 0.04 / PHYSICS_STEP_SECONDS,
      angle: 0.08,
    })
    setIntegratedMotion(state, { x: -0.02, y: 0 }, -0.08)
    state.yawRate = angularVelocity
    state.physicsState.yawRate = angularVelocity
    const wall = concreteWall('angular-wall', -2.9, -3.3, 0.125, 2.5)

    expect(
      findCompoundCollisionManifolds(
        vehicleColliders({ x: -0.02, angle: -0.08 }),
        [wall],
      ),
    ).toHaveLength(0)
    expect(
      findCompoundCollisionManifolds(
        vehicleColliders({ x: 0.02, angle: 0.08 }),
        [wall],
      ),
    ).toHaveLength(0)
    expect(
      resolveVehicleAgainstStaticColliders(
        state,
        PHYSICS_STEP_SECONDS,
        () => [wall],
      ),
    ).toBe(true)
    expect(state.physicsState.yawRate).not.toBe(angularVelocity)
    expect(Number.isFinite(state.physicsState.yawRate)).toBe(true)
  })

  it('detects a pure -0.08 to +0.08 rad rotational sweep', () => {
    const angularVelocity = 0.16 / PHYSICS_STEP_SECONDS
    const state = vehicle('pure-angular-wall-ccd', { angle: 0.08 })
    setIntegratedMotion(state, { x: 0, y: 0 }, -0.08)
    state.yawRate = angularVelocity
    state.physicsState.yawRate = angularVelocity
    const wall = concreteWall('pure-angular-wall', -2.9, -3.3, 0.125, 2.5)

    expect(
      findCompoundCollisionManifolds(
        vehicleColliders({ angle: -0.08 }),
        [wall],
      ),
    ).toHaveLength(0)
    expect(
      findCompoundCollisionManifolds(
        vehicleColliders({ angle: 0.08 }),
        [wall],
      ),
    ).toHaveLength(0)
    const impact = sweepCompoundCollidersWithRotation(
      {
        colliders: vehicleColliders({ angle: -0.08 }),
        position: { x: 0, y: 0 },
        velocity: { x: 0, y: 0 },
        angularVelocity,
      },
      {
        colliders: [wall],
        position: { x: 0, y: 0 },
        velocity: { x: 0, y: 0 },
        angularVelocity: 0,
      },
      PHYSICS_STEP_SECONDS,
    )
    expect(impact).not.toBeNull()
    if (impact) {
      const actualPose = vehicleColliders({
        angle: -0.08 + angularVelocity * impact.timeSeconds,
      })
      const actualManifolds = findCompoundCollisionManifolds(actualPose, [wall])
      expect(actualManifolds).not.toHaveLength(0)
      expect(
        actualManifolds.some((manifold) =>
          impact.manifolds.some(
            (reported) =>
              reported.firstColliderId === manifold.firstColliderId &&
              reported.secondColliderId === manifold.secondColliderId,
          ),
        ),
      ).toBe(true)
    }

    expect(
      resolveVehicleAgainstStaticColliders(
        state,
        PHYSICS_STEP_SECONDS,
        () => [wall],
      ),
    ).toBe(true)
    expect(state.physicsState.yawRate).not.toBe(angularVelocity)
  })

  it('detects a transient angular contact halfway between clear primary probes deterministically', () => {
    const angularDelta = 0.04
    const sampleCount =
      PHYSICS_CONSTANTS.collision
        .ccdAngularPoseSamplesPerMaximumArcStep
    const impactFraction = 1.5 / sampleCount
    const impactAngle = angularDelta * impactFraction
    const rotatingCollider = rectangle(
      'between-probes-rotor',
      1,
      0,
      0.001,
      0.001,
    )
    const wall = concreteWall(
      'between-probes-wall',
      Math.cos(impactAngle),
      Math.sin(impactAngle),
      0.001,
      0.001,
    )
    const manifoldsAtFraction = (fraction: number) =>
      findCompoundCollisionManifolds(
        [rotateColliderAroundOrigin(rotatingCollider, angularDelta * fraction)],
        [wall],
      )

    expect(sampleCount).toBe(4)
    expect(manifoldsAtFraction(0)).toHaveLength(0)
    for (let sample = 1; sample <= sampleCount; sample += 1) {
      expect(manifoldsAtFraction(sample / sampleCount)).toHaveLength(0)
    }
    const midpointManifolds = manifoldsAtFraction(impactFraction)
    expect(midpointManifolds).not.toHaveLength(0)

    const sweep = () =>
      sweepCompoundCollidersWithRotation(
        {
          colliders: [rotatingCollider],
          position: { x: 0, y: 0 },
          velocity: { x: 0, y: 0 },
          angularVelocity: angularDelta / PHYSICS_STEP_SECONDS,
        },
        {
          colliders: [wall],
          position: { x: 0, y: 0 },
          velocity: { x: 0, y: 0 },
          angularVelocity: 0,
        },
        PHYSICS_STEP_SECONDS,
      )
    const firstImpact = sweep()
    const repeatedImpact = sweep()

    expect(repeatedImpact).toEqual(firstImpact)
    expect(firstImpact).not.toBeNull()
    if (firstImpact) {
      const actualPoseManifolds = manifoldsAtFraction(
        firstImpact.timeSeconds / PHYSICS_STEP_SECONDS,
      )
      expect(actualPoseManifolds).not.toHaveLength(0)
      expect(
        firstImpact.manifolds.some((reported) =>
          actualPoseManifolds.some(
            (actual) =>
              actual.firstColliderId === reported.firstColliderId &&
              actual.secondColliderId === reported.secondColliderId,
          ),
        ),
      ).toBe(true)
    }
  })

  it('rejects a frozen hit for a real angular arc below five centimetres', () => {
    const angularDelta = -0.04
    const moving = rectangle('small-arc-body', 1, 0, 0.1, 0.05)
    const wall = concreteWall('small-arc-wall', 1, 0.08, 0.3, 0.01)
    const velocity = { x: 0, y: 0.03 / PHYSICS_STEP_SECONDS }
    const angularVelocity = angularDelta / PHYSICS_STEP_SECONDS
    const maximumRadius = Math.hypot(1.1, 0.05)

    expect(Math.abs(angularDelta) * maximumRadius).toBeLessThan(
      PHYSICS_CONSTANTS.collision.ccdMaximumAngularArcStepMeters,
    )
    expect(
      sweepCompoundColliders(
        { colliders: [moving], velocity },
        { colliders: [wall], velocity: { x: 0, y: 0 } },
        PHYSICS_STEP_SECONDS,
      ),
    ).not.toBeNull()
    expect(
      sweepCompoundCollidersWithRotation(
        {
          colliders: [moving],
          position: { x: 0, y: 0 },
          velocity,
          angularVelocity,
        },
        {
          colliders: [wall],
          position: { x: 0, y: 0 },
          velocity: { x: 0, y: 0 },
          angularVelocity: 0,
        },
        PHYSICS_STEP_SECONDS,
      ),
    ).toBeNull()
  })

  it('rejects a frozen-pose wall hit when real rotation carries the nose clear', () => {
    const angularVelocity = (Math.PI / 2) / PHYSICS_STEP_SECONDS
    const state = vehicle('rotating-away-from-wall', {
      x: 0.5,
      velocityX: 0.5 / PHYSICS_STEP_SECONDS,
      angle: Math.PI / 2,
    })
    setIntegratedMotion(state, { x: 0, y: 0 }, 0)
    state.yawRate = angularVelocity
    state.physicsState.yawRate = angularVelocity
    const wall = concreteWall('avoided-wall', 3.325, 0, 0.125, 5)

    expect(
      findCompoundCollisionManifolds(vehicleColliders({ angle: 0 }), [wall]),
    ).toHaveLength(0)
    expect(
      findCompoundCollisionManifolds(
        vehicleColliders({ x: 0.5, angle: Math.PI / 2 }),
        [wall],
      ),
    ).toHaveLength(0)
    expect(
      sweepCompoundColliders(
        {
          colliders: vehicleColliders({ angle: 0 }),
          velocity: { x: 0.5 / PHYSICS_STEP_SECONDS, y: 0 },
        },
        { colliders: [wall], velocity: { x: 0, y: 0 } },
        PHYSICS_STEP_SECONDS,
      ),
    ).not.toBeNull()
    expect(
      resolveVehicleAgainstStaticColliders(
        state,
        PHYSICS_STEP_SECONDS,
        () => [wall],
      ),
    ).toBe(false)
    expect(state.position.x).toBeCloseTo(0.5)
    expect(state.angle).toBeCloseTo(Math.PI / 2)
  })

  it('preserves four-centimetre Monaco-style clearance without invisible contact', () => {
    const upperWall = concreteWall('monaco-upper', 0, 1.165, 20, 0.125)
    const lowerWall = concreteWall('monaco-lower', 0, -1.165, 20, 0.125)
    const centered = vehicleColliders()
    const movedIntoUpperFace = vehicleColliders({ y: 0.05 })

    expect(
      findCompoundCollisionManifolds(centered, [upperWall, lowerWall]),
    ).toHaveLength(0)
    expect(
      findCompoundCollisionManifolds(movedIntoUpperFace, [upperWall]),
    ).not.toHaveLength(0)
  })

  it('preserves front/rear clearance through a Monaco-style hairpin corridor', () => {
    const upperWall = concreteWall('monaco-hairpin-upper', 0, 2.965, 8, 0.125)
    const lowerWall = concreteWall('monaco-hairpin-lower', 0, -2.965, 8, 0.125)
    const rotated = vehicleColliders({ angle: Math.PI / 2 })
    const movedIntoUpperFace = vehicleColliders({ y: 0.06, angle: Math.PI / 2 })

    expect(
      findCompoundCollisionManifolds(rotated, [upperWall, lowerWall]),
    ).toHaveLength(0)
    expect(
      findCompoundCollisionManifolds(movedIntoUpperFace, [upperWall]),
    ).not.toHaveLength(0)
  })
})
