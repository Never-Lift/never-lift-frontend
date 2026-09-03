import { clamp } from '@/race/math'
import type { DriverInput, RaceMode } from '@/race/types'

const CONTROL_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'KeyI',
  'KeyJ',
  'KeyK',
  'KeyL',
  'Space',
])

const PLAYER_TWO_ALTERNATIVE = {
  throttle: 'KeyI',
  brake: 'KeyK',
  left: 'KeyJ',
  right: 'KeyL',
} as const

export type KeyboardBindings = {
  playerOne: {
    throttle: string
    brake: string
    left: string
    right: string
  }
  playerTwo: {
    throttle: string
    brake: string
    left: string
    right: string
  }
}

export const DEFAULT_KEYBOARD_BINDINGS: KeyboardBindings = {
  playerOne: {
    throttle: 'KeyW',
    brake: 'KeyS',
    left: 'KeyA',
    right: 'KeyD',
  },
  playerTwo: {
    throttle: 'ArrowUp',
    brake: 'ArrowDown',
    left: 'ArrowLeft',
    right: 'ArrowRight',
  },
}

/** A second local layout avoids relying on the arrow-key matrix of a keyboard. */
export const ALTERNATIVE_LOCAL_KEYBOARD_BINDINGS: KeyboardBindings = {
  playerOne: DEFAULT_KEYBOARD_BINDINGS.playerOne,
  playerTwo: {
    throttle: 'KeyI',
    brake: 'KeyK',
    left: 'KeyJ',
    right: 'KeyL',
  },
}

export class KeyboardControls {
  private readonly pressed = new Set<string>()
  private readonly target: Window
  private bindings: KeyboardBindings

  constructor(
    target: Window = window,
    bindings: KeyboardBindings = DEFAULT_KEYBOARD_BINDINGS,
  ) {
    this.target = target
    this.bindings = bindings
    target.addEventListener('keydown', this.handleKeyDown)
    target.addEventListener('keyup', this.handleKeyUp)
    target.addEventListener('blur', this.handleBlur)
    target.document.addEventListener('visibilitychange', this.handleVisibilityChange)
  }

  private handleKeyDown = (event: KeyboardEvent) => {
    if (!CONTROL_KEYS.has(event.code)) return
    event.preventDefault()
    this.pressed.add(event.code)
  }

  private handleKeyUp = (event: KeyboardEvent) => {
    if (!CONTROL_KEYS.has(event.code)) return
    event.preventDefault()
    this.pressed.delete(event.code)
  }

  private handleBlur = () => {
    this.pressed.clear()
  }

  private handleVisibilityChange = () => {
    if (this.target.document.visibilityState !== 'visible') {
      this.pressed.clear()
    }
  }

  setBindings(bindings: KeyboardBindings) {
    this.bindings = bindings
    this.pressed.clear()
  }

  getPressedCodes() {
    return [...this.pressed].sort()
  }

  isIdentificationHeld() {
    return this.isPressed('Space')
  }

  getPlayerOneInput(mode: RaceMode): DriverInput {
    const includeArrows = mode === 'solo'
    return {
      throttle:
        this.isPressed(this.bindings.playerOne.throttle) ||
        (includeArrows && this.isPressed(this.bindings.playerTwo.throttle))
          ? 1
          : 0,
      brake:
        this.isPressed(this.bindings.playerOne.brake) ||
        (includeArrows && this.isPressed(this.bindings.playerTwo.brake))
          ? 1
          : 0,
      steer: clamp(
        (this.isPressed(this.bindings.playerOne.left) ||
        (includeArrows && this.isPressed(this.bindings.playerTwo.left))
          ? 1
          : 0) -
          (this.isPressed(this.bindings.playerOne.right) ||
          (includeArrows && this.isPressed(this.bindings.playerTwo.right))
            ? 1
            : 0),
        -1,
        1,
      ),
    }
  }

  getPlayerTwoInput(): DriverInput {
    return {
      throttle:
        this.isPressed(this.bindings.playerTwo.throttle) ||
        this.isPressed(PLAYER_TWO_ALTERNATIVE.throttle)
          ? 1
          : 0,
      brake:
        this.isPressed(this.bindings.playerTwo.brake) ||
        this.isPressed(PLAYER_TWO_ALTERNATIVE.brake)
          ? 1
          : 0,
      steer: clamp(
        (this.isPressed(this.bindings.playerTwo.left) ||
        this.isPressed(PLAYER_TWO_ALTERNATIVE.left)
          ? 1
          : 0) -
          (this.isPressed(this.bindings.playerTwo.right) ||
          this.isPressed(PLAYER_TWO_ALTERNATIVE.right)
            ? 1
            : 0),
        -1,
        1,
      ),
    }
  }

  private isPressed(code: string) {
    return this.pressed.has(code)
  }

  destroy() {
    this.pressed.clear()
    this.target.removeEventListener('keydown', this.handleKeyDown)
    this.target.removeEventListener('keyup', this.handleKeyUp)
    this.target.removeEventListener('blur', this.handleBlur)
    this.target.document.removeEventListener('visibilitychange', this.handleVisibilityChange)
  }
}
