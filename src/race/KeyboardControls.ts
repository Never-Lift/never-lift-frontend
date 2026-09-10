import { NUMERIC_SPEED_EPSILON_METERS_PER_SECOND } from '@/race/constants'
import {
  KEYBOARD_CONTROL_SCHEMES,
  getKeyboardControlScheme,
  type KeyboardControlSchemeId,
} from '@/race/control-schemes'
import { clamp, dot } from '@/race/math'
import { bodyAxes } from '@/race/physics-utils'
import type { DriverInput, VehicleState } from '@/race/types'

type SteeringVehicle = Pick<VehicleState, 'angle' | 'velocity'>

/** Human left/right follow travel direction in reverse. Apply before physics/transport. */
function travelSteer(steer: number, vehicle?: SteeringVehicle | null) {
  if (!vehicle || steer === 0) return steer
  const speed = dot(vehicle.velocity, bodyAxes(vehicle.angle).forward)
  return speed < -NUMERIC_SPEED_EPSILON_METERS_PER_SECOND ? -steer : steer
}

const CONTROL_KEYS = new Set([
  ...KEYBOARD_CONTROL_SCHEMES.flatMap((scheme) => Object.values(scheme.bindings)),
  'Space',
])

export class KeyboardControls {
  private readonly pressed = new Set<string>()
  private readonly target: Window

  constructor(target: Window = window) {
    this.target = target
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

  getPressedCodes() {
    return [...this.pressed].sort()
  }

  isIdentificationHeld() {
    return this.isPressed('Space')
  }

  getInput(
    schemeId: KeyboardControlSchemeId,
    vehicle?: SteeringVehicle | null,
  ): DriverInput {
    const bindings = getKeyboardControlScheme(schemeId).bindings
    return {
      throttle: this.isPressed(bindings.throttle) ? 1 : 0,
      brake: this.isPressed(bindings.brake) ? 1 : 0,
      steer: travelSteer(
        clamp(
          (this.isPressed(bindings.left) ? 1 : 0) -
            (this.isPressed(bindings.right) ? 1 : 0),
          -1,
          1,
        ),
        vehicle,
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
