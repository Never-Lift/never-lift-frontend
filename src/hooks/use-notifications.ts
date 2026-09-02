import { useCallback, useEffect, useRef, useState } from 'react'

export type NotificationTone = 'error' | 'warning' | 'success' | 'info'

export type AppNotification = {
  id: number
  message: string
  tone: NotificationTone
}

export function useNotifications(durationMs = 5_000) {
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const nextId = useRef(0)
  const timers = useRef(new Map<number, number>())

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id)
    if (timer !== undefined) window.clearTimeout(timer)
    timers.current.delete(id)
    setNotifications((current) => current.filter((item) => item.id !== id))
  }, [])

  const notify = useCallback((message: string, tone: NotificationTone = 'error') => {
    const id = ++nextId.current
    setNotifications((current) => [...current, { id, message, tone }])
    const timer = window.setTimeout(() => dismiss(id), durationMs)
    timers.current.set(id, timer)
    return id
  }, [dismiss, durationMs])

  useEffect(() => () => {
    timers.current.forEach((timer) => window.clearTimeout(timer))
    timers.current.clear()
  }, [])

  return { notifications, notify, dismiss }
}
