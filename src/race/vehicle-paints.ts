export const VEHICLE_PAINT_OPTIONS = [
  { id: 'red', label: 'Vermelho', color: '#a84448' },
  { id: 'blue', label: 'Azul', color: '#365f82' },
  { id: 'green', label: 'Verde', color: '#3f704f' },
] as const

export type VehiclePaintColor = (typeof VEHICLE_PAINT_OPTIONS)[number]['color']

export const DEFAULT_VEHICLE_PAINT_COLOR: VehiclePaintColor = '#365f82'
export const SECONDARY_VEHICLE_PAINT_COLOR: VehiclePaintColor = '#a84448'

const LEGACY_PAINT_MIGRATIONS: Readonly<Record<string, VehiclePaintColor>> = {
  '#2d7dff': '#365f82',
  '#31c7ff': '#365f82',
  '#9c6cff': '#365f82',
  '#f0f0fa': '#365f82',
  '#ff2e88': '#a84448',
  '#ff2d8d': '#a84448',
  '#ff4055': '#a84448',
  '#ffb82e': '#a84448',
  '#2bd67b': '#3f704f',
}

export function isVehiclePaintColor(color: string): boolean {
  const normalized = color.trim().toLowerCase()

  return VEHICLE_PAINT_OPTIONS.some((option) => option.color === normalized)
}

export function normalizeVehiclePaintColor(
  color: string | null | undefined,
  fallback: VehiclePaintColor = DEFAULT_VEHICLE_PAINT_COLOR,
): VehiclePaintColor {
  const normalized = color?.trim().toLowerCase()
  if (!normalized) return fallback
  const supportedPaint = VEHICLE_PAINT_OPTIONS.find(
    (option) => option.color === normalized,
  )
  if (supportedPaint) return supportedPaint.color

  return LEGACY_PAINT_MIGRATIONS[normalized] ?? fallback
}

export function getAlternativeVehiclePaintColors(
  color: string | null | undefined,
): VehiclePaintColor[] {
  const selectedColor = normalizeVehiclePaintColor(color)

  return VEHICLE_PAINT_OPTIONS.map((option) => option.color).filter(
    (optionColor) => optionColor !== selectedColor,
  )
}
