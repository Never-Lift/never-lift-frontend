import {
  Bot,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Gamepad2,
  LoaderCircle,
  MapPinned,
  Play,
  RotateCcw,
  Users,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useAuth } from '@/auth/auth-context'
import { AppShell } from '@/components/AppShell'
import { RaceCanvas } from '@/components/race/RaceCanvas'
import { VehiclePreview } from '@/components/race/VehiclePreview'
import { Button } from '@/components/ui/button'
import {
  raceApi,
  type LocalRaceResultResponse,
  type TrackCatalog,
  type TrackCatalogEntry,
  type TrackDefinition,
} from '@/lib/api'
import { getErrorMessage } from '@/lib/error-messages'
import { RaceEngine } from '@/race/RaceEngine'
import type {
  BotDifficulty,
  RaceMode,
  RaceResultEntry,
  VehicleSetup,
} from '@/race/types'
import {
  DEFAULT_VEHICLE_PAINT_COLOR,
  getAlternativeVehiclePaintColors,
  normalizeVehiclePaintColor,
  SECONDARY_VEHICLE_PAINT_COLOR,
  VEHICLE_PAINT_OPTIONS,
} from '@/race/vehicle-paints'
import type { TimeOfDayPreset } from '@/race/visual-settings'

type PlayerSelection = {
  name: string
  color: string
}

type SubmissionState =
  | { status: 'idle' }
  | { status: 'sending' }
  | { status: 'success'; response: LocalRaceResultResponse }
  | { status: 'error'; message: string }

const timeOfDayOptions: Array<{
  id: TimeOfDayPreset
  label: string
  description: string
}> = [
  { id: 'day', label: 'Dia', description: 'Máxima clareza do circuito' },
  {
    id: 'sunset',
    label: 'Entardecer',
    description: 'Luz quente e contraste suave',
  },
  {
    id: 'night',
    label: 'Noite',
    description: 'Pista escurecida e faróis ativos',
  },
]

function timeOfDayLabel(timeOfDay: TimeOfDayPreset) {
  return timeOfDayOptions.find((option) => option.id === timeOfDay)?.label ?? 'Dia'
}

const defaultPlayerOne: PlayerSelection = {
  name: 'Piloto 1',
  color: DEFAULT_VEHICLE_PAINT_COLOR,
}

const defaultPlayerTwo: PlayerSelection = {
  name: 'Piloto 2',
  color: SECONDARY_VEHICLE_PAINT_COLOR,
}

const environmentLabels: Record<
  TrackDefinition['sceneryLayout']['preset'],
  string
> = {
  park: 'Parque',
  street: 'Urbano',
  desert: 'Deserto',
  coastal: 'Litoral',
  classic: 'Clássico',
  'night-city': 'Cidade',
}

function formatTrackLength(lengthMeters: number) {
  return `${(lengthMeters / 1000).toFixed(3)} km`
}

function TrackPreview({ track }: { track: TrackDefinition }) {
  const width = Math.max(1, track.bounds.maxX - track.bounds.minX)
  const height = Math.max(1, track.bounds.maxY - track.bounds.minY)
  const points = track.centerline
    .map((point) => `${point.x},${-point.y}`)
    .join(' ')

  return (
    <svg
      aria-label={`Prévia do traçado ${track.name}`}
      className="h-full min-h-52 w-full"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      viewBox={`${track.bounds.minX - width * 0.06} ${-track.bounds.maxY - height * 0.06} ${width * 1.12} ${height * 1.12}`}
    >
      <polyline
        fill="none"
        points={points}
        stroke="rgba(240, 240, 250, 0.2)"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={Math.max(width, height) * 0.025}
      />
      <polyline
        fill="none"
        points={points}
        stroke="#31c7ff"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={Math.max(width, height) * 0.009}
      />
    </svg>
  )
}

