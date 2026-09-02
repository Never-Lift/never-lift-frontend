import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { NotificationStack } from '@/components/ui/notification-stack'
import { useNotifications } from '@/hooks/use-notifications'

function Harness() {
  const { notifications, notify, dismiss } = useNotifications()
  return (
    <>
      <button onClick={() => notify('Falha de conexão')}>Erro</button>
      <button onClick={() => notify('Tudo certo', 'success')}>Sucesso</button>
      <NotificationStack notifications={notifications} onDismiss={dismiss} />
    </>
  )
}

describe('NotificationStack', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('can be dismissed with the close button', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Erro' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Falha de conexão')
    await userEvent.click(screen.getByRole('button', { name: 'Fechar notificação' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('expires automatically after five seconds', () => {
    vi.useFakeTimers()
    render(<Harness />)
    act(() => screen.getByRole('button', { name: 'Sucesso' }).click())
    expect(screen.getByRole('status')).toHaveTextContent('Tudo certo')
    act(() => vi.advanceTimersByTime(5_000))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
