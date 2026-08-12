import enduranceEngineer from '@/assets/avatars/endurance-engineer.png'
import garageTuner from '@/assets/avatars/garage-tuner.png'
import kartingAce from '@/assets/avatars/karting-ace.png'
import offroadRacer from '@/assets/avatars/offroad-racer.png'
import pitMechanic from '@/assets/avatars/pit-mechanic.png'
import rallyNavigator from '@/assets/avatars/rally-navigator.png'
import rookiePilot from '@/assets/avatars/rookie-pilot.png'
import streetDrifter from '@/assets/avatars/street-drifter.png'

export type Avatar = {
  id: string
  name: string
  image: string
}

export const avatars: Avatar[] = [
  { id: 'rookie-pilot', name: 'Piloto novato', image: rookiePilot },
  { id: 'street-drifter', name: 'Drifter urbana', image: streetDrifter },
  { id: 'pit-mechanic', name: 'Mecânico de box', image: pitMechanic },
  { id: 'rally-navigator', name: 'Navegadora de rali', image: rallyNavigator },
  {
    id: 'endurance-engineer',
    name: 'Engenheira de endurance',
    image: enduranceEngineer,
  },
  { id: 'karting-ace', name: 'Ás do kart', image: kartingAce },
  { id: 'garage-tuner', name: 'Preparadora de garagem', image: garageTuner },
  { id: 'offroad-racer', name: 'Piloto off-road', image: offroadRacer },
]

export function getAvatar(avatarId?: string | null) {
  return avatars.find((avatar) => avatar.id === avatarId)
}
