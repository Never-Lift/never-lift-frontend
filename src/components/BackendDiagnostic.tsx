import { useEffect, useState } from 'react'
import { CircleAlert, CircleCheck, LoaderCircle, RotateCw } from 'lucide-react'

type HealthResponse = {
  status: string
  version?: string
}

type DiagnosticState =
  | { phase: 'loading' }
  | { phase: 'success'; health: HealthResponse }
  | { phase: 'error'; message: string }

function isHealthResponse(value: unknown): value is HealthResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    typeof value.status === 'string' &&
    (!('version' in value) ||
      value.version === undefined ||
      typeof value.version === 'string')
  )
}

function formatHealthStatus(status: string) {
  const normalizedStatus = status.trim().toLowerCase()

  return normalizedStatus === 'up' ? 'ok' : normalizedStatus
}

export function BackendDiagnostic() {
  const [attempt, setAttempt] = useState(0)
  const [diagnostic, setDiagnostic] = useState<DiagnosticState>({
    phase: 'loading',
  })

  useEffect(() => {
    const controller = new AbortController()
    const apiUrl = import.meta.env.VITE_API_URL?.trim().replace(/\/+$/, '')

    if (!apiUrl) {
      setDiagnostic({
        phase: 'error',
        message: 'VITE_API_URL não está configurada.',
      })
      return () => controller.abort()
    }

    setDiagnostic({ phase: 'loading' })

    async function checkBackend() {
      try {
        const response = await fetch(`${apiUrl}/health`, {
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        })

        if (!response.ok) {
          throw new Error(`A API respondeu com HTTP ${response.status}.`)
        }

        const health: unknown = await response.json()

        if (!isHealthResponse(health)) {
          throw new Error('A API retornou um payload de health inválido.')
        }

        setDiagnostic({ phase: 'success', health })
      } catch (error) {
        if (controller.signal.aborted) return

        setDiagnostic({
          phase: 'error',
          message:
            error instanceof Error
              ? error.message
              : 'Não foi possível consultar o backend.',
        })
      }
    }

    void checkBackend()

    return () => controller.abort()
  }, [attempt])

  return (
    <aside
      aria-live="polite"
      className="surface-panel p-5"
    >
      <div className="mb-5 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Estado do backend
        </p>
        <span className="size-2 rounded-full bg-muted-foreground/50" />
      </div>

      {diagnostic.phase === 'loading' && (
        <div className="flex items-center gap-3 text-sm">
          <LoaderCircle
            aria-hidden="true"
            className="size-5 animate-spin text-primary"
          />
          <span>Verificando conexão…</span>
        </div>
      )}

      {diagnostic.phase === 'success' && (
        <div className="flex items-start gap-3">
          <CircleCheck aria-hidden="true" className="mt-0.5 size-5 text-success" />
          <div>
            <p className="font-mono text-lg font-bold">
              backend: {formatHealthStatus(diagnostic.health.status)}
            </p>
            {diagnostic.health.version && (
              <p className="mt-1 text-xs text-muted-foreground">
                versão {diagnostic.health.version}
              </p>
            )}
          </div>
        </div>
      )}

      {diagnostic.phase === 'error' && (
        <div>
          <div className="flex items-start gap-3">
            <CircleAlert aria-hidden="true" className="mt-0.5 size-5 text-destructive" />
            <div>
              <p className="font-mono text-lg font-bold">backend: indisponível</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {diagnostic.message}
              </p>
            </div>
          </div>
          <button
            className="mt-5 inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-semibold transition hover:border-primary/60 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            onClick={() => setAttempt((current) => current + 1)}
            type="button"
          >
            <RotateCw aria-hidden="true" className="size-3.5" />
            Tentar novamente
          </button>
        </div>
      )}
    </aside>
  )
}
