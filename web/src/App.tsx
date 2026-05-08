import { Navigate, Route, Routes } from 'react-router-dom'
import { RequireAdmin, RequireAuth, useAuth } from './auth/AuthContext'
import { AppShell } from './components/AppShell'
import { AccountsPage } from './pages/AccountsPage'
import { AdminPage } from './pages/AdminPage'
import { ChatsPage } from './pages/ChatsPage'
import { ExportsPage } from './pages/ExportsPage'
import { LoginPage } from './pages/LoginPage'
import { RegisterPage } from './pages/RegisterPage'
import { ScriptsPage } from './pages/ScriptsPage'

export default function App() {
  const auth = useAuth()
  const defaultPath = auth.cloudAdminOnly ? '/admin' : '/accounts'

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to={defaultPath} replace />} />
          {!auth.cloudAdminOnly ? (
            <>
              <Route path="/accounts" element={<AccountsPage />} />
              <Route path="/chats" element={<ChatsPage />} />
              <Route path="/exports" element={<ExportsPage />} />
              <Route path="/scripts" element={<ScriptsPage />} />
            </>
          ) : null}
          <Route element={<RequireAdmin />}>
            <Route path="/admin" element={<AdminPage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to={defaultPath} replace />} />
    </Routes>
  )
}
