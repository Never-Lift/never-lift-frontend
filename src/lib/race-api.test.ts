import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { raceApi } from '@/lib/api'
import { jsonResponse } from '@/test/render-app'

describe('raceApi', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', 'http://localhost:8080/api')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('posts a contract-compatible local result with the in-memory token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ persistedCount: 2, resultIds: ['result-1', 'result-2'] }, 201),
    )
    vi.stubGlobal('fetch', fetchMock)
    const payload = {
      trackId: 'albert-park',
      trackCatalogVersion: '2026.1',
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
