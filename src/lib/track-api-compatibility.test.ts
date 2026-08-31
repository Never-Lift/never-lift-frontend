import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { raceApi, type TrackEscapeRoad } from '@/lib/api'
import { jsonResponse } from '@/test/render-app'
import { SHORT_TRACK } from '@/test/track-fixtures'

type MutableTrackDefinitionPayload = {
  catalogVersion: string
  physicsContractVersion: string
  curbs: Array<{
    palette: string
    widthMeters: number
    outerColor?: string
    outerWidthMeters?: number
  }>
  pitLane: {
    visualStyle: {
      laneWidthMeters: number
      garageStartRatio: number
      garageEndRatio: number
      pitBoxLengthMeters: number
      pitBoxDepthMeters: number
      pitBoxCenterOffsetMeters: number
      garageDepthMeters: number
      garageCenterOffsetMeters: number
      pitWallHeightMeters: number
      canopyDepthMeters: number
    }
  }
  centerline: Array<{
    halfWidthMeters: number
    elevationLayer?: number
  }>
  trackLimits: {
    segments: Array<{
      left: {
        zones: Array<{ surface: string; widthMeters: number }>
        barrier?: string
        fence?: string
        fenceVisualStyle?: {
          heightMeters: number
          postSpacingMeters: number
          postColor: string
          meshColor: string
          meshOpacity: number
          cantileverMeters: number
        }
      }
    }>
  }
  sceneryLayout: {
    landmarks: Array<{
      id: string
      kind: string
      position: { x: number; y: number }
      rotation: number
      scale: number
      dimensions?: {
        lengthMeters: number
        depthMeters: number
        heightMeters: number
      }
    }>
    staticObjects: Array<{
      id: string
      kind: string
      position: { x: number; y: number }
      rotation: number
      scale: number
    }>
    escapeRoads: Array<{
      id: string
      kind: string
      affectsPhysics: boolean
      elevationLayer: number
      widthMeters: number
      path: Array<{ x: number; y: number }>
      obstacleRows: Array<{
        from: { x: number; y: number }
        to: { x: number; y: number }
        blockLengthMeters: number
        palette: string
      }>
    }>
  }
  barrierGeometry: {
    segments: Array<{
      trackLimitSegmentIndex: number
      side: string
      material: string
      collisionLayer: string
      thicknessMeters: number
      chunkIndexes: number[]
      path: Array<{ x: number; y: number; elevationLayer: number }>
    }>
  }
  source: {
    environmentReferences: Array<unknown>
  }
}

function validEscapeRoad(): TrackEscapeRoad {
  return {
    id: 'rettifilo-slalom',
    kind: 'slalom-block-rows',
    affectsPhysics: false,
    elevationLayer: 0,
    widthMeters: 7,
    path: [
      { x: 0, y: 0 },
      { x: 30, y: 4 },
    ],
    obstacleRows: [
      { from: { x: 8, y: -3 }, to: { x: 8, y: 1 }, blockLengthMeters: 1, palette: 'white-red-chevron' },
      { from: { x: 15, y: -1 }, to: { x: 15, y: 3 }, blockLengthMeters: 1, palette: 'white-red-chevron' },
      { from: { x: 22, y: -3 }, to: { x: 22, y: 1 }, blockLengthMeters: 1, palette: 'white-red-chevron' },
    ],
  }
}

