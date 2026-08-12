import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { useAuth } from '@/auth/auth-context'

export function OnlineRoute() {
  const { isUser } = useAuth()
  const location = useLocation()

  if (!isUser) {
    return (
      <Navigate
        replace
        state={{
          from: location.pathname,
          message: 'Faça login para liberar os modos online.',
        }}
        to="/login"
      />
    )
  }

  return <Outlet />
}

export function AccountRoute() {
  const { isUser } = useAuth()
  const location = useLocation()

  if (!isUser) {
    return (
      <Navigate
        replace
        state={{
          from: location.pathname,
          message: 'Faça login para acessar sua conta.',
        }}
        to="/login"
      />
    )
  }

  return <Outlet />
}
