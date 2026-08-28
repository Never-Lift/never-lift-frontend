import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { raceApi } from '@/lib/api'
import { jsonResponse } from '@/test/render-app'
import { SHORT_TRACK } from '@/test/track-fixtures'

describe('raceApi', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', 'http://localhost:8080/api')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('loads the versioned track catalog and a selected definition', async () => {
    const catalogTracks = Array.from({ length: 24 }, (_, index) => ({
      round: index + 1,
      id: index === 7 ? 'monaco' : `track-${index + 1}`,
      name: index === 7 ? 'Circuit de Monaco' : `Track ${index + 1}`,
      countryCode: index === 7 ? 'MC' : 'TS',
      countryName: index === 7 ? 'Monaco' : 'Test',
      locality: index === 7 ? 'Monaco' : `Test ${index + 1}`,
      lengthMeters: index === 7 ? 3337 : 4000 + index,
      definitionPath:
        index === 7 ? 'tracks/monaco.json' : `tracks/track-${index + 1}.json`,
    }))
    const catalog = {
      schemaVersion: '2.0.0',
      catalogVersion: '2026.11',
      physicsContractVersion: '2.0.0',
      seasonReference: 2026,
      calendarPolicy: 'original-24-round-freeze',
      tracks: catalogTracks,
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(catalog))
      .mockResolvedValueOnce(jsonResponse(SHORT_TRACK))
    vi.stubGlobal('fetch', fetchMock)

    await expect(raceApi.getTracks()).resolves.toEqual(catalog)
    await expect(raceApi.getTrack('monaco')).resolves.toEqual(SHORT_TRACK)
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/tracks',
      expect.any(Object),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/tracks/monaco',
      expect.any(Object),
    )
  })

  it('reports a deploy mismatch before an obsolete definition reaches the race canvas', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          ...SHORT_TRACK,
          schemaVersion: '1.1.0',
          catalogVersion: '2026.2',
          physicsContractVersion: '1.3.0',
          trackLimits: {
            runoffWidthMeters: 10,
            segments: [],
          },
        }),
      ),
    )

    await expect(raceApi.getTrack('monaco')).rejects.toThrow(
      'não são compatíveis com esta versão do jogo',
    )
  })

  it('posts a contract-compatible local result with the in-memory token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ persistedCount: 2, resultIds: ['result-1', 'result-2'] }, 201),
    )
    vi.stubGlobal('fetch', fetchMock)
    const payload = {
      trackId: 'albert-park',
      trackCatalogVersion: '2026.11',
      physicsContractVersion: '2.0.0',
      mode: 'local' as const,
      results: [
        {
          userIdOrNull: 'd42a153a-234b-4655-a36c-04075687c5fb',
          position: 1,
          totalTimeMs: 12_000,
          bestLapTimeMs: 12_000,
          finished: true,
        },
        {
          userIdOrNull: null,
          position: 2,
          totalTimeMs: 12_500,
          bestLapTimeMs: 12_500,
          finished: true,
        },
      ],
    }

    await expect(raceApi.submitLocalResult(payload, 'user.jwt')).resolves.toEqual({
      persistedCount: 2,
      resultIds: ['result-1', 'result-2'],
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8080/api/races/local-result',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(payload),
        headers: expect.any(Headers),
      }),
    )
    const headers = fetchMock.mock.calls[0][1].headers as Headers
    expect(headers.get('Authorization')).toBe('Bearer user.jwt')
  })
})
