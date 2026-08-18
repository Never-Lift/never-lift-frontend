import type { Vector2 } from '@/race/types'

export const TAU = Math.PI * 2

export function add(a: Vector2, b: Vector2): Vector2 {
  return { x: a.x + b.x, y: a.y + b.y }
}
export function subtract(a: Vector2, b: Vector2): Vector2 {
  return { x: a.x - b.x, y: a.y - b.y }
}

export function scale(vector: Vector2, amount: number): Vector2 {
  return { x: vector.x * amount, y: vector.y * amount }
}

export function dot(a: Vector2, b: Vector2): number {
  return a.x * b.x + a.y * b.y
}

export function magnitude(vector: Vector2): number {
  return Math.hypot(vector.x, vector.y)
}

export function normalize(vector: Vector2): Vector2 {
  const length = magnitude(vector)
  if (length <= Number.EPSILON) return { x: 0, y: 0 }
  return scale(vector, 1 / length)
}

export function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

export function lerp(from: number, to: number, alpha: number) {
  return from + (to - from) * alpha
}

export function normalizeAngle(angle: number) {
  let normalized = angle % TAU
  if (normalized < 0) normalized += TAU
  return normalized
}

export function signedAngleDelta(from: number, to: number) {
  let delta = normalizeAngle(to) - normalizeAngle(from)
  if (delta > Math.PI) delta -= TAU
  if (delta < -Math.PI) delta += TAU
  return delta
}

export function lerpAngle(from: number, to: number, alpha: number) {
  return normalizeAngle(from + signedAngleDelta(from, to) * alpha)
}
