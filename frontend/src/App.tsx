import { useEffect, type ReactNode } from 'react'
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { defaultPathForRole, isPathAllowed } from './auth/types'
import { Shell } from './components/Shell'
import { InterviewPeriodProvider } from './model/interviewPeriod'
import { ResponseDeadlinesProvider } from './model/responseDeadlines'
import { AppProvider, useApp } from './model/store'
import { DateProvider } from './model/systemDate'
import { AccessDeniedView } from './views/AccessDeniedView'
import { AdminView } from './views/AdminView'
import { EngineerView } from './views/EngineerView'
import { HomeView } from './views/HomeView'
import { LoginView } from './views/LoginView'
import { ManagerView } from './views/ManagerView'
import { SalesView } from './views/SalesView'
import { SlackCallbackView } from './views/SlackCallbackView'

/** store の view と react-router の URL を同期する */
function PathSync() {
  const { syncFromPath, bindNavigate } = useApp()
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    bindNavigate((path: string, options?: { replace?: boolean }) => {
      navigate(path, { replace: options?.replace })
    })
  }, [bindNavigate, navigate])

  useEffect(() => {
    syncFromPath(location.pathname)
  }, [location.pathname, syncFromPath])

  return null
}

function AuthGate({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const location = useLocation()
  const path = location.pathname

  if (!auth.ready) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center text-muted" data-testid="auth-loading">
        認証状態を確認しています…
      </div>
    )
  }

  if (path === '/login' || path.startsWith('/auth/slack/callback')) {
    if (auth.isAuthenticated && path === '/login') {
      const role = auth.accessRole
      if (role === 'denied') return <Navigate to="/access-denied" replace />
      return <Navigate to={auth.homePath || '/'} replace />
    }
    return <>{children}</>
  }

  if (!auth.isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: path }} />
  }

  const role = auth.accessRole
  if (!role) {
    return <Navigate to="/login" replace />
  }

  if (role === 'denied') {
    if (path !== '/access-denied') return <Navigate to="/access-denied" replace />
    return <>{children}</>
  }

  if (!isPathAllowed(role, path)) {
    return <Navigate to={defaultPathForRole(role)} replace />
  }

  return <>{children}</>
}

function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <AuthGate>
            <LoginView />
          </AuthGate>
        }
      />
      <Route
        path="/auth/slack/callback"
        element={
          <AuthGate>
            <SlackCallbackView />
          </AuthGate>
        }
      />
      <Route
        path="/access-denied"
        element={
          <AuthGate>
            <AccessDeniedView />
          </AuthGate>
        }
      />
      <Route
        path="*"
        element={
          <AuthGate>
            <AuthedShell />
          </AuthGate>
        }
      />
    </Routes>
  )
}

function AuthedShell() {
  return (
    <Shell>
      <PathSync />
      <Routes>
        <Route path="/admin" element={<AdminView />} />
        <Route path="/mgr" element={<ManagerView />} />
        <Route path="/sales-mgr" element={<Navigate to="/mgr" replace />} />
        <Route path="/sales" element={<SalesView />} />
        <Route path="/engineer" element={<EngineerView />} />
        <Route path="/member" element={<Navigate to="/engineer" replace />} />
        <Route path="/" element={<HomeView />} />
        <Route path="*" element={<HomeView />} />
      </Routes>
    </Shell>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <DateProvider>
          <InterviewPeriodProvider>
            <ResponseDeadlinesProvider>
              <AppProvider>
                <AppRoutes />
              </AppProvider>
            </ResponseDeadlinesProvider>
          </InterviewPeriodProvider>
        </DateProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
