import { Flag, Gauge, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { KeyboardControls } from '@/race/KeyboardControls'
import { LocalRaceSession } from '@/race/LocalRaceSession'
import type { RaceEngine } from '@/race/RaceEngine'
import { RaceRenderer } from '@/race/RaceRenderer'
import type {
  DamageKind,
  HandlingMode,
  RaceMode,
  RaceResultEntry,
} from '@/race/types'
import type { TimeOfDayPreset } from '@/race/visual-settings'

type RaceCanvasProps = {
  engine: RaceEngine
  mode: RaceMode
  timeOfDay: TimeOfDayPreset
  onAbort: () => void
  onFinished: (results: RaceResultEntry[]) => void
}
export type DriverTelemetry = {
  name: string
  lap: number
  speedKph: number
  handlingMode: HandlingMode
  damage: DamageKind
  health: number
}

const damageLabels: Record<DamageKind, string> = {
  none: 'Sem dano mecânico',
  engine: 'Motor: potência levemente reduzida',
  steering: 'Direção: carro puxando para um lado',
  'engine-and-steering': 'Motor e direção danificados',
  'total-loss': 'Perda total: controles desativados',
}

type DriverTelemetryCardProps = {
  driver: DriverTelemetry
  driverIndex: number
  lapCount: number
}

export function DriverTelemetryCard({
  driver,
  driverIndex,
  lapCount,
}: DriverTelemetryCardProps) {
  const isDrift = driver.handlingMode === 'drift'
  const shiftKey = driverIndex === 0 ? 'Shift esquerdo' : 'Shift direito'
  const health = Math.max(0, Math.min(100, Math.round(driver.health)))

  return (
    <article className="surface-panel flex flex-wrap items-center justify-between gap-4 p-4">
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-[10px] border border-primary/30 bg-primary/10 text-primary">
          {driverIndex === 0 ? (
            <Gauge aria-hidden="true" className="size-5" />
          ) : (
            <Flag aria-hidden="true" className="size-5" />
          )}
        </span>
        <div>
          <p className="font-extrabold">{driver.name}</p>
          <p className="text-xs font-semibold text-muted-foreground">
            Volta {driver.lap}/{lapCount}
          </p>
        </div>
      </div>
      <div className="min-w-44 text-right">
        <p className="font-display text-2xl font-black italic">
          {driver.speedKph} km/h
        </p>
        <p
          className={`text-[10px] font-extrabold uppercase tracking-[0.12em] ${
            driver.damage === 'none'
              ? 'text-muted-foreground'
              : 'text-destructive'
          }`}
        >
          {damageLabels[driver.damage]}
        </p>
        <div className="mt-2 flex items-center justify-end gap-2">
          <span className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground">
            Vida {health}%
          </span>
          <span
            aria-label={`Vida do carro: ${health}%`}
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={health}
            className="h-2 w-24 overflow-hidden rounded-full bg-muted"
            role="progressbar"
          >
            <span
              className={`block h-full rounded-full transition-[width] ${
                health > 55
                  ? 'bg-success'
                  : health > 25
                    ? 'bg-warning'
                    : 'bg-destructive'
              }`}
              style={{ width: `${health}%` }}
            />
          </span>
        </div>
        <p
          aria-live="polite"
          className={`mt-2 text-xs font-extrabold uppercase tracking-[0.1em] ${
            isDrift ? 'text-warning' : 'text-info'
          }`}
        >
          Modo da corrida: {isDrift ? 'Drift' : 'Normal'}
        </p>
        <p className="text-[10px] font-semibold text-muted-foreground">
          {shiftKey}: boost (disponível no Módulo 5)
        </p>
      </div>
    </article>
  )
}

export function RaceCanvas({
  engine,
  mode,
  timeOfDay,
  onAbort,
  onFinished,
}: RaceCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const finishedRef = useRef(false)
  const onFinishedRef = useRef(onFinished)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [telemetry, setTelemetry] = useState<DriverTelemetry[]>([])
  const [startAnnouncement, setStartAnnouncement] = useState('Semáforo apagado')

  useEffect(() => {
    onFinishedRef.current = onFinished
  }, [onFinished])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const controls = new KeyboardControls()
    const humanIds = mode === 'local' ? ['player-1', 'player-2'] : ['player-1']
    const session = new LocalRaceSession(engine, humanIds)
    const renderer = new RaceRenderer(canvas, engine.track, {
      timeOfDay,
      quality: 'medium',
    })
    let animationFrame = 0
    let previousTimestamp: number | null = null
    let lastTelemetryUpdate = 0

    function frame(timestamp: number) {
      const deltaSeconds =
        previousTimestamp === null ? 0 : (timestamp - previousTimestamp) / 1000
      previousTimestamp = timestamp

      const frameInputs = {
        'player-1': controls.getPlayerOneInput(mode),
        ...(mode === 'local'
          ? { 'player-2': controls.getPlayerTwoInput() }
          : {}),
      }
      session.advanceFrame(deltaSeconds, frameInputs)
      renderer.render(engine, deltaSeconds, session.getOverlayState())

      if (timestamp - lastTelemetryUpdate >= 150) {
        setElapsedSeconds(engine.getSimulationTimeSeconds())
        setTelemetry(
          humanIds.flatMap((racerId) => {
            const vehicle = engine.getVehicleState(racerId)
            if (!vehicle) return []
            return [
              {
                name: vehicle.name,
                lap: vehicle.currentLap,
                speedKph: Math.round(Math.hypot(vehicle.velocity.x, vehicle.velocity.y) * 3.6),
                handlingMode: vehicle.handlingMode,
                damage: vehicle.damage.kind,
                health: vehicle.damage.health,
              },
            ]
          }),
        )
        const lights = session.getStartLightState()
        const jumpStarts = humanIds.filter(
          (racerId) => session.getPenalty(racerId).throttleLockTicksRemaining > 0,
        )
        setStartAnnouncement(
          jumpStarts.length > 0
            ? `Largada queimada: acelerador bloqueado para ${jumpStarts.join(' e ')}`
            : lights.stage === 'sequence'
              ? `Semáforo: ${lights.redLights} de 5 luzes vermelhas`
              : lights.stage === 'lights-out'
                ? 'Largue!'
                : 'Corrida liberada',
        )
        lastTelemetryUpdate = timestamp
      }

      if (engine.getStatus() === 'finished') {
        if (!finishedRef.current) {
          finishedRef.current = true
          onFinishedRef.current(engine.getResults())
        }
        return
      }
      animationFrame = requestAnimationFrame(frame)
    }

    animationFrame = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(animationFrame)
      controls.destroy()
    }
  }, [engine, mode, timeOfDay])

  return (
    <section aria-label="Corrida local em andamento" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-extrabold uppercase tracking-[0.22em] text-info">
            {engine.track.name} // {engine.lapCount} volta // {timeOfDay === 'day' ? 'Dia' : timeOfDay === 'sunset' ? 'Entardecer' : 'Noite'}
          </p>
          <h1 className="mt-1 font-display text-3xl font-black uppercase italic">
            {mode === 'solo' ? 'Solo contra bots' : 'Duelo local'}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-full border border-border bg-card/80 px-4 py-2 font-mono text-sm font-bold">
            {elapsedSeconds.toFixed(1)}s
          </span>
          <Button onClick={onAbort} size="sm" variant="secondary">
            <RotateCcw aria-hidden="true" className="size-4" />
            Sair do teste
          </Button>
        </div>
      </div>

      <p aria-live="polite" className="sr-only">
        {startAnnouncement}
      </p>

      <div className="overflow-hidden rounded-2xl border border-border bg-[#101b19] shadow-[0_24px_70px_rgb(0_0_0/0.35)]">
        <canvas
          aria-label={`Circuito ${engine.track.name} com carros em movimento`}
          className="block aspect-[4/5] min-h-[30rem] w-full sm:aspect-[16/10] sm:min-h-[22rem]"
          ref={canvasRef}
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {telemetry.map((driver, index) => (
          <DriverTelemetryCard
            driver={driver}
            driverIndex={index}
            key={driver.name}
            lapCount={engine.lapCount}
          />
        ))}
      </div>

      <p className="text-center text-xs font-semibold text-muted-foreground">
        {mode === 'solo'
          ? 'WASD ou setas controlam o carro · Shift será o boost no Módulo 5'
          : 'Jogador 1: WASD + Shift esquerdo · Jogador 2: setas + Shift direito · Shift será o boost no Módulo 5'}
      </p>
    </section>
  )
}
