import { describe, expect, it, vi } from 'vitest'

import {
  PHYSICS_CONSTANTS,
  PHYSICS_STEP_SECONDS,
} from '@/race/constants'
import {
  JUMP_START_LOCK_TICKS,
  LIGHTS_OUT_DELAY_TICKS,
  LocalRaceSession,
  START_LIGHT_COUNT,
  START_LIGHT_TICKS,
  START_RELEASE_TICK,
} from '@/race/LocalRaceSession'
import { RaceEngine } from '@/race/RaceEngine'
import type { DriverInput } from '@/race/types'
import { SHORT_TRACK } from '@/test/track-fixtures'

const NEUTRAL_INPUT: DriverInput = {
  throttle: 0,
  brake: 0,
  steer: 0,
}

const THROTTLE_INPUT: DriverInput = {
  ...NEUTRAL_INPUT,
  throttle: 1,
}

function createSession() {
  const engine = new RaceEngine({
    track: SHORT_TRACK,
    mode: 'local',
    racers: [
      {
        id: 'player-1',
        name: 'Player 1',
        kind: 'human',
        color: '#31c7ff',
      },
      {
        id: 'player-2',
        name: 'Player 2',
        kind: 'human',
        color: '#ff2e88',
      },
    ],
  })
  return { engine, session: new LocalRaceSession(engine, ['player-1', 'player-2']) }
}

function inputs(
  playerOne: DriverInput = NEUTRAL_INPUT,
  playerTwo: DriverInput = NEUTRAL_INPUT,
) {
  return { 'player-1': playerOne, 'player-2': playerTwo }
}

function release(session: LocalRaceSession, frameRate = 60, input = NEUTRAL_INPUT) {
  const maximumFrames = Math.ceil(
    frameRate * (START_RELEASE_TICK * PHYSICS_STEP_SECONDS + 1),
  )
  for (let frame = 0; frame < maximumFrames && !session.isReleased(); frame += 1) {
    session.advanceFrame(1 / frameRate, inputs(input))
  }
  expect(session.isReleased()).toBe(true)
}

