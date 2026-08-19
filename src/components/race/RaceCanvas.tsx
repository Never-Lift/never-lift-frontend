import { Flag, Gauge, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { KeyboardControls } from '@/race/KeyboardControls'
import type { RaceEngine } from '@/race/RaceEngine'
import { RaceRenderer } from '@/race/RaceRenderer'
import type {
  DamageKind,
  HandlingMode,
  RaceMode,
  RaceResultEntry,
} from '@/race/types'

type RaceCanvasProps = {
  engine: RaceEngine
  mode: RaceMode
  playerOneMode: HandlingMode
  playerTwoMode: HandlingMode
  onAbort: () => void
  onFinished: (results: RaceResultEntry[]) => void
}
export type DriverTelemetry = {
  name: string
  lap: number
  speedKph: number
  handlingMode: HandlingMode
  damage: DamageKind
}

const damageLabels: Record<DamageKind, string> = {
  none: 'Sem dano mecânico',
  engine: 'Motor: potência reduzida',
  steering: 'Direção: esterço reduzido',
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
        <p
          aria-live="polite"
          className={`mt-2 text-xs font-extrabold uppercase tracking-[0.1em] ${
            isDrift ? 'text-warning' : 'text-info'
          }`}
        >
          {isDrift ? 'Drift ativo' : 'Normal ativo'}
        </p>
        <p className="text-[10px] font-semibold text-muted-foreground">
          {shiftKey} alterna para {isDrift ? 'Normal' : 'Drift'}
        </p>
      </div>
    </article>
  )
}

export function RaceCanvas({
  engine,
  mode,
  playerOneMode,
  playerTwoMode,
  onAbort,
  onFinished,
}: RaceCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const finishedRef = useRef(false)
  const onFinishedRef = useRef(onFinished)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [telemetry, setTelemetry] = useState<DriverTelemetry[]>([])

  useEffect(() => {
    onFinishedRef.current = onFinished
  }, [onFinished])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const controls = new KeyboardControls(playerOneMode, playerTwoMode)
    const renderer = new RaceRenderer(canvas)
    let animationFrame = 0
    let previousTimestamp: number | null = null
    let lastTelemetryUpdate = 0

    function frame(timestamp: number) {
      const deltaSeconds =
        previousTimestamp === null ? 0 : (timestamp - previousTimestamp) / 1000
      previousTimestamp = timestamp

      engine.setInput('player-1', controls.getPlayerOneInput(mode))
      if (mode === 'local') {
        engine.setInput('player-2', controls.getPlayerTwoInput())
      }
      engine.advanceFrame(deltaSeconds)
      renderer.render(engine)

      if (timestamp - lastTelemetryUpdate >= 150) {
        const humanIds = mode === 'local' ? ['player-1', 'player-2'] : ['player-1']
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
              },
            ]
          }),
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
  }, [engine, mode, playerOneMode, playerTwoMode])

  return (
    <section aria-label="Corrida local em andamento" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-extrabold uppercase tracking-[0.22em] text-info">
            Oval técnico // 1 volta
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

      <div className="overflow-hidden rounded-2xl border border-border bg-[#101b19] shadow-[0_24px_70px_rgb(0_0_0/0.35)]">
        <canvas
          aria-label="Pista oval com carros em movimento"
          className="block aspect-[16/10] min-h-[22rem] w-full"
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
          ? 'WASD ou setas controlam o carro · Shift esquerdo alterna Normal/Drift (não é freio de mão)'
          : 'Jogador 1: WASD + Shift esquerdo · Jogador 2: setas + Shift direito · Shift alterna Normal/Drift'}
      </p>
    </section>
  )
}
