import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { OnlineRacePanel } from '@/components/race/OnlineRacePanel'
import { onlineRoomSession } from '@/online/OnlineRoomSession'
import type { OnlineRoomClientOptions } from '@/online/OnlineRoomClient'
import type { RoomSummary } from '@/lib/api'
import { onlineFrame, onlinePlayers, ONLINE_SESSION_ID } from '@/test/online-race-fixtures'
import { SHORT_TRACK } from '@/test/track-fixtures'

const { draw } = vi.hoisted(() => ({ draw: vi.fn() }))
vi.mock('@/race/RaceRenderer', () => ({ RaceRenderer: class { render = draw } }))
afterEach(() => { cleanup(); onlineRoomSession.resetForTests(); vi.clearAllMocks(); vi.useRealTimers() })
const room: RoomSummary = { code:'1234', name:'Sala teste', hostId:'user-1', trackId:SHORT_TRACK.id,
  trackCatalogVersion:'2026.12', physicsContractVersion:'2.0.3', participantCount:3, limit:3,
  state:'qualifying', settingsLocked:true, players:onlinePlayers }
async function mount() {
  let options!: OnlineRoomClientOptions
  const client = {connect:vi.fn(async () => { options.onStatus?.('connected') }), disconnect:vi.fn(), sendInput:vi.fn(() => true), setReady:vi.fn()}
  await onlineRoomSession.connect({roomCode:room.code,initialRoom:room,trackCatalogVersion:'2026.12',physicsContractVersion:'2.0.3',getTicket:vi.fn(),
    createClient: value => { options=value;return client as never }})
  const onLeave=vi.fn(async () => {})
  render(<OnlineRacePanel room={room} player={onlinePlayers[0]} isHost onLeave={onLeave} onCancelQualification={vi.fn()} getTrack={async () => SHORT_TRACK} />)
  act(() => options.onEnvelope?.({type:'state_snapshot',payload:onlineFrame()}))
  await screen.findByLabelText('Telemetria online')
  return {options,client,onLeave}
}
it('uses server HUD, shows five-stage lights/penalty and confirms Escape before leaving', async () => {
  const {options,onLeave}=await mount()
  const frame=onlineFrame({phase:'countdown',tick:1,substep:4,serverTime:1_000_033})
  frame.cars[0].lap=1;frame.cars[0].currentLapTimeMs=12_345
  act(() => {
    options.onEnvelope?.({type:'state_snapshot',payload:frame})
    options.onEnvelope?.({type:'race_event',payload:{type:'start_light',sessionId:ONLINE_SESSION_ID,tick:1,substep:4,serverTime:1_000_033,stage:4}})
  })
  await screen.findByLabelText('4 luzes vermelhas')
  expect(screen.getByText(/Atual 0:12.345/)).toBeInTheDocument()
  frame.cars[0].falseStart=true
  act(() => options.onEnvelope?.({type:'state_snapshot',payload:{...frame,phase:'race',tick:2,substep:8,raceTimeMs:2000,serverTime:1_000_066}}))
  await screen.findByText(/acelerador bloqueado 3 s/)
  fireEvent.keyDown(window,{key:'Escape',code:'Escape'})
  expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
  expect(onLeave).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button',{name:'Continuar na sala'}))
  expect(onLeave).not.toHaveBeenCalled()
})
it('expires protocol error notifications after five seconds while keeping the race safely unavailable', async () => {
  const { options } = await mount()
  act(() => options.onEnvelope?.({ type: 'state_snapshot', payload: { invalid: true } }))
  expect(await screen.findByRole('alert')).toHaveTextContent('incompatível')
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument(), { timeout: 6500 })
  expect(screen.getByText('Corrida indisponível. Saia da sala para continuar.')).toBeInTheDocument()
}, 10000)
it('warns once during a silent delivery gap and lets the driver dismiss it without leaving', async () => {
  await mount()
  expect(await screen.findByRole('status')).toHaveTextContent('Atualizações da corrida atrasadas')
  fireEvent.click(screen.getByRole('button', { name: 'Fechar notificação' }))
  await new Promise(resolve => setTimeout(resolve, 150))
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.getByLabelText('Telemetria online')).toBeInTheDocument()
})
it('offers host readiness after qualifying and stops drawing on the authoritative podium', async () => {
  const {options,client}=await mount()
  act(() => options.onEnvelope?.({type:'race_event',payload:{type:'qualifying_result',sessionId:ONLINE_SESSION_ID,tick:0,substep:0,serverTime:1_000_000,
    grid:onlinePlayers.map((p,i)=>({playerId:p.id,position:i+1,bestLapTimeMs:60000+i,valid:true}))}}))
  fireEvent.click(await screen.findByRole('button',{name:'Pronto para a corrida'}))
  expect(client.setReady).toHaveBeenCalledWith(true)
  act(() => options.onEnvelope?.({type:'race_result',payload:{sessionId:ONLINE_SESSION_ID,trackId:SHORT_TRACK.id,trackCatalogVersion:'2026.12',physicsContractVersion:'2.0.3',
    standings:onlinePlayers.map((p,i)=>({playerId:p.id,userId:p.userId,displayName:p.displayName,position:i+1,totalTimeMs:123000+i,bestLapTimeMs:60000,finished:true,laps:2,progressMeters:0}))}}))
  expect(await screen.findByLabelText('Pódio')).toBeInTheDocument()
  const renders=draw.mock.calls.length
  await new Promise(resolve => setTimeout(resolve,60))
  expect(draw).toHaveBeenCalledTimes(renders)
  fireEvent.click(screen.getByRole('button',{name:'Confirmar e voltar ao lobby'}))
  expect(client.setReady).toHaveBeenLastCalledWith(true)
})
it('keeps the last picture while disconnected and reports a failed reconnection instead of waiting forever', async () => {
  const {options}=await mount()
  act(() => options.onStatus?.('reconnecting'))
  await screen.findByText(/Reconectando por até 30 segundos/)
  const renders=draw.mock.calls.length
  act(() => options.onStatus?.('failed'))
  await screen.findByText(/Não foi possível reconectar/)
  expect(draw).toHaveBeenCalledTimes(renders)
  act(() => options.onStatus?.('connected'))
  await waitFor(() => expect(screen.getByText(/Reconectando por até 30 segundos/)).toBeInTheDocument())
  expect(draw).toHaveBeenCalledTimes(renders)
})
