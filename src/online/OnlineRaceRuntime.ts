import type { RoomParticipant, TrackDefinition } from '@/lib/api'
import type { OnlineEnvelope } from '@/online/OnlineRoomClient'
import { OnlinePrediction } from '@/online/OnlinePrediction'
import { RemoteSnapshotBuffer } from '@/online/RemoteSnapshotBuffer'
import { eventSchema, resultSchema, snapshotSchema, snapshotVehicle,
  type OnlineSnapshot, type OnlineResult, type OnlinePhase, type QualifyingGrid } from '@/online/race-protocol'
import { sameInput } from '@/race/LocalInputBuffer'
import type { LocalRaceOverlayState } from '@/race/LocalRaceSession'
import type { DriverInput, InterpolatedVehicleState } from '@/race/types'

const NEUTRAL: DriverInput = { throttle: 0, brake: 0, steer: 0 }
const INPUT_INTERVAL_MS = 1000 / 30
const MAX_SNAPSHOT_SILENCE_MS = 250
type Command = { sequence: number; input: DriverInput }

/** Runs outside React. The physical engine contains only the local human. */
export class OnlineRaceRuntime {
  readonly mode = 'solo' as const
  private readonly prediction: OnlinePrediction
  private readonly remotes = new RemoteSnapshotBuffer()
  private readonly playerId: string
  private readonly track: TrackDefinition
  private players = new Map<string, RoomParticipant>()
  private readonly send: (input: DriverInput, sequence: number, timestamp: number) => boolean
  private snapshot: OnlineSnapshot | null = null
  private sessionId: string | null = null
  private phase: OnlinePhase = 'qualifying'
  private result: OnlineResult | null = null
  private grid: QualifyingGrid = []
  private connected = true
  private awaitingSnapshot = true
  private sequence = 0
  private current: Command = { sequence: -1, input: NEUTRAL }
  private staged: Command | null = null
  private queued: DriverInput[] = []
  private raw = NEUTRAL
  private lastSent = -Infinity
  private receivedAt = 0
  private receivedSnapshots = 0
  private largestSnapshotGapMs = 0
  private offset = Infinity
  private lastRenderTime = -Infinity
  private redLights = 0
  private frames: InterpolatedVehicleState[] = []
  private error: string | null = null

  constructor(track: TrackDefinition, player: RoomParticipant, players: RoomParticipant[],
    send: (input: DriverInput, sequence: number, timestamp: number) => boolean, initialSequence = 0) {
    this.track = track
    this.playerId = player.id
    this.setPlayers(players)
    this.send = send
    this.sequence = initialSequence
    this.prediction = new OnlinePrediction(track, { id: player.id, name: player.displayName ?? 'Piloto', kind: 'human', color: player.color ?? '#365f82' })
  }

  setPlayers(players: RoomParticipant[]) { this.players = new Map(players.map((player) => [player.id, player])) }

  setConnection(connected: boolean) {
    if (connected === this.connected) return
    this.connected = connected
    this.awaitingSnapshot = true
    this.staged = null
    this.queued = []
    this.raw = NEUTRAL
    this.current = { sequence: -1, input: NEUTRAL }
  }

  receive(envelope: OnlineEnvelope, now: number) {
    if (envelope.type === 'state_snapshot') {
      const parsed = snapshotSchema.safeParse(envelope.payload)
      if (!parsed.success) { this.error = 'O servidor enviou um estado incompatível com esta versão da corrida.'; return }
      const frame = parsed.data
      if (frame.trackId !== this.track.id || frame.trackCatalogVersion !== this.track.catalogVersion) {
        this.error = 'A pista recebida não corresponde à sala.'; return
      }
      if (this.sessionId && frame.sessionId !== this.sessionId) return
      if (!this.connected || (this.snapshot && frame.substep <= this.snapshot.substep && !this.awaitingSnapshot)) return
      const own = frame.cars.find((car) => car.playerId === this.playerId)
      if (!own) { this.error = 'Seu carro não está presente no estado recebido.'; return }
      const reset = this.awaitingSnapshot || !this.snapshot || frame.physicsSubstep < this.snapshot.physicsSubstep ||
        (frame.phase === 'countdown' && this.snapshot.phase !== 'countdown')
      if (reset) {
        this.remotes.clear(); this.offset = Infinity; this.lastRenderTime = -Infinity
        this.staged = null; this.queued = []; this.current = { sequence: -1, input: NEUTRAL }; this.raw = NEUTRAL
      }
      this.sessionId = frame.sessionId
      this.snapshot = frame
      this.phase = frame.phase
      this.sequence = Math.max(this.sequence, own.lastProcessedClientSeq + 1)
      if (!reset && this.receivedSnapshots > 0) this.largestSnapshotGapMs = Math.max(this.largestSnapshotGapMs, now - this.receivedAt)
      this.receivedAt = now
      this.receivedSnapshots++
      this.offset = Math.min(this.offset, now - frame.serverTime)
      this.awaitingSnapshot = false
      this.error = null
      this.prediction.reconcile(snapshotVehicle(own, this.players.get(this.playerId)), frame.physicsSubstep / 120, own.lastProcessedClientSeq, reset)
      this.remotes.push({ time: frame.serverTime, cars: frame.cars.map((car) => snapshotVehicle(car, this.players.get(car.playerId))) })
      if (frame.phase === 'race') this.redLights = 0
      this.compose(now)
      return
    }
    if (envelope.type === 'race_result') {
      const parsed = resultSchema.safeParse(envelope.payload)
      if (!parsed.success || (this.sessionId && parsed.data.sessionId !== this.sessionId) || parsed.data.trackId !== this.track.id) return
      this.result = parsed.data; this.phase = 'results'
      return
    }
    if (envelope.type !== 'race_event') return
    const parsed = eventSchema.safeParse(envelope.payload)
    if (!parsed.success) return
    const event = parsed.data
    if (this.sessionId && event.sessionId !== this.sessionId) return
    if (this.snapshot && event.substep < this.snapshot.substep) return
    this.sessionId = event.sessionId
    if (event.type === 'start_light') this.redLights = event.stage
    if (event.type === 'lights_out') { this.redLights = 0; this.phase = 'race' }
    if (event.type === 'session_phase') this.phase = event.phase
    if (event.type === 'qualifying_result') { this.grid = event.grid; this.phase = 'qualifying_results' }
    // The snapshot's falseStart/raceTimeMs controls penalty duration, including
    // reconnection. The event alone never starts a wall-clock penalty timer.
  }

