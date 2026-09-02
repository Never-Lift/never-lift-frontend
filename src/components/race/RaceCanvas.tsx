import { DoorOpen, Flag, Gauge, Keyboard } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Brand } from '@/components/Brand'
import { KeyboardControls } from '@/race/KeyboardControls'
import { LocalRaceSession } from '@/race/LocalRaceSession'
import type { RaceEngine } from '@/race/RaceEngine'
import { RaceRenderer } from '@/race/RaceRenderer'
import type {
  DamageKind,
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
      splitScreenAspectRatio: () => window.innerWidth / window.innerHeight,
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
      renderer.render(
        engine,
        deltaSeconds,
        session.getOverlayState(controls.isIdentificationHeld()),
      )

      if (timestamp - lastTelemetryUpdate >= 150) {
        setTelemetry(
          humanIds.flatMap((racerId) => {
            const vehicle = engine.getVehicleState(racerId)
            if (!vehicle) return []
            return [
              {
                name: vehicle.name,
                lap: vehicle.currentLap,
                speedKph: Math.round(Math.hypot(vehicle.velocity.x, vehicle.velocity.y) * 3.6),
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
    <section
      aria-label="Corrida local em andamento"
      className="fixed inset-0 z-50 h-dvh min-h-0 overflow-hidden bg-background"
    >
      <p aria-live="polite" className="sr-only">
        {startAnnouncement}
      </p>

      <div className="absolute inset-0 overflow-hidden bg-[#101b19]">
        <canvas
          aria-label={`Circuito ${engine.track.name} com carros em movimento`}
          className="absolute inset-0 block size-full"
          ref={canvasRef}
        />
        <div
          className={
            mode === 'local'
              ? 'race-telemetry-grid pointer-events-none absolute inset-0 z-10 grid'
              : 'pointer-events-none absolute inset-0 z-10 grid'
          }
        >
          {telemetry.map((driver, index) => (
            <div className="flex min-h-0 items-end p-3 sm:p-4" key={driver.name}>
              <div className="w-full max-w-sm">
                <DriverTelemetryCard
                  driver={driver}
                  driverIndex={index}
                  lapCount={engine.lapCount}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="pointer-events-none absolute left-3 top-3 z-20 flex items-start gap-3 sm:left-4 sm:top-4">
        <Brand compact />
        <p className="inline-flex items-center gap-2 rounded-lg border border-border/70 bg-background/76 px-2.5 py-2 text-[10px] font-bold text-muted-foreground backdrop-blur-md">
          <Keyboard aria-hidden="true" className="size-3.5 text-info" />
          Segure <kbd className="text-foreground">ESPAÇO</kbd> para identificar pilotos
        </p>
      </div>

      <Button
        aria-label="Sair da corrida"
        className="absolute bottom-4 right-4 z-30 size-11 shadow-xl"
        onClick={onAbort}
        size="icon"
        title="Sair da corrida"
        type="button"
        variant="secondary"
      >
        <DoorOpen aria-hidden="true" className="size-5" />
      </Button>
    </section>
  )
}
