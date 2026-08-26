import { describe, expect, it } from 'vitest'

import type { TrackDefinition } from '@/lib/api'
import { sweepCompoundCollidersWithRotation } from '@/race/continuous-collision'
import { PHYSICS_STEP_SECONDS } from '@/race/constants'
import { TrackGeometry } from '@/race/TrackGeometry'
import { createTrackFixture } from '@/test/track-fixtures'
import { createVehicleWorldCollider } from '@/race/vehicle-geometry'

/*
 * Test-only extract from the executable Monaco v2 definition, catalog 2026.6:
 * contracts/module-2/v2/tracks/monaco.json, 1588.572 m..1613.549 m.
 *
 * The 24 complete definitions intentionally live only in the backend. Keeping
 * this narrow, verbatim geometry extract exercises the real TrackGeometry path
 * without turning the frontend test bundle into a second track catalog.
 */
const MONACO_CENTERLINE: TrackDefinition['centerline'] = [
  {
    x: -435.452,
    y: -394.107,
    distanceMeters: 1588.572,
    halfWidthMeters: 5,
    elevationLayer: 0,
  },
  {
    x: -435.663,
    y: -399.098,
    distanceMeters: 1593.567,
    halfWidthMeters: 5,
    elevationLayer: 0,
  },
  {
    x: -435.796,
    y: -404.091,
    distanceMeters: 1598.563,
    halfWidthMeters: 5,
    elevationLayer: 0,
  },
  {
    x: -435.869,
    y: -409.086,
    distanceMeters: 1603.558,
    halfWidthMeters: 5,
    elevationLayer: 0,
  },
  {
    x: -435.899,
    y: -414.082,
    distanceMeters: 1608.554,
    halfWidthMeters: 5,
    elevationLayer: 0,
  },
  {
    x: -435.919,
    y: -419.077,
    distanceMeters: 1613.549,
    halfWidthMeters: 5,
    elevationLayer: 0,
  },
]

const MONACO_BARRIER_PATHS = {
  left: [
    { x: -430.458, y: -394.359, distanceMeters: 1588.572, elevationLayer: 0 },
    { x: -430.666, y: -399.27, distanceMeters: 1593.567, elevationLayer: 0 },
    { x: -430.797, y: -404.194, distanceMeters: 1598.563, elevationLayer: 0 },
    { x: -430.869, y: -409.138, distanceMeters: 1603.558, elevationLayer: 0 },
    { x: -430.899, y: -414.107, distanceMeters: 1608.554, elevationLayer: 0 },
    { x: -430.919, y: -419.091, distanceMeters: 1613.549, elevationLayer: 0 },
  ],
  right: [
    { x: -440.446, y: -393.855, distanceMeters: 1588.572, elevationLayer: 0 },
    { x: -440.66, y: -398.926, distanceMeters: 1593.567, elevationLayer: 0 },
    { x: -440.795, y: -403.988, distanceMeters: 1598.563, elevationLayer: 0 },
    { x: -440.869, y: -409.034, distanceMeters: 1603.558, elevationLayer: 0 },
    { x: -440.899, y: -414.057, distanceMeters: 1608.554, elevationLayer: 0 },
    { x: -440.919, y: -419.063, distanceMeters: 1613.549, elevationLayer: 0 },
  ],
} satisfies Record<'left' | 'right', TrackDefinition['barrierGeometry']['segments'][number]['path']>

function createMonacoConcreteCorridor() {
  const base = createTrackFixture('monaco')
  const chunk = {
    index: 6,
    fromDistanceMeters: 1588.572,
    toDistanceMeters: 1613.549,
    bounds: {
      minX: -445,
      minY: -424,
      maxX: -426,
      maxY: -389,
    },
  }
  const barrier = (
    index: 16 | 17,
    side: 'left' | 'right',
  ): TrackDefinition['barrierGeometry']['segments'][number] => ({
    index,
    trackLimitSegmentIndex: 8,
    side,
    fromDistanceMeters: 1434.91,
    toDistanceMeters: 1635.13,
    material: 'concrete-wall',
    thicknessMeters: 0.35,
    collisionLayer: 'track-barrier',
    chunkIndexes: [6],
    path: MONACO_BARRIER_PATHS[side],
  })

  return {
    ...base,
    bounds: chunk.bounds,
    centerline: MONACO_CENTERLINE,
    racingLine: MONACO_CENTERLINE.map((point) => ({
      x: point.x,
      y: point.y,
      distanceMeters: point.distanceMeters,
      targetSpeedFactor: 0.5,
    })),
    barrierGeometry: {
      segments: [barrier(16, 'left'), barrier(17, 'right')],
    },
    chunks: [chunk],
  } satisfies TrackDefinition
}

function centerlinePose(index: number) {
  const point = MONACO_CENTERLINE[index]
  const previous = MONACO_CENTERLINE[index - 1]
  const next = MONACO_CENTERLINE[index + 1]
  return {
    position: { x: point.x, y: point.y },
    angle: Math.atan2(next.y - previous.y, next.x - previous.x),
  }
}

