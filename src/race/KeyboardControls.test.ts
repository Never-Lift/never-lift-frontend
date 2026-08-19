import { afterEach, describe, expect, it } from 'vitest'

import { KeyboardControls } from '@/race/KeyboardControls'

let controls: KeyboardControls | null = null

afterEach(() => {
  controls?.destroy()
  controls = null
})
function key(type: 'keydown' | 'keyup', code: string) {
  window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }))
}

describe('KeyboardControls', () => {
  it('accepts WASD and arrows simultaneously for a solo player', () => {
    controls = new KeyboardControls('normal', 'normal')
    key('keydown', 'KeyW')
    key('keydown', 'ArrowRight')

    expect(controls.getPlayerOneInput('solo')).toMatchObject({
      throttle: 1,
      steer: 1,
    })
  })

  it('keeps distinct mappings for two local players', () => {
    controls = new KeyboardControls('normal', 'drift')
    key('keydown', 'KeyW')
    key('keydown', 'ArrowLeft')

    expect(controls.getPlayerOneInput('local')).toMatchObject({
      throttle: 1,
      steer: 0,
    })
    expect(controls.getPlayerTwoInput()).toMatchObject({
      throttle: 0,
      steer: -1,
      handlingMode: 'drift',
    })
  })

  it('toggles normal and drift modes independently', () => {
    controls = new KeyboardControls('normal', 'drift')
    key('keydown', 'ShiftLeft')
    key('keyup', 'ShiftLeft')
    key('keydown', 'ShiftRight')

    expect(controls.getPlayerOneInput('local').handlingMode).toBe('drift')
    expect(controls.getPlayerTwoInput().handlingMode).toBe('normal')
  })
})
