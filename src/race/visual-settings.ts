export type TimeOfDayPreset = 'day' | 'sunset' | 'night'
export type GraphicsQuality = 'low' | 'medium' | 'high'

export const DEFAULT_GRAPHICS_QUALITY: GraphicsQuality = 'medium'

export const AMBIENT_PARTICLE_BUDGET: Record<GraphicsQuality, number> = {
  low: 24,
  medium: 48,
  high: 80,
}

export const HEADLIGHT_VISUAL_SETTINGS = {
  widthToLengthRatio: 0.22,
  startHalfWidthToVehicleLengthRatio: 0.055,
  colorStops: [
    { offset: 0, color: 'rgba(255, 244, 196, 0.18)' },
    { offset: 0.55, color: 'rgba(255, 236, 174, 0.07)' },
    { offset: 1, color: 'rgba(255, 229, 158, 0)' },
  ],
} as const

export const VEHICLE_SHADOW_SETTINGS: Record<
  TimeOfDayPreset,
  {
    worldAngleRadians: number
    distanceToWidthRatio: number
    opacity: number
  }
> = {
  day: {
    worldAngleRadians: Math.PI * 0.7,
    distanceToWidthRatio: 0.18,
    opacity: 0.22,
  },
  sunset: {
    worldAngleRadians: Math.PI * 0.18,
    distanceToWidthRatio: 0.38,
    opacity: 0.28,
  },
  night: {
    worldAngleRadians: Math.PI * 0.5,
    distanceToWidthRatio: 0.1,
    opacity: 0.16,
  },
}
