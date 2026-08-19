import {
  Bot,
  CheckCircle2,
  CircleAlert,
  Gamepad2,
  LoaderCircle,
  Play,
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
} from '@/lib/api'
import { getErrorMessage } from '@/lib/error-messages'
import { TEST_OVAL } from '@/race/constants'
import { RaceEngine } from '@/race/RaceEngine'
import type {
  BotDifficulty,
  HandlingMode,
  RaceMode,
  RaceResultEntry,
  VehicleProfileId,
  VehicleSetup,
} from '@/race/types'

type PlayerSelection = {
  name: string
  profileId: VehicleProfileId
  color: string
  handlingMode: HandlingMode
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
  { id: 'formula', name: 'F1', description: 'Leve, veloz e preciso' },
  { id: 'supercar', name: 'Supercarro', description: 'Estável e equilibrado' },
  { id: 'drift', name: 'Drift', description: 'Ágil e solto de traseira' },
]

const colorOptions = ['#2d7dff', '#ff2e88', '#2bd67b', '#ffb82e', '#f0f0fa', '#9c6cff']

const defaultPlayerOne: PlayerSelection = {
  name: 'Piloto 1',
  profileId: 'formula',
  color: colorOptions[0],
  handlingMode: 'normal',
}

const defaultPlayerTwo: PlayerSelection = {
  name: 'Piloto 2',
  profileId: 'drift',
  color: colorOptions[1],
  handlingMode: 'drift',
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

        <div>
          <p className="mb-2 text-[10px] font-extrabold uppercase tracking-[0.17em] text-muted-foreground">
            Acerto inicial
          </p>
          <div className="flex rounded-[10px] border border-border bg-background/45 p-1">
            {(['normal', 'drift'] as const).map((handlingMode) => (
              <button
                aria-pressed={selection.handlingMode === handlingMode}
                className={`rounded-lg px-4 py-2 text-xs font-extrabold uppercase tracking-[0.1em] ${
                  selection.handlingMode === handlingMode
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground'
                }`}
                key={handlingMode}
                onClick={() => onChange({ ...selection, handlingMode })}
                type="button"
              >
                {handlingMode}
              </button>
            ))}
          </div>
        </div>
      </div>
    </fieldset>
  )
}

export function RacePage() {
  const { account, session, startGuestSession } = useAuth()
  const requestedGuest = useRef(false)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [mode, setMode] = useState<RaceMode>('solo')
  const [difficulty, setDifficulty] = useState<BotDifficulty>('normal')
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

  useEffect(() => {
    if (session || requestedGuest.current) return
    requestGuestSession()
  }, [requestGuestSession, session])

  const startRace = useCallback(() => {
    if (!session) return
    const primaryName = account?.displayName ?? playerOne.name
    const racers: VehicleSetup[] = [
      {
        id: 'player-1',
        name: primaryName,
        kind: 'human',
        profileId: playerOne.profileId,
        color: playerOne.color,
        handlingMode: playerOne.handlingMode,
      },
    ]

    if (mode === 'local') {
      racers.push({
        id: 'player-2',
        name: playerTwo.name,
        kind: 'human',
        profileId: playerTwo.profileId,
        color: playerTwo.color,
        handlingMode: playerTwo.handlingMode,
      })
    } else {
      racers.push(
        {
          id: 'bot-apex',
          name: 'Bot Apex',
          kind: 'bot',
          profileId: 'supercar',
          color: '#ffb82e',
          handlingMode: 'normal',
          botDifficulty: difficulty,
        },
        {
          id: 'bot-slide',
          name: 'Bot Slide',
          kind: 'bot',
          profileId: 'drift',
          color: '#2bd67b',
          handlingMode: 'drift',
          botDifficulty: difficulty,
        },
      )
    }

    setResults(null)
    setSubmission({ status: 'idle' })
    setEngine(
      new RaceEngine({ mode, racers, lapCount: 1, maximumRaceSeconds: 60 }),
    )
  }, [account?.displayName, difficulty, mode, playerOne, playerTwo, session])

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
        const authenticatedUserId =
          session.role === 'user' ? (account?.id ?? session.subject ?? null) : null
        const response = await raceApi.submitLocalResult(
          {
            trackId: TEST_OVAL.trackId,
            trackCatalogVersion: TEST_OVAL.trackCatalogVersion,
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
      <AppShell moduleLabel="Módulo 02 // Parte 2a">
        <RaceCanvas
          engine={engine}
          mode={mode}
          onAbort={() => setEngine(null)}
          onFinished={finishRace}
          playerOneMode={playerOne.handlingMode}
          playerTwoMode={playerTwo.handlingMode}
        />
      </AppShell>
    )
  }

  if (results) {
    return (
      <AppShell moduleLabel="Módulo 02 // Parte 2a">
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
    <AppShell moduleLabel="Módulo 02 // Parte 2a">
      <section className="space-y-7">
        <header className="max-w-3xl">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.22em] text-info">
            Laboratório de pista
          </p>
          <h1 className="display-heading mt-3 text-6xl sm:text-8xl">Motor local</h1>
          <p className="mt-5 max-w-2xl leading-7 text-muted-foreground">
            Uma volta no oval técnico para validar passo fixo, superfícies, drift,
            colisões, bots e dois jogadores no mesmo teclado.
          </p>
        </header>

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
            Geometria temporária vinculada ao catálogo v1; as 24 pistas chegam na Parte 2b.
          </div>
          <Button disabled={!session} onClick={startRace} size="lg">
            {session ? <Play aria-hidden="true" className="size-4" /> : <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />}
            {session ? 'Largar' : 'Preparando sessão'}
          </Button>
        </div>
      </section>
    </AppShell>
  )
}