describe('track API compatibility guard', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', 'http://localhost:8080/api')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('accepts a valid 2.0 definition with explicit barrier faces', async () => {
    const definition = structuredClone(SHORT_TRACK)
    definition.trackLimits.segments[0].left = {
      zones: [],
      barrier: 'tecpro',
      fence: 'debris-fence',
      fenceVisualStyle: {
        heightMeters: 3.5,
        postSpacingMeters: 2.8,
        postColor: '#77838e',
        meshColor: '#65727e',
        meshOpacity: 0.23,
        cantileverMeters: 0.25,
      },
    }
    definition.sceneryLayout.landmarks.push({
      id: 'main-grandstand',
      kind: 'main-grandstand-covered',
      position: { x: 30, y: 40 },
      rotation: 0,
      scale: 12,
      dimensions: {
        lengthMeters: 28,
        depthMeters: 14,
        heightMeters: 8,
      },
    })
    definition.barrierGeometry.segments[0].material = 'tecpro'
    definition.barrierGeometry.segments[0].thicknessMeters = 0.62
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(definition)))

    await expect(raceApi.getTrack('monaco')).resolves.toEqual(definition)
  })

  it('accepts a visual-only slalom escape road without changing the physics contract', async () => {
    const definition = structuredClone(SHORT_TRACK)
    definition.sceneryLayout.escapeRoads = [validEscapeRoad()]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(definition)))

    await expect(raceApi.getTrack('monza')).resolves.toEqual(definition)
  })

  it('accepts contiguous barrier pieces split at an elevation boundary', async () => {
    const definition = structuredClone(SHORT_TRACK)
    const original = definition.barrierGeometry.segments[0]
    const splitIndex = Math.floor(original.path.length / 2)
    const splitPoint = original.path[splitIndex]
    const first = {
      ...original,
      toDistanceMeters: splitPoint.distanceMeters,
      path: original.path.slice(0, splitIndex + 1),
    }
    const second = {
      ...original,
      fromDistanceMeters: splitPoint.distanceMeters,
      path: original.path.slice(splitIndex),
    }
    definition.barrierGeometry.segments = [
      first,
      second,
      ...definition.barrierGeometry.segments.slice(1),
    ].map((segment, index) => ({ ...segment, index }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(definition)))

    await expect(raceApi.getTrack('suzuka')).resolves.toEqual(definition)
  })

  it('accepts authored braking boards and a matching physical/visual barrier opening', async () => {
    const definition = structuredClone(SHORT_TRACK)
    definition.sceneryLayout.brakingMarkers = [
      {
        id: 'turn-1-150m',
        cornerIndex: 1,
        distanceToCornerMeters: 150,
        trackDistanceMeters: 10,
        side: 'left',
        position: { x: 30, y: 12 },
        rotation: 0,
        elevationLayer: 0,
      },
    ]
    const original = definition.barrierGeometry.segments[0]
    const openingFrom = original.path[1]
    const openingTo = original.path[2]
    definition.barrierOpenings = [
      {
        id: 'test-escape-access',
        side: original.side,
        fromDistanceMeters: openingFrom.distanceMeters,
        toDistanceMeters: openingTo.distanceMeters,
        reason: 'escape-road-access',
      },
    ]
    definition.barrierGeometry.segments = [
      {
        ...original,
        toDistanceMeters: openingFrom.distanceMeters,
        path: original.path.slice(0, 2),
      },
      {
        ...original,
        fromDistanceMeters: openingTo.distanceMeters,
        path: original.path.slice(2),
      },
      ...definition.barrierGeometry.segments.slice(1),
    ].map((segment, index) => ({ ...segment, index }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(definition)))

    await expect(raceApi.getTrack('monza')).resolves.toEqual(definition)
  })

  it('accepts a physical chevron escape road with its authored external edge', async () => {
    const definition = structuredClone(SHORT_TRACK)
    const road = validEscapeRoad()
    road.affectsPhysics = true
    road.edgeMaterial = 'concrete-wall'
    road.edgeSides = ['left']
    road.obstacleRows = road.obstacleRows.map((row) => ({
      ...row,
      palette: 'white-red-chevron',
      collisionMaterial: 'concrete-wall',
    }))
    definition.sceneryLayout.escapeRoads = [road]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(definition)))

    await expect(raceApi.getTrack('monza')).resolves.toEqual(definition)
  })

  it('rejects a gap between split barrier pieces', async () => {
    const definition = structuredClone(SHORT_TRACK)
    const original = definition.barrierGeometry.segments[0]
    const splitIndex = Math.floor(original.path.length / 2)
    const splitPoint = original.path[splitIndex]
    definition.barrierGeometry.segments = [
      {
        ...original,
        toDistanceMeters: splitPoint.distanceMeters,
        path: original.path.slice(0, splitIndex + 1),
      },
      {
        ...original,
        fromDistanceMeters: splitPoint.distanceMeters + 1,
        path: original.path.slice(splitIndex),
      },
      ...definition.barrierGeometry.segments.slice(1),
    ].map((segment, index) => ({ ...segment, index }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(definition)))

    await expect(raceApi.getTrack('suzuka')).rejects.toThrow(
      'dados desta pista não são compatíveis',
    )
  })

  it.each([
    {
      label: 'unknown curb palette',
      mutate: (definition: MutableTrackDefinitionPayload) => {
        definition.curbs[0].palette = 'neon-rainbow'
      },
    },
    {
      label: 'impossible curb width',
      mutate: (definition: MutableTrackDefinitionPayload) => {
        definition.curbs[0].widthMeters = 8
      },
    },
    {
      label: 'invalid curb outer paint',
      mutate: (definition: MutableTrackDefinitionPayload) => {
        definition.curbs[0].outerColor = 'green'
      },
    },
    {
      label: 'impossible curb outer width',
      mutate: (definition: MutableTrackDefinitionPayload) => {
        definition.curbs[0].outerWidthMeters = 4
      },
    },
    {
      label: 'impossible pit lane width',
      mutate: (definition: MutableTrackDefinitionPayload) => {
        definition.pitLane.visualStyle.laneWidthMeters = 30
      },
    },
    {
      label: 'missing pit garage depth',
      mutate: (definition: MutableTrackDefinitionPayload) => {
        delete (
          definition.pitLane.visualStyle as Partial<
            MutableTrackDefinitionPayload['pitLane']['visualStyle']
          >
        ).garageDepthMeters
      },
    },
    {
      label: 'obsolete catalog version',
      mutate: (definition: MutableTrackDefinitionPayload) => {
        definition.catalogVersion = '2026.2'
      },
    },
    {
      label: 'obsolete physics contract',
      mutate: (definition: MutableTrackDefinitionPayload) => {
        definition.physicsContractVersion = '1.3.0'
      },
    },
    {
      label: 'missing elevation layer',
      mutate: (definition: MutableTrackDefinitionPayload) => {
        delete definition.centerline[0].elevationLayer
      },
    },
    {
      label: 'impossible half width',
      mutate: (definition: MutableTrackDefinitionPayload) => {
        definition.centerline[0].halfWidthMeters = 2
      },
    },
    {
      label: 'unknown surface material',
      mutate: (definition: MutableTrackDefinitionPayload) => {
        definition.trackLimits.segments[0].left.zones = [
          { surface: 'ice', widthMeters: 4 },
        ]
      },
    },
    {
      label: 'non-positive zone width',
      mutate: (definition: MutableTrackDefinitionPayload) => {
        definition.trackLimits.segments[0].left.zones = [
          { surface: 'grass', widthMeters: -2 },
        ]
      },
    },
    {
      label: 'missing barrier type',
      mutate: (definition: MutableTrackDefinitionPayload) => {
        delete definition.trackLimits.segments[0].left.barrier
      },
    },
    {
      label: 'unknown barrier type',
      mutate: (definition: MutableTrackDefinitionPayload) => {
        definition.trackLimits.segments[0].left.barrier = 'invisible-wall'
      },
    },
    {
      label: 'debris fence used as the impact barrier',
      mutate: (definition: MutableTrackDefinitionPayload) => {
        definition.trackLimits.segments[0].left.barrier = 'debris-fence'
      },
    },
    {
      label: 'unknown fence type',
      mutate: (definition: MutableTrackDefinitionPayload) => {
        definition.trackLimits.segments[0].left.fence = 'spectator-fence'
      },
    },
    {
      label: 'invalid fence visual height',
      mutate: (definition: MutableTrackDefinitionPayload) => {
        definition.trackLimits.segments[0].left.fenceVisualStyle = {
          heightMeters: 9,
          postSpacingMeters: 2.8,
          postColor: '#77838e',
          meshColor: '#65727e',
          meshOpacity: 0.23,
          cantileverMeters: 0.25,
        }
      },
    },
    {
      label: 'invalid scenery footprint',
      mutate: (definition: MutableTrackDefinitionPayload) => {
        definition.sceneryLayout.landmarks.push({
          id: 'main-grandstand',
          kind: 'main-grandstand-covered',
          position: { x: 30, y: 40 },
          rotation: 0,
          scale: 12,
          dimensions: {
            lengthMeters: 401,
            depthMeters: 14,
            heightMeters: 8,
          },
        })
      },
    },
    {
      label: 'missing escape road collection',
      mutate: (definition: MutableTrackDefinitionPayload) => {
        delete (
          definition.sceneryLayout as Partial<
            MutableTrackDefinitionPayload['sceneryLayout']
          >
        ).escapeRoads
      },
    },
    {
      label: 'escape road affecting physics',
      mutate: (definition: MutableTrackDefinitionPayload) => {
        definition.sceneryLayout.escapeRoads = [validEscapeRoad()]
        definition.sceneryLayout.escapeRoads[0].affectsPhysics = true
      },
    },
    {
      label: 'escape road with invalid palette',
      mutate: (definition: MutableTrackDefinitionPayload) => {
        definition.sceneryLayout.escapeRoads = [validEscapeRoad()]
        definition.sceneryLayout.escapeRoads[0].obstacleRows[0].palette =
          'yellow-black'
      },
    },
    {
      label: 'escape road with too short path',
      mutate: (definition: MutableTrackDefinitionPayload) => {
        definition.sceneryLayout.escapeRoads = [validEscapeRoad()]
        definition.sceneryLayout.escapeRoads[0].path = [{ x: 0, y: 0 }]
      },
    },
    {
      label: 'duplicate escape road and scenery id',
      mutate: (definition: MutableTrackDefinitionPayload) => {
        definition.sceneryLayout.staticObjects.push({
          id: 'rettifilo-slalom',
          kind: 'start-gantry',
          position: { x: 0, y: 0 },
          rotation: 0,
          scale: 1,
        })
        definition.sceneryLayout.escapeRoads = [validEscapeRoad()]
      },
    },
    {
      label: 'missing audit references',
      mutate: (definition: MutableTrackDefinitionPayload) => {
        definition.source.environmentReferences = []
      },
    },
    {
      label: 'barrier material diverging from track limits',
      mutate: (definition: MutableTrackDefinitionPayload) => {
        definition.barrierGeometry.segments[0].material = 'guardrail'
      },
    },
    {
      label: 'barrier face on an unknown collision layer',
      mutate: (definition: MutableTrackDefinitionPayload) => {
        definition.barrierGeometry.segments[0].collisionLayer = 'invisible-wall'
      },
    },
    {
      label: 'barrier face with no geometric path',
      mutate: (definition: MutableTrackDefinitionPayload) => {
        definition.barrierGeometry.segments[0].path = []
      },
    },
    {
      label: 'barrier face referencing an unknown chunk',
      mutate: (definition: MutableTrackDefinitionPayload) => {
        definition.barrierGeometry.segments[0].chunkIndexes = [999]
      },
    },
  ])('rejects a nominal 2.0 definition with $label', async ({ mutate }) => {
    const definition = structuredClone(
      SHORT_TRACK,
    ) as unknown as MutableTrackDefinitionPayload
    mutate(definition)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(definition)))

    await expect(raceApi.getTrack('monaco')).rejects.toThrow(
      'dados desta pista não são compatíveis',
    )
  })

  it('rejects a definition with no environment segments before geometry lookup can crash', async () => {
    const definition = structuredClone(SHORT_TRACK)
    definition.trackLimits.segments = []
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(definition)))

    await expect(raceApi.getTrack('monaco')).rejects.toThrow(
      'dados desta pista não são compatíveis',
    )
  })

  it('rejects an obsolete catalog before its entries are shown', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          schemaVersion: '1.1.0',
          catalogVersion: '2026.2',
          physicsContractVersion: '1.3.0',
          seasonReference: 2026,
          tracks: [],
        }),
      ),
    )

    await expect(raceApi.getTracks()).rejects.toThrow(
      'lista de circuitos não é compatível',
    )
  })

  it('rejects a nominal 2.0 catalog from another catalog generation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          schemaVersion: '2.0.0',
          catalogVersion: '2026.6',
          physicsContractVersion: '2.0.0',
          seasonReference: 2026,
          tracks: Array.from({ length: 24 }, () => ({})),
        }),
      ),
    )

    await expect(raceApi.getTracks()).rejects.toThrow(
      'lista de circuitos não é compatível',
    )
  })

  it('rejects a 2026.12 catalog with a malformed track entry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          schemaVersion: '2.0.0',
          catalogVersion: '2026.12',
          physicsContractVersion: '2.0.0',
          seasonReference: 2026,
          calendarPolicy: 'original-24-round-freeze',
          tracks: Array.from({ length: 24 }, (_, index) => ({
            round: index + 1,
            id: `track-${index + 1}`,
            name: `Track ${index + 1}`,
            countryCode: 'TS',
            countryName: 'Test',
            locality: `Test ${index + 1}`,
            lengthMeters: 4000 + index,
            definitionPath:
              index === 0 ? '../outside.json' : `tracks/track-${index + 1}.json`,
          })),
        }),
      ),
    )

    await expect(raceApi.getTracks()).rejects.toThrow(
      'lista de circuitos não é compatível',
    )
  })
})
