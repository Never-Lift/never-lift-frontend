import { clamp } from '@/race/math'
import type { DriverInput, HandlingMode, RaceMode } from '@/race/types'

const CONTROL_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ShiftLeft',
  'ShiftRight',
])

function opposite(mode: HandlingMode): HandlingMode {
  return mode === 'normal' ? 'drift' : 'normal'
}

export class KeyboardControls {
  private readonly pressed = new Set<string>()
  private readonly target: Window
  private playerOneMode: HandlingMode
  private playerTwoMode: HandlingMode

  constructor(
    playerOneMode: HandlingMode,
    playerTwoMode: HandlingMode,
    target: Window = window,
  ) {
    this.target = target
    this.playerOneMode = playerOneMode
    this.playerTwoMode = playerTwoMode
    target.addEventListener('keydown', this.handleKeyDown)
    target.addEventListener('keyup', this.handleKeyUp)
    target.addEventListener('blur', this.handleBlur)
  }

  private handleKeyDown = (event: KeyboardEvent) => {
    if (!CONTROL_KEYS.has(event.code)) return
    event.preventDefault()
    if (!event.repeat && event.code === 'ShiftLeft') {
      this.playerOneMode = opposite(this.playerOneMode)
    }
    if (!event.repeat && event.code === 'ShiftRight') {
      this.playerTwoMode = opposite(this.playerTwoMode)
    }
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

  getPlayerOneInput(mode: RaceMode): DriverInput {
    const includeArrows = mode === 'solo'
    return {
      throttle:
        this.isPressed('KeyW') ||
        (includeArrows && this.isPressed('ArrowUp'))
          ? 1
          : 0,
      brake:
        this.isPressed('KeyS') ||
        (includeArrows && this.isPressed('ArrowDown'))
          ? 1
          : 0,
      steer: clamp(
        (this.isPressed('KeyD') ||
        (includeArrows && this.isPressed('ArrowRight'))
          ? 1
          : 0) -
          (this.isPressed('KeyA') ||
          (includeArrows && this.isPressed('ArrowLeft'))
            ? 1
            : 0),
        -1,
        1,
      ),
      handlingMode: this.playerOneMode,
    }
  }

  getPlayerTwoInput(): DriverInput {
    return {
      throttle: this.isPressed('ArrowUp') ? 1 : 0,
      brake: this.isPressed('ArrowDown') ? 1 : 0,
      steer: clamp(
        (this.isPressed('ArrowRight') ? 1 : 0) -
          (this.isPressed('ArrowLeft') ? 1 : 0),
        -1,
        1,
      ),
      handlingMode: this.playerTwoMode,
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
  }
}