function TrackOption({
  track,
  selected,
  onSelect,
}: {
  track: TrackCatalogEntry
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      aria-pressed={selected}
      className={`flex w-full items-center justify-between gap-4 rounded-xl border px-4 py-3 text-left transition ${
        selected
          ? 'border-primary bg-primary/10'
          : 'border-border/70 bg-background/35 hover:bg-muted/55'
      }`}
      onClick={onSelect}
      type="button"
    >
      <span className="min-w-0">
        <span className="block truncate text-sm font-extrabold">{track.name}</span>
        <span className="mt-0.5 block text-xs font-semibold text-muted-foreground">
          {track.countryName} · {track.locality}
        </span>
      </span>
      <span className="shrink-0 font-mono text-xs font-bold text-info">
        {formatTrackLength(track.lengthMeters)}
      </span>
    </button>
  )
}

function PlayerConfigurator({
  label,
  selection,
  otherSelection,
  onChange,
}: {
  label: string
  selection: PlayerSelection
  otherSelection?: PlayerSelection
  onChange: (selection: PlayerSelection) => void
}) {
  const [isChanging, setIsChanging] = useState(false)
  const selectedColor = normalizeVehiclePaintColor(selection.color)
  const otherColor = otherSelection
    ? normalizeVehiclePaintColor(otherSelection.color)
    : null
  const duplicatesOther = (color: string) => otherColor === color

  return (
    <fieldset className="surface-panel p-5 sm:p-6">
      <legend className="px-2 text-[11px] font-extrabold uppercase tracking-[0.2em] text-info">
        {label}
      </legend>
      <div className="grid items-center gap-5 sm:grid-cols-[12rem_minmax(0,1fr)]">
        <VehiclePreview
          className="h-32 w-full"
          color={selectedColor}
        />
        <div>
          <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-muted-foreground">
            Carro atual
          </p>
          <p className="mt-1 font-display text-3xl font-black uppercase italic">
            F1 Never Lift
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Monoposto único com pintura personalizável
          </p>
          <Button
            aria-expanded={isChanging}
            className="mt-4"
            onClick={() => setIsChanging((current) => !current)}
            size="sm"
            type="button"
            variant="secondary"
          >
            {isChanging ? 'Concluir' : 'Personalizar'}
          </Button>
        </div>
      </div>

      {isChanging && (
        <div className="mt-5 border-t border-border/70 pt-5">
          <div>
            <p className="mb-2 text-[10px] font-extrabold uppercase tracking-[0.17em] text-muted-foreground">
              Cor do carro e capacete
            </p>
            <div className="flex flex-wrap gap-2">
              {VEHICLE_PAINT_OPTIONS.map((paint) => (
                <button
                  aria-label={`Selecionar pintura ${paint.label}`}
                  aria-pressed={selectedColor === paint.color}
                  className={`size-8 rounded-full border-2 transition ${
                    selectedColor === paint.color
                      ? 'scale-110 border-foreground'
                      : 'border-transparent opacity-75 hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-25'
                  }`}
                  disabled={duplicatesOther(paint.color)}
                  key={paint.id}
                  onClick={() => onChange({ ...selection, color: paint.color })}
                  style={{ backgroundColor: paint.color }}
                  title={paint.label}
                  type="button"
                />
              ))}
            </div>
          </div>
          {otherSelection && (
            <p className="mt-4 text-xs font-semibold text-warning">
              A pintura usada pelo outro jogador fica indisponível.
            </p>
          )}
        </div>
      )}
      <p className="mt-3 text-xs font-semibold text-muted-foreground">
        Todos os participantes usam o mesmo modelo e a mesma física.
      </p>
    </fieldset>
  )
}

