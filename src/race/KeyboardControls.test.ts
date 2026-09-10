import { afterEach, describe, expect, it } from 'vitest'

import { PHYSICS_STEP_SECONDS, VEHICLE_DYNAMICS } from '@/race/constants'
import {
  KEYBOARD_CONTROL_SCHEMES,
  type KeyboardControlSchemeId,
} from '@/race/control-schemes'
import { KeyboardControls } from '@/race/KeyboardControls'
import { RaceEngine } from '@/race/RaceEngine'
import { integrateVehicle } from '@/race/vehicle-physics'
import { SHORT_TRACK } from '@/test/track-fixtures'

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
  it('does not treat tiny resting velocity oscillations as reverse', () => {
    controls = new KeyboardControls()
    key('keydown', 'ArrowLeft')
    for (const speed of [0, -0.03, 0.02, -0.09, 0.001]) {
      expect(controls.getInput('arrows', { angle: 0, velocity: { x: speed, y: 0 } }).steer).toBe(1)
    }
    expect(controls.getInput('arrows', { angle: 0, velocity: { x: -0.2, y: 0 } }).steer).toBe(-1)
  })
  it.each([
    ['wasd', 'KeyD', -1],
    ['wasd', 'KeyA', 1],
    ['arrows', 'ArrowRight', -1],
    ['arrows', 'ArrowLeft', 1],
    ['ijkl', 'KeyL', -1],
    ['ijkl', 'KeyJ', 1],
  ] as const)(
    'keeps the requested turn in reverse for the %s key %s',
    (scheme, code, forwardSteer) => {
      controls = new KeyboardControls()
      key('keydown', code)
      const vehicle = { angle: 0, velocity: { x: 4, y: 0 } }
      expect(controls.getInput(scheme, vehicle).steer).toBe(forwardSteer)
      vehicle.velocity.x = -4
      expect(controls.getInput(scheme, vehicle).steer).toBe(-forwardSteer)
      vehicle.velocity = { x: 0, y: 4 }
      expect(controls.getInput(scheme, vehicle).steer).toBe(forwardSteer)
      vehicle.velocity = { x: 0, y: 0 }
      expect(controls.getInput(scheme, vehicle).steer).toBe(forwardSteer)
      key('keyup', code)
      vehicle.velocity.x = -4
      expect(controls.getInput(scheme, vehicle).steer).toBe(0)
    },
  )

  it.each([
    ['arrows', 'ArrowRight'],
    ['ijkl', 'KeyL'],
  ] as const)('adapts the %s scheme independently in reverse', (scheme, code) => {
    controls = new KeyboardControls()
    key('keydown', 'KeyW')
    key('keydown', 'KeyD')
    key('keydown', code)
    const backwards = { angle: Math.PI, velocity: { x: 5, y: 0 } }
    const forwards = { angle: 0, velocity: { x: 5, y: 0 } }
    expect(controls.getInput('wasd', backwards)).toEqual({
      throttle: 1,
      brake: 0,
      steer: 1,
    })
    expect(controls.getInput(scheme, forwards).steer).toBe(-1)
    expect(controls.getInput('wasd', forwards).steer).toBe(-1)
    expect(controls.getInput(scheme, backwards).steer).toBe(1)
  })

  it('does not invert steering while braking forward', () => {
    controls = new KeyboardControls()
    key('keydown', 'KeyS')
    key('keydown', 'KeyD')
    expect(
      controls.getInput('wasd', {
        angle: 0,
        velocity: { x: 10, y: 0 },
      }),
    ).toEqual({ throttle: 0, brake: 1, steer: -1 })
  })

  it.each([
    ['KeyD', -1],
    ['KeyA', 1],
  ] as const)(
    'turns toward the same side of travel with %s going forwards or backwards',
    (code, turnSign) => {
      controls = new KeyboardControls()
      key('keydown', code)
      for (const speed of [4, -4]) {
        const engine = new RaceEngine({
          track: SHORT_TRACK,
          mode: 'solo',
          racers: [
            {
              id: 'player-1',
              name: 'Pilot',
              kind: 'human',
              color: '#2d7dff',
            },
          ],
        })
        const vehicle = engine.getVehicleState('player-1')!
        vehicle.angle = 0
        vehicle.position = { x: 0, y: 0 }
        vehicle.velocity = { x: speed, y: 0 }
        vehicle.physicsState.longitudinalSpeed = speed
        vehicle.physicsState.frontWheelAngularSpeed =
          speed / VEHICLE_DYNAMICS.wheelRadiusMeters
        vehicle.physicsState.rearWheelAngularSpeed =
          speed / VEHICLE_DYNAMICS.wheelRadiusMeters
        for (let step = 0; step < 30; step += 1) {
          integrateVehicle(
            vehicle,
            controls.getInput('wasd', vehicle),
            'asphalt',
            PHYSICS_STEP_SECONDS,
          )
        }
        // Relative to travel, right is -y going forward and +y in reverse.
        expect(Math.sign(vehicle.position.y * speed)).toBe(turnSign)
        expect(Math.sign(vehicle.angle * speed)).toBe(turnSign)
        expect(Math.abs(vehicle.angle)).toBeGreaterThan(0.001)
      }
    },
  )

  it('reads only the selected group even when another group is pressed', () => {
    controls = new KeyboardControls()
    key('keydown', 'KeyW')
    key('keydown', 'ArrowRight')

    expect(controls.getInput('wasd')).toEqual({
      throttle: 1,
      brake: 0,
      steer: 0,
    })
    expect(controls.getInput('arrows')).toEqual({
      throttle: 0,
      brake: 0,
      steer: -1,
    })
    expect(controls.getInput('ijkl')).toEqual({
      throttle: 0,
      brake: 0,
      steer: 0,
    })
  })

  it.each(
    KEYBOARD_CONTROL_SCHEMES.map((scheme) => [scheme.id, scheme.bindings] as const),
  )('supports every action in the %s group', (scheme, bindings) => {
    controls = new KeyboardControls()
    key('keydown', bindings.throttle)
    key('keydown', bindings.left)
    expect(controls.getInput(scheme)).toEqual({
      throttle: 1,
      brake: 0,
      steer: 1,
    })

    key('keyup', bindings.throttle)
    key('keyup', bindings.left)
    key('keydown', bindings.brake)
    key('keydown', bindings.right)
    expect(controls.getInput(scheme)).toEqual({
      throttle: 0,
      brake: 1,
      steer: -1,
    })
  })

  it('does not capture Shift or map it to a driving action', () => {
    controls = new KeyboardControls()
    const leftShift = key('keydown', 'ShiftLeft')
    const rightShift = key('keydown', 'ShiftRight')

    expect(leftShift.defaultPrevented).toBe(false)
    expect(rightShift.defaultPrevented).toBe(false)
    for (const scheme of KEYBOARD_CONTROL_SCHEMES) {
      expect(controls.getInput(scheme.id)).toEqual({
        throttle: 0,
        brake: 0,
        steer: 0,
      })
    }
  })

  it('uses Space only as the hold-to-identify shortcut', () => {
    controls = new KeyboardControls()
    const space = key('keydown', 'Space')

    expect(space.defaultPrevented).toBe(true)
    expect(controls.isIdentificationHeld()).toBe(true)
    expect(controls.getInput('wasd')).toEqual({
      throttle: 0,
      brake: 0,
      steer: 0,
    })

    key('keyup', 'Space')
    expect(controls.isIdentificationHeld()).toBe(false)
  })

  it('keeps every independent key from different groups', () => {
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
    expect(controls.getInput('wasd')).toEqual({
      throttle: 1,
      brake: 0,
      steer: 1,
    })
    expect(controls.getInput('arrows')).toEqual({
      throttle: 1,
      brake: 0,
      steer: -1,
    })

    key('keyup', 'KeyA')
    expect(controls.getInput('wasd')).toMatchObject({
      throttle: 1,
      steer: 0,
    })
    expect(controls.getInput('arrows')).toMatchObject({
      throttle: 1,
      steer: -1,
    })
  })

  it('clears held keys when the window loses focus or visibility', () => {
    controls = new KeyboardControls()
    key('keydown', 'KeyW')
    window.dispatchEvent(new Event('blur'))
    expect(controls.getInput('wasd')).toEqual({
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

  it('keeps its public scheme type restricted to the three presets', () => {
    const schemes: KeyboardControlSchemeId[] = ['wasd', 'arrows', 'ijkl']
    expect(schemes).toHaveLength(3)
  })
})
