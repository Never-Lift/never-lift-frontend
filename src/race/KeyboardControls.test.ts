import { afterEach, describe, expect, it } from 'vitest'

import {
  ALTERNATIVE_LOCAL_KEYBOARD_BINDINGS,
  KeyboardControls,
} from '@/race/KeyboardControls'

import { PHYSICS_STEP_SECONDS, VEHICLE_DYNAMICS } from '@/race/constants'
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
  it.each([
    ['KeyD', -1], ['KeyA', 1], ['ArrowRight', -1], ['ArrowLeft', 1],
  ] as const)('keeps the requested turn in reverse for solo key %s', (code, forwardSteer) => {
    controls = new KeyboardControls()
    key('keydown', code)
    const vehicle = { angle: 0, velocity: { x: 4, y: 0 } }
    expect(controls.getPlayerOneInput('solo', vehicle).steer).toBe(forwardSteer)
    vehicle.velocity.x = -4
    expect(controls.getPlayerOneInput('solo', vehicle).steer).toBe(-forwardSteer)
    vehicle.velocity = { x: 0, y: 4 }
    expect(controls.getPlayerOneInput('solo', vehicle).steer).toBe(forwardSteer)
    vehicle.velocity = { x: 0, y: 0 }
    expect(controls.getPlayerOneInput('solo', vehicle).steer).toBe(forwardSteer)
    key('keyup', code)
    vehicle.velocity.x = -4
    expect(controls.getPlayerOneInput('solo', vehicle).steer).toBe(0)
  })

  it.each(['ArrowRight', 'KeyL'])('adapts each local player independently, including %s', (code) => {
    controls = new KeyboardControls()
    key('keydown', 'KeyW')
    key('keydown', 'KeyD')
    key('keydown', code)
    const backwards = { angle: Math.PI, velocity: { x: 5, y: 0 } }
    const forwards = { angle: 0, velocity: { x: 5, y: 0 } }
    expect(controls.getPlayerOneInput('local', backwards)).toEqual({ throttle: 1, brake: 0, steer: 1 })
    expect(controls.getPlayerTwoInput(forwards).steer).toBe(-1)
    expect(controls.getPlayerOneInput('local', forwards).steer).toBe(-1)
    expect(controls.getPlayerTwoInput(backwards).steer).toBe(1)
  })

  it('does not invert steering while braking forward', () => {
    controls = new KeyboardControls()
    key('keydown', 'KeyS')
    key('keydown', 'KeyD')
    expect(controls.getPlayerOneInput('solo', { angle: 0, velocity: { x: 10, y: 0 } }))
      .toEqual({ throttle: 0, brake: 1, steer: -1 })
  })

  it.each([['KeyD', -1], ['KeyA', 1]] as const)(
    'turns toward the same side of travel with %s going forwards or backwards', (code, turnSign) => {
      controls = new KeyboardControls()
      key('keydown', code)
      for (const speed of [4, -4]) {
        const engine = new RaceEngine({ track: SHORT_TRACK, mode: 'solo', racers: [
          { id: 'player-1', name: 'Pilot', kind: 'human', color: '#2d7dff' },
        ] })
        const vehicle = engine.getVehicleState('player-1')!
        vehicle.angle = 0
        vehicle.position = { x: 0, y: 0 }
        vehicle.velocity = { x: speed, y: 0 }
        vehicle.physicsState.longitudinalSpeed = speed
        vehicle.physicsState.frontWheelAngularSpeed = speed / VEHICLE_DYNAMICS.wheelRadiusMeters
        vehicle.physicsState.rearWheelAngularSpeed = speed / VEHICLE_DYNAMICS.wheelRadiusMeters
        for (let step = 0; step < 30; step += 1) {
          integrateVehicle(vehicle, controls.getPlayerOneInput('solo', vehicle), 'asphalt', PHYSICS_STEP_SECONDS)
        }
        // Relative to travel, right is -y going forward and +y in reverse.
        expect(Math.sign(vehicle.position.y * speed)).toBe(turnSign)
        expect(Math.sign(vehicle.angle * speed)).toBe(turnSign)
        expect(Math.abs(vehicle.angle)).toBeGreaterThan(0.001)
      }
    },
  )

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
