import {
  Angry,
  Bot,
  CheckCircle2,
  CircleAlert,
  LoaderCircle,
  Meh,
  Minus,
  Play,
  Plus,
  RotateCcw,
  Settings2,
  Smile,
  Users,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useAuth } from '@/auth/auth-context'
import { AppShell } from '@/components/AppShell'
import { RaceCanvas } from '@/components/race/RaceCanvas'
import { TrackCarousel } from '@/components/race/TrackCarousel'
import { VehiclePreview } from '@/components/race/VehiclePreview'
import { Button } from '@/components/ui/button'
import {
  raceApi,
  type LocalRaceResultResponse,
  type TrackCatalog,
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

const difficultyOptions: Array<{
  id: BotDifficulty
  label: string
  tone: string
}> = [
  { id: 'easy', label: 'Fácil', tone: 'text-success' },
  { id: 'normal', label: 'Médio', tone: 'text-warning' },
  { id: 'hard', label: 'Difícil', tone: 'text-destructive' },
]

function DifficultyIcon({ difficulty }: { difficulty: BotDifficulty }) {
  if (difficulty === 'easy') return <Smile aria-hidden="true" className="size-5" />
  if (difficulty === 'hard') return <Angry aria-hidden="true" className="size-5" />
  return <Meh aria-hidden="true" className="size-5" />
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
  const markerScale = Math.max(width, height)
  const start = track.startFinish.position
  const lateral = {
    x: -track.startFinish.forward.y,
    y: track.startFinish.forward.x,
  }
  const startLineFrom = {
    x: start.x - lateral.x * track.startFinish.halfWidthMeters,
    y: start.y - lateral.y * track.startFinish.halfWidthMeters,
  }
  const startLineTo = {
    x: start.x + lateral.x * track.startFinish.halfWidthMeters,
    y: start.y + lateral.y * track.startFinish.halfWidthMeters,
  }
  const directionLength = markerScale * 0.075
  const directionEnd = {
    x: start.x + track.startFinish.forward.x * directionLength,
    y: start.y + track.startFinish.forward.y * directionLength,
  }
  const points = track.centerline
    .map((point) => `${point.x},${-point.y}`)
    .join(' ')

  return (
    <svg
      aria-label={`Prévia do traçado ${track.name}`}
      className="size-full"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      viewBox={`${track.bounds.minX - width * 0.06} ${-track.bounds.maxY - height * 0.06} ${width * 1.12} ${height * 1.12}`}
    >
      <defs>
        <marker
          id="track-direction-arrow"
          markerHeight="7"
          markerWidth="7"
          orient="auto"
          refX="5"
          refY="3.5"
        >
          <path d="M0,0 L0,7 L6,3.5 z" fill="#31c7ff" />
        </marker>
      </defs>
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
      <line
        stroke="#f0f0fa"
        strokeDasharray={`${markerScale * 0.008} ${markerScale * 0.006}`}
        strokeLinecap="round"
        strokeWidth={markerScale * 0.012}
        x1={startLineFrom.x}
        x2={startLineTo.x}
        y1={-startLineFrom.y}
        y2={-startLineTo.y}
      />
      <circle
        cx={start.x}
        cy={-start.y}
        fill="#31c7ff"
        r={markerScale * 0.018}
        stroke="#f0f0fa"
        strokeWidth={markerScale * 0.005}
      />
      <line
        markerEnd="url(#track-direction-arrow)"
        stroke="#31c7ff"
        strokeLinecap="round"
        strokeWidth={markerScale * 0.012}
        x1={start.x}
        x2={directionEnd.x}
        y1={-start.y}
        y2={-directionEnd.y}
      />
    </svg>
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
  const selectedColor = normalizeVehiclePaintColor(selection.color)
  const otherColor = otherSelection
    ? normalizeVehiclePaintColor(otherSelection.color)
    : null
  const duplicatesOther = (color: string) => otherColor === color

  return (
    <fieldset className="rounded-xl border border-border/70 bg-background/35 p-3.5">
      <legend className="px-2 text-[11px] font-extrabold uppercase tracking-[0.2em] text-info">
        {label}
      </legend>
      <div className="grid items-center gap-3 sm:grid-cols-[7rem_minmax(0,1fr)]">
        <VehiclePreview
          className="h-20 w-full"
          color={selectedColor}
        />
        <div className="min-w-0">
          <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-muted-foreground">
            F1 Never Lift
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
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
      </div>
      {otherSelection && (
        <p className="mt-2 text-[11px] font-semibold text-warning">
          A pintura do outro jogador fica indisponível.
        </p>
      )}
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
  const [difficulty, setDifficulty] = useState<BotDifficulty>('easy')
  const [botCount, setBotCount] = useState(2)
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDayPreset>('day')
  const [playerOne, setPlayerOne] = useState(defaultPlayerOne)
  const [playerTwo, setPlayerTwo] = useState(defaultPlayerTwo)
  const [engine, setEngine] = useState<RaceEngine | null>(null)
  const [results, setResults] = useState<RaceResultEntry[] | null>(null)
  const [submission, setSubmission] = useState<SubmissionState>({ status: 'idle' })
  const humanCount = mode === 'local' ? 2 : 1
  const maximumBotCount = 22 - humanCount
  const difficultyOption =
    difficultyOptions.find((option) => option.id === difficulty) ??
    difficultyOptions[0]

  useEffect(() => {
    setBotCount((current) => Math.min(current, maximumBotCount))
  }, [maximumBotCount])

  const cycleDifficulty = useCallback(() => {
    setDifficulty((current) => {
      const currentIndex = difficultyOptions.findIndex(
        (option) => option.id === current,
      )
      return difficultyOptions[(currentIndex + 1) % difficultyOptions.length].id
    })
  }, [])

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
    }

    const humanColors = new Set(
      racers.filter((racer) => racer.kind === 'human').map((racer) => racer.color),
    )
    const botColors = [
      ...VEHICLE_PAINT_OPTIONS.map((paint) => paint.color).filter(
        (color) => !humanColors.has(color),
      ),
      ...VEHICLE_PAINT_OPTIONS.map((paint) => paint.color),
    ]
    for (let index = 0; index < botCount; index += 1) {
      racers.push({
        id: `bot-${index + 1}`,
        name: `Bot ${String(index + 1).padStart(2, '0')}`,
        kind: 'bot',
        color: botColors[index % botColors.length],
        botDifficulty: difficulty,
      })
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
    botCount,
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
            Defina modo, pilotos, adversários e condições da prova antes da largada.
          </p>
        </header>

        <section className="grid items-stretch gap-5 xl:grid-cols-[minmax(0,1.02fr)_minmax(24rem,0.98fr)]">
          <section className="surface-panel min-w-0 p-5 sm:p-6 xl:h-[56rem] xl:overflow-y-auto">
            <div className="mb-6 flex items-center gap-3 border-b border-border/70 pb-4">
              <Settings2 aria-hidden="true" className="size-5 text-primary" />
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-muted-foreground">
                  Preparação local
                </p>
                <h2 className="font-display text-2xl font-black uppercase italic">
                  Ajustes da prova
                </h2>
              </div>
            </div>

            <div className="space-y-6">
              <fieldset>
                <legend className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-muted-foreground">
                  Modo de jogo
                </legend>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <button
                    aria-pressed={mode === 'solo'}
                    className={
                      mode === 'solo'
                        ? 'flex items-center gap-3 rounded-xl border border-primary/70 bg-primary/10 p-3.5 text-left transition'
                        : 'flex items-center gap-3 rounded-xl border border-border/70 bg-background/35 p-3.5 text-left transition hover:bg-muted/55'
                    }
                    onClick={() => setMode('solo')}
                    type="button"
                  >
                    <Bot aria-hidden="true" className="size-5 text-primary" />
                    <span>
                      <strong className="block text-sm">Solo</strong>
                      <small className="text-muted-foreground">Um jogador</small>
                    </span>
                  </button>
                  <button
                    aria-pressed={mode === 'local'}
                    className={
                      mode === 'local'
                        ? 'flex items-center gap-3 rounded-xl border border-primary/70 bg-primary/10 p-3.5 text-left transition'
                        : 'flex items-center gap-3 rounded-xl border border-border/70 bg-background/35 p-3.5 text-left transition hover:bg-muted/55'
                    }
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
                    <Users aria-hidden="true" className="size-5 text-info" />
                    <span>
                      <strong className="block text-sm">Local</strong>
                      <small className="text-muted-foreground">Dois jogadores</small>
                    </span>
                  </button>
                </div>
              </fieldset>

              <section aria-labelledby="vehicle-settings-title">
                <h3
                  className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-muted-foreground"
                  id="vehicle-settings-title"
                >
                  Carros
                </h3>
                <div className="mt-3 space-y-3">
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
                </div>
              </section>

              {tracksLoading ? (
                <div className="grid min-h-48 place-items-center gap-2 text-sm text-muted-foreground">
                  <LoaderCircle aria-hidden="true" className="size-6 animate-spin text-info" />
                  Carregando circuitos…
                </div>
              ) : (
                <TrackCarousel
                  catalog={trackCatalog}
                  getTrack={raceApi.getTrack}
                  onLoadError={setTrackError}
                  onSelect={setSelectedTrackId}
                  selectedId={selectedTrackId}
                />
              )}

              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div>
                  <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-muted-foreground">
                    Quantidade de bots
                  </p>
                  <div className="mt-2 flex h-11 items-center justify-between rounded-[10px] border border-border bg-background/45 p-1">
                    <Button
                      aria-label="Diminuir quantidade de bots"
                      disabled={botCount === 0}
                      onClick={() => setBotCount((current) => Math.max(0, current - 1))}
                      size="icon"
                      type="button"
                      variant="ghost"
                    >
                      <Minus aria-hidden="true" className="size-4" />
                    </Button>
                    <span
                      aria-label={botCount + ' bots selecionados'}
                      className="font-mono text-base font-black text-foreground"
                    >
                      {botCount}
                    </span>
                    <Button
                      aria-label="Aumentar quantidade de bots"
                      disabled={botCount >= maximumBotCount}
                      onClick={() =>
                        setBotCount((current) =>
                          Math.min(maximumBotCount, current + 1),
                        )
                      }
                      size="icon"
                      type="button"
                      variant="ghost"
                    >
                      <Plus aria-hidden="true" className="size-4" />
                    </Button>
                  </div>
                  <p className="mt-1.5 text-[10px] font-semibold text-muted-foreground">
                    {humanCount + botCount}/22 vagas ocupadas
                  </p>
                </div>

                <div>
                  <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-muted-foreground">
                    Dificuldade
                  </p>
                  <Button
                    aria-label={
                      'Dificuldade dos bots: ' +
                      difficultyOption.label +
                      '; clique para alterar'
                    }
                    className={'mt-2 size-11 ' + difficultyOption.tone}
                    disabled={botCount === 0}
                    onClick={cycleDifficulty}
                    size="icon"
                    title={'Bots no ' + difficultyOption.label.toLocaleLowerCase('pt-BR')}
                    type="button"
                    variant="secondary"
                  >
                    <DifficultyIcon difficulty={difficulty} />
                  </Button>
                </div>
              </div>

              <fieldset>
                <legend className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-muted-foreground">
                  Horário da corrida
                </legend>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {timeOfDayOptions.map((option) => (
                    <button
                      aria-pressed={timeOfDay === option.id}
                      className={
                        timeOfDay === option.id
                          ? 'rounded-xl border border-primary bg-primary/12 px-3 py-3 text-center text-sm font-extrabold text-foreground transition'
                          : 'rounded-xl border border-border bg-background/45 px-3 py-3 text-center text-sm font-extrabold text-muted-foreground transition hover:bg-muted/65'
                      }
                      key={option.id}
                      onClick={() => setTimeOfDay(option.id)}
                      title={option.description}
                      type="button"
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </fieldset>

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

              {sessionError && (
                <div
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/40 bg-destructive/8 p-4"
                  role="alert"
                >
                  <p className="text-sm text-destructive">{sessionError}</p>
                  <Button onClick={requestGuestSession} size="sm" variant="secondary">
                    Tentar sessão novamente
                  </Button>
                </div>
              )}

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
          </section>

          <section
            aria-label="Mapa do circuito selecionado"
            className="surface-panel min-h-[40rem] min-w-0 overflow-hidden p-5 sm:p-6 xl:h-[56rem]"
          >
            {trackLoading && (
              <div className="grid h-full min-h-[36rem] place-items-center text-sm font-semibold text-muted-foreground">
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
                <div className="mt-5 min-h-0 flex-1 rounded-xl border border-border/70 bg-[#07101a] p-5">
                  <TrackPreview track={selectedTrack} />
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs font-semibold">
                  <span className="inline-flex items-center gap-2 text-muted-foreground">
                    <span className="size-2.5 rounded-full bg-info ring-2 ring-foreground/80" />
                    Largada e sentido da prova
                  </span>
                  <span className="text-muted-foreground">
                    Traçado completo durante a corrida
                  </span>
                </div>
              </div>
            )}
            {!trackLoading && !selectedTrack && !trackError && (
              <div className="grid h-full min-h-[36rem] place-items-center text-sm text-muted-foreground">
                Selecione um circuito para carregar a prévia.
              </div>
            )}
          </section>
        </section>
      </section>
    </AppShell>
  )
}
