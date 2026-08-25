import {
  SURFACE_DYNAMICS,
  TIRE_MODEL,
} from '@/race/constants'
import { clamp } from '@/race/math'
import type { SurfaceId } from '@/race/types'

export type AxleTireForceInput = {
  normalLoadNewtons: number
  referenceLoadNewtons: number
  slipAngleRadians: number
  longitudinalForceDemandNewtons: number
  corneringStiffnessNewtonsPerRadian: number
  surface: SurfaceId
}

export type AxleTireForce = {
  longitudinalNewtons: number
  lateralNewtons: number
  peakForceNewtons: number
  utilization: number
  longitudinalSaturated: boolean
  lateralSaturated: boolean
}

export function computePeakTireForce(
  normalLoadNewtons: number,
  referenceLoadNewtons: number,
  surfaceId: SurfaceId,
) {
  const surface = SURFACE_DYNAMICS[surfaceId]
  const load = Math.max(0, normalLoadNewtons)
  const referenceLoad = Math.max(Number.EPSILON, referenceLoadNewtons)
  return (
    TIRE_MODEL.peakFrictionCoefficient *
    surface.gripMultiplier *
    referenceLoad *
    (load / referenceLoad) ** TIRE_MODEL.loadSensitivityExponent
  )
}

export function computeLongitudinalForceFromSlip(
  slipRatio: number,
  peakForceNewtons: number,
) {
  if (peakForceNewtons <= Number.EPSILON) return 0
  return (
    peakForceNewtons *
    Math.tanh(
      (TIRE_MODEL.longitudinalStiffnessNewtonsPerSlip * slipRatio) /
        peakForceNewtons,
    )
  )
}

/**
 * Saturating axle model with a shared friction circle. It deliberately avoids
 * piecewise "drift" states: loss of grip follows continuously from demand.
 */
export function computeAxleTireForce(
  input: AxleTireForceInput,
): AxleTireForce {
  const surface = SURFACE_DYNAMICS[input.surface]
  const peakForce = computePeakTireForce(
    input.normalLoadNewtons,
    input.referenceLoadNewtons,
    input.surface,
  )
  if (peakForce <= Number.EPSILON) {
    return {
      longitudinalNewtons: 0,
      lateralNewtons: 0,
      peakForceNewtons: 0,
      utilization: 0,
      longitudinalSaturated: input.longitudinalForceDemandNewtons !== 0,
      lateralSaturated: input.slipAngleRadians !== 0,
    }
  }

  const corneringStiffness =
    input.corneringStiffnessNewtonsPerRadian *
    surface.corneringStiffnessMultiplier
  const pureLateral =
    -peakForce *
    Math.tanh(
      (corneringStiffness * input.slipAngleRadians) / peakForce,
    )
  const normalizedLongitudinal =
    input.longitudinalForceDemandNewtons / peakForce
  const normalizedLateral = pureLateral / peakForce
  const combinedDemand = Math.hypot(
    normalizedLongitudinal,
    normalizedLateral,
  )
  const combinedScale = combinedDemand > 1 ? 1 / combinedDemand : 1

  return {
    longitudinalNewtons:
      input.longitudinalForceDemandNewtons * combinedScale,
    lateralNewtons: pureLateral * combinedScale,
    peakForceNewtons: peakForce,
    utilization: clamp(combinedDemand, 0, 1),
    longitudinalSaturated: Math.abs(normalizedLongitudinal) > 1,
    lateralSaturated: Math.abs(normalizedLateral) >= 1,
  }
}