describe('LocalRaceSession start procedure', () => {
  it('forwards the hold-to-identify state independently of the start lights', () => {
    const { session } = createSession()

    expect(session.getOverlayState().showDriverNames).toBe(false)
    expect(session.getOverlayState(true).showDriverNames).toBe(true)
    expect(session.getOverlayState(true).startLights.stage).toBe('sequence')
  })

  it('derives every start-sequence duration from the published v2 contract', () => {
    expect(START_LIGHT_COUNT).toBe(PHYSICS_CONSTANTS.race.startLightCount)
    expect(START_LIGHT_TICKS).toBe(
      Math.round(
        PHYSICS_CONSTANTS.race.startLightStageSeconds / PHYSICS_STEP_SECONDS,
      ),
    )
    expect(LIGHTS_OUT_DELAY_TICKS).toBe(
      Math.round(
        PHYSICS_CONSTANTS.race.lightsOutDelaySeconds / PHYSICS_STEP_SECONDS,
      ),
    )
    expect(START_RELEASE_TICK).toBe(
      START_LIGHT_COUNT * START_LIGHT_TICKS + LIGHTS_OUT_DELAY_TICKS,
    )
  })

  it('turns on the contracted red lights in order, then releases on lights-out', () => {
    const { engine, session } = createSession()
    const initial = engine.getVehicleState('player-1')

    expect(session.getStartLightState()).toEqual({
      stage: 'sequence',
      redLights: 0,
    })
    for (let light = 1; light <= START_LIGHT_COUNT; light += 1) {
      for (let tick = 0; tick < START_LIGHT_TICKS; tick += 1) {
        session.advanceFrame(PHYSICS_STEP_SECONDS, inputs())
      }
      expect(session.getStartLightState()).toEqual({
        stage: 'sequence',
        redLights: light,
      })
      expect(engine.getSimulationTimeSeconds()).toBe(0)
      expect(engine.getVehicleState('player-1')?.position).toEqual(initial?.position)
    }

    for (let tick = 0; tick < LIGHTS_OUT_DELAY_TICKS; tick += 1) {
      session.advanceFrame(PHYSICS_STEP_SECONDS, inputs())
    }
    expect(session.getStartLightState()).toEqual({
      stage: 'lights-out',
      redLights: 0,
    })
  })

  it.each([30, 60, 120])(
    'observes the same ordered light sequence at %i FPS',
    (frameRate) => {
      const { engine, session } = createSession()
      const observed = [0]
      let previousLights = 0
      while (!session.isReleased()) {
        session.advanceFrame(1 / frameRate, inputs())
        const state = session.getStartLightState()
        if (state.stage === 'sequence' && state.redLights !== previousLights) {
          observed.push(state.redLights)
          previousLights = state.redLights
        }
      }

      expect(observed).toEqual(
        Array.from({ length: START_LIGHT_COUNT + 1 }, (_, index) => index),
      )
      expect(session.getStartLightState().stage).toBe('lights-out')
      expect(engine.getSimulationTimeSeconds()).toBeLessThanOrEqual(
        PHYSICS_STEP_SECONDS,
      )
    },
  )

  it('detects early throttle and preserves brake and steer input', () => {
    const { engine, session } = createSession()
    const setInput = vi.spyOn(engine, 'setInput')
    const earlyInput: DriverInput = {
      throttle: 1,
      brake: 0.6,
      steer: -0.75,
    }

    session.advanceFrame(PHYSICS_STEP_SECONDS, inputs(earlyInput))
    expect(session.getPenalty('player-1')).toEqual({
      jumpStarted: true,
      throttleLockTicksRemaining: JUMP_START_LOCK_TICKS,
    })

    release(session, 60, earlyInput)
    session.advanceFrame(PHYSICS_STEP_SECONDS, inputs(earlyInput))
    expect(setInput).toHaveBeenLastCalledWith('player-2', NEUTRAL_INPUT)
    expect(setInput).toHaveBeenCalledWith('player-1', {
      throttle: 0,
      brake: 0.6,
      steer: -0.75,
    })
  })

  it.each([30, 60, 120])(
    'locks jump-start throttle for exactly 300 engine ticks at %i FPS',
    (frameRate) => {
      const { engine, session } = createSession()
      session.advanceFrame(1 / 60, inputs(THROTTLE_INPUT))
      release(session, 60, THROTTLE_INPUT)

      const start = engine.getVehicleState('player-1')
      expect(session.getPenalty('player-1').throttleLockTicksRemaining).toBe(
        JUMP_START_LOCK_TICKS,
      )

      for (let frame = 0; frame < frameRate * 5; frame += 1) {
        session.advanceFrame(1 / frameRate, inputs(THROTTLE_INPUT))
      }

      const locked = engine.getVehicleState('player-1')
      expect(session.getPenalty('player-1').throttleLockTicksRemaining).toBe(0)
      expect(engine.getSimulationTimeSeconds()).toBeCloseTo(5, 5)
      expect(locked?.position).toEqual(start?.position)
      expect(locked?.velocity).toEqual({ x: 0, y: 0 })

      for (let frame = 0; frame < Math.ceil(frameRate / 30); frame += 1) {
        session.advanceFrame(1 / frameRate, inputs(THROTTLE_INPUT))
      }
      expect(Math.hypot(
        engine.getVehicleState('player-1')?.velocity.x ?? 0,
        engine.getVehicleState('player-1')?.velocity.y ?? 0,
      )).toBeGreaterThan(0)
    },
  )

  it('keeps the engine substep cap when a frame crosses the lock boundary', () => {
    const { engine, session } = createSession()
    session.advanceFrame(PHYSICS_STEP_SECONDS, inputs(THROTTLE_INPUT))
    release(session, 60, THROTTLE_INPUT)
    const lockTicksAfterRelease =
      session.getPenalty('player-1').throttleLockTicksRemaining
    for (let tick = 0; tick < lockTicksAfterRelease - 1; tick += 1) {
      session.advanceFrame(PHYSICS_STEP_SECONDS, inputs(THROTTLE_INPUT))
    }
    expect(session.getPenalty('player-1').throttleLockTicksRemaining).toBe(1)

    const before = engine.getSimulationTimeSeconds()
    const steps = session.advanceFrame(0.25, inputs(THROTTLE_INPUT))

    expect(steps).toBe(
      PHYSICS_CONSTANTS.simulation.maxSubstepsPerFrame,
    )
    expect(engine.getSimulationTimeSeconds() - before).toBeCloseTo(
      PHYSICS_STEP_SECONDS *
        PHYSICS_CONSTANTS.simulation.maxSubstepsPerFrame,
      6,
    )
    expect(session.getPenalty('player-1').throttleLockTicksRemaining).toBe(0)
    expect(Math.hypot(
      engine.getVehicleState('player-1')?.velocity.x ?? 0,
      engine.getVehicleState('player-1')?.velocity.y ?? 0,
    )).toBeGreaterThan(0)
  })
})
