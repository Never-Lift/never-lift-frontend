import {
  Bot,
  CheckCircle2,
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
  HandlingMode,
  RaceMode,
  RaceResultEntry,
  VehicleProfileId,
  VehicleSetup,
} from '@/race/types'
import type { TimeOfDayPreset } from '@/race/visual-settings'

type PlayerSelection = {
  name: string
  profileId: VehicleProfileId
  color: string
}

type SubmissionState =
  | { status: 'idle' }
  | { status: 'sending' }
  | { status: 'success'; response: LocalRaceResultResponse }
  | { status: 'error'; message: string }

const vehicleOptions: Array<{
  id: VehicleProfileId
  name: string
  description: string
}> = [
  { id: 'formula', name: 'F1', description: 'Silhueta monoposto' },
  {
    id: 'supercar',
    name: 'Supercarro',
    description: 'Silhueta esportiva fechada',
  },
  { id: 'drift', name: 'Drift', description: 'Silhueta urbana preparada' },
]

const colorOptions = ['#2d7dff', '#ff2e88', '#2bd67b', '#ffb82e', '#f0f0fa', '#9c6cff']

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
  profileId: 'formula',
  color: colorOptions[0],
}

const defaultPlayerTwo: PlayerSelection = {
  name: 'Piloto 2',
  profileId: 'drift',
  color: colorOptions[1],
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
  onChange,
}: {
  label: string
  selection: PlayerSelection
  onChange: (selection: PlayerSelection) => void
}) {
  return (
    <fieldset className="surface-panel p-5 sm:p-6">
      <legend className="px-2 text-[11px] font-extrabold uppercase tracking-[0.2em] text-info">
        {label}
      </legend>
      <div className="grid gap-3 sm:grid-cols-3">
        {vehicleOptions.map((vehicle) => (
          <button
            aria-pressed={selection.profileId === vehicle.id}
            className={`rounded-xl border p-4 text-left transition ${
              selection.profileId === vehicle.id
                ? 'border-primary bg-primary/12 shadow-[inset_0_0_0_1px_rgb(45_125_255/0.3)]'
                : 'border-border bg-background/45 hover:bg-muted/65'
            }`}
            key={vehicle.id}
            onClick={() => onChange({ ...selection, profileId: vehicle.id })}
            type="button"
          >
            <span className="font-extrabold">{vehicle.name}</span>
            <span className="mt-1 block text-xs leading-5 text-muted-foreground">
              {vehicle.description}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-5 border-t border-border/70 pt-5">
        <div>
          <p className="mb-2 text-[10px] font-extrabold uppercase tracking-[0.17em] text-muted-foreground">
            Cor do carro {selection.profileId === 'formula' && 'e capacete'}
          </p>
          <div className="flex flex-wrap gap-2">
            {colorOptions.map((color) => (
              <button
                aria-label={`Selecionar cor ${color}`}
                aria-pressed={selection.color === color}
                className={`size-8 rounded-full border-2 transition ${
                  selection.color === color
                    ? 'scale-110 border-foreground'
                    : 'border-transparent opacity-75 hover:opacity-100'
                }`}
                key={color}
                onClick={() => onChange({ ...selection, color })}
                style={{ backgroundColor: color }}
                type="button"
              />
            ))}
          </div>
        </div>

      </div>
      <p className="mt-3 text-xs font-semibold text-muted-foreground">
        A escolha do modelo é somente visual; todos os carros compartilham a mesma física.
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
  const [handlingMode, setHandlingMode] = useState<HandlingMode>('normal')
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
          throw new Error('O catálogo ativo não contém as 24 pistas esperadas.')
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
          definition.catalogVersion !== trackCatalog.catalogVersion
        ) {
          throw new Error('A definição da pista não corresponde ao catálogo ativo.')
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
    const racers: VehicleSetup[] = [
      {
        id: 'player-1',
        name: primaryName,
        kind: 'human',
        profileId: playerOne.profileId,
        color: playerOne.color,
      },
    ]

    if (mode === 'local') {
      racers.push({
        id: 'player-2',
        name: playerTwo.name,
        kind: 'human',
        profileId: playerTwo.profileId,
        color: playerTwo.color,
      })
    } else {
      racers.push(
        {
          id: 'bot-apex',
          name: 'Bot Apex',
          kind: 'bot',
          profileId: 'supercar',
          color: '#ffb82e',
          botDifficulty: difficulty,
        },
        {
          id: 'bot-slide',
          name: 'Bot Slide',
          kind: 'bot',
          profileId: 'drift',
          color: '#2bd67b',
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
        handlingMode,
        racers,
        lapCount: 1,
      }),
    )
  }, [
    account?.displayName,
    difficulty,
    handlingMode,
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
        setSubmission({ status: 'error', message: 'Sessão ausente; resultado não enviado.' })
        return
      }

      setSubmission({ status: 'sending' })
      try {
        const completedTrack = activeTrack.current
        if (!completedTrack) {
          throw new Error('A definição da pista concluída não está mais em memória.')
        }
        const authenticatedUserId =
          session.role === 'user' ? (account?.id ?? session.subject ?? null) : null
        const response = await raceApi.submitLocalResult(
          {
            trackId: completedTrack.id,
            trackCatalogVersion: completedTrack.catalogVersion,
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
      <AppShell moduleLabel="Módulo 02 // Parte 2c">
        <RaceCanvas
          engine={engine}
          mode={mode}
          timeOfDay={timeOfDay}
          onAbort={() => setEngine(null)}
          onFinished={finishRace}
        />
      </AppShell>
    )
  }

  if (results) {
    return (
      <AppShell moduleLabel="Módulo 02 // Parte 2c">
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
                {submission.status === 'sending' && 'Enviando resultado ao backend…'}
                {submission.status === 'success' && 'Resultado persistido no backend'}
                {submission.status === 'error' && 'Não foi possível persistir o resultado'}
              </p>
              {submission.status === 'success' && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {submission.response.persistedCount} registros confirmados.
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
    <AppShell moduleLabel="Módulo 02 // Parte 2c">
      <section className="space-y-7">
        <header className="max-w-3xl">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.22em] text-info">
            Preparação da corrida
          </p>
          <h1 className="display-heading mt-3 text-6xl sm:text-8xl">Escolha a pista</h1>
          <p className="mt-5 max-w-2xl leading-7 text-muted-foreground">
            Selecione um dos 24 circuitos oficiais do catálogo ativo. A geometria
            carregada será usada pela física, pelas câmeras e pelo minimapa.
          </p>
        </header>

        <section className="grid gap-4 lg:grid-cols-[minmax(18rem,0.85fr)_minmax(0,1.15fr)]">
          <div className="surface-panel p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-muted-foreground">
                  Catálogo {trackCatalog?.catalogVersion ?? 'carregando'}
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
                Carregando catálogo…
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

          <div className="surface-panel min-h-[28rem] overflow-hidden p-5 sm:p-6">
            {trackLoading && (
              <div className="grid h-full min-h-[24rem] place-items-center text-sm font-semibold text-muted-foreground">
                <LoaderCircle aria-hidden="true" className="size-7 animate-spin text-info" />
                Carregando geometria…
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
                  {selectedTrack.chunks.length} trechos renderizáveis · minimapa de orientação fixa
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

        <div className="grid gap-3 sm:grid-cols-2">
          <button
            aria-pressed={mode === 'solo'}
            className={`surface-panel flex items-center gap-4 p-5 text-left transition ${mode === 'solo' ? 'border-primary/70 bg-primary/8' : ''}`}
            onClick={() => setMode('solo')}
            type="button"
          >
            <Bot aria-hidden="true" className="size-7 text-primary" />
            <span><strong className="block">Solo contra bots</strong><small className="text-muted-foreground">WASD e setas habilitados juntos</small></span>
          </button>
          <button
            aria-pressed={mode === 'local'}
            className={`surface-panel flex items-center gap-4 p-5 text-left transition ${mode === 'local' ? 'border-primary/70 bg-primary/8' : ''}`}
            onClick={() => setMode('local')}
            type="button"
          >
            <Users aria-hidden="true" className="size-7 text-accent" />
            <span><strong className="block">Dois jogadores locais</strong><small className="text-muted-foreground">WASD contra setas</small></span>
          </button>
        </div>

        <fieldset className="rounded-2xl border border-border bg-card/55 p-5">
          <legend className="px-2 text-[11px] font-extrabold uppercase tracking-[0.2em] text-muted-foreground">
            Modo de condução da corrida
          </legend>
          <p className="mb-3 text-sm text-muted-foreground">
            A opção escolhida vale igualmente para todos os jogadores e bots.
          </p>
          <div className="flex flex-wrap gap-2">
            {(['normal', 'drift'] as const).map((option) => (
              <Button
                aria-pressed={handlingMode === option}
                key={option}
                onClick={() => setHandlingMode(option)}
                type="button"
                variant={handlingMode === option ? 'default' : 'secondary'}
              >
                {option === 'normal' ? 'Normal' : 'Drift'}
              </Button>
            ))}
          </div>
        </fieldset>

        <fieldset className="rounded-2xl border border-border bg-card/55 p-5">
          <legend className="px-2 text-[11px] font-extrabold uppercase tracking-[0.2em] text-muted-foreground">
            Horário da corrida
          </legend>
          <p className="mb-3 text-sm text-muted-foreground">
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

        <PlayerConfigurator label="Jogador 1" onChange={setPlayerOne} selection={playerOne} />
        {mode === 'local' && (
          <PlayerConfigurator label="Jogador 2" onChange={setPlayerTwo} selection={playerTwo} />
        )}

        {mode === 'solo' && (
          <fieldset className="rounded-2xl border border-border bg-card/55 p-5">
            <legend className="px-2 text-[11px] font-extrabold uppercase tracking-[0.2em] text-muted-foreground">
              Dificuldade dos bots
            </legend>
            <div className="flex flex-wrap gap-2">
              {(['easy', 'normal', 'hard'] as const).map((option) => (
                <Button
                  key={option}
                  onClick={() => setDifficulty(option)}
                  type="button"
                  variant={difficulty === option ? 'default' : 'secondary'}
                >
                  {option === 'easy' ? 'Fácil' : option === 'normal' ? 'Normal' : 'Difícil'}
                </Button>
              ))}
            </div>
          </fieldset>
        )}

        {sessionError && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/40 bg-destructive/8 p-4" role="alert">
            <p className="text-sm text-destructive">{sessionError}</p>
            <Button onClick={requestGuestSession} size="sm" variant="secondary">
              Tentar sessão novamente
            </Button>
          </div>
        )}

        <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card/65 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <Gamepad2 aria-hidden="true" className="size-5 text-info" />
            {selectedTrack
              ? `${selectedTrack.name} · ${formatTrackLength(selectedTrack.lengthMeters)} · ${environmentLabels[selectedTrack.sceneryLayout.preset]} · ${timeOfDayLabel(timeOfDay)}`
              : 'Selecione e carregue uma pista para liberar a largada.'}
          </div>
          <Button
            disabled={!session || !selectedTrack || trackLoading}
            onClick={startRace}
            size="lg"
          >
            {session && selectedTrack ? (
              <Play aria-hidden="true" className="size-4" />
            ) : (
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
            )}
            {session && selectedTrack ? 'Largar' : 'Preparando corrida'}
          </Button>
        </div>
      </section>
    </AppShell>
  )
}
