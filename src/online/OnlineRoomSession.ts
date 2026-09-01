import { useSyncExternalStore } from 'react'

import type { ConnectionTicketResponse, RoomSummary } from '@/lib/api'
import {
  OnlineRoomClient,
  type OnlineEnvelope,
  type OnlineRoomClientOptions,
  type OnlineRoomClientStatus,
} from '@/online/OnlineRoomClient'
import { roomFromPayload } from '@/online/room-state'

export type OnlineRoomSessionError = {
  code: string
  message: string
}

export type OnlineRoomSessionSnapshot = {
  roomCode: string | null
  room: RoomSummary | null
  status: OnlineRoomClientStatus
  error: OnlineRoomSessionError | null
}

type ConnectOptions = {
  roomCode: string
  initialRoom: RoomSummary
  trackCatalogVersion: string
  physicsContractVersion: string
  getTicket: () => Promise<ConnectionTicketResponse>
  createClient?: (options: OnlineRoomClientOptions) => OnlineRoomClient
}

const TERMINAL_ERROR_CODES = new Set([
  'left_room',
  'removed_from_room',
  'room_closed',
  'room_not_found',
])

function errorFromEnvelope(envelope: OnlineEnvelope): OnlineRoomSessionError {
  const payload =
    typeof envelope.payload === 'object' && envelope.payload !== null
      ? (envelope.payload as Record<string, unknown>)
      : {}
  return {
    code: String(payload.code ?? 'online_error'),
    message: String(payload.message ?? 'A conexão com a sala encontrou um erro.'),
  }
}

class OnlineRoomSessionStore {
  private snapshot: OnlineRoomSessionSnapshot = {
    roomCode: null,
    room: null,
    status: 'idle',
    error: null,
  }
  private readonly listeners = new Set<() => void>()
  private client: OnlineRoomClient | null = null

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = () => this.snapshot

  async connect(options: ConnectOptions) {
    if (
      this.client &&
      this.snapshot.roomCode === options.roomCode &&
      ['connecting', 'connected', 'reconnecting'].includes(this.snapshot.status)
    ) {
      this.setRoom(options.initialRoom)
      return
    }

    this.disconnect()
    this.update({
      roomCode: options.roomCode,
      room: options.initialRoom,
      status: 'connecting',
      error: null,
    })

    const createClient =
      options.createClient ?? ((clientOptions: OnlineRoomClientOptions) => new OnlineRoomClient(clientOptions))
    let client: OnlineRoomClient
    client = createClient({
      roomCode: options.roomCode,
      trackCatalogVersion: options.trackCatalogVersion,
      physicsContractVersion: options.physicsContractVersion,
      getTicket: options.getTicket,
      onStatus: (status) => {
        if (this.client === client) this.update({ status })
      },
      onEnvelope: (envelope) => {
        if (this.client !== client) return
        if (envelope.type === 'room_state') {
          const nextRoom = roomFromPayload(
            envelope.payload,
            options.roomCode,
            this.snapshot.room,
          )
          if (nextRoom) this.update({ room: nextRoom, error: null })
          return
        }
        if (envelope.type === 'error') {
          const error = errorFromEnvelope(envelope)
          if (TERMINAL_ERROR_CODES.has(error.code)) {
            client.disconnect()
            this.client = null
            this.update({ roomCode: null, room: null, status: 'closed', error })
          } else {
            this.update({ error })
          }
        }
      },
    })
    this.client = client

    try {
      await client.connect()
    } catch (error) {
      if (this.client === client) {
        this.update({
          status: 'failed',
          error: {
            code: 'connection_failed',
            message: error instanceof Error ? error.message : 'Não foi possível conectar à sala.',
          },
        })
      }
      throw error
    }
  }

  setRoom(room: RoomSummary) {
    if (this.snapshot.roomCode && room.code !== this.snapshot.roomCode) return
    this.update({ room, roomCode: room.code })
  }

  setReady(ready: boolean) {
    this.client?.setReady(ready)
  }

  disconnect() {
    const client = this.client
    this.client = null
    client?.disconnect()
    this.update({ roomCode: null, room: null, status: 'closed', error: null })
  }

  clearError() {
    if (this.snapshot.error) this.update({ error: null })
  }

  resetForTests() {
    this.disconnect()
    this.snapshot = { roomCode: null, room: null, status: 'idle', error: null }
    this.emit()
  }

  private update(changes: Partial<OnlineRoomSessionSnapshot>) {
    this.snapshot = { ...this.snapshot, ...changes }
    this.emit()
  }

  private emit() {
    this.listeners.forEach((listener) => listener())
  }
}

export const onlineRoomSession = new OnlineRoomSessionStore()

export function useOnlineRoomSession() {
  return useSyncExternalStore(
    onlineRoomSession.subscribe,
    onlineRoomSession.getSnapshot,
    onlineRoomSession.getSnapshot,
  )
}
