import { createContext, useContext } from 'react'

import type {
  Account,
  AccountChanges,
  LoginCredentials,
  RegisterCredentials,
} from '@/lib/auth-types'

export type SessionState = {
  role: 'guest' | 'user'
  token?: string
  subject?: string
}

export type AuthContextValue = {
  session: SessionState | null
  account: Account | null
  isGuest: boolean
  isUser: boolean
  startGuestSession: () => Promise<void>
  login: (credentials: LoginCredentials) => Promise<void>
  register: (credentials: RegisterCredentials) => Promise<void>
  loadAccount: () => Promise<Account>
  updateAccount: (changes: AccountChanges) => Promise<Account>
  deleteAccount: (currentPassword: string) => Promise<void>
  signOut: () => void
}

export const emptyAuthValue: AuthContextValue = {
  session: null,
  account: null,
  isGuest: false,
  isUser: false,
  startGuestSession: async () => undefined,
  login: async () => undefined,
  register: async () => undefined,
  loadAccount: async () => {
    throw new Error('No account is available.')
  },
  updateAccount: async () => {
    throw new Error('No account is available.')
  },
  deleteAccount: async () => undefined,
  signOut: () => undefined,
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth() {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }

  return context
}
