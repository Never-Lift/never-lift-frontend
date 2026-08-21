export type TimeOfDayPreset = 'day' | 'sunset' | 'night'
export type GraphicsQuality = 'low' | 'medium' | 'high'

export const DEFAULT_GRAPHICS_QUALITY: GraphicsQuality = 'medium'

export const AMBIENT_PARTICLE_BUDGET: Record<GraphicsQuality, number> = {
  low: 24,
  medium: 48,
  high: 80,
}
