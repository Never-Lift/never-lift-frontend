import { DoorOpen, LoaderCircle, Trophy } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Brand } from '@/components/Brand'
import { Button } from '@/components/ui/button'
import { NotificationStack } from '@/components/ui/notification-stack'
import { useNotifications } from '@/hooks/use-notifications'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { raceApi, type RoomParticipant, type RoomSummary, type TrackDefinition } from '@/lib/api'
import { onlineRoomSession } from '@/online/OnlineRoomSession'
import { OnlineRaceRuntime } from '@/online/OnlineRaceRuntime'
import type { OnlineRoomClientStatus } from '@/online/OnlineRoomClient'
import type { OnlineSnapshot, OnlineResult, OnlinePhase, QualifyingGrid } from '@/online/race-protocol'
import { KeyboardControls } from '@/race/KeyboardControls'
import { loadKeyboardControlPreferences } from '@/race/control-schemes'
import { RaceRenderer } from '@/race/RaceRenderer'
import { raceGraphicsSettings } from '@/race/visual-settings'

function formatOnlineTime(ms: number) {
  if (!ms) return '—'
  return `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(3).padStart(6, '0')}`
}
type Presentation = {
  snapshot: OnlineSnapshot | null; result: OnlineResult | null; grid: QualifyingGrid
  phase: OnlinePhase; frozen: boolean; lights: number; error: string | null
  connection: OnlineRoomClientStatus
  stalled: boolean
}
const initial: Presentation = { snapshot: null, result: null, grid: [], phase: 'qualifying', frozen: true, lights: 0, error: null, connection: 'connecting', stalled: false }

