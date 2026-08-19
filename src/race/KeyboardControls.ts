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
  'ShiftLeft',
  'ShiftRight',
])

export class KeyboardControls {
  private readonly pressed = new Set<string>()
  private readonly target: Window

  constructor(target: Window = window) {
    this.target = target
    target.addEventListener('keydown', this.handleKeyDown)
    target.addEventListener('keyup', this.handleKeyUp)
    target.addEventListener('blur', this.handleBlur)
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
        (this.isPressed('KeyA') ||
        (includeArrows && this.isPressed('ArrowLeft'))
          ? 1
          : 0) -
          (this.isPressed('KeyD') ||
          (includeArrows && this.isPressed('ArrowRight'))
            ? 1
            : 0),
        -1,
        1,
      ),
      nitro:
        this.isPressed('ShiftLeft') ||
        (includeArrows && this.isPressed('ShiftRight')),
    }
  }

  getPlayerTwoInput(): DriverInput {
    return {
      throttle: this.isPressed('ArrowUp') ? 1 : 0,
      brake: this.isPressed('ArrowDown') ? 1 : 0,
      steer: clamp(
        (this.isPressed('ArrowLeft') ? 1 : 0) -
          (this.isPressed('ArrowRight') ? 1 : 0),
        -1,
        1,
      ),
      nitro: this.isPressed('ShiftRight'),
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
