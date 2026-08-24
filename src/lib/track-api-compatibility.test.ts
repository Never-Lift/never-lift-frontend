import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { raceApi } from '@/lib/api'
import { jsonResponse } from '@/test/render-app'
import { SHORT_TRACK } from '@/test/track-fixtures'

type MutableTrackDefinitionPayload = {
  catalogVersion: string
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

  it('accepts a valid 1.3 definition with curbs, asymmetric zones, and an optional fence', async () => {
    const definition = structuredClone(SHORT_TRACK)
    definition.trackLimits.segments[0].left = {
      zones: [
        { surface: 'asphalt', widthMeters: 4 },
        { surface: 'gravel', widthMeters: 11 },
      ],
      barrier: 'tecpro',
      fence: 'debris-fence',
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(definition)))

    await expect(raceApi.getTrack('monaco')).resolves.toEqual(definition)
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
  ])('rejects a nominal 1.3 definition with $label', async ({ mutate }) => {
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
          seasonReference: 2026,
          tracks: [],
        }),
      ),
    )

    await expect(raceApi.getTracks()).rejects.toThrow(
      'lista de circuitos não é compatível',
    )
  })

  it('rejects a nominal 1.3 catalog from another catalog generation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          schemaVersion: '1.3.0',
          catalogVersion: '2026.3',
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
