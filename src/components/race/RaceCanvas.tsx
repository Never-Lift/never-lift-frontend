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
type DriverTelemetry = {
  name: string
  lap: number
  speedKph: number
  handlingMode: HandlingMode
  damage: DamageKind
}

const damageLabels: Record<DamageKind, string> = {
  none: 'sem dano',
  engine: 'motor (cosmético)',
  steering: 'direção (cosmético)',
  'total-loss': 'perda total (cosmética)',
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
          <article
            className="surface-panel flex flex-wrap items-center justify-between gap-4 p-4"
            key={driver.name}
          >
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-[10px] border border-primary/30 bg-primary/10 text-primary">
                {index === 0 ? (
                  <Gauge aria-hidden="true" className="size-5" />
                ) : (
                  <Flag aria-hidden="true" className="size-5" />
                )}
              </span>
              <div>
                <p className="font-extrabold">{driver.name}</p>
                <p className="text-xs font-semibold text-muted-foreground">
                  Volta {driver.lap}/{engine.lapCount} · {driver.handlingMode}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="font-display text-2xl font-black italic">
                {driver.speedKph} km/h
              </p>
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                {damageLabels[driver.damage]}
              </p>
            </div>
          </article>
        ))}
      </div>

      <p className="text-center text-xs font-semibold text-muted-foreground">
        {mode === 'solo'
          ? 'WASD ou setas controlam o carro · Shift esquerdo alterna normal/drift'
          : 'Jogador 1: WASD + Shift esquerdo · Jogador 2: setas + Shift direito'}
      </p>
    </section>
  )
}
