import { afterEach, describe, expect, it } from 'vitest'

import { KeyboardControls } from '@/race/KeyboardControls'

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
})
