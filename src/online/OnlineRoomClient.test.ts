import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ConnectionTicketResponse } from '@/lib/api'
import { OnlineRoomClient, type SocketLike } from '@/online/OnlineRoomClient'

class FakeSocket implements SocketLike {
  readyState = 0
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = 3
    this.onclose?.()
  }

  open() {
    this.readyState = 1
    this.onopen?.()
  }
}

const ticket = (expiresAt = '2026-09-01T12:01:00.000Z'): ConnectionTicketResponse => ({
  ticket: 'short-lived-ticket',
  roomCode: '1234',
  expiresAt,
})

afterEach(() => {
  vi.useRealTimers()
})

describe('OnlineRoomClient', () => {
  it('obtains a ticket before connecting and never places the JWT in the WebSocket URL', async () => {
    const sockets: FakeSocket[] = []
    const getTicket = vi.fn().mockResolvedValue(ticket())
    const envelopes: unknown[] = []
    const client = new OnlineRoomClient({
      roomCode: '1234',
      trackCatalogVersion: '2026.12',
      physicsContractVersion: '2.0.0',
      getTicket,
      now: () => Date.parse('2026-09-01T12:00:00.000Z'),
      wsUrl: 'wss://race.example/ws',
      webSocketFactory: (url) => {
        expect(url).toBe('wss://race.example/ws?ticket=short-lived-ticket')
        expect(url).not.toContain('jwt')
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket
      },
      onEnvelope: (envelope) => envelopes.push(envelope),
    })

    await client.connect()
    expect(getTicket).toHaveBeenCalledTimes(1)
    sockets[0].open()
    expect(JSON.parse(sockets[0].sent[0])).toEqual({
      type: 'join_room',
      payload: {
        roomCode: '1234',
        trackCatalogVersion: '2026.12',
        physicsContractVersion: '2.0.0',
      },
    })

    sockets[0].onmessage?.({ data: JSON.stringify({ type: 'room_state', payload: {} }) })
    expect(envelopes).toHaveLength(1)
  })

  it('reconnects with the same valid ticket inside the reconnection window', async () => {
    vi.useFakeTimers()
    const sockets: FakeSocket[] = []
    let now = Date.parse('2026-09-01T12:00:00.000Z')
    const getTicket = vi.fn().mockResolvedValue(ticket())
    const client = new OnlineRoomClient({
      roomCode: '1234',
      trackCatalogVersion: '2026.12',
      physicsContractVersion: '2.0.0',
      getTicket,
      wsUrl: 'ws://localhost/ws',
      now: () => now,
      backoffMs: [100],
      webSocketFactory: (url) => {
        expect(url).toContain('ticket=short-lived-ticket')
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket
      },
    })

    await client.connect()
    sockets[0].open()
    sockets[0].close()
    expect(client.getStatus()).toBe('reconnecting')
    now += 100
    vi.advanceTimersByTime(100)
    await Promise.resolve()
    expect(sockets).toHaveLength(2)
    expect(getTicket).toHaveBeenCalledTimes(1)
    sockets[1].open()
    expect(client.getStatus()).toBe('connected')

    client.setReady(true)
    client.startRace()
    expect(JSON.parse(sockets[1].sent[1])).toEqual({
      type: 'ready',
      payload: { ready: true },
    })
    expect(JSON.parse(sockets[1].sent[2])).toEqual({
      type: 'start_race',
      payload: {},
    })
    client.disconnect()
  })

  it('does not reconnect after the 30 second window expires', async () => {
    vi.useFakeTimers()
    let now = Date.parse('2026-09-01T12:00:00.000Z')
    const sockets: FakeSocket[] = []
    const client = new OnlineRoomClient({
      roomCode: '1234',
      trackCatalogVersion: '2026.12',
      physicsContractVersion: '2.0.0',
      getTicket: vi.fn().mockResolvedValue(ticket()),
      wsUrl: 'ws://localhost/ws',
      now: () => now,
      backoffMs: [100],
      webSocketFactory: () => {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket
      },
    })

    await client.connect()
    sockets[0].open()
    sockets[0].close()
    now += 30_000
    vi.advanceTimersByTime(30_000)
    await Promise.resolve()
    expect(client.getStatus()).toBe('failed')
    expect(sockets).toHaveLength(1)
  })

  it('lets two simulated clients join the same room and publish independent ready messages', async () => {
    const sockets: FakeSocket[] = []
    const states: unknown[] = []
    const makeClient = () =>
      new OnlineRoomClient({
        roomCode: '1234',
        trackCatalogVersion: '2026.12',
        physicsContractVersion: '2.0.0',
        getTicket: vi.fn().mockResolvedValue({ ...ticket(), ticket: `ticket-${sockets.length + 1}` }),
        wsUrl: 'ws://localhost/ws',
        webSocketFactory: () => {
          const socket = new FakeSocket()
          sockets.push(socket)
          return socket
        },
        onEnvelope: (envelope) => states.push(envelope),
      })

    const first = makeClient()
    const second = makeClient()
    await Promise.all([first.connect(), second.connect()])
    sockets[0].open()
    sockets[1].open()
    first.setReady(true)
    second.setReady(true)
    expect(JSON.parse(sockets[0].sent[1])).toEqual({ type: 'ready', payload: { ready: true } })
    expect(JSON.parse(sockets[1].sent[1])).toEqual({ type: 'ready', payload: { ready: true } })
    sockets[0].onmessage?.({ data: JSON.stringify({ type: 'room_state', payload: { code: '1234' } }) })
    sockets[1].onmessage?.({ data: JSON.stringify({ type: 'room_state', payload: { code: '1234' } }) })
    expect(states).toHaveLength(2)
    first.disconnect()
    second.disconnect()
  })
})
