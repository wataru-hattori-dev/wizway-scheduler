import { useAuth } from '../auth/AuthContext'

export function AccessDeniedView() {
  const auth = useAuth()

  return (
    <div className="mx-auto grid max-w-lg gap-5 py-10">
      <section className="grid gap-2">
        <p className="text-xs font-bold tracking-wider text-danger">権限エラー</p>
        <h1>アクセス権限がありません</h1>
        <p className="leading-relaxed text-muted">
          このツールは社内ワークスペースのメンバーのみ利用できます。
          別の Slack ワークスペースでログインしている場合は、社内アカウントで再度サインインしてください。
        </p>
      </section>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary" onClick={() => auth.logout()}>
          ログアウトしてやり直す
        </button>
      </div>
    </div>
  )
}
