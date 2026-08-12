import { Route, Routes } from 'react-router-dom'

import { AccountRoute } from '@/components/RouteGuards'
import { AccountPage } from '@/pages/AccountPage'
import { AuthPage } from '@/pages/AuthPage'
import { HomePage } from '@/pages/HomePage'

export function App() {
  return (
    <Routes>
      <Route element={<HomePage />} path="/" />
      <Route element={<AuthPage mode="login" />} path="/login" />
      <Route element={<AuthPage mode="register" />} path="/register" />

      <Route element={<AccountRoute />}>
        <Route element={<AccountPage />} path="/account" />
      </Route>

      <Route element={<HomePage />} path="*" />
    </Routes>
  )
}
