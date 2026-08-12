export type AuthRole = 'guest' | 'user'

export type TokenResponse = {
  token?: string
  tokenType?: string
  expiresIn?: number
  role: AuthRole
  subject?: string
}

export type Account = {
  id: string
  gamertag: string
  displayName: string
  avatarId: string | null
  preferredLanguage: string
  createdAt: string
}

export type LoginCredentials = {
  gamertag: string
  password: string
}

export type RegisterCredentials = LoginCredentials & {
  displayName: string
  avatarId?: string
}

export type AccountChanges = {
  currentPassword: string
  displayName?: string
  avatarId?: string | null
  password?: string
}
