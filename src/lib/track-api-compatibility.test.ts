import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { raceApi } from '@/lib/api'
import { jsonResponse } from '@/test/render-app'
import { SHORT_TRACK } from '@/test/track-fixtures'

type MutableTrackDefinitionPayload = {
  catalogVersion: string
  physicsContractVersion: string
  curbs: Array<{
    palette: string
    widthMeters: number
  }>
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
      }
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
    }
    definition.barrierGeometry.segments[0].material = 'tecpro'
    definition.barrierGeometry.segments[0].thicknessMeters = 0.62
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(definition)))

    await expect(raceApi.getTrack('monaco')).resolves.toEqual(definition)
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
          catalogVersion: '2026.7',
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
})
