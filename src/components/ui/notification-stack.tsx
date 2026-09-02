import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import type { AppNotification, NotificationTone } from '@/hooks/use-notifications'

const toneStyles: Record<NotificationTone, string> = {
  error: 'border-destructive/45 bg-destructive/12 text-destructive',
  warning: 'border-warning/45 bg-warning/12 text-warning',
  success: 'border-success/45 bg-success/12 text-success',
  info: 'border-info/45 bg-info/12 text-info',
}

function NotificationIcon({ tone }: { tone: NotificationTone }) {
  if (tone === 'success') return <CircleCheck aria-hidden="true" className="size-5" />
  if (tone === 'warning') return <TriangleAlert aria-hidden="true" className="size-5" />
  if (tone === 'info') return <Info aria-hidden="true" className="size-5" />
  return <CircleAlert aria-hidden="true" className="size-5" />
}

export function NotificationStack({
  notifications,
  onDismiss,
}: {
  notifications: AppNotification[]
  onDismiss: (id: number) => void
}) {
  if (notifications.length === 0) return null

  return (
    <div
      aria-label="Notificações"
      className="pointer-events-none fixed right-4 top-4 z-[100] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
    >
      {notifications.map((notification) => (
        <div
          className={`pointer-events-auto flex items-start gap-3 rounded-xl border p-4 shadow-xl backdrop-blur-xl ${toneStyles[notification.tone]}`}
          key={notification.id}
          role={notification.tone === 'error' ? 'alert' : 'status'}
        >
          <span className="mt-0.5 shrink-0"><NotificationIcon tone={notification.tone} /></span>
          <p className="min-w-0 flex-1 text-sm font-semibold leading-5 text-foreground">
            {notification.message}
          </p>
          <Button
            aria-label="Fechar notificação"
            className="-mr-2 -mt-2 size-8 shrink-0"
            onClick={() => onDismiss(notification.id)}
            size="icon"
            variant="ghost"
          >
            <X aria-hidden="true" className="size-4" />
          </Button>
        </div>
      ))}
    </div>
  )
}
