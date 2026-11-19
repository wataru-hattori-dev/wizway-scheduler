import { useState } from 'react'
import { useAuth } from '../auth/AuthContext'

const DEV_ROLES = [
  { role: 'admin' as const, label: '管理者（マスター）', hint: '全画面を操作' },
  { role: 'mgr' as const, label: 'Mgr・本郷', hint: '/mgr のみ' },
  { role: 'engineer' as const, label: 'エンジニア', hint: '/engineer のみ' },
]

export function LoginView() {
  const auth = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isDev = import.meta.env.DEV

  const onSlack = async () => {
    setBusy(true)
    setError(null)
    try {
      await auth.startSlackLogin()
    } catch (err) {
      setBusy(false)
      setError(err instanceof Error ? err.message : 'Slack ログインを開始できませんでした')
    }
  }

  const onDev = async (role: 'admin' | 'mgr' | 'engineer') => {
    setBusy(true)
    setError(null)
    try {
      const session = await auth.devLogin(role)
      const path = session.homePath || '/'
      window.location.assign(path)
    } catch (err) {
      setBusy(false)
      setError(err instanceof Error ? err.message : '開発用ログインに失敗しました')
    }
  }

  return (
    <div className="mx-auto grid max-w-lg gap-6 py-10">
      <section className="grid gap-2">
        <p className="text-xs font-bold tracking-wider text-accent">サインイン</p>
        <h1>Slack でログイン</h1>
        <p className="leading-relaxed text-muted">
          社内 Slack アカウントで認証し、権限に応じた画面へ移動します。
        </p>
      </section>

      <button
        type="button"
        className="btn btn-primary w-full py-3 text-base font-semibold"
        onClick={onSlack}
        disabled={busy}
        data-testid="slack-login"
      >
        Slack でログイン
      </button>

      {isDev ? (
        <section className="grid gap-3 rounded-2xl border border-line bg-white p-4">
          <div>
            <h2>開発用クイックログイン</h2>
            <p className="pt-1 text-sm text-muted">
              Slack 認証を通さず、ロールを選んで即ログインできます（`import.meta.env.DEV` のみ表示）。
            </p>
          </div>
          <div className="grid gap-2">
            {DEV_ROLES.map((item) => (
              <button
                key={item.role}
                type="button"
                className="btn btn-ghost w-full text-left"
                disabled={busy}
                onClick={() => onDev(item.role)}
                data-testid={`dev-login-${item.role}`}
              >
                <span className="font-semibold">{item.label}</span>
                <span className="mt-0.5 block text-xs text-muted">{item.hint}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {error ? (
        <p className="text-sm text-danger" role="alert" data-testid="login-error">
          {error}
        </p>
      ) : null}
    </div>
  )
}
