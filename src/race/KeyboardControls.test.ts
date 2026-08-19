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
    controls = new KeyboardControls()
    key('keydown', 'KeyW')
    key('keydown', 'ArrowRight')

    expect(controls.getPlayerOneInput('solo')).toMatchObject({
      throttle: 1,
      steer: -1,
      nitro: false,
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
      nitro: false,
    })
  })

  it('reserves each Shift key for the corresponding player nitro input', () => {
    controls = new KeyboardControls()
    key('keydown', 'ShiftLeft')
    key('keydown', 'ShiftRight')

    expect(controls.getPlayerOneInput('local').nitro).toBe(true)
    expect(controls.getPlayerTwoInput().nitro).toBe(true)
  })
})
