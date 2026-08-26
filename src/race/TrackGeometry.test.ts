import { describe, expect, it } from 'vitest'

import { PHYSICS_CONSTANTS } from '@/race/constants'
import { crossesGate, TrackGeometry } from '@/race/TrackGeometry'
import { LONG_TRACK, SHORT_TRACK } from '@/test/track-fixtures'

function rectangle(
  id: string,
  centerX: number,
  centerY: number,
  halfWidth: number,
  halfHeight: number,
) {
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

describe('TrackGeometry', () => {
  const walledGeometry = new TrackGeometry(SHORT_TRACK)
  const runoffGeometry = new TrackGeometry(LONG_TRACK)
  const walledRadius = SHORT_TRACK.lengthMeters / (Math.PI * 2)
  const runoffRadius = LONG_TRACK.lengthMeters / (Math.PI * 2)

  it('classifies the real-width racing surface independently from screen scale', () => {
    expect(runoffGeometry.getSurfaceAt({ x: runoffRadius, y: 0 })).toBe('asphalt')
    expect(runoffGeometry.getSurfaceAt({ x: runoffRadius + 9, y: 0 })).toBe('grass')
  })

  it('distinguishes audited asphalt and gravel zones in the v2 physics mapping', () => {
    const definition = structuredClone(LONG_TRACK)
    definition.trackLimits.segments[0].right = {
      zones: [
        { surface: 'asphalt', widthMeters: 4 },
        { surface: 'gravel', widthMeters: 12 },
      ],
      barrier: 'tecpro',
    }
    const geometry = new TrackGeometry(definition)

    expect(
      geometry.getEnvironmentAt({ x: runoffRadius + 2, y: 0 }).material,
    ).toBe('asphalt')
    expect(
      geometry.getEnvironmentAt({ x: runoffRadius + 14, y: 0 }).material,
    ).toBe('gravel')
    expect(geometry.getSurfaceAt({ x: runoffRadius + 14, y: 0 })).toBe(
      'gravel',
    )
  })

  it('keeps a walled circuit closed at the asphalt edge', () => {
    const [contact] = walledGeometry.getBarrierCollisionManifolds(
      [rectangle('probe', walledRadius + 7.7, 0, 0.5, 0.5)],
      0,
    )

    expect(contact).toBeDefined()
    expect(contact?.penetrationMeters).toBeGreaterThan(0)
    expect(contact?.normal.x).toBeGreaterThan(0)
  })

  it('places collision at the audited sum of side-zone widths', () => {
    expect(
      runoffGeometry.getBarrierCollisionManifolds(
        [rectangle('clear-probe', runoffRadius + 9, 0, 1, 1)],
        0,
      ),
    ).toHaveLength(0)

    const [contact] = runoffGeometry.getBarrierCollisionManifolds(
      [rectangle('contact-probe', runoffRadius + 17.5, 0, 1, 1)],
      0,
    )
    expect(contact).toBeDefined()
    expect(contact?.normal.x).toBeGreaterThan(0)
  })

  it('uses the explicit track-facing barrier path with real contact points', () => {
    const faceX = walledRadius + 8
    const definition = structuredClone(SHORT_TRACK)
    definition.barrierGeometry.segments = [
      {
        index: 0,
        trackLimitSegmentIndex: 0,
        side: 'right',
        fromDistanceMeters: 0,
        toDistanceMeters: 40,
        material: 'concrete-wall',
        thicknessMeters: 0.4,
        collisionLayer: 'track-barrier',
        chunkIndexes: [0],
        path: [
          { x: faceX, y: -20, distanceMeters: 0, elevationLayer: 0 },
          { x: faceX, y: 20, distanceMeters: 40, elevationLayer: 0 },
        ],
      },
    ]
    const geometry = new TrackGeometry(definition)

    expect(
      geometry.getBarrierCollisionManifolds(
        [rectangle('clearance-probe', faceX - 0.54, 0, 0.5, 0.5)],
        0,
      ),
    ).toHaveLength(0)
    const [manifold] = geometry.getBarrierCollisionManifolds(
      [rectangle('vehicle-probe', faceX - 0.49, 0, 0.5, 0.5)],
      0,
    )
    expect(manifold.secondColliderId).toBe('barrier-0-0')
    expect(manifold.contacts.length).toBeGreaterThan(0)
    expect(manifold.normal.x).toBeGreaterThan(0)
    expect(manifold.penetrationMeters).toBeCloseTo(0.01, 8)
  })

  it('reports curb and gravel as their own v2 physics surfaces', () => {
    const definition = structuredClone(LONG_TRACK)
    definition.curbs = [
      {
        index: 0,
        fromDistanceMeters: 0,
        toDistanceMeters: 80,
        side: 'right',
        widthMeters: 1,
        stripeLengthMeters: 2,
        palette: 'red-white',
      },
    ]
    definition.trackLimits.segments[0].right = {
      zones: [{ surface: 'gravel', widthMeters: 12 }],
      barrier: 'tyre-barrier',
    }
    const geometry = new TrackGeometry(definition)

    expect(
      geometry.getSurfaceAt({ x: runoffRadius + 7.5, y: 0 }, 0),
    ).toBe('curb')
    expect(
      geometry.getSurfaceAt({ x: runoffRadius + 14, y: 0 }, 0),
    ).toBe('gravel')
  })

  it('uses the contracted pit-lane half width for surface classification', () => {
    const definition = structuredClone(SHORT_TRACK)
    definition.pitLane.path = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
    ]
    const geometry = new TrackGeometry(definition)
    const pitHalfWidth = PHYSICS_CONSTANTS.race.pitLaneHalfWidthMeters

    expect(geometry.getSurfaceAt({ x: 10, y: pitHalfWidth - 0.01 })).toBe(
      definition.surfaceModel.pitLane,
    )
    expect(geometry.getSurfaceAt({ x: 10, y: pitHalfWidth + 0.01 })).not.toBe(
      definition.surfaceModel.pitLane,
    )
  })

  it('accepts a directional gate only in order-compatible forward movement', () => {
    const gate = SHORT_TRACK.checkpoints[0]
    const from = {
      x: gate.position.x - gate.forward.x * 3,
      y: gate.position.y - gate.forward.y * 3,
    }
    const to = {
      x: gate.position.x + gate.forward.x * 3,
      y: gate.position.y + gate.forward.y * 3,
    }

    expect(crossesGate(from, to, gate)).toBe(true)
    expect(crossesGate(to, from, gate)).toBe(false)
    expect(
      crossesGate(
        { x: from.x - gate.forward.y * 30, y: from.y + gate.forward.x * 30 },
        { x: to.x - gate.forward.y * 30, y: to.y + gate.forward.x * 30 },
        gate,
      ),
    ).toBe(false)
  })
})