function offsetPose(
  pose: ReturnType<typeof centerlinePose>,
  leftOffsetMeters: number,
) {
  const left = { x: -Math.sin(pose.angle), y: Math.cos(pose.angle) }
  return {
    position: {
      x: pose.position.x + left.x * leftOffsetMeters,
      y: pose.position.y + left.y * leftOffsetMeters,
    },
    angle: pose.angle,
  }
}

describe('Monaco v2 canonical barrier regression', () => {
  it('keeps the complete F1 clear while centered through the real corridor extract', () => {
    const geometry = new TrackGeometry(createMonacoConcreteCorridor())

    for (let index = 1; index < MONACO_CENTERLINE.length - 1; index += 1) {
      const pose = centerlinePose(index)
      expect(
        geometry.getBarrierCollisionManifolds(
          createVehicleWorldCollider(pose),
          0,
        ),
        `unexpected invisible contact at ${MONACO_CENTERLINE[index].distanceMeters} m`,
      ).toHaveLength(0)
    }
  })

  it('uses the canonical faces without an invisible safety margin', () => {
    const geometry = new TrackGeometry(createMonacoConcreteCorridor())
    const centered = centerlinePose(2)

    for (const clearOffset of [-3.9, 3.9]) {
      expect(
        geometry.getBarrierCollisionManifolds(
          createVehicleWorldCollider(offsetPose(centered, clearOffset)),
          0,
        ),
      ).toHaveLength(0)
    }

    const leftContact = geometry.getBarrierCollisionManifolds(
      createVehicleWorldCollider(offsetPose(centered, 4.1)),
      0,
    )
    const rightContact = geometry.getBarrierCollisionManifolds(
      createVehicleWorldCollider(offsetPose(centered, -4.1)),
      0,
    )

    expect(leftContact.some((contact) => contact.secondColliderId.startsWith('barrier-16-'))).toBe(true)
    expect(rightContact.some((contact) => contact.secondColliderId.startsWith('barrier-17-'))).toBe(true)
    expect(
      [...leftContact, ...rightContact].every(
        (contact) => contact.secondCollisionMaterial === 'concrete-wall',
      ),
    ).toBe(true)
  })

  it('detects a translating and rotating F1 crossing a canonical face between clear endpoints', () => {
    const geometry = new TrackGeometry(createMonacoConcreteCorridor())
    const from = centerlinePose(2)
    const to = offsetPose(from, 7)
    const angularDelta = 0.08
    const endPose = { ...to, angle: to.angle + angularDelta }
    const bounds = {
      minX: Math.min(from.position.x, to.position.x) - 4,
      minY: Math.min(from.position.y, to.position.y) - 4,
      maxX: Math.max(from.position.x, to.position.x) + 4,
      maxY: Math.max(from.position.y, to.position.y) + 4,
    }

    expect(
      geometry.getBarrierCollisionManifolds(
        createVehicleWorldCollider(from),
        0,
      ),
    ).toHaveLength(0)
    expect(
      geometry.getBarrierCollisionManifolds(
        createVehicleWorldCollider(endPose),
        0,
      ),
    ).toHaveLength(0)

    const velocity = {
      x: (to.position.x - from.position.x) / PHYSICS_STEP_SECONDS,
      y: (to.position.y - from.position.y) / PHYSICS_STEP_SECONDS,
    }
    const angularVelocity = angularDelta / PHYSICS_STEP_SECONDS
    const impact = sweepCompoundCollidersWithRotation(
      {
        colliders: createVehicleWorldCollider(from),
        position: from.position,
        velocity,
        angularVelocity,
      },
      {
        colliders: geometry.getBarrierColliders(0, bounds),
        position: { x: 0, y: 0 },
        velocity: { x: 0, y: 0 },
        angularVelocity: 0,
      },
      PHYSICS_STEP_SECONDS,
    )

    expect(impact).not.toBeNull()
    if (!impact) return
    expect(
      impact.manifolds.some(
        (contact) =>
          contact.secondColliderId.startsWith('barrier-16-') &&
          contact.secondCollisionMaterial === 'concrete-wall',
      ),
    ).toBe(true)

    const impactPose = {
      position: {
        x: from.position.x + velocity.x * impact.timeSeconds,
        y: from.position.y + velocity.y * impact.timeSeconds,
      },
      angle: from.angle + angularVelocity * impact.timeSeconds,
    }
    const actualContacts = geometry.getBarrierCollisionManifolds(
      createVehicleWorldCollider(impactPose),
      0,
    )
    expect(actualContacts).not.toHaveLength(0)
    expect(
      actualContacts.some((actual) =>
        impact.manifolds.some(
          (reported) =>
            reported.firstColliderId === actual.firstColliderId &&
            reported.secondColliderId === actual.secondColliderId,
        ),
      ),
    ).toBe(true)
  })
})
