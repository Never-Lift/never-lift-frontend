import { expect, it, vi } from 'vitest'
import { OnlineRoomClient, type SocketLike } from '@/online/OnlineRoomClient'
import { OnlineRaceRuntime } from '@/online/OnlineRaceRuntime'
import { onlineFrame, onlinePlayers } from '@/test/online-race-fixtures'
import { SHORT_TRACK } from '@/test/track-fixtures'

class ServerSocket implements SocketLike {
  readyState = 1
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  sent: { type: string; payload: Record<string, unknown> }[] = []
  send(data: string) { this.sent.push(JSON.parse(data)) }
  close() { this.readyState = 3; this.onclose?.() }
  deliver(payload: unknown) { this.onmessage?.({ data: JSON.stringify({ type: 'state_snapshot', payload }) }) }
}

it('reconciles two independently predicted drivers against the same collision authority over two mock sockets', async () => {
  let now = 0
  const clients = await Promise.all(onlinePlayers.slice(0, 2).map(async (player) => {
    const socket = new ServerSocket()
    const getTicket = vi.fn(async () => ({ roomCode: '1234', ticket: 'ticket-' + player.id, expiresAt: '2030-01-01T00:00:00Z' }))
    let runtime: OnlineRaceRuntime
    const client = new OnlineRoomClient({
      roomCode: '1234', trackCatalogVersion: '2026.12', physicsContractVersion: '2.0.3',
      wsUrl: 'ws://localhost/ws', getTicket, webSocketFactory: () => socket,
      onEnvelope: envelope => runtime.receive(envelope, now),
    })
    runtime = new OnlineRaceRuntime(SHORT_TRACK, player, onlinePlayers, (input, seq, timestamp) => client.sendInput(input, seq, timestamp))
    await client.connect(); socket.onopen?.()
    expect(getTicket).toHaveBeenCalledTimes(1)
    return { runtime, socket, client }
  }))
  const initial = onlineFrame()
  clients.forEach(({socket}) => socket.deliver(initial))
  for (const {runtime,socket} of clients) {
    runtime.setInput({ throttle: 1, brake: 0, steer: 0 })
    runtime.advance(1/120, 8)
    expect(runtime.getOwnState().physicsState.appliedThrottle).toBeGreaterThan(0)
    runtime.flushInput(8, 1008)
    expect(socket.sent.at(-1)).toMatchObject({ type: 'input', payload: {clientSeq: 0, clientTimestamp: 1008} })
  }
  const before = clients.map(({runtime}) => structuredClone(runtime.getInterpolatedVehicles()[0].renderPosition))
  const collision = onlineFrame({ substep: 4, physicsSubstep: 4, tick: 1, serverTime: initial.serverTime + 33 })
  collision.cars.forEach(car => { car.x += 0.6; car.lastProcessedClientSeq = 0 })
  now = 33
  clients.forEach(({socket}) => socket.deliver(collision))
  for (const [index, {runtime}] of clients.entries()) {
    // Physical authority changes immediately; its presentation keeps continuity.
    expect(runtime.getOwnState().position.x).toBe(collision.cars[index].x)
    expect(runtime.getInterpolatedVehicles()[0].renderPosition.x).toBeCloseTo(before[index].x, 10)
    const remote = runtime.getInterpolatedVehicles().find(car => car.id === onlinePlayers[1-index].id)!
    expect(remote.renderPosition.x).toBe(initial.cars[1-index].x)
    runtime.setInput({ throttle: 0, brake: 0, steer: 0 })
    runtime.advance(0.1, 133)
    expect(runtime.getInterpolatedVehicles()[0].renderPosition.x).toBeCloseTo(runtime.getOwnState().position.x, 10)
    expect(runtime.getInterpolatedVehicles().find(car => car.id === onlinePlayers[1-index].id)!.renderPosition.x).toBe(collision.cars[1-index].x)
  }
  clients.forEach(({client}) => client.disconnect())
})
