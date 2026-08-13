import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { jsonResponse, renderApp, userAccount } from '@/test/render-app'

function loginResponses(fetchMock: ReturnType<typeof vi.fn>) {
  fetchMock
    .mockResolvedValueOnce(
      jsonResponse({ token: 'user.jwt', role: 'user', subject: userAccount.id }),
    )
    .mockResolvedValueOnce(jsonResponse(userAccount))
}

async function loginAndOpenAccount(
  user: ReturnType<typeof userEvent.setup>,
) {
  renderApp('/login')
  await user.type(screen.getByLabelText('Gamertag'), 'turbo_fox')
  await user.type(screen.getByLabelText('Senha'), 'fast123')
  await user.click(screen.getByRole('button', { name: 'Entrar' }))
  await user.click(await screen.findByRole('link', { name: 'Editar minha conta' }))
  expect(await screen.findByRole('heading', { name: 'Minha conta' })).toBeInTheDocument()
}

describe('AccountPage', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', 'http://localhost:8080/api')
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('keeps the original account when the current password is wrong on edit', async () => {
    const fetchMock = vi.fn()
    loginResponses(fetchMock)
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { code: 'invalid_current_password', message: 'Wrong password' },
        401,
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    await loginAndOpenAccount(user)

    const displayName = screen.getByLabelText('Nome de exibição')
    await user.clear(displayName)
    await user.type(displayName, 'Changed Name')
    await user.type(screen.getByLabelText('Senha atual'), 'wrong')
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A senha atual está incorreta.',
    )
    await user.click(screen.getByRole('link', { name: /Never Lift/ }))
    expect(await screen.findByText('Piloto autenticado')).toBeInTheDocument()
    expect(screen.getByText('Turbo Fox')).toBeInTheDocument()
    expect(screen.queryByText('Changed Name')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('requires an irreversible AlertDialog confirmation and preserves the account on wrong password', async () => {
    const fetchMock = vi.fn()
    loginResponses(fetchMock)
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { code: 'invalid_current_password', message: 'Wrong password' },
        401,
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    await loginAndOpenAccount(user)

    await user.click(screen.getByRole('button', { name: 'Excluir conta' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(
      within(dialog).getByText(/Esta ação é irreversível/),
    ).toBeInTheDocument()

    await user.type(within(dialog).getByLabelText('Senha atual'), 'wrong')
    await user.click(
      within(dialog).getByRole('button', {
        name: 'Sim, excluir permanentemente',
      }),
    )

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'A senha atual está incorreta.',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }))
    await user.click(screen.getByRole('link', { name: /Never Lift/ }))
    expect(await screen.findByText('Piloto autenticado')).toBeInTheDocument()
    expect(screen.getByText('Turbo Fox')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('deletes the account only after an accepted password', async () => {
    const fetchMock = vi.fn()
    loginResponses(fetchMock)
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        jsonResponse({ token: 'guest.jwt', role: 'guest', subject: 'guest-id' }),
      )
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    await loginAndOpenAccount(user)

    await user.click(screen.getByRole('button', { name: 'Excluir conta' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.type(within(dialog).getByLabelText('Senha atual'), 'fast123')
    await user.click(
      within(dialog).getByRole('button', {
        name: 'Sim, excluir permanentemente',
      }),
    )

    expect(
      await screen.findByText('Faça login para acessar sua conta.'),
    ).toBeInTheDocument()
    expect(fetchMock.mock.calls[2][1]?.method).toBe('DELETE')
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toEqual({
      currentPassword: 'fast123',
    })
  })

  it('updates account fields after the password is accepted', async () => {
    const updatedAccount = {
      ...userAccount,
      displayName: 'Turbo Fox Prime',
      avatarId: 'garage-tuner',
    }
    const fetchMock = vi.fn()
    loginResponses(fetchMock)
    fetchMock.mockResolvedValueOnce(jsonResponse(updatedAccount))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    await loginAndOpenAccount(user)

    const displayName = screen.getByLabelText('Nome de exibição')
    await user.clear(displayName)
    await user.type(displayName, 'Turbo Fox Prime')
    await user.click(screen.getByRole('radio', { name: 'Preparadora de garagem' }))
    await user.type(screen.getByLabelText('Senha atual'), 'fast123')
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Conta atualizada com sucesso.',
    )
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:8080/api/account/me',
        expect.objectContaining({ method: 'PATCH' }),
      ),
    )
    expect(screen.getByDisplayValue('Turbo Fox Prime')).toBeInTheDocument()
  })

  it('allows removing the current avatar explicitly', async () => {
    const updatedAccount = {
      ...userAccount,
      avatarId: null,
    }
    const fetchMock = vi.fn()
    loginResponses(fetchMock)
    fetchMock.mockResolvedValueOnce(jsonResponse(updatedAccount))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    await loginAndOpenAccount(user)

    await user.click(screen.getByRole('radio', { name: 'Sem avatar' }))
    await user.type(screen.getByLabelText('Senha atual'), 'fast123')
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Conta atualizada com sucesso.',
    )
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toEqual({
      currentPassword: 'fast123',
      displayName: userAccount.displayName,
      avatarId: null,
    })
  })
})
