import * as PortableMath from '@/race/portable-math'

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

/**
 * Two-dimensional scalar cross product. The sign follows the project's
 * counter-clockwise-positive angle convention.
 */
export function cross(a: Vector2, b: Vector2): number {
  return a.x * b.y - a.y * b.x
}

/** Returns the linear velocity at a point caused by an angular velocity. */
export function crossScalarVector(
  angularVelocity: number,
  radius: Vector2,
): Vector2 {
  return {
    x: -angularVelocity * radius.y,
    y: angularVelocity * radius.x,
  }
}

export function perpendicularLeft(vector: Vector2): Vector2 {
  return { x: -vector.y, y: vector.x }
}

export function rotate(vector: Vector2, angle: number): Vector2 {
  const cosine = PortableMath.cos(angle)
  const sine = PortableMath.sin(angle)
  return {
    x: vector.x * cosine - vector.y * sine,
    y: vector.x * sine + vector.y * cosine,
  }
}

export function distanceSquared(a: Vector2, b: Vector2): number {
  const deltaX = b.x - a.x
  const deltaY = b.y - a.y
  return deltaX * deltaX + deltaY * deltaY
}

export function magnitude(vector: Vector2): number {
  return PortableMath.hypot(vector.x, vector.y)
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

export function normalizeSignedAngle(angle: number) {
  if (!Number.isFinite(angle)) return angle
  const magnitudeWithinTurn = Math.abs(angle) % TAU
  const signedWithinTurn = Math.sign(angle) * magnitudeWithinTurn
  if (signedWithinTurn > Math.PI) return signedWithinTurn - TAU
  if (signedWithinTurn < -Math.PI) return signedWithinTurn + TAU
  return signedWithinTurn
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
