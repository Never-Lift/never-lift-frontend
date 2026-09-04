import * as PortableMath from '@/race/portable-math'

import type { Vector2 } from '@/race/types'

export function moveTowards(
  current: number,
  target: number,
  maximumDelta: number,
) {
  if (Math.abs(target - current) <= maximumDelta) return target
  return current + Math.sign(target - current) * maximumDelta
}

export function finiteOr(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback
}

export function bodyAxes(angle: number) {
  const forward = { x: PortableMath.cos(angle), y: PortableMath.sin(angle) }
  return {
    forward,
    left: { x: -forward.y, y: forward.x },
  }
}

export function vectorFromBody(
  longitudinal: number,
  lateral: number,
  angle: number,
): Vector2 {
  const { forward, left } = bodyAxes(angle)
  return {
    x: forward.x * longitudinal + left.x * lateral,
    y: forward.y * longitudinal + left.y * lateral,
  }
}
