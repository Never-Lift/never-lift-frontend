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
    const catalog = {
      schemaVersion: '1.1.0',
      catalogVersion: '2026.2',
      seasonReference: 2026,
      calendarPolicy: 'original-24-round-freeze',
      tracks: [
        {
          round: 8,
          id: 'monaco',
          name: 'Circuit de Monaco',
          countryCode: 'MC',
          countryName: 'Monaco',
          locality: 'Monaco',
          lengthMeters: 3337,
          definitionPath: 'tracks/monaco.json',
        },
      ],
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

  it('posts a contract-compatible local result with the in-memory token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ persistedCount: 2, resultIds: ['result-1', 'result-2'] }, 201),
    )
    vi.stubGlobal('fetch', fetchMock)
    const payload = {
      trackId: 'albert-park',
      trackCatalogVersion: '2026.2',
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
