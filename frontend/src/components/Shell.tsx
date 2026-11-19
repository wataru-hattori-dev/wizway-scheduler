import { useEffect, type ReactNode } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useApp } from '../model/store'
import { useSystemDate } from '../model/systemDate'
import {
  SidebarDeadlines,
  SidebarInterviewPeriod,
  SidebarMyStatus,
} from './SidebarPanels'

const ROLE_LABEL: Record<string, string> = {
  admin: '管理者',
  manager: 'Mgr',
  sales: '営業',
  engineer: 'エンジニア',
}

type NavItem = { id: string; label: string }

export function Shell({ children }: { children: ReactNode }) {
  const app = useApp()
  const auth = useAuth()
  const {
    view,
    role,
    state,
    toast,
    apiReady,
    apiError,
    apiBusy,
  } = app
  const { dateLocal, isOverride, setDateLocal } = useSystemDate()
  const accessRole = auth.accessRole

  let nav: NavItem[] = [{ id: 'home', label: '案内' }]
  if (accessRole === 'admin') {
    nav = [
      { id: 'home', label: '案内' },
      { id: 'admin', label: ROLE_LABEL.admin },
      { id: 'manager', label: ROLE_LABEL.manager },
      { id: 'sales', label: ROLE_LABEL.sales },
      { id: 'engineer', label: ROLE_LABEL.engineer },
    ]
  } else if (view !== 'home') {
    nav = [
      { id: 'home', label: '案内' },
      { id: role, label: ROLE_LABEL[role] || role },
    ]
  }

  // mgr / engineer はホーム案内へ行けない（ガードで自画面へ戻る）ため案内を出さない
  if (accessRole === 'mgr') {
    nav = [{ id: 'manager', label: ROLE_LABEL.manager }]
  } else if (accessRole === 'engineer') {
    nav = [{ id: 'engineer', label: ROLE_LABEL.engineer }]
  }

  const showApiStatus = !apiReady || Boolean(apiError) || apiBusy

  useEffect(() => {
    const titles: Record<string, string> = {
      home: '案内',
      admin: '管理者',
      manager: 'Mgr',
      sales: '営業',
      engineer: 'エンジニア',
    }
    document.title = `${titles[view] || 'トップ'} | 三者面談 日程調整`
    window.scrollTo(0, 0)
  }, [view])

  const onNav = (id: string) => {
    if (accessRole === 'admin') {
      if (id === 'home') {
        app.setView('home')
        return
      }
      app.chooseRole(id)
      return
    }
    app.setView(id)
  }

  return (
    <div className="min-h-screen w-full max-w-full">
      <aside className="flex h-auto flex-col gap-[18px] overflow-y-auto bg-navy px-4 py-[22px] text-[#f6f1e8] lg:fixed lg:inset-y-0 lg:left-0 lg:z-10 lg:h-screen lg:w-[280px] lg:max-h-screen">
        <div className="flex items-center gap-3">
          <span
            className="grid h-[42px] w-[42px] place-items-center rounded-[13px] bg-accent font-bold text-white"
            aria-hidden="true"
          >
            3
          </span>
          <div>
            <strong className="block">三者面談 日程調整</strong>
            <small className="block pt-1 text-xs leading-snug text-[#d5cdc0]">Mgr / 営業 / エンジニア</small>
          </div>
        </div>

        <nav className="grid grid-cols-2 gap-1.5 lg:grid-cols-1" aria-label="画面">
          {nav.map((item) => {
            const active = view === item.id
            return (
              <button
                key={item.id}
                type="button"
                data-testid={`nav-${item.id}`}
                className={`rounded-[10px] px-2.5 py-2 text-left lg:text-left ${
                  active ? 'bg-white text-navy' : 'bg-transparent'
                }`}
                onClick={() => onNav(item.id)}
              >
                {item.label}
              </button>
            )
          })}
        </nav>

        <SidebarInterviewPeriod />
        <SidebarDeadlines />
        <SidebarMyStatus />

        <div className="mt-auto grid gap-[18px]">
          <div className="grid gap-1.5" data-testid="dev-system-date">
            <p className="text-xs text-[#d5cdc0]">開発用日付{isOverride ? '（疑似）' : ''}</p>
            <input
              type="date"
              value={dateLocal}
              onChange={(event) => setDateLocal(event.target.value)}
              className="dev-date-local w-full cursor-pointer rounded-[10px] border border-[#3C653A] bg-white/10 px-2.5 py-2 text-sm text-[rgb(28_51_52/var(--tw-bg-opacity,1))] [color-scheme:dark]"
              aria-label="開発用の基準日付"
            />
          </div>
          <p
            className={`rounded-xl bg-white/5 px-3 py-2.5 ${
              state.hongoJoins ? 'shadow-[inset_3px_0_0_#efb08a]' : ''
            }`}
          >
            今期の本郷: {state.hongoJoins ? '参加' : '不参加'}
          </p>
          <div className="grid gap-1.5">
            {auth.user?.displayName ? (
              <p className="text-xs text-[#d5cdc0]" data-testid="auth-user">
                {auth.user.displayName}
                {accessRole ? `（${accessRole}）` : ''}
              </p>
            ) : accessRole ? (
              <p className="text-xs text-[#d5cdc0]" data-testid="auth-user">
                ロール: {accessRole}
              </p>
            ) : null}
            <button
              type="button"
              className="rounded-[10px] border border-[#3C653A] bg-transparent px-2.5 py-2 text-left text-sm text-[#f6f1e8]"
              onClick={() => auth.logout()}
              data-testid="logout"
            >
              ログアウト
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-h-screen w-full max-w-full min-w-0 flex-col overflow-x-hidden lg:pl-[280px]">
        {(apiBusy || !apiReady) && (
          <div
            className="pointer-events-none h-0.5 w-full overflow-hidden bg-line"
            role="progressbar"
            aria-label={!apiReady ? 'API から読込中' : '通信中'}
          >
            <div className="h-full w-1/3 animate-pulse bg-accent" />
          </div>
        )}
        <main
          className="mx-auto w-full max-w-[1300px] min-w-0 flex-1 overflow-x-hidden p-4 lg:p-7"
          aria-busy={apiBusy || !apiReady}
        >
          {children}
        </main>
        {showApiStatus ? (
          <footer
            className="mt-auto border-t border-line/70 px-4 py-2 text-right lg:px-7"
            aria-live="polite"
          >
            {!apiReady ? (
              <p className="text-xs text-muted" data-testid="api-loading">
                API から読込中…
              </p>
            ) : null}
            {apiError ? (
              <p className="text-xs text-danger" data-testid="api-error">
                API: {apiError}
              </p>
            ) : null}
            {apiBusy ? (
              <p className="text-xs text-muted" data-testid="api-busy">
                通信中…
              </p>
            ) : null}
          </footer>
        ) : null}
      </div>

      {toast ? (
        <div
          key={toast.id}
          className={`toast-banner fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-30 flex max-w-[min(560px,calc(100%-24px))] -translate-x-1/2 items-start gap-3 rounded-2xl px-4 py-3 text-sm leading-snug text-white shadow-lg sm:items-center sm:rounded-full ${
            toast.tone === 'warn' ? 'bg-warn' : toast.tone === 'info' ? 'bg-info' : 'bg-navy'
          }`}
          role="status"
          aria-live="polite"
          data-testid="toast"
        >
          <span className="min-w-0 flex-1">{toast.message}</span>
          <button
            type="button"
            className="shrink-0 border-0 bg-transparent p-0 text-lg leading-none text-white/80 hover:text-white"
            aria-label="通知を閉じる"
            onClick={() => app.dismissToast?.()}
          >
            ×
          </button>
        </div>
      ) : null}
    </div>
  )
}
