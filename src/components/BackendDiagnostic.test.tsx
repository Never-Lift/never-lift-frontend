import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BackendDiagnostic } from '@/components/BackendDiagnostic'

describe('BackendDiagnostic', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', 'http://localhost:8080/api/')
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('shows the backend status returned by the health endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ status: 'UP', version: '0.1.0' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<BackendDiagnostic />)

    expect(screen.getByText('Verificando conexão…')).toBeInTheDocument()
    expect(await screen.findByText('backend: ok')).toBeInTheDocument()
    expect(screen.getByText('versão 0.1.0')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:8080/api/health', {
      headers: { Accept: 'application/json' },
      signal: expect.any(AbortSignal),
    })
  })

  it('shows an actionable error when the backend is unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 503 }),
    )

    render(<BackendDiagnostic />)

    expect(await screen.findByText('backend: indisponível')).toBeInTheDocument()
    expect(screen.getByText('A API respondeu com HTTP 503.')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Tentar novamente' }),
    ).toBeInTheDocument()
  })

  it('does not call fetch when VITE_API_URL is missing', async () => {
    vi.stubEnv('VITE_API_URL', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    render(<BackendDiagnostic />)

    expect(await screen.findByText('backend: indisponível')).toBeInTheDocument()
    expect(
      screen.getByText('VITE_API_URL não está configurada.'),
    ).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a successful response with an invalid payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ healthy: true }),
      }),
    )

    render(<BackendDiagnostic />)

    expect(await screen.findByText('backend: indisponível')).toBeInTheDocument()
    expect(
      screen.getByText('A API retornou um payload de health inválido.'),
    ).toBeInTheDocument()
  })
})
