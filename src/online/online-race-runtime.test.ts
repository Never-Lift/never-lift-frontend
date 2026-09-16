import { describe, expect, it, vi } from 'vitest'
import { OnlineRaceRuntime } from '@/online/OnlineRaceRuntime'
import { onlineFrame, onlinePlayers, ONLINE_SESSION_ID } from '@/test/online-race-fixtures'
import { SHORT_TRACK } from '@/test/track-fixtures'

function setup() {
  const send = vi.fn().mockReturnValue(true)
  const runtime = new OnlineRaceRuntime(SHORT_TRACK, onlinePlayers[0], onlinePlayers, send)
  return { runtime, send }
}
describe('online presentation lifecycle', () => {
  it('bounds speculation during a delivery gap, keeps sending controls and resumes on a fresh frame', () => {
    const { runtime, send } = setup()
    runtime.receive({ type: 'state_snapshot', payload: onlineFrame() }, 0)
    runtime.setInput({ throttle: 1, brake: 0, steer: 0 })
    for (let now = 10; now <= 250; now += 10) runtime.advance(0.01, now)
    const before = runtime.getOwnState()
    expect(runtime.getDeliveryStatus(250).stalled).toBe(false)
    runtime.setInput({ throttle: 0, brake: 1, steer: 1 })
    for (let now = 260; now <= 1000; now += 10) {
      runtime.flushInput(now, now + 1_000_000)
      runtime.advance(0.01, now)
    }
    expect(runtime.getDeliveryStatus(1000)).toMatchObject({ stalled: true, ageMs: 1000, receivedSnapshots: 1 })
    expect(runtime.getOwnState()).toEqual(before)
    expect(send.mock.calls.some(call => call[0].brake === 1)).toBe(true)
    runtime.receive({ type: 'state_snapshot', payload: onlineFrame({ tick: 30, substep: 120, physicsSubstep: 120, serverTime: 1_001_000 }) }, 1000)
    expect(runtime.getDeliveryStatus(1000)).toMatchObject({ stalled: false, ageMs: 0, largestGapMs: 1000, receivedSnapshots: 2 })
    runtime.advance(1 / 60, 1017)
    expect(runtime.getOwnState().physicsState.appliedBrake).toBeGreaterThan(0)
  })

  it('does not report countdown, completed qualifying or disconnected sockets as delivery stalls', () => {
    const { runtime } = setup()
    runtime.receive({ type: 'state_snapshot', payload: onlineFrame({ phase: 'countdown' }) }, 0)
    expect(runtime.getDeliveryStatus(5000).stalled).toBe(false)
    const frame = onlineFrame({ phase: 'qualifying', tick: 100, substep: 400, physicsSubstep: 400 })
    frame.cars[0].qualifyingAttempts = 2
    runtime.receive({ type: 'state_snapshot', payload: frame }, 5000)
    expect(runtime.getDeliveryStatus(10000).stalled).toBe(false)
    runtime.setConnection(false)
    expect(runtime.getDeliveryStatus(15000).stalled).toBe(false)
  })
  it('neutralizes navigation immediately instead of sending a queued press on cleanup', () => {
    const { runtime, send } = setup()
    runtime.receive({ type: 'state_snapshot', payload: onlineFrame() }, 0)
    runtime.setInput({ throttle: 1, brake: 0, steer: 0 })
    runtime.setInput({ throttle: 0, brake: 1, steer: 1 })
    runtime.releaseInput(1234)
    expect(send).toHaveBeenLastCalledWith({ throttle: 0, brake: 0, steer: 0 }, 1, 1234)
    runtime.flushInput(34, 1268)
    expect(send).toHaveBeenLastCalledWith({ throttle: 0, brake: 0, steer: 0 }, 2, 1268)
  })
  it('keeps countdown physics locked while sending the authorized raw start intention', () => {
    const {runtime,send}=setup()
    runtime.receive({type:'state_snapshot',payload:onlineFrame({phase:'countdown'})},0)
    const before = runtime.getOwnState()
    runtime.setInput({throttle:1,brake:0,steer:1})
    runtime.flushInput(0,1000)
    runtime.advance(0.05,50)
    expect(runtime.getOwnState()).toEqual(before)
    expect(send).toHaveBeenCalledWith({throttle:1,brake:0,steer:1},0,1000)
    runtime.receive({type:'race_event',payload:{type:'start_light',sessionId:ONLINE_SESSION_ID,tick:0,substep:0,serverTime:1_000_000,stage:3}},50)
    expect(runtime.getRedLights()).toBe(3)
  })

  it('releases prediction only after authoritative qualifying countdown', () => {
    const {runtime}=setup()
    runtime.receive({type:'state_snapshot',payload:onlineFrame({phase:'qualifying'})},0)
    runtime.setInput({throttle:1,brake:0,steer:0});runtime.advance(0.03,30)
    expect(runtime.getOwnState().physicsState.appliedThrottle).toBe(0)
    runtime.receive({type:'state_snapshot',payload:onlineFrame({phase:'qualifying',substep:364,tick:91,serverTime:1_003_033,physicsSubstep:364})},3033)
    runtime.setInput({throttle:1,brake:0,steer:0});runtime.advance(0.03,3063)
    expect(runtime.getOwnState().physicsState.appliedThrottle).toBeGreaterThan(0)
    expect(runtime.getInterpolatedVehicles()).toHaveLength(1)
  })

  it('freezes all visible positions on disconnect and waits for a fresh snapshot after reconnect', () => {
    const {runtime}=setup()
    runtime.receive({type:'state_snapshot',payload:onlineFrame()},0)
    runtime.advance(0.01,10)
    const visible=structuredClone(runtime.getInterpolatedVehicles())
    runtime.setConnection(false);runtime.advance(1,1000)
    expect(runtime.getInterpolatedVehicles()).toEqual(visible)
    runtime.setConnection(true);runtime.advance(1,2000)
    expect(runtime.isFrozen()).toBe(true)
    runtime.receive({type:'state_snapshot',payload:onlineFrame({substep:240,tick:60,physicsSubstep:240,serverTime:1_002_000})},2000)
    expect(runtime.isFrozen()).toBe(false)
  })

  it('hides finished opponents until the focal driver is also a ghost', () => {
    const {runtime}=setup();const frame=onlineFrame()
    frame.cars[1].isGhost=true
    runtime.receive({type:'state_snapshot',payload:frame},0)
    expect(runtime.getInterpolatedVehicles().map(c=>c.id)).not.toContain('user-2')
    frame.cars[0].isGhost=true
    runtime.receive({type:'state_snapshot',payload:{...frame,tick:1,substep:4,physicsSubstep:4,serverTime:1_000_033}},33)
    expect(runtime.getInterpolatedVehicles().find(c=>c.id==='user-2')?.renderOpacity).toBe(0.4)
    expect(runtime.getInterpolatedVehicles()[0].renderOpacity).toBe(0.4)
  })

  it('preserves a short press/release and renews held commands at 30 Hz', () => {
    const {runtime,send}=setup()
    runtime.receive({type:'state_snapshot',payload:onlineFrame()},0)
    runtime.setInput({throttle:1,brake:0,steer:0})
    runtime.setInput({throttle:0,brake:0,steer:0})
    for(let now=0;now<1000;now+=8) runtime.flushInput(now,1000+now)
    expect(send).toHaveBeenCalledTimes(30)
    expect(send.mock.calls[0][0].throttle).toBe(1)
    expect(send.mock.calls[1][0].throttle).toBe(0)
    expect(send.mock.calls.map(call=>call[1])).toEqual(Array.from({length:30},(_,i)=>i))
  })

  it('uses server HUD fields and ignores old sessions, stale frames and nonfinite states', () => {
    const {runtime}=setup();const frame=onlineFrame();frame.cars[0].currentLapTimeMs=12345
    runtime.receive({type:'state_snapshot',payload:frame},0)
    runtime.advance(0.1,100)
    expect(runtime.getOwnSnapshot()?.currentLapTimeMs).toBe(12345)
    runtime.receive({type:'state_snapshot',payload:{...frame,sessionId:'00000000-0000-4000-8000-000000000009',substep:4}},100)
    expect(runtime.getSnapshot()?.sessionId).toBe(ONLINE_SESSION_ID)
    runtime.receive({type:'state_snapshot',payload:{...frame,serverTime:NaN}},100)
    expect(runtime.getError()).toBeTruthy()
  })

  it('stops prediction on the authoritative result and retains all standings', () => {
    const {runtime}=setup();runtime.receive({type:'state_snapshot',payload:onlineFrame()},0)
    runtime.receive({type:'race_result',payload:{sessionId:ONLINE_SESSION_ID,trackId:SHORT_TRACK.id,trackCatalogVersion:'2026.12',physicsContractVersion:'2.0.3',
      standings:onlinePlayers.map((p,i)=>({playerId:p.id,userId:p.userId,displayName:p.displayName,position:i+1,totalTimeMs:100000,bestLapTimeMs:50000,finished:true,laps:2,progressMeters:SHORT_TRACK.lengthMeters*2}))}},200)
    expect(runtime.getPhase()).toBe('results')
    expect(runtime.getResult()?.standings).toHaveLength(3)
    expect(runtime.isFrozen()).toBe(true)
  })
})
