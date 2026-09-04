import type {
  ConnectionTicketResponse,
  RoomSummary,
} from '@/lib/api'

export type OnlineEnvelope = {
  type: string
  payload?: unknown
}

export type OnlineRoomClientMessage =
  | { type: 'join_room'; payload: { roomCode: string; trackCatalogVersion: string; physicsContractVersion: string } }
  | { type: 'select_loadout'; payload: { color: string } }
  | { type: 'ready'; payload: { ready: boolean } }
  | { type: 'start_race'; payload: Record<string, never> }

export type SocketLike = {
  readyState?: number
  send: (data: string) => void
  close: () => void
  onopen: (() => void) | null
  onmessage: ((event: { data: string }) => void) | null
  onerror: (() => void) | null
  onclose: (() => void) | null
}

export type OnlineRoomClientStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'closed'
  | 'failed'

export type OnlineRoomClientOptions = {
  roomCode: string
  trackCatalogVersion: string
  physicsContractVersion: string
  getTicket: () => Promise<ConnectionTicketResponse>
  wsUrl?: string
  webSocketFactory?: (url: string) => SocketLike
  now?: () => number
  setTimeout?: (handler: () => void, timeout: number) => ReturnType<typeof globalThis.setTimeout>
  clearTimeout?: (handle: ReturnType<typeof globalThis.setTimeout>) => void
  reconnectWindowMs?: number
  backoffMs?: readonly number[]
  onStatus?: (status: OnlineRoomClientStatus) => void
  onEnvelope?: (envelope: OnlineEnvelope) => void
}

const DEFAULT_RECONNECT_WINDOW_MS = 30_000
const DEFAULT_BACKOFF_MS = [250, 500, 1_000, 2_000, 4_000]

function defaultWebSocketFactory(url: string) {
  return new WebSocket(url) as unknown as SocketLike
}

function defaultWebSocketUrl() {
  const configured = import.meta.env.VITE_WS_URL?.trim().replace(/\/+$/, '')
  if (configured) return configured

  const apiUrl = import.meta.env.VITE_API_URL?.trim().replace(/\/+$/, '')
  if (!apiUrl) throw new Error('VITE_WS_URL ou VITE_API_URL não está configurada.')

  return apiUrl.replace(/^http/i, 'ws').replace(/\/api$/, '') + '/ws'
}

function ticketExpiry(ticket: ConnectionTicketResponse, now: number) {
  const parsed = Date.parse(ticket.expiresAt)
  return Number.isFinite(parsed) ? parsed : now + 60_000
}

export class OnlineRoomClient {
  private readonly options: Required<
    Pick<
      OnlineRoomClientOptions,
      | 'webSocketFactory'
      | 'now'
      | 'setTimeout'
      | 'clearTimeout'
      | 'reconnectWindowMs'
      | 'backoffMs'
    >
  > & OnlineRoomClientOptions

  private socket: SocketLike | null = null
  private ticket: ConnectionTicketResponse | null = null
  private ticketExpiresAt = 0
  private reconnectDeadline = 0
  private reconnectAttempt = 0
  private reconnectTimer: ReturnType<typeof globalThis.setTimeout> | null = null
  private stopped = true
  private status: OnlineRoomClientStatus = 'idle'

  constructor(options: OnlineRoomClientOptions) {
    this.options = {
      ...options,
      webSocketFactory: options.webSocketFactory ?? defaultWebSocketFactory,
      now: options.now ?? Date.now,
      setTimeout: options.setTimeout ?? globalThis.setTimeout,
      clearTimeout: options.clearTimeout ?? globalThis.clearTimeout,
      reconnectWindowMs: options.reconnectWindowMs ?? DEFAULT_RECONNECT_WINDOW_MS,
      backoffMs: options.backoffMs ?? DEFAULT_BACKOFF_MS,
    }
  }

  getStatus() {
    return this.status
  }

  async connect() {
    if (this.status === 'connecting' || this.status === 'connected') return
    this.stopped = false
    this.reconnectAttempt = 0
    this.reconnectDeadline = 0
    this.setStatus('connecting')
    try {
      await this.connectWithValidTicket()
    } catch (error) {
      this.setStatus('failed')
      throw error
    }
  }

  disconnect() {
    this.stopped = true
    this.clearReconnectTimer()
    const socket = this.socket
    this.socket = null
    if (socket) socket.close()
    this.setStatus('closed')
  }

  selectLoadout(color: string) {
    this.send({ type: 'select_loadout', payload: { color } })
  }

