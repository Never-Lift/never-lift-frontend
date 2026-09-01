import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { onlineApi } from '@/lib/api'
import { jsonResponse } from '@/test/render-app'

describe('onlineApi', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', 'http://localhost:8080/api')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('lists rooms and sends the in-memory auth token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ rooms: [{ code: '1234', name: 'Treino' }] }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(onlineApi.listRooms('guest.jwt')).resolves.toEqual([
      { code: '1234', name: 'Treino' },
    ])
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8080/api/rooms',
      expect.objectContaining({ headers: expect.any(Headers) }),
    )
    const headers = fetchMock.mock.calls[0][1].headers as Headers
    expect(headers.get('Authorization')).toBe('Bearer guest.jwt')
  })

  it('uses the room actions and ticket endpoint without putting a JWT in the URL', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ code: '1234', name: 'Treino' }, 201))
      .mockResolvedValueOnce(jsonResponse({ ticket: 'ticket', roomCode: '1234', expiresAt: '2026-09-01T12:01:00Z' }))
    vi.stubGlobal('fetch', fetchMock)

    await onlineApi.createRoom(
      {
        trackId: 'albert-park',
        gridSize: 22,
        botsEnabled: false,
        botDifficulty: 'normal',
        visibility: 'public',
      },
      'user.jwt',
    )
    const response = await onlineApi.getConnectionTicket('1234', 'user.jwt')
    expect(response.ticket).toBe('ticket')
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:8080/api/rooms')
    expect(fetchMock.mock.calls[1][0]).toBe(
      'http://localhost:8080/api/rooms/1234/connection-ticket',
    )
    expect(String(fetchMock.mock.calls[1][0])).not.toContain('jwt')
  })

  it('uses explicit endpoints to remove a participant and leave the room', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ code: '1234', trackId: 'albert-park' }))
      .mockResolvedValueOnce(jsonResponse({ code: '1234', trackId: 'albert-park' }))
    vi.stubGlobal('fetch', fetchMock)

    await onlineApi.removePlayer('1234', 'player-2', 'host.jwt')
    await onlineApi.leaveRoom('1234', 'player.jwt')

    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://localhost:8080/api/rooms/1234/participants/player-2',
    )
    expect(fetchMock.mock.calls[0][1]).toEqual(
      expect.objectContaining({ method: 'DELETE' }),
    )
    expect(fetchMock.mock.calls[1][0]).toBe(
      'http://localhost:8080/api/rooms/1234/leave',
    )
    expect(fetchMock.mock.calls[1][1]).toEqual(
      expect.objectContaining({ method: 'POST' }),
    )
  })
})
