import {
  KEYBOARD_CONTROL_SCHEMES,
  getKeyboardControlScheme,
  type KeyboardControlSchemeId,
} from '@/race/control-schemes'
import { clamp, dot } from '@/race/math'
import { bodyAxes } from '@/race/physics-utils'
import type { DriverInput, VehicleState } from '@/race/types'

type SteeringVehicle = Pick<VehicleState, 'angle' | 'velocity'>

// Input policy, not a physical constant: sub-0.36 km/h settling at rest must
// not alternate left/right as the longitudinal velocity crosses numeric zero.
const REVERSE_STEERING_SPEED_METERS_PER_SECOND = 0.1

/** Human left/right follow travel direction in reverse. Apply before physics/transport. */
function travelSteer(steer: number, vehicle?: SteeringVehicle | null) {
  if (!vehicle || steer === 0) return steer
  const speed = dot(vehicle.velocity, bodyAxes(vehicle.angle).forward)
  return speed < -REVERSE_STEERING_SPEED_METERS_PER_SECOND ? -steer : steer
}

const CONTROL_KEYS = new Set([
  ...KEYBOARD_CONTROL_SCHEMES.flatMap((scheme) => Object.values(scheme.bindings)),
  'Space',
])

export class KeyboardControls {
  private readonly pressed = new Set<string>()
  private readonly target: Window
  private readonly onChange?: () => void

  constructor(target: Window = window, onChange?: () => void) {
    this.target = target
    this.onChange = onChange
    target.addEventListener('keydown', this.handleKeyDown)
    target.addEventListener('keyup', this.handleKeyUp)
    target.addEventListener('blur', this.handleBlur)
    target.document.addEventListener('visibilitychange', this.handleVisibilityChange)
  }

  private handleKeyDown = (event: KeyboardEvent) => {
    if (!CONTROL_KEYS.has(event.code)) return
    event.preventDefault()
    if (this.pressed.has(event.code)) return
    this.pressed.add(event.code)
    this.onChange?.()
  }

  private handleKeyUp = (event: KeyboardEvent) => {
    if (!CONTROL_KEYS.has(event.code)) return
    event.preventDefault()
    if (this.pressed.delete(event.code)) this.onChange?.()
  }

  private handleBlur = () => {
    this.pressed.clear()
    this.onChange?.()
  }

  private handleVisibilityChange = () => {
    if (this.target.document.visibilityState !== 'visible') {
      this.handleBlur()
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
