import { afterEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_KEYBOARD_CONTROL_PREFERENCES,
  loadKeyboardControlPreferences,
  normalizeKeyboardControlPreferences,
  saveKeyboardControlPreferences,
} from '@/race/control-schemes'

afterEach(() => {
  window.localStorage.clear()
})

describe('keyboard control scheme preferences', () => {
  it('loads defaults when no valid preference exists', () => {
    expect(loadKeyboardControlPreferences()).toEqual(
      DEFAULT_KEYBOARD_CONTROL_PREFERENCES,
    )
    window.localStorage.setItem('never-lift.keyboard-controls.v1', '{invalid')
    expect(loadKeyboardControlPreferences()).toEqual(
      DEFAULT_KEYBOARD_CONTROL_PREFERENCES,
    )
  })

  it('persists the primary choice for solo and future online races', () => {
    saveKeyboardControlPreferences({
      version: 1,
      primary: 'ijkl',
      secondary: 'arrows',
    })

    expect(loadKeyboardControlPreferences()).toEqual({
      version: 1,
      primary: 'ijkl',
      secondary: 'arrows',
    })
  })

  it('repairs duplicate or unknown local groups safely', () => {
    expect(
      normalizeKeyboardControlPreferences({
        version: 1,
        primary: 'arrows',
        secondary: 'arrows',
      }),
    ).toEqual({ version: 1, primary: 'arrows', secondary: 'wasd' })

    expect(
      normalizeKeyboardControlPreferences({
        version: 1,
        primary: 'unknown' as never,
        secondary: 'unknown' as never,
      }),
    ).toEqual(DEFAULT_KEYBOARD_CONTROL_PREFERENCES)
  })
})
