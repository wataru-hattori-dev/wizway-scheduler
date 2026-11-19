import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import type { AuthSession } from '../auth/types'
import { defaultPathForRole } from '../auth/types'

export function SlackCallbackView() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const auth = useAuth()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const code = params.get('code')
      const state = params.get('state')
      const oauthError = params.get('error')
      if (oauthError) {
        setError(`Slack 認証がキャンセルまたは失敗しました（${oauthError}）`)
        return
      }
      if (!code) {
        setError('認可コードがありません')
        return
      }
      try {
        const storedState = sessionStorage.getItem('wizway_oauth_state')
        if (storedState && state && storedState !== state) {
          setError('不正な state です。もう一度ログインしてください。')
          return
        }
      } catch {
        /* ignore */
      }

      const redirectUri =
        import.meta.env.VITE_SLACK_REDIRECT_URI ||
        `${window.location.origin}/auth/slack/callback`

      try {
        const session = await api.post<AuthSession>('/auth/slack/callback', {
          code,
          redirectUri,
          state: state || undefined,
        })
        if (cancelled) return
        auth.applySession(session)
        const role = session.user?.accessRole
        const next =
          session.homePath ||
          (role ? defaultPathForRole(role) : '/')
        navigate(next, { replace: true })
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : '認証に失敗しました')
      }
    })()
    return () => {
      cancelled = true
    }
    // 初回マウント時のみ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (error) {
    return (
      <div className="mx-auto grid max-w-lg gap-4 py-10">
        <h1>ログインに失敗しました</h1>
        <p className="text-muted">{error}</p>
        <button type="button" className="btn btn-primary" onClick={() => navigate('/login', { replace: true })}>
          ログイン画面へ
        </button>
      </div>
    )
  }

  return (
    <div className="mx-auto grid max-w-lg gap-3 py-10">
      <h1>認証中…</h1>
      <p className="text-muted">Slack の認可結果を確認しています。</p>
    </div>
  )
}
