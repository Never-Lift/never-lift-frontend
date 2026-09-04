import { describe, expect, it } from 'vitest'

import { performanceRacers } from '../../tools/race-performance-entry'

describe('performance benchmark grids', () => {
  it('really runs two humans and twenty bots for local 22', () => {
    const racers = performanceRacers('local', 22)
    expect(racers.filter(racer => racer.kind === 'human').map(racer => racer.id)).toEqual(['player-1', 'player-2'])
    expect(racers.filter(racer => racer.kind === 'bot')).toHaveLength(20)
    expect(new Set(racers.map(racer => racer.id)).size).toBe(22)
  })

  it('keeps the solo and bot-free local cases distinct', () => {
    expect(performanceRacers('solo', 22).filter(racer => racer.kind === 'bot')).toHaveLength(21)
    expect(performanceRacers('local', 2).filter(racer => racer.kind === 'bot')).toHaveLength(0)
    expect(() => performanceRacers('local', 1)).toThrow()
    expect(() => performanceRacers('local', 23)).toThrow()
  })
})
