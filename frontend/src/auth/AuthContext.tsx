import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { api } from '../api/client'
import {
  AUTH_TOKEN_KEY,
  type AccessRole,
  type AuthSession,
  type AuthUser,
  defaultPathForRole,
} from './types'

type AuthContextValue = {
  ready: boolean
  session: AuthSession | null
  user: AuthUser | null
  accessRole: AccessRole | null
  token: string | null
  isAuthenticated: boolean
  refresh: () => Promise<AuthSession | null>
  applySession: (session: AuthSession) => void
  logout: () => Promise<void>
  startSlackLogin: () => Promise<void>
  devLogin: (role: 'admin' | 'mgr' | 'engineer') => Promise<AuthSession>
  homePath: string
}

const AuthContext = createContext<AuthContextValue | null>(null)

function readStoredToken(): string | null {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY)
  } catch {
    return null
  }
}

function writeStoredToken(token: string | null) {
  try {
    if (token) localStorage.setItem(AUTH_TOKEN_KEY, token)
    else localStorage.removeItem(AUTH_TOKEN_KEY)
  } catch {
    /* ignore */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [session, setSession] = useState<AuthSession | null>(null)

  const applySession = useCallback((next: AuthSession) => {
    if (next.authenticated && next.token) {
      writeStoredToken(next.token)
      setSession(next)
      return
    }
    writeStoredToken(null)
    setSession({ authenticated: false })
  }, [])

  const refresh = useCallback(async () => {
    try {
      const me = await api.get<AuthSession>('/auth/me')
      if (me.authenticated) {
        applySession({ ...me, token: me.token || readStoredToken() || undefined })
        return me
      }
      applySession({ authenticated: false })
      return me
    } catch {
      // 401/403 は未ログイン扱い。ネットワーク等の失敗もセッションをクリアする。
      applySession({ authenticated: false })
      return { authenticated: false }
    }
  }, [applySession])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await refresh()
      if (!cancelled) setReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [refresh])

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout')
    } catch {
      /* ignore */
    }
    applySession({ authenticated: false })
    if (window.location.pathname !== '/login') {
      window.location.assign('/login')
    }
  }, [applySession])

  const startSlackLogin = useCallback(async () => {
    const redirectUri =
      import.meta.env.VITE_SLACK_REDIRECT_URI ||
      `${window.location.origin}/auth/slack/callback`
    const q = new URLSearchParams({ redirectUri })
    const res = await api.get<{ authorizeUrl: string; state: string }>(
      `/auth/slack/authorize-url?${q.toString()}`,
    )
    try {
      sessionStorage.setItem('wizway_oauth_state', res.state)
    } catch {
      /* ignore */
    }
    window.location.assign(res.authorizeUrl)
  }, [])

  const devLogin = useCallback(
    async (role: 'admin' | 'mgr' | 'engineer') => {
      const res = await api.post<AuthSession>('/auth/dev/login', { role })
      applySession(res)
      return res
    },
    [applySession],
  )

  const user = session?.authenticated ? session.user || null : null
  const accessRole = user?.accessRole || null
  const token = session?.authenticated ? session.token || readStoredToken() : null
  const homePath = accessRole ? defaultPathForRole(accessRole) : '/'

  const value = useMemo<AuthContextValue>(
    () => ({
      ready,
      session,
      user,
      accessRole,
      token,
      isAuthenticated: Boolean(session?.authenticated),
      refresh,
      applySession,
      logout,
      startSlackLogin,
      devLogin,
      homePath,
    }),
    [
      ready,
      session,
      user,
      accessRole,
      token,
      refresh,
      applySession,
      logout,
      startSlackLogin,
      devLogin,
      homePath,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