export function OnlineRacePanel({ room, player, isHost, onLeave, onCancelQualification, getTrack = raceApi.getTrack }: {
  room: RoomSummary; player: RoomParticipant; isHost: boolean
  onLeave: () => Promise<void>; onCancelQualification: () => Promise<void>
  getTrack?: typeof raceApi.getTrack
}) {
  const [track, setTrack] = useState<TrackDefinition | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [state, setState] = useState<Presentation>(initial)
  const [leaveOpen, setLeaveOpen] = useState(false)
  const { notifications, notify, dismiss } = useNotifications()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const roomRef = useRef(room)
  const playerRef = useRef(player)
  const leaveRef = useRef(false)
  const lastStallNotice = useRef(-Infinity)
  roomRef.current = room
  playerRef.current = player
  leaveRef.current = leaveOpen

  useEffect(() => {
    const error = state.error ?? loadError
    if (error) notify(error)
  }, [state.error, loadError, notify])

  useEffect(() => {
    const now = performance.now()
    if (state.stalled && now - lastStallNotice.current >= 5000) {
      lastStallNotice.current = now
      notify('Atualizações da corrida atrasadas. Aguardando o servidor; seus comandos continuam sendo enviados.', 'warning')
    }
  }, [state.stalled, notify])

  useEffect(() => {
    let active = true
    getTrack(room.trackId).then((definition) => { if (active) setTrack(definition) })
      .catch(() => { if (active) setLoadError('Não foi possível carregar a pista. Saia e entre novamente na sala.') })
    return () => { active = false }
  }, [getTrack, room.trackId])

  useEffect(() => {
    const exit = (event: KeyboardEvent) => {
      if ((event.key === 'Escape' || event.code === 'Escape') && !event.repeat && !event.defaultPrevented && !leaveRef.current) {
        event.preventDefault(); setLeaveOpen(true)
      }
    }
    window.addEventListener('keydown', exit)
    return () => window.removeEventListener('keydown', exit)
  }, [])

  useEffect(() => {
    if (!track || !canvasRef.current) return
    let runtime: OnlineRaceRuntime
    let renderer: RaceRenderer
    try {
      runtime = new OnlineRaceRuntime(track, playerRef.current, roomRef.current.players ?? [],
        (input, sequence, timestamp) => onlineRoomSession.sendInput(input, sequence, timestamp), onlineRoomSession.getNextInputSequence())
      renderer = new RaceRenderer(canvasRef.current, track, { timeOfDay: 'day', ...raceGraphicsSettings('solo', roomRef.current.limit), vehicleSpriteCache: true })
    } catch {
      setLoadError('Não foi possível preparar a corrida neste navegador.')
      return
    }
    const scheme = loadKeyboardControlPreferences().primary
    let controls: KeyboardControls
    const capture = () => runtime.setInput(leaveRef.current ? { throttle: 0, brake: 0, steer: 0 } : controls.getInput(scheme, runtime.getOwnState()))
    controls = new KeyboardControls(window, capture)
    const unsubscribeStatus = onlineRoomSession.subscribe(() => {
      const session = onlineRoomSession.getSnapshot()
      runtime.setConnection(session.status === 'connected')
      if (session.room?.players) runtime.setPlayers(session.room.players)
    })
    runtime.setConnection(onlineRoomSession.getSnapshot().status === 'connected')
    const unsubscribe = onlineRoomSession.subscribeRace((envelope) => runtime.receive(envelope, performance.now()))
    let raf = 0
    let previous: number | null = null
    let stopped = false
    const frame = (now: number) => {
      if (stopped) return
      const delta = previous === null ? 0 : Math.min((now - previous) / 1000, 0.1)
      previous = now
      capture()
      runtime.advance(delta, now)
      if (!runtime.isFrozen()) renderer.render(runtime, delta, runtime.getOverlay(controls.isIdentificationHeld()))
      if (runtime.getPhase() !== 'results') raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    const inputTimer = window.setInterval(() => {
      if (stopped) return
      capture(); runtime.flushInput(performance.now(), Date.now())
    }, 8)
    const hudTimer = window.setInterval(() => {
      setState({ snapshot: runtime.getSnapshot(), result: runtime.getResult(), grid: runtime.getGrid(),
        phase: runtime.getPhase(), lights: runtime.getRedLights(), frozen: runtime.isFrozen(), error: runtime.getError(),
        stalled: runtime.getDeliveryStatus(performance.now()).stalled,
        connection: onlineRoomSession.getSnapshot().status })
    }, 100)
    return () => {
      stopped = true; cancelAnimationFrame(raf); window.clearInterval(inputTimer); window.clearInterval(hudTimer)
      controls.destroy(); unsubscribe(); unsubscribeStatus()
      // Navigation leaves the socket alive, but held keys must not survive it.
      runtime.releaseInput(Date.now())
    }
  }, [track])

  const own = state.snapshot?.cars.find((car) => car.playerId === player.id)
  const fastest = state.snapshot?.cars.filter((car) => car.bestLapTimeMs > 0).sort((a, b) => a.bestLapTimeMs - b.bestLapTimeMs)[0]
  const name = (id: string) => room.players?.find((candidate) => candidate.id === id)?.displayName ?? 'Piloto'
  const waitingResults = state.phase === 'qualifying_results' || state.phase === 'results'
  const penaltyMs = own?.falseStart ? Math.max(0, 5000 - (state.snapshot?.raceTimeMs ?? 0)) : 0

  return (
    <section aria-label="Corrida online" className="fixed inset-0 z-40 bg-background">
      <NotificationStack notifications={notifications} onDismiss={dismiss} />
      <canvas aria-label="Pista da corrida online" className="h-full w-full" ref={canvasRef} />
      <div className="pointer-events-none absolute left-4 top-4"><Brand compact /></div>
      {(!track || !state.snapshot) && !loadError && <div className="absolute inset-0 grid place-items-center bg-background/80"><p className="flex items-center gap-3 text-info"><LoaderCircle className="size-5 animate-spin" /> Aguardando pista e estado do servidor…</p></div>}
      {(state.error || loadError) && <div role="status" className="surface-panel absolute left-1/2 top-1/3 max-w-md -translate-x-1/2 p-6">Corrida indisponível. Saia da sala para continuar.</div>}
      {state.frozen && state.snapshot && !waitingResults && !state.error && <div role="status" className="surface-panel absolute left-1/2 top-1/3 -translate-x-1/2 p-5">{state.connection === 'failed' || state.connection === 'closed' ? 'Não foi possível reconectar. Saia da sala para continuar.' : 'Conexão interrompida. Reconectando por até 30 segundos…'}</div>}
      {state.phase === 'countdown' && <div aria-label={`${state.lights} luzes vermelhas`} className="absolute left-1/2 top-8 flex -translate-x-1/2 gap-3 rounded-xl bg-background/95 p-4">{Array.from({ length: 5 }, (_, index) => <span key={index} className={`size-7 rounded-full ${index < state.lights ? 'bg-destructive' : 'bg-muted'}`} />)}</div>}
      {state.phase === 'qualifying' && <div className="absolute left-1/2 top-5 -translate-x-1/2 rounded-xl bg-background/85 px-5 py-3 text-center font-bold"><p>Classificação · 2 voltas cronometradas</p><p className="text-xs text-muted-foreground">{(state.snapshot?.substep ?? 0) < 360 ? `Largada em ${Math.max(1, Math.ceil((360 - (state.snapshot?.substep ?? 0)) / 120))}` : own?.qualifyingAttempts === 2 ? 'Tentativas concluídas. Aguardando os outros pilotos.' : 'A melhor volta válida define o grid'}</p></div>}
      {own && !waitingResults && <aside aria-label="Telemetria online" className="surface-panel absolute bottom-4 left-4 max-w-sm p-4">
        <p className="font-display text-2xl font-black italic">{Math.round(own.speed * 3.6)} km/h <span className="ml-5 text-info">P{own.position}/{room.participantCount}</span></p>
        <p className="text-sm font-bold">{state.phase === 'qualifying' ? `Tentativas ${own.qualifyingAttempts}/2` : `Volta ${Math.min(own.lap + 1, state.snapshot!.totalLaps)}/${state.snapshot!.totalLaps}`}</p>
        <p className="mt-2 text-xs">Atual {formatOnlineTime(own.currentLapTimeMs)} · Melhor {formatOnlineTime(own.bestLapTimeMs)}</p>
        {fastest && <p className="mt-1 text-xs text-info">Mais rápida: {name(fastest.playerId)} · {formatOnlineTime(fastest.bestLapTimeMs)}</p>}
        {own.isGhost && <p className="mt-2 font-bold text-success">Chegada concluída</p>}
        {penaltyMs > 0 && <p role="status" className="mt-2 font-bold text-destructive">Largada queimada · acelerador bloqueado {Math.ceil(penaltyMs / 1000)} s</p>}
        <p className="mt-2 text-[10px] text-muted-foreground">Espaço: nomes dos pilotos · Esc: sair</p>
      </aside>}
      {waitingResults && <div className="absolute inset-0 overflow-y-auto bg-background/95 p-5 sm:p-12"><div className="mx-auto max-w-4xl">
        <h1 className="display-heading text-5xl">{state.phase === 'results' ? 'Resultado da corrida' : 'Grid de largada'}</h1>
        {state.result ? <>
          <div className="my-8 grid grid-cols-3 items-end gap-3" aria-label="Pódio">
            {[1, 0, 2].map((rank) => { const entry = [...state.result!.standings].sort((a, b) => a.position - b.position)[rank]; return entry && <article key={entry.playerId} className={`surface-panel text-center ${rank === 0 ? 'pb-14 pt-8' : 'p-5'}`}>
              <Trophy className="mx-auto mb-3 size-6 text-warning" /><p className="font-display text-3xl font-black">{entry.position}º</p>
              <span className="mx-auto my-3 block h-2 w-16 rounded" style={{ backgroundColor: room.players?.find((p) => p.id === entry.playerId)?.color ?? '#365f82' }} />
              <p className="font-bold">{entry.displayName}</p><p className="text-sm">{entry.finished ? formatOnlineTime(entry.totalTimeMs) : 'DNF'}</p>
            </article> })}
          </div>
          <ol className="space-y-2">{[...state.result.standings].sort((a,b) => a.position-b.position).map((entry) => <li className="surface-panel flex justify-between gap-3 p-3" key={entry.playerId}><span>{entry.position}º · {entry.displayName}</span><span>{entry.finished ? formatOnlineTime(entry.totalTimeMs) : 'DNF'} · Melhor {formatOnlineTime(entry.bestLapTimeMs)}</span></li>)}</ol>
        </> : <ol className="my-8 space-y-2">{state.grid.map((entry) => <li key={entry.playerId} className="surface-panel flex justify-between p-4"><span>{entry.position}º · {name(entry.playerId)}</span><span>{entry.valid ? formatOnlineTime(entry.bestLapTimeMs) : 'Sem volta válida'}</span></li>)}</ol>}
        {state.phase === 'results' && !state.result && <p className="my-6">Aguardando a confirmação do resultado pelo servidor…</p>}
        <Button className="mt-6" disabled={state.phase === 'results' && !state.result} onClick={() => onlineRoomSession.setReady(!player.ready)}>{player.ready ? 'Retirar confirmação' : state.phase === 'results' ? 'Confirmar e voltar ao lobby' : 'Pronto para a corrida'}</Button>
        <p className="mt-3 text-sm text-muted-foreground">{state.phase === 'results' ? 'Retorno ao lobby após as confirmações ou em até 60 segundos.' : 'A corrida começa quando todos confirmarem, inclusive o host.'}</p>
      </div></div>}
      {isHost && state.phase === 'qualifying' && !own?.currentLapTimeMs && <Button className="absolute bottom-4 right-20" variant="secondary" onClick={() => void onCancelQualification()}>Cancelar classificação</Button>}
      <Button aria-label="Sair da sala" className="absolute bottom-4 right-4 z-10" size="icon" variant="secondary" onClick={() => setLeaveOpen(true)}><DoorOpen className="size-5" /></Button>
      <AlertDialog open={leaveOpen} onOpenChange={setLeaveOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Sair de {room.name}?</AlertDialogTitle><AlertDialogDescription>Deseja realmente sair da sala {room.name}? A prova dos demais pilotos continua.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Continuar na sala</AlertDialogCancel><AlertDialogAction onClick={() => void onLeave()}>Sair da sala</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </section>
  )
}
