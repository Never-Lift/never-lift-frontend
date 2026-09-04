import { describe, expect, it } from 'vitest'

import { raceGraphicsSettings } from './visual-settings'

describe('race graphics workload profiles', () => {
  it('keeps the normal solo profile until a dense grid is selected', () => {
    expect(raceGraphicsSettings('solo', 9)).toEqual({ quality: 'medium', pixelRatioCap: 1.5 })
    expect(raceGraphicsSettings('solo', 10)).toEqual({ quality: 'low', pixelRatioCap: 1 })
    expect(raceGraphicsSettings('solo', 22)).toEqual({ quality: 'low', pixelRatioCap: 1 })
  })

  it('limits raster work for two cameras even without bots', () => {
    expect(raceGraphicsSettings('local', 2)).toEqual({ quality: 'low', pixelRatioCap: 1 })
    expect(raceGraphicsSettings('local', 22)).toEqual({ quality: 'low', pixelRatioCap: 1 })
  })
})
