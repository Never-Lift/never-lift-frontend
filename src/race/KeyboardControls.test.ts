import { afterEach, describe, expect, it } from 'vitest'

import {
  ALTERNATIVE_LOCAL_KEYBOARD_BINDINGS,
  KeyboardControls,
} from '@/race/KeyboardControls'

let controls: KeyboardControls | null = null

afterEach(() => {
  controls?.destroy()
  controls = null
})
function key(type: 'keydown' | 'keyup', code: string) {
  const event = new KeyboardEvent(type, {
    code,
    bubbles: true,
    cancelable: true,
  })
  window.dispatchEvent(event)
  return event
}

describe('KeyboardControls', () => {
  it('accepts WASD and arrows simultaneously for a solo player', () => {
    controls = new KeyboardControls()
    key('keydown', 'KeyW')
    key('keydown', 'ArrowRight')

    expect(controls.getPlayerOneInput('solo')).toMatchObject({
      throttle: 1,
      steer: -1,
    })
  })

  it('keeps distinct mappings for two local players', () => {
    controls = new KeyboardControls()
    key('keydown', 'KeyW')
    key('keydown', 'ArrowLeft')

    expect(controls.getPlayerOneInput('local')).toMatchObject({
      throttle: 1,
      steer: 0,
    })
    expect(controls.getPlayerTwoInput()).toMatchObject({
      throttle: 0,
      steer: 1,
    })
  })

  it('does not capture Shift or map it to a driving action', () => {
    controls = new KeyboardControls()
    const leftShift = key('keydown', 'ShiftLeft')
    const rightShift = key('keydown', 'ShiftRight')

    expect(leftShift.defaultPrevented).toBe(false)
    expect(rightShift.defaultPrevented).toBe(false)
    expect(controls.getPlayerOneInput('local')).toEqual({
      throttle: 0,
      brake: 0,
      steer: 0,
    })
    expect(controls.getPlayerTwoInput()).toEqual({
      throttle: 0,
      brake: 0,
      steer: 0,
    })
  })

  it('uses Space only as the hold-to-identify shortcut', () => {
    controls = new KeyboardControls()
    const space = key('keydown', 'Space')

    expect(space.defaultPrevented).toBe(true)
    expect(controls.isIdentificationHeld()).toBe(true)
    expect(controls.getPlayerOneInput('local')).toEqual({
      throttle: 0,
      brake: 0,
      steer: 0,
    })

    key('keyup', 'Space')
    expect(controls.isIdentificationHeld()).toBe(false)
  })

  it('keeps every independent key when both local players use multiple controls', () => {
    controls = new KeyboardControls()
    for (const code of ['KeyW', 'KeyA', 'ArrowUp', 'ArrowRight']) {
      key('keydown', code)
    }

    expect(controls.getPressedCodes()).toEqual([
      'ArrowRight',
      'ArrowUp',
      'KeyA',
      'KeyW',
    ])
    expect(controls.getPlayerOneInput('local')).toEqual({
      throttle: 1,
      brake: 0,
      steer: 1,
    })
    expect(controls.getPlayerTwoInput()).toEqual({
      throttle: 1,
      brake: 0,
      steer: -1,
    })

    key('keyup', 'KeyA')
    expect(controls.getPlayerOneInput('local')).toMatchObject({
      throttle: 1,
      steer: 0,
    })
    expect(controls.getPlayerTwoInput()).toMatchObject({
      throttle: 1,
      steer: -1,
    })
  })

  it('supports an alternative local layout without sharing state between players', () => {
    controls = new KeyboardControls(window, ALTERNATIVE_LOCAL_KEYBOARD_BINDINGS)
    key('keydown', 'KeyW')
    key('keydown', 'KeyI')
    key('keydown', 'KeyJ')

    expect(controls.getPlayerOneInput('local')).toEqual({
      throttle: 1,
      brake: 0,
      steer: 0,
    })
    expect(controls.getPlayerTwoInput()).toEqual({
      throttle: 1,
      brake: 0,
      steer: 1,
    })
  })

  it('accepts the built-in IJKL fallback for player two', () => {
    controls = new KeyboardControls()
    key('keydown', 'KeyI')
    key('keydown', 'KeyL')

    expect(controls.getPlayerTwoInput()).toEqual({
      throttle: 1,
      brake: 0,
      steer: -1,
    })
  })

  it('clears held keys when the window loses focus or visibility', () => {
    controls = new KeyboardControls()
    key('keydown', 'KeyW')
    window.dispatchEvent(new Event('blur'))
    expect(controls.getPlayerOneInput('local')).toEqual({
      throttle: 0,
      brake: 0,
      steer: 0,
    })

    key('keydown', 'KeyW')
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(controls.getPressedCodes()).toEqual([])
  })
})