export function RacePage() {
  const { account, session, startGuestSession } = useAuth()
  const requestedGuest = useRef(false)
  const trackRequestId = useRef(0)
  const activeTrack = useRef<TrackDefinition | null>(null)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [trackCatalog, setTrackCatalog] = useState<TrackCatalog | null>(null)
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null)
  const [selectedTrack, setSelectedTrack] = useState<TrackDefinition | null>(null)
  const [trackError, setTrackError] = useState<string | null>(null)
  const [tracksLoading, setTracksLoading] = useState(true)
  const [trackLoading, setTrackLoading] = useState(false)
  const [mode, setMode] = useState<RaceMode>('solo')
  const [difficulty, setDifficulty] = useState<BotDifficulty>('normal')
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDayPreset>('day')
  const [playerOne, setPlayerOne] = useState(defaultPlayerOne)
  const [playerTwo, setPlayerTwo] = useState(defaultPlayerTwo)
  const [engine, setEngine] = useState<RaceEngine | null>(null)
  const [results, setResults] = useState<RaceResultEntry[] | null>(null)
  const [submission, setSubmission] = useState<SubmissionState>({ status: 'idle' })

  const requestGuestSession = useCallback(() => {
    requestedGuest.current = true
    setSessionError(null)
    startGuestSession().catch((error: unknown) => {
      requestedGuest.current = false
      setSessionError(getErrorMessage(error))
    })
  }, [startGuestSession])

  const loadTrackCatalog = useCallback(() => {
    setTracksLoading(true)
    setTrackError(null)
    raceApi
      .getTracks()
      .then((catalog) => {
        if (catalog.tracks.length !== 24) {
          throw new Error('A lista de circuitos está incompleta. Tente novamente.')
        }
        setTrackCatalog(catalog)
        setSelectedTrackId((current) => current ?? catalog.tracks[0]?.id ?? null)
      })
      .catch((error: unknown) => setTrackError(getErrorMessage(error)))
      .finally(() => setTracksLoading(false))
  }, [])

  useEffect(() => {
    if (session || requestedGuest.current) return
    requestGuestSession()
  }, [requestGuestSession, session])

  useEffect(() => {
    loadTrackCatalog()
  }, [loadTrackCatalog])

  useEffect(() => {
    if (!selectedTrackId || !trackCatalog) return
    const requestId = trackRequestId.current + 1
    trackRequestId.current = requestId
    setTrackLoading(true)
    setTrackError(null)
    setSelectedTrack(null)
    raceApi
      .getTrack(selectedTrackId)
      .then((definition) => {
        if (requestId !== trackRequestId.current) return
        if (
          definition.id !== selectedTrackId ||
          definition.catalogVersion !== trackCatalog.catalogVersion ||
          definition.physicsContractVersion !==
            trackCatalog.physicsContractVersion
        ) {
          throw new Error('Não foi possível confirmar os dados deste circuito.')
        }
        setSelectedTrack(definition)
      })
      .catch((error: unknown) => {
        if (requestId === trackRequestId.current) {
          setTrackError(getErrorMessage(error))
        }
      })
      .finally(() => {
        if (requestId === trackRequestId.current) setTrackLoading(false)
      })
  }, [selectedTrackId, trackCatalog])

  const startRace = useCallback(() => {
    if (!session || !selectedTrack) return
    const primaryName = account?.displayName ?? playerOne.name
    const playerOneColor = normalizeVehiclePaintColor(playerOne.color)
    const playerTwoColor = normalizeVehiclePaintColor(
      playerTwo.color,
      SECONDARY_VEHICLE_PAINT_COLOR,
    )
    const racers: VehicleSetup[] = [
      {
        id: 'player-1',
        name: primaryName,
        kind: 'human',
        color: playerOneColor,
      },
    ]

    if (mode === 'local') {
      racers.push({
        id: 'player-2',
        name: playerTwo.name,
        kind: 'human',
        color: playerTwoColor,
      })
    } else {
      const botColors = getAlternativeVehiclePaintColors(playerOneColor)
      racers.push(
        {
          id: 'bot-apex',
          name: 'Bot Apex',
          kind: 'bot',
          color: botColors[0],
          botDifficulty: difficulty,
        },
        {
          id: 'bot-vector',
          name: 'Bot Vector',
          kind: 'bot',
          color: botColors[1],
          botDifficulty: difficulty,
        },
      )
    }

    setResults(null)
    setSubmission({ status: 'idle' })
    activeTrack.current = selectedTrack
    setEngine(
      new RaceEngine({
        track: selectedTrack,
        mode,
        racers,
        lapCount: 1,
      }),
    )
  }, [
    account?.displayName,
    difficulty,
    mode,
    playerOne,
    playerTwo,
    selectedTrack,
    session,
  ])

  const finishRace = useCallback(
    async (raceResults: RaceResultEntry[]) => {
      setResults(raceResults)
      setEngine(null)
      if (!session) {
        setSubmission({
          status: 'error',
          message: 'Sua sessão terminou. Corra novamente para salvar o resultado.',
        })
        return
      }

      setSubmission({ status: 'sending' })
      try {
        const completedTrack = activeTrack.current
        if (!completedTrack) {
          throw new Error('Não foi possível identificar a pista concluída.')
        }
        const authenticatedUserId =
          session.role === 'user' ? (account?.id ?? session.subject ?? null) : null
        const response = await raceApi.submitLocalResult(
          {
            trackId: completedTrack.id,
            trackCatalogVersion: completedTrack.catalogVersion,
            physicsContractVersion: completedTrack.physicsContractVersion,
            mode,
            results: raceResults.map((result) => ({
              userIdOrNull:
                result.racerId === 'player-1' ? authenticatedUserId : null,
              position: result.position,
              totalTimeMs: result.totalTimeMs,
              bestLapTimeMs: result.bestLapTimeMs,
              finished: result.finished,
            })),
          },
          session.token,
        )
        setSubmission({ status: 'success', response })
      } catch (error) {
        setSubmission({ status: 'error', message: getErrorMessage(error) })
      }
    },
    [account?.id, mode, session],
  )

  if (engine) {
    return (
      <RaceCanvas
        engine={engine}
        mode={mode}
        timeOfDay={timeOfDay}
        onAbort={() => setEngine(null)}
        onFinished={finishRace}
      />
    )
  }

  if (results) {
    return (
      <AppShell moduleLabel="Resultado da corrida">
        <section className="mx-auto max-w-3xl">
          <div className="mb-8 text-center">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.22em] text-info">
              Bandeirada
            </p>
            <h1 className="display-heading mt-3 text-6xl sm:text-7xl">Resultado local</h1>
          </div>
          <div className="surface-panel overflow-hidden">
            {results.map((result) => (
              <div
                className="flex items-center justify-between gap-5 border-b border-border/65 px-5 py-4 last:border-b-0"
                key={result.racerId}
              >
                <div className="flex items-center gap-4">
                  <span className="font-display text-4xl font-black italic text-primary">
                    {result.position}
                  </span>
                  <div>
                    <p className="font-extrabold">{result.racerName}</p>
                    <p className="text-xs font-semibold text-muted-foreground">
                      {result.finished ? 'Completou a volta' : 'Tempo limite atingido'}
                    </p>
                  </div>
                </div>
                <p className="font-mono text-sm font-bold">
                  {result.finished ? `${(result.totalTimeMs / 1000).toFixed(3)}s` : 'DNF'}
                </p>
              </div>
            ))}
          </div>

          <div
            aria-live="polite"
            className="mt-5 flex items-start gap-3 rounded-xl border border-border bg-card/70 p-4"
          >
            {submission.status === 'sending' && (
              <LoaderCircle aria-hidden="true" className="mt-0.5 size-5 animate-spin text-info" />
            )}
            {submission.status === 'success' && (
              <CheckCircle2 aria-hidden="true" className="mt-0.5 size-5 text-success" />
            )}
            {submission.status === 'error' && (
              <CircleAlert aria-hidden="true" className="mt-0.5 size-5 text-destructive" />
            )}
            <div>
              <p className="font-bold">
                {submission.status === 'sending' && 'Salvando resultado…'}
                {submission.status === 'success' && 'Resultado salvo'}
                {submission.status === 'error' && 'Não foi possível salvar o resultado'}
              </p>
              {submission.status === 'success' && (
                <p className="mt-1 text-sm text-muted-foreground">
                  Sua corrida foi registrada com sucesso.
                </p>
              )}
              {submission.status === 'error' && (
                <p className="mt-1 text-sm text-muted-foreground">{submission.message}</p>
              )}
            </div>
          </div>
          <Button className="mt-6 w-full" onClick={() => setResults(null)} size="lg">
            Configurar nova corrida
          </Button>
        </section>
      </AppShell>
    )
  }

  return (
    <AppShell moduleLabel="Preparação da corrida">
      <section className="space-y-7">
        <header className="max-w-3xl">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.22em] text-info">
            Preparação da corrida
          </p>
          <h1 className="display-heading mt-3 text-6xl sm:text-8xl">Prepare a corrida</h1>
          <p className="mt-5 max-w-2xl leading-7 text-muted-foreground">
            Escolha circuito e pintura. O resumo acompanha as decisões até a largada.
          </p>
        </header>

        <section className="grid gap-4 lg:grid-cols-[minmax(18rem,0.85fr)_minmax(0,1.15fr)]">
          <div className="surface-panel min-w-0 p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-muted-foreground">
                  Temporada 2026
                </p>
                <h2 className="mt-1 font-display text-2xl font-black uppercase italic">
                  24 circuitos
                </h2>
              </div>
              <MapPinned aria-hidden="true" className="size-6 text-info" />
            </div>

            {tracksLoading && (
              <div className="grid min-h-48 place-items-center text-sm text-muted-foreground">
                <LoaderCircle aria-hidden="true" className="size-6 animate-spin text-info" />
                Carregando circuitos…
              </div>
            )}
            {!tracksLoading && trackCatalog && (
              <div
                aria-label="Circuitos disponíveis"
                className="max-h-[28rem] space-y-2 overflow-y-auto pr-1"
              >
                {trackCatalog.tracks.map((track) => (
                  <TrackOption
                    key={track.id}
                    onSelect={() => setSelectedTrackId(track.id)}
                    selected={selectedTrackId === track.id}
                    track={track}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="surface-panel min-h-[28rem] min-w-0 overflow-hidden p-5 sm:p-6">
            {trackLoading && (
              <div className="grid h-full min-h-[24rem] place-items-center text-sm font-semibold text-muted-foreground">
                <LoaderCircle aria-hidden="true" className="size-7 animate-spin text-info" />
                Preparando pista…
              </div>
            )}
            {!trackLoading && selectedTrack && (
              <div className="flex h-full flex-col">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-info">
                      {selectedTrack.countryCode} // {selectedTrack.locality}
                    </p>
                    <h2 className="mt-1 font-display text-3xl font-black uppercase italic">
                      {selectedTrack.name}
                    </h2>
                  </div>
                  <div className="flex gap-2 text-xs font-bold">
                    <span className="rounded-full border border-border bg-background/55 px-3 py-1.5">
                      {formatTrackLength(selectedTrack.lengthMeters)}
                    </span>
                    <span className="rounded-full border border-info/35 bg-info/10 px-3 py-1.5 text-info">
                      {environmentLabels[selectedTrack.sceneryLayout.preset]}
                    </span>
                  </div>
                </div>
                <div className="mt-5 flex-1 rounded-xl border border-border/70 bg-[#07101a] p-4">
                  <TrackPreview track={selectedTrack} />
                </div>
                <p className="mt-4 text-xs font-semibold text-muted-foreground">
                  Traçado completo disponível durante a corrida
                </p>
              </div>
            )}
            {!trackLoading && !selectedTrack && !trackError && (
              <div className="grid h-full min-h-[24rem] place-items-center text-sm text-muted-foreground">
                Selecione um circuito para carregar a prévia.
              </div>
            )}
          </div>
        </section>

        {trackError && (
          <div
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/40 bg-destructive/8 p-4"
            role="alert"
          >
            <p className="text-sm text-destructive">{trackError}</p>
            <Button onClick={loadTrackCatalog} size="sm" variant="secondary">
              <RotateCcw aria-hidden="true" className="size-4" />
              Recarregar pistas
            </Button>
          </div>
        )}

        <section className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_21rem]">
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                aria-pressed={mode === 'solo'}
                className={`surface-panel flex items-center gap-4 p-5 text-left transition ${mode === 'solo' ? 'border-primary/70 bg-primary/8' : ''}`}
                onClick={() => setMode('solo')}
                type="button"
              >
                <Bot aria-hidden="true" className="size-7 text-primary" />
                <span>
                  <strong className="block">Solo contra bots</strong>
                  <small className="text-muted-foreground">
                    Um piloto contra dois adversários
                  </small>
                </span>
              </button>
              <button
                aria-pressed={mode === 'local'}
                className={`surface-panel flex items-center gap-4 p-5 text-left transition ${mode === 'local' ? 'border-primary/70 bg-primary/8' : ''}`}
                onClick={() => {
                  setMode('local')
                  if (
                    normalizeVehiclePaintColor(playerTwo.color) ===
                    normalizeVehiclePaintColor(playerOne.color)
                  ) {
                    setPlayerTwo({
                      ...playerTwo,
                      color:
                        getAlternativeVehiclePaintColors(playerOne.color)[0] ??
                        SECONDARY_VEHICLE_PAINT_COLOR,
                    })
                  }
                }}
                type="button"
              >
                <Users aria-hidden="true" className="size-7 text-accent" />
                <span>
                  <strong className="block">Dois jogadores locais</strong>
                  <small className="text-muted-foreground">
                    WASD contra setas em split-screen
                  </small>
                </span>
              </button>
            </div>

            <PlayerConfigurator
              label="Jogador 1"
              onChange={setPlayerOne}
              otherSelection={mode === 'local' ? playerTwo : undefined}
              selection={playerOne}
            />
            {mode === 'local' && (
              <PlayerConfigurator
                label="Jogador 2"
                onChange={setPlayerTwo}
                otherSelection={playerOne}
                selection={playerTwo}
              />
            )}

            <details className="group rounded-2xl border border-border bg-card/55 p-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-extrabold marker:content-none">
                <span>
                  <span className="block text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                    Ajustes da prova
                  </span>
                  <span className="mt-1 block">Opções adicionais</span>
                </span>
                <ChevronDown
                  aria-hidden="true"
                  className="size-5 text-info transition-transform group-open:rotate-180"
                />
              </summary>

              <div className="mt-5 space-y-5 border-t border-border/70 pt-5">
                <fieldset>
                  <legend className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-muted-foreground">
                    Horário da corrida
                  </legend>
                  <p className="mb-3 mt-2 text-sm text-muted-foreground">
                    O preset visual permanece fixo da largada até a bandeirada.
                  </p>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {timeOfDayOptions.map((option) => (
                      <button
                        aria-pressed={timeOfDay === option.id}
                        className={`rounded-xl border p-4 text-left transition ${
                          timeOfDay === option.id
                            ? 'border-primary bg-primary/12'
                            : 'border-border bg-background/45 hover:bg-muted/65'
                        }`}
                        key={option.id}
                        onClick={() => setTimeOfDay(option.id)}
                        type="button"
                      >
                        <span className="font-extrabold">{option.label}</span>
                        <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                          {option.description}
                        </span>
                      </button>
                    ))}
                  </div>
                </fieldset>

                {mode === 'solo' && (
                  <fieldset>
                    <legend className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-muted-foreground">
                      Dificuldade dos bots
                    </legend>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(['easy', 'normal', 'hard'] as const).map((option) => (
                        <Button
                          key={option}
                          onClick={() => setDifficulty(option)}
                          type="button"
                          variant={difficulty === option ? 'default' : 'secondary'}
                        >
                          {option === 'easy'
                            ? 'Fácil'
                            : option === 'normal'
                              ? 'Normal'
                              : 'Difícil'}
                        </Button>
                      ))}
                    </div>
                  </fieldset>
                )}
              </div>
            </details>

            {sessionError && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/40 bg-destructive/8 p-4" role="alert">
                <p className="text-sm text-destructive">{sessionError}</p>
                <Button onClick={requestGuestSession} size="sm" variant="secondary">
                  Tentar sessão novamente
                </Button>
              </div>
            )}
          </div>

          <aside
            aria-label="Resumo da corrida"
            className="surface-panel overflow-hidden lg:sticky lg:top-24"
          >
            <div className="border-b border-border/70 bg-primary/8 p-5">
              <div className="flex items-center gap-3">
                <Gamepad2 aria-hidden="true" className="size-5 text-info" />
                <div>
                  <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-muted-foreground">
                    Configuração atual
                  </p>
                  <h2 className="font-display text-2xl font-black uppercase italic">
                    Resumo da corrida
                  </h2>
                </div>
              </div>
            </div>

            <dl className="space-y-3 p-5 text-sm">
              <div>
                <dt className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
                  Pista
                </dt>
                <dd className="mt-1 font-extrabold">
                  {selectedTrack?.name ?? 'Carregando pista…'}
                </dd>
                {selectedTrack && (
                  <dd className="mt-0.5 text-xs text-muted-foreground">
                    {formatTrackLength(selectedTrack.lengthMeters)} ·{' '}
                    {environmentLabels[selectedTrack.sceneryLayout.preset]}
                  </dd>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3 border-t border-border/60 pt-3">
                <div>
                  <dt className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
                    Modo
                  </dt>
                  <dd className="mt-1 font-bold">{mode === 'solo' ? 'Solo' : 'Local'}</dd>
                </div>
                <div>
                  <dt className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
                    Carro
                  </dt>
                  <dd className="mt-1 font-bold">F1</dd>
                </div>
                <div>
                  <dt className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
                    Voltas
                  </dt>
                  <dd className="mt-1 font-bold">1 volta</dd>
                </div>
                <div>
                  <dt className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
                    Horário
                  </dt>
                  <dd className="mt-1 font-bold">{timeOfDayLabel(timeOfDay)}</dd>
                </div>
              </div>
              <div className="border-t border-border/60 pt-3">
                <dt className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
                  Pinturas
                </dt>
                {[playerOne, ...(mode === 'local' ? [playerTwo] : [])].map((player) => (
                  <dd className="mt-2 flex items-center gap-2 font-bold" key={player.name}>
                    <span
                      aria-hidden="true"
                      className="size-3 rounded-full border border-foreground/25"
                      style={{
                        backgroundColor: normalizeVehiclePaintColor(player.color),
                      }}
                    />
                    {player.name} · F1
                  </dd>
                ))}
              </div>
            </dl>

            <div className="border-t border-border/70 p-5">
              <Button
                className="w-full"
                disabled={!session || !selectedTrack || trackLoading}
                onClick={startRace}
                size="lg"
              >
                {session && selectedTrack ? (
                  <Play aria-hidden="true" className="size-4" />
                ) : (
                  <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                )}
                {session && selectedTrack ? 'Iniciar corrida' : 'Preparando corrida'}
              </Button>
            </div>
          </aside>
        </section>
      </section>
    </AppShell>
  )
}
