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
  it.each([SHORT_TRACK, LONG_TRACK])('indexed projection preserves full-scan results and canonical ties in $id', (definition) => {
    const indexed = new TrackGeometry(definition)
    const fullScan = new TrackGeometry(definition)
    // Exercise the exact same projection/ranking against one unprunable block.
    Object.assign(fullScan, { centerlineProjectionBlocks: [{
      indexes: Array.from({ length: definition.centerline.length - 1 }, (_, i) => i),
      bounds: { minX: -Infinity, minY: -Infinity, maxX: Infinity, maxY: Infinity },
    }] })
    const radius = definition.lengthMeters / (Math.PI * 2)
    for (let i = 0; i < 120; i++) {
      const angle = i * Math.PI / 60
      const point = { x: Math.cos(angle) * radius * (i % 3), y: Math.sin(angle) * radius * (i % 3) }
      for (const preferred of [undefined, definition.lengthMeters * .25]) {
        expect(indexed.project(point, preferred)).toEqual(fullScan.project(point, preferred))
      }
    }
  })
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

  it('adds physical escape-road blocks and edge walls to the same collision broadphase', () => {
    const definition = structuredClone(SHORT_TRACK)
    definition.sceneryLayout.escapeRoads = [
      {
        id: 'physical-escape',
        kind: 'slalom-block-rows',
        affectsPhysics: true,
        edgeMaterial: 'concrete-wall',
        edgeSides: ['left'],
        elevationLayer: 0,
        widthMeters: 7,
        path: [
          { x: 100, y: 0 },
          { x: 120, y: 0 },
        ],
        obstacleRows: [
          {
            from: { x: 104, y: -2 },
            to: { x: 104, y: 2 },
            blockLengthMeters: 0.9,
            palette: 'white-red-chevron',
            collisionMaterial: 'concrete-wall',
          },
          {
            from: { x: 110, y: -2 },
            to: { x: 110, y: 2 },
            blockLengthMeters: 0.9,
            palette: 'white-red-chevron',
            collisionMaterial: 'concrete-wall',
          },
          {
            from: { x: 116, y: -2 },
            to: { x: 116, y: 2 },
            blockLengthMeters: 0.9,
            palette: 'white-red-chevron',
            collisionMaterial: 'concrete-wall',
          },
        ],
      },
    ]
    const geometry = new TrackGeometry(definition)

    const obstacleManifold = geometry.getBarrierCollisionManifolds(
      [rectangle('escape-obstacle-probe', 104, 0, 0.5, 0.5)],
      0,
    )[0]
    expect(obstacleManifold?.secondColliderId).toMatch(
      /^escape-physical-escape-row-0-block-/,
    )
    expect(obstacleManifold?.secondCollisionMaterial).toBe('concrete-wall')

    const edgeColliders = geometry.getBarrierColliders(0, {
      minX: 99,
      minY: 3,
      maxX: 121,
      maxY: 4,
    })
    expect(
      edgeColliders.some(
        (collider) => collider.id === 'escape-physical-escape-edge-left-0',
      ),
    ).toBe(true)
    expect(
      geometry.getBarrierColliders(0).some(
        (collider) => collider.id === 'escape-physical-escape-edge-right-0',
      ),
    ).toBe(false)
    expect(geometry.getSurfaceAt({ x: 108, y: 0 })).toBe('asphalt')
    expect(
      geometry.getBarrierCollisionManifolds(
        [rectangle('clear-escape-probe', 108, 0, 0.2, 0.2)],
        0,
      ),
    ).toHaveLength(0)
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
      geometry.getSurfaceAt({ x: runoffRadius + 8.5, y: 0 }, 0),
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

  it('keeps the pit corridor open while blocking passage through the garage shell', () => {
    const definition = structuredClone(SHORT_TRACK)
    definition.pitLane.path = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
    ]
    definition.pitLane.garageBarrier = {
      side: 'right',
      material: 'concrete-wall',
      thicknessMeters: 0.35,
      path: [
        { x: 0, y: -10 },
        { x: 20, y: -10 },
      ],
    }
    const geometry = new TrackGeometry(definition)

    expect(
      geometry.getBarrierCollisionManifolds(
        [rectangle('pit-center-probe', 10, 0, 0.4, 0.4)],
        0,
      ),
    ).toHaveLength(0)
    const [garageContact] = geometry.getBarrierCollisionManifolds(
      [rectangle('garage-through-probe', 10, -10.1, 0.3, 0.3)],
      0,
    )
    expect(garageContact).toBeDefined()
    expect(garageContact?.secondColliderId).toMatch(/^garage-barrier-/)
    expect(garageContact?.secondCollisionMaterial).toBe('concrete-wall')
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
