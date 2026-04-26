import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { AccountsPage } from './pages/AccountsPage'
import { AgentsPage } from './pages/AgentsPage'
import { ChatsPage } from './pages/ChatsPage'
import { ExportsPage } from './pages/ExportsPage'

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/accounts" replace />} />
        <Route path="/accounts" element={<AccountsPage />} />
        <Route path="/chats" element={<ChatsPage />} />
        <Route path="/agents" element={<AgentsPage />} />
        <Route path="/exports" element={<ExportsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/accounts" replace />} />
    </Routes>
  )
}
