import { afterEach, describe, expect, it, vi } from 'vitest'

import type { RoomSummary } from '@/lib/api'
import type { OnlineRoomClientOptions } from '@/online/OnlineRoomClient'
import { onlineRoomSession } from '@/online/OnlineRoomSession'

const room: RoomSummary = {
  code: '1234',
  name: 'Persistente',
  hostId: 'user-1',
  trackId: 'albert-park',
  trackCatalogVersion: '2026.12',
  physicsContractVersion: '2.0.0',
  participantCount: 1,
  limit: 22,
  state: 'lobby',
  settingsLocked: false,
  players: [],
}

describe('OnlineRoomSession', () => {
  afterEach(() => {
    onlineRoomSession.resetForTests()
  })

  it('keeps the connection alive without page subscribers and disconnects only explicitly', async () => {
    let options: OnlineRoomClientOptions | undefined
    const client = {
      connect: vi.fn().mockImplementation(async () => options?.onStatus?.('connected')),
      disconnect: vi.fn(),
      setReady: vi.fn(),
    }
    const unsubscribe = onlineRoomSession.subscribe(vi.fn())

    await onlineRoomSession.connect({
      roomCode: '1234',
      initialRoom: room,
      trackCatalogVersion: '2026.12',
      physicsContractVersion: '2.0.0',
      getTicket: vi.fn(),
      createClient: (clientOptions) => {
        options = clientOptions
        return client as never
      },
    })
    unsubscribe()

    onlineRoomSession.setReady(true)
    expect(client.disconnect).not.toHaveBeenCalled()
    expect(client.setReady).toHaveBeenCalledWith(true)
    expect(onlineRoomSession.getSnapshot().status).toBe('connected')

    onlineRoomSession.disconnect()
    expect(client.disconnect).toHaveBeenCalledTimes(1)
    expect(onlineRoomSession.getSnapshot().roomCode).toBeNull()
  })

  it('updates presence immediately from room_state and clears a terminal removal', async () => {
    let options: OnlineRoomClientOptions | undefined
    const client = {
      connect: vi.fn().mockImplementation(async () => options?.onStatus?.('connected')),
      disconnect: vi.fn(),
      setReady: vi.fn(),
    }
    await onlineRoomSession.connect({
      roomCode: '1234',
      initialRoom: room,
      trackCatalogVersion: '2026.12',
      physicsContractVersion: '2.0.0',
      getTicket: vi.fn(),
      createClient: (clientOptions) => {
        options = clientOptions
        return client as never
      },
    })

    options?.onEnvelope?.({
      type: 'room_state',
      payload: {
        ...room,
        participantCount: 2,
        players: [
          { playerId: 'user-1', userId: 'user-1', displayName: 'Host' },
          { playerId: 'user-2', userId: 'user-2', displayName: 'Convidado' },
        ],
      },
    })
    expect(onlineRoomSession.getSnapshot().room?.players).toHaveLength(2)

    options?.onEnvelope?.({
      type: 'error',
      payload: { code: 'removed_from_room', message: 'Removido pelo host.' },
    })
    expect(client.disconnect).toHaveBeenCalledTimes(1)
    expect(onlineRoomSession.getSnapshot()).toEqual(
      expect.objectContaining({ roomCode: null, room: null, status: 'closed' }),
    )
  })

  it('accepts an explicit settings unlock instead of keeping a previous lock sticky', async () => {
    let options: OnlineRoomClientOptions | undefined
    const client = {
      connect: vi.fn().mockImplementation(async () => options?.onStatus?.('connected')),
      disconnect: vi.fn(),
      setReady: vi.fn(),
    }
    await onlineRoomSession.connect({
      roomCode: '1234',
      initialRoom: { ...room, settingsLocked: true },
      trackCatalogVersion: '2026.12',
      physicsContractVersion: '2.0.0',
      getTicket: vi.fn(),
      createClient: (clientOptions) => {
        options = clientOptions
        return client as never
      },
    })

    options?.onEnvelope?.({
      type: 'room_state',
      payload: { ...room, settingsLocked: false },
    })

    expect(onlineRoomSession.getSnapshot().room?.settingsLocked).toBe(false)
  })
})
