import { describe, expect, it } from 'vitest'

import protocol from '../../contracts/module-2/v2/realtime-race-protocol.schema.json'

type SchemaNode = Record<string, unknown> & {
  properties?: Record<string, SchemaNode>
  required?: string[]
  maxItems?: number
  pattern?: string
}

function definition(name: string) {
  return (protocol.$defs as Record<string, SchemaNode>)[name]
}

describe('realtime protocol v2 lobby contract', () => {
  it('keeps the numeric room code, reversible ready, full room state and 22-car limits', () => {
    const joinPayload = definition('joinRoomEnvelope').properties?.payload
    const readyPayload = definition('readyEnvelope').properties?.payload
    const roomPayload = definition('roomStateEnvelope').properties?.payload
    const roomPlayers = roomPayload?.properties?.players
    const snapshotCars = definition('stateSnapshotEnvelope')
      .properties?.payload?.properties?.cars
    const standings = definition('raceResultEnvelope')
      .properties?.payload?.properties?.standings

    expect(joinPayload?.properties?.roomCode?.pattern).toBe('^[0-9]{4}$')
    expect(readyPayload?.required).toContain('ready')
    expect(readyPayload?.properties?.ready).toEqual({ type: 'boolean' })
    expect(roomPayload?.required).toEqual(
      expect.arrayContaining([
        'code',
        'name',
        'players',
        'hostId',
        'settings',
        'readyStates',
        'state',
        'participantCount',
        'limit',
        'hostName',
      ]),
    )
    expect(roomPayload?.properties).not.toHaveProperty('hasPassword')
    expect(roomPlayers?.maxItems).toBe(22)
    expect(snapshotCars?.maxItems).toBe(22)
    expect(standings?.maxItems).toBe(22)
  })
})