  setReady(ready: boolean) {
    this.send({ type: 'ready', payload: { ready } })
  }

  startRace() {
    this.send({ type: 'start_race', payload: {} })
  }

  private setStatus(status: OnlineRoomClientStatus) {
    this.status = status
    this.options.onStatus?.(status)
  }

  private async connectWithValidTicket() {
    const now = this.options.now()
    if (!this.ticket || now >= this.ticketExpiresAt) {
      const ticket = await this.options.getTicket()
      if (ticket.roomCode !== this.options.roomCode) {
        throw new Error('O ticket de conexão não pertence a esta sala.')
      }
      this.ticket = ticket
      this.ticketExpiresAt = ticketExpiry(ticket, now)
    }

    if (this.options.now() >= this.ticketExpiresAt) {
      throw new Error('O ticket de conexão expirou.')
    }

    this.openSocket(this.ticket.ticket)
  }

  private openSocket(ticket: string) {
    const baseUrl = this.options.wsUrl ?? defaultWebSocketUrl()
    const separator = baseUrl.includes('?') ? '&' : '?'
    // The short-lived ticket is the only credential placed in the URL. The
    // primary JWT remains in the Authorization header used to obtain it.
    const url = `${baseUrl}${separator}ticket=${encodeURIComponent(ticket)}`
    const socket = this.options.webSocketFactory(url)
    this.socket = socket

    socket.onopen = () => {
      if (this.stopped || this.socket !== socket) return
      this.reconnectAttempt = 0
      this.reconnectDeadline = 0
      this.setStatus('connected')
      this.sendEnvelope({
        type: 'join_room',
        payload: {
          roomCode: this.options.roomCode,
          trackCatalogVersion: this.options.trackCatalogVersion,
          physicsContractVersion: this.options.physicsContractVersion,
        },
      })
    }
    socket.onmessage = (event) => {
      if (this.stopped || this.socket !== socket) return
      try {
        const envelope = JSON.parse(event.data) as OnlineEnvelope
        if (!envelope || typeof envelope.type !== 'string') return
        if (
          envelope.type === 'race_event' &&
          envelope.payload && typeof envelope.payload === 'object' &&
          'type' in envelope.payload && envelope.payload.type === 'version_mismatch'
        ) {
          // Retrying the same build cannot repair a physical-contract mismatch.
          this.disconnect()
          this.setStatus('failed')
          this.options.onEnvelope?.({ type: 'error', payload: {
            code: 'version_mismatch',
            message: 'A versão do jogo é incompatível com o servidor. Atualize a página ou use a preview correspondente.',
          } })
          return
        }
        this.options.onEnvelope?.(envelope)
      } catch {
        // Ignore malformed frames. Validation errors are reported by the
        // server through the typed `error` envelope instead.
      }
    }
    socket.onerror = () => {
      if (this.socket === socket) socket.close()
    }
    socket.onclose = () => {
      if (this.socket !== socket) return
      this.socket = null
      if (!this.stopped) {
        if (this.reconnectDeadline === 0) {
          this.reconnectDeadline = this.options.now() + this.options.reconnectWindowMs
        }
        this.scheduleReconnect()
      }
    }
  }

  private send(message: OnlineRoomClientMessage) {
    this.sendEnvelope(message)
  }

  private sendEnvelope(message: OnlineRoomClientMessage) {
    if (!this.socket || (this.socket.readyState !== undefined && this.socket.readyState !== 1)) {
      return false
    }
    this.socket.send(JSON.stringify(message))
    return true
  }

  private scheduleReconnect() {
    const now = this.options.now()
    if (now >= this.reconnectDeadline) {
      this.setStatus('failed')
      return
    }
    if (now >= this.ticketExpiresAt) {
      this.ticket = null
    }

    const delay = Math.min(
      this.options.backoffMs[this.reconnectAttempt] ?? this.options.backoffMs.at(-1) ?? 4_000,
      Math.max(0, this.reconnectDeadline - now),
    )
    this.reconnectAttempt += 1
    this.setStatus('reconnecting')
    this.reconnectTimer = this.options.setTimeout(() => {
      this.reconnectTimer = null
      if (this.stopped) return
      if (this.options.now() >= this.reconnectDeadline) {
        this.setStatus('failed')
        return
      }
      this.connectWithValidTicket().catch(() => this.scheduleReconnect())
    }, delay)
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer === null) return
    this.options.clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }
}

export type OnlineRoomEnvelope = OnlineEnvelope & {
  type: 'room_state'
  payload: RoomSummary
}
