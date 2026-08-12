import {
  useCallback,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react'

import { accountApi, authApi } from '@/lib/api'
import {
  AuthContext,
  type AuthContextValue,
  type SessionState,
} from '@/auth/auth-context'
import type {
  Account,
  AccountChanges,
  LoginCredentials,
  RegisterCredentials,
  TokenResponse,
} from '@/lib/auth-types'

function sessionFromResponse(response: TokenResponse): SessionState {
  return {
    role: response.role,
    token: response.token,
    subject: response.subject,
  }
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<SessionState | null>(null)
  const [account, setAccount] = useState<Account | null>(null)

  const loadAccountWith = useCallback(async (activeSession: SessionState) => {
    const currentAccount = await accountApi.get(activeSession.token)
    setAccount(currentAccount)
    return currentAccount
  }, [])

  const authenticate = useCallback(
    async (response: TokenResponse) => {
      const nextSession = sessionFromResponse(response)
      setSession(nextSession)

      if (nextSession.role === 'user') {
        await loadAccountWith(nextSession)
      } else {
        setAccount(null)
      }
    },
    [loadAccountWith],
  )

  const startGuestSession = useCallback(async () => {
    if (session) return
    await authenticate(await authApi.guest())
  }, [authenticate, session])

  const login = useCallback(
    async (credentials: LoginCredentials) => {
      await authenticate(await authApi.login(credentials))
    },
    [authenticate],
  )

  const register = useCallback(
    async (credentials: RegisterCredentials) => {
      const response = await authApi.register(credentials)
      const nextSession = sessionFromResponse(response)
      setSession(nextSession)

      let createdAccount = await loadAccountWith(nextSession)
      if (credentials.avatarId) {
        createdAccount = await accountApi.update(
          {
            currentPassword: credentials.password,
            avatarId: credentials.avatarId,
          },
          nextSession.token,
        )
        setAccount(createdAccount)
      }
    },
    [loadAccountWith],
  )

  const loadAccount = useCallback(async () => {
    if (!session || session.role !== 'user') {
      throw new Error('Faça login para acessar sua conta.')
    }

    return loadAccountWith(session)
  }, [loadAccountWith, session])

  const updateAccount = useCallback(
    async (changes: AccountChanges) => {
      if (!session || session.role !== 'user') {
        throw new Error('Faça login para editar sua conta.')
      }

      const updatedAccount = await accountApi.update(changes, session.token)
      setAccount(updatedAccount)
      return updatedAccount
    },
    [session],
  )

  const signOut = useCallback(() => {
    setSession(null)
    setAccount(null)
  }, [])

  const deleteAccount = useCallback(
    async (currentPassword: string) => {
      if (!session || session.role !== 'user') {
        throw new Error('Faça login para excluir sua conta.')
      }

      await accountApi.delete(currentPassword, session.token)
    },
    [session],
  )

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      account,
      isGuest: session?.role === 'guest',
      isUser: session?.role === 'user',
      startGuestSession,
      login,
      register,
      loadAccount,
      updateAccount,
      deleteAccount,
      signOut,
    }),
    [
      account,
      deleteAccount,
      loadAccount,
      login,
      register,
      session,
      signOut,
      startGuestSession,
      updateAccount,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