  setInput(input: DriverInput) {
    if (!this.connected || this.awaitingSnapshot || sameInput(this.raw, input)) return
    this.raw = { ...input }
    if (this.staged) {
      if (this.queued.length >= 32) { this.error = 'Os comandos acumularam. Aguarde a conexão estabilizar.'; return }
      this.queued.push(this.raw)
    } else this.stage(this.raw)
  }

  private stage(input: DriverInput) {
    this.staged = { sequence: this.sequence++, input: { ...input } }
    this.current = this.staged
  }

  releaseInput(timestamp: number) {
    // Leaving the canvas must not flush an older queued press instead of stop.
    this.queued = []; this.staged = null; this.raw = NEUTRAL
    const sequence = this.sequence++
    this.current = { sequence, input: NEUTRAL }
    if (this.connected && !this.awaitingSnapshot && ['qualifying', 'countdown', 'race'].includes(this.phase)) {
      this.send(NEUTRAL, sequence, timestamp)
    }
  }

  flushInput(now: number, timestamp: number) {
    if (!this.connected || this.awaitingSnapshot || this.error || !['qualifying', 'countdown', 'race'].includes(this.phase)) return
    if (now - this.lastSent + 1e-6 < INPUT_INTERVAL_MS) return
    if (!this.staged) this.stage(this.queued.shift() ?? this.raw)
    const command = this.staged!
    if (this.send(command.input, command.sequence, timestamp)) {
      this.lastSent = Number.isFinite(this.lastSent) ? Math.max(this.lastSent + INPUT_INTERVAL_MS, now - INPUT_INTERVAL_MS / 2) : now
      this.staged = null
      if (this.queued.length) this.stage(this.queued.shift()!)
    }
  }

  advance(deltaSeconds: number, now: number) {
    if (this.isFrozen() || !this.snapshot) return
    // Bound speculation when delivery stalls even before the socket closes.
    if (!this.getDeliveryStatus(now).stalled && this.canMove()) {
      const car = this.getOwnSnapshot()!
      const input = car.falseStart ? { ...this.current.input, throttle: 0 } : this.current.input
      this.prediction.setInput(this.current.sequence, input)
      this.prediction.advance(deltaSeconds)
    }
    this.compose(now)
  }

  private canMove() {
    const car = this.getOwnSnapshot()
    return this.phase === 'race' || (this.phase === 'qualifying' && this.snapshot!.substep >= 360 && car!.qualifyingAttempts < 2 && car!.damageState.kind !== 'total-loss')
  }

  private compose(now: number) {
    if (!this.snapshot || this.isFrozen()) return
    const serverNow = Math.max(this.lastRenderTime, Math.min(now - this.offset, this.snapshot.serverTime + 100))
    this.lastRenderTime = serverNow
    const ownGhost = this.getOwnSnapshot()!.isGhost
    const focal = this.prediction.getVisualState()
    const authority = this.getOwnSnapshot()!
    focal.finished = ownGhost; focal.renderOpacity = ownGhost ? 0.4 : 1
    focal.damage = { ...authority.damageState }
    // Alias only the renderer's focus identifier. World coordinates are shared
    // by car, camera and minimap; there is no second position simulation.
    focal.id = 'player-1'
    this.frames = [focal, ...this.remotes.sample(serverNow).filter((car) =>
      car.id !== this.playerId && (!car.finished || ownGhost) && this.phase !== 'qualifying',
    )]
  }

  getInterpolatedVehicles() { return this.frames }
  getOwnState() { return this.prediction.getState() }
  getOwnSnapshot() { return this.snapshot?.cars.find((car) => car.playerId === this.playerId) ?? null }
  getSnapshot() { return this.snapshot }
  getPhase() { return this.phase }
  getResult() { return this.result }
  getGrid() { return this.grid }
  getError() { return this.error }
  /** Arrival gaps are not RTT or a measurement of the player's rendering FPS. */
  getDeliveryStatus(now: number) {
    const ageMs = this.snapshot ? Math.max(0, now - this.receivedAt) : 0
    return { ageMs, largestGapMs: this.largestSnapshotGapMs, receivedSnapshots: this.receivedSnapshots,
      stalled: !this.isFrozen() && this.canMove() && ageMs > MAX_SNAPSHOT_SILENCE_MS }
  }
  isFrozen() { return !this.connected || this.awaitingSnapshot || !!this.error || this.phase === 'results' }
  getOverlay(showNames = false): LocalRaceOverlayState {
    return { startLights: { stage: 'hidden', redLights: 0 }, penalties: {}, showDriverNames: showNames || this.phase === 'countdown' }
  }
  getRedLights() { return this.phase === 'countdown' ? this.redLights : 0 }
}
