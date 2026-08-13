import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { act, type PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthProvider } from '@/auth/AuthContext'
import { useAuth } from '@/auth/auth-context'
import { jsonResponse, userAccount } from '@/test/render-app'

function wrapper({ children }: PropsWithChildren) {
  return <AuthProvider>{children}</AuthProvider>
}

describe('AuthProvider', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', 'http://localhost:8080/api')
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('keeps the login token in memory and sends it as Bearer for the account', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          token: 'user.jwt.token',
          tokenType: 'Bearer',
          role: 'user',
          subject: userAccount.id,
        }),
      )
      .mockResolvedValueOnce(jsonResponse(userAccount))
    vi.stubGlobal('fetch', fetchMock)
    const storageSpy = vi.spyOn(Storage.prototype, 'setItem')
    const { result } = renderHook(() => useAuth(), { wrapper })

    await act(() =>
      result.current.login({ gamertag: 'turbo_fox', password: 'fast123' }),
    )

    expect(result.current.isUser).toBe(true)
    expect(result.current.account).toEqual(userAccount)
    expect(storageSpy).not.toHaveBeenCalled()

    const loginRequest = fetchMock.mock.calls[0]
    const accountRequest = fetchMock.mock.calls[1]
    expect(loginRequest[0]).toBe('http://localhost:8080/api/auth/login')
    expect(JSON.parse(String(loginRequest[1]?.body))).toEqual({
      gamertag: 'turbo_fox',
      password: 'fast123',
    })
    expect(accountRequest[0]).toBe('http://localhost:8080/api/account/me')
    expect((accountRequest[1].headers as Headers).get('Authorization')).toBe(
      'Bearer user.jwt.token',
    )
  })

  it('registers first and applies the optional avatar through account update', async () => {
    const registeredAccount = { ...userAccount, avatarId: null }
    const accountWithAvatar = {
      ...registeredAccount,
      avatarId: 'street-drifter',
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ token: 'new.jwt', role: 'user', subject: userAccount.id }),
      )
      .mockResolvedValueOnce(jsonResponse(registeredAccount))
      .mockResolvedValueOnce(jsonResponse(accountWithAvatar))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useAuth(), { wrapper })

    await act(() =>
      result.current.register({
        gamertag: 'turbo_fox',
        displayName: 'Turbo Fox',
        password: 'fast123',
        avatarId: 'street-drifter',
      }),
    )

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      gamertag: 'turbo_fox',
      displayName: 'Turbo Fox',
      password: 'fast123',
    })
    expect(fetchMock.mock.calls[2][1]?.method).toBe('PATCH')
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toEqual({
      currentPassword: 'fast123',
      avatarId: 'street-drifter',
    })
    expect(result.current.account).toEqual(accountWithAvatar)
  })

  it('starts a guest session without loading a persistent account', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        token: 'guest.jwt',
        role: 'guest',
        subject: 'guest-id',
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useAuth(), { wrapper })

    await act(() => result.current.startGuestSession())

    await waitFor(() => expect(result.current.isGuest).toBe(true))
    expect(result.current.account).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://localhost:8080/api/auth/guest',
    )
    expect(fetchMock.mock.calls[0][1]?.credentials).toBeUndefined()
  })
})
