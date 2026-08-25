import { describe, expect, it } from 'vitest'

import {
  DEFAULT_VEHICLE_PAINT_COLOR,
  getAlternativeVehiclePaintColors,
  isVehiclePaintColor,
  normalizeVehiclePaintColor,
  SECONDARY_VEHICLE_PAINT_COLOR,
  VEHICLE_PAINT_OPTIONS,
} from '@/race/vehicle-paints'

describe('vehicle paint presets', () => {
  it('offers only restrained red, blue and green paints', () => {
    expect(VEHICLE_PAINT_OPTIONS).toEqual([
      { id: 'red', label: 'Vermelho', color: '#a84448' },
      { id: 'blue', label: 'Azul', color: '#365f82' },
      { id: 'green', label: 'Verde', color: '#3f704f' },
    ])
    expect(DEFAULT_VEHICLE_PAINT_COLOR).toBe('#365f82')
    expect(SECONDARY_VEHICLE_PAINT_COLOR).toBe('#a84448')
  })

  it('recognizes preset colors case-insensitively without accepting arbitrary paint', () => {
    expect(isVehiclePaintColor(' #A84448 ')).toBe(true)
    expect(isVehiclePaintColor('#365f82')).toBe(true)
    expect(isVehiclePaintColor('#3f704f')).toBe(true)
    expect(isVehiclePaintColor('#ff2e88')).toBe(false)
    expect(isVehiclePaintColor('#ffffff')).toBe(false)
  })

  it('migrates every previous setup color to the closest supported family', () => {
    expect(normalizeVehiclePaintColor('#2d7dff')).toBe('#365f82')
    expect(normalizeVehiclePaintColor('#9C6CFF')).toBe('#365f82')
    expect(normalizeVehiclePaintColor('#ff2e88')).toBe('#a84448')
    expect(normalizeVehiclePaintColor('#ffb82e')).toBe('#a84448')
    expect(normalizeVehiclePaintColor('#2bd67b')).toBe('#3f704f')
  })

  it('falls back safely when a persisted or remote value is unknown', () => {
    expect(normalizeVehiclePaintColor(undefined)).toBe('#365f82')
    expect(normalizeVehiclePaintColor('#123456')).toBe('#365f82')
    expect(normalizeVehiclePaintColor('#123456', '#3f704f')).toBe('#3f704f')
  })

  it.each(VEHICLE_PAINT_OPTIONS)(
    'reserves the two other paints for rivals when the player chooses $label',
    ({ color }) => {
      const alternatives = getAlternativeVehiclePaintColors(color)

      expect(alternatives).toHaveLength(2)
      expect(new Set(alternatives).size).toBe(2)
      expect(alternatives).not.toContain(color)
      expect(alternatives).toEqual(
        VEHICLE_PAINT_OPTIONS.map((option) => option.color).filter(
          (optionColor) => optionColor !== color,
        ),
      )
    },
  )
})
