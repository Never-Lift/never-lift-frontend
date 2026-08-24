import { useEffect, useRef } from 'react'

import { cn } from '@/lib/utils'
import { PHYSICS_CONSTANTS } from '@/race/constants'
import { drawVehicleVisual } from '@/race/vehicle-visuals'

export type VehiclePreviewProps = {
  color: string
  className?: string
  label?: string
}

export function VehiclePreview({
  color,
  className,
  label,
}: VehiclePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const renderPreview = () => {
      const context = canvas.getContext('2d')
      if (!context) return

      const bounds = canvas.getBoundingClientRect()
      const width = Math.max(1, bounds.width || canvas.clientWidth || 320)
      const height = Math.max(1, bounds.height || canvas.clientHeight || 160)
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
      const pixelWidth = Math.round(width * pixelRatio)
      const pixelHeight = Math.round(height * pixelRatio)

      if (canvas.width !== pixelWidth) canvas.width = pixelWidth
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight

      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      context.clearRect(0, 0, width, height)

      const profile = PHYSICS_CONSTANTS.vehicleVisual
      const naturalRatio = profile.lengthMeters / profile.widthMeters
      const vehicleLength = Math.min(width * 0.72, height * 0.7 * naturalRatio)

      drawVehicleVisual(context, {
        color,
        x: width * 0.5,
        y: height * 0.5,
        angleRadians: -Math.PI / 15,
        length: vehicleLength,
        width: vehicleLength / naturalRatio,
        detail: 'preview',
      })
    }

    renderPreview()
    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(renderPreview)
    resizeObserver?.observe(canvas)
    window.addEventListener('resize', renderPreview)

    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', renderPreview)
    }
  }, [color])

  return (
    <div
      className={cn(
        'relative min-h-24 overflow-hidden rounded-xl border border-border/80 bg-[radial-gradient(circle_at_65%_35%,rgb(45_125_255/0.14),transparent_48%),linear-gradient(145deg,rgb(13_22_34/0.96),rgb(5_10_17/0.98))]',
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-25 [background-image:linear-gradient(rgb(138_157_180/0.12)_1px,transparent_1px),linear-gradient(90deg,rgb(138_157_180/0.12)_1px,transparent_1px)] [background-size:20px_20px]"
      />
      <canvas
        aria-label={label ?? 'Prévia do carro F1'}
        className="absolute inset-0 size-full"
        ref={canvasRef}
        role="img"
      />
    </div>
  )
}
