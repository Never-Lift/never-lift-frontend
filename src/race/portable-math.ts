/**
 * portable-f64-v1 (physics 2.0.3). Keep operation order identical to PortableMath.java.
 * Range-reduced convergent series use only IEEE-754 arithmetic and correctly rounded
 * sqrt; never the platform's implementation-dependent transcendental functions.
 * This is a physics kernel, not a replacement for Math in camera/rendering/UI code.
 */
const HALF_PI = 1.5707963267948966
const HALF_PI_LOW = 6.123233995736766e-17
const QUARTER_PI = 0.7853981633974483
const QUARTER_PI_LOW = 3.061616997868383e-17
const LN2_HIGH = 0.6931471803691238
const LN2_LOW = 1.9082149292705877e-10
const INVERSE_LN2 = 1.4426950408889634
const bits = new DataView(new ArrayBuffer(8))

function reducedAngle(angle: number) {
  const quadrant = Math.sign(angle) * Math.floor(Math.abs(angle) / HALF_PI + 0.5)
  return { quadrant: ((quadrant % 4) + 4) % 4, remainder: (angle - quadrant * HALF_PI) - quadrant * HALF_PI_LOW }
}

function sineSeries(x: number) {
  const square = -x * x
  let term = x, sum = x
  for (let k = 1; k <= 10; k++) {
    term = term * square / ((2 * k) * (2 * k + 1))
    sum += term
  }
  return sum
}

function cosineSeries(x: number) {
  const square = -x * x
  let term = 1, sum = 1
  for (let k = 1; k <= 10; k++) {
    term = term * square / ((2 * k - 1) * (2 * k))
    sum += term
  }
  return sum
}

export function sin(angle: number): number {
  if (angle === 0) return angle
  if (!Number.isFinite(angle)) return Number.NaN
  const { quadrant, remainder: x } = reducedAngle(angle)
  return quadrant === 0 ? sineSeries(x) : quadrant === 1 ? cosineSeries(x) : quadrant === 2 ? -sineSeries(x) : -cosineSeries(x)
}

export function cos(angle: number): number {
  if (!Number.isFinite(angle)) return Number.NaN
  const { quadrant, remainder: x } = reducedAngle(angle)
  return quadrant === 0 ? cosineSeries(x) : quadrant === 1 ? -sineSeries(x) : quadrant === 2 ? -cosineSeries(x) : sineSeries(x)
}

function atanPositive(value: number) {
  const reciprocal = value > 1
  let x = reciprocal ? 1 / value : value
  const aroundOne = x > 0.41421356237309503
  if (aroundOne) x = (x - 1) / (x + 1)
  const square = -x * x
  let term = x, sum = x
  for (let k = 1; k <= 24; k++) {
    term *= square
    sum += term / (2 * k + 1)
  }
  if (aroundOne) sum = QUARTER_PI + (sum + QUARTER_PI_LOW)
  return reciprocal ? HALF_PI - (sum - HALF_PI_LOW) : sum
}

export function atan2(y: number, x: number): number {
  if (Number.isNaN(x) || Number.isNaN(y)) return Number.NaN
  const negativeX = x < 0 || Object.is(x, -0)
  const negativeY = y < 0 || Object.is(y, -0)
  let angle: number
  if (y === 0) angle = negativeX ? Math.PI : 0
  else if (x === 0) angle = HALF_PI
  else if (!Number.isFinite(x) && !Number.isFinite(y)) angle = negativeX ? 3 * QUARTER_PI : QUARTER_PI
  else {
    angle = atanPositive(Math.abs(y / x))
    if (negativeX) angle = Math.PI - angle
  }
  return negativeY ? -angle : angle
}

function powerOfTwo(exponent: number) {
  bits.setUint32(0, (exponent + 1023) * 0x100000)
  bits.setUint32(4, 0)
  return bits.getFloat64(0)
}

function exponentialMinusOne(x: number) {
  if (x === 0) return x
  const exponent = Math.floor(x * INVERSE_LN2 + 0.5)
  const remainder = (x - exponent * LN2_HIGH) - exponent * LN2_LOW
  let term = remainder, sum = remainder
  for (let k = 2; k <= 18; k++) {
    term = term * remainder / k
    sum += term
  }
  if (exponent === 0) return sum
  const factor = powerOfTwo(exponent)
  return (factor - 1) + factor * sum
}

export function tanh(value: number): number {
  if (Number.isNaN(value) || value === 0) return value
  const x = Math.abs(value)
  if (x >= 22) return Math.sign(value)
  const t = exponentialMinusOne(x >= 1 ? 2 * x : -2 * x)
  const result = x >= 1 ? 1 - 2 / (t + 2) : -t / (t + 2)
  return value < 0 ? -result : result
}

function logarithm(x: number) {
  let correction = 0
  if (x < 2.2250738585072014e-308) { x *= 18014398509481984; correction = -54 }
  bits.setFloat64(0, x)
  const high = bits.getUint32(0)
  let exponent = (high >>> 20) - 1023 + correction
  bits.setUint32(0, (high & 0xfffff) | 0x3ff00000)
  let mantissa = bits.getFloat64(0)
  if (mantissa > 1.4142135623730951) { mantissa /= 2; exponent++ }
  const z = (mantissa - 1) / (mantissa + 1), square = z * z
  let term = z, sum = z
  for (let k = 1; k <= 16; k++) { term *= square; sum += term / (2 * k + 1) }
  return exponent * LN2_HIGH + (2 * sum + exponent * LN2_LOW)
}

/** Physics only uses nonnegative bases (load ratios and bot speed factors). */
export function pow(base: number, exponent: number): number {
  if (exponent === 0) return 1
  if (Number.isNaN(base) || Number.isNaN(exponent) || base < 0) return Number.NaN
  if (base === 0) return exponent > 0 ? 0 : Number.POSITIVE_INFINITY
  if (base === 1) return 1
  if (base === Number.POSITIVE_INFINITY) return exponent > 0 ? base : 0
  if (Number.isSafeInteger(exponent)) {
    let count = Math.abs(exponent), factor = exponent < 0 ? 1 / base : base, result = 1
    while (count > 0) {
      if (count % 2 === 1) result *= factor
      count = Math.floor(count / 2)
      if (count > 0) factor *= factor
    }
    return result
  }
  const x = exponent * logarithm(base)
  if (x > 709.782712893384) return Number.POSITIVE_INFINITY
  if (x < -745.1332191019411) return 0
  const scale = Math.floor(x * INVERSE_LN2 + 0.5)
  const remainder = (x - scale * LN2_HIGH) - scale * LN2_LOW
  let term = remainder, sum = remainder
  for (let k = 2; k <= 18; k++) { term = term * remainder / k; sum += term }
  if (scale > 1023) return ((1 + sum) * powerOfTwo(1023)) * powerOfTwo(scale - 1023)
  if (scale < -1022) return ((1 + sum) * powerOfTwo(-1022)) * powerOfTwo(scale + 1022)
  return (1 + sum) * powerOfTwo(scale)
}

export function hypot(x: number, y: number): number {
  if (Math.abs(x) === Number.POSITIVE_INFINITY || Math.abs(y) === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY
  const scale = Math.max(Math.abs(x), Math.abs(y))
  if (scale === 0) return 0
  const a = x / scale, b = y / scale
  return scale * Math.sqrt(a * a + b * b)
}
