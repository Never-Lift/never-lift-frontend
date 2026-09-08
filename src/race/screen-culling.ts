import type { Viewport } from './camera'
import type { Vector2 } from './types'

/** Conservative screen-space rejection only; never clips/truncates a path. */
export function screenBoundsVisible(minX: number, minY: number, maxX: number, maxY: number,
  viewport: Viewport | undefined, padding = 0) {
  if (!viewport) return true
  // Preserve legacy drawing for degenerate data rather than falsely hiding it.
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) ||
    !Number.isFinite(maxY) || !Number.isFinite(padding)) return true
  return !(maxX + padding < viewport.x || minX - padding > viewport.x + viewport.width ||
    maxY + padding < viewport.y || minY - padding > viewport.y + viewport.height)
}

export function screenPathVisible(points: readonly Vector2[], viewport: Viewport | undefined, padding = 0) {
  if (!viewport || points.length === 0) return true
  let minX = points[0].x, maxX = minX, minY = points[0].y, maxY = minY
  for (let index = 1; index < points.length; index++) {
    minX = Math.min(minX, points[index].x); maxX = Math.max(maxX, points[index].x)
    minY = Math.min(minY, points[index].y); maxY = Math.max(maxY, points[index].y)
  }
  return screenBoundsVisible(minX, minY, maxX, maxY, viewport, padding)
}
