import { Fragment } from 'react'
import { useAuth } from '../auth/AuthContext'
import type { AccessRole } from '../auth/types'
import { useApp } from '../model/store'

/** 案内画面のアクション用ロール */
export type HomeRole = 'admin' | 'mgr' | 'sales' | 'engineer'

function toHomeRole(accessRole: AccessRole | null): HomeRole {
  if (accessRole === 'admin') return 'admin'
  if (accessRole === 'mgr') return 'mgr'
  return 'engineer'
}

/** Mgr / 営業 / 管理者はステップ2の「NG日時を登録」を有効化 */
function canRegisterNg(role: HomeRole): boolean {
  return role === 'mgr' || role === 'sales' || role === 'admin'
}

/** エンジニア / 管理者はステップ3の「NG日時を回答」を有効化 */
function canAnswerNg(role: HomeRole): boolean {
  return role === 'engineer' || role === 'admin'
}

const STEPS = [
  {
    n: '1',
    title: '管理者が面談期間を設定',
    text: '面談の実施期間と回答期限を管理画面で設定します。',
    highlight: false,
  },
  {
    n: '2',
    title: 'Mgr/営業がNG日時を登録',
    text: '事前に参加できない日時を登録します。',
    highlight: false,
  },
  {
    n: '3',
    title: 'エンジニアがNG日時を回答',
    text: '提示された候補枠から、参加できない日時を回答します。',
    highlight: true,
  },
  {
    n: '4',
    title: 'Mgrが日程を最終確定',
    text: '回答をもとに日程を確定し、関係者へ Slack 通知が送られます。',
    highlight: false,
  },
]

export function HomeView() {
  const app = useApp()
  const auth = useAuth()
  const homeRole = toHomeRole(auth.accessRole)
  const registerNgEnabled = canRegisterNg(homeRole)
  const answerNgEnabled = canAnswerNg(homeRole)

  const onRegisterNg = () => {
    if (!registerNgEnabled) return
    if (homeRole === 'admin') app.chooseRole('manager')
    else if (homeRole === 'mgr') app.chooseRole('manager')
    else if (homeRole === 'sales') app.chooseRole('sales')
  }

  const onAnswerNg = () => {
    if (!answerNgEnabled) return
    app.chooseRole('engineer')
  }

  return (
    <div className="grid gap-[18px]">
      <section className="pt-2">
        <p className="text-xs font-bold tracking-wider text-accent">案内</p>
        <h1>日程調整の流れ</h1>
        <p className="max-w-3xl leading-relaxed text-muted">
          このツールでは、管理者 → Mgr/営業 → エンジニア → Mgrの順で面談日程を整えます。
        </p>
      </section>

      <section aria-label="全体フロー">
        <h2>全体の流れ（4ステップ）</h2>
        <ol className="mt-3 flex list-none flex-col items-start gap-0 p-0 lg:flex-row">
          {STEPS.map((step, index) => (
            <Fragment key={step.n}>
              <li
                className={
                  step.highlight
                    ? 'flex min-w-0 w-full flex-1 flex-col rounded-card border-2 border-accent bg-accent-soft/60 p-[18px] shadow-card lg:w-auto'
                    : 'flex min-w-0 w-full flex-1 flex-col rounded-card border border-line bg-paper p-[18px] shadow-card lg:w-auto'
                }
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span
                    className={
                      step.highlight
                        ? 'inline-grid h-7 w-7 place-items-center rounded-full bg-accent text-[13px] font-bold text-white'
                        : 'inline-grid h-7 w-7 place-items-center rounded-full bg-navy text-[13px] text-white'
                    }
                  >
                    {step.n}
                  </span>
                  {step.highlight ? (
                    <span className="rounded-full border border-accent/40 bg-white px-2.5 py-0.5 text-xs font-semibold text-accent">
                      あなたの担当
                    </span>
                  ) : null}
                </div>
                <strong className="block leading-snug">{step.title}</strong>
                <p className="mt-1.5 leading-relaxed text-muted">{step.text}</p>

                {step.n === '2' && registerNgEnabled ? (
                  <div className="pt-3">
                    <button
                      type="button"
                      className="btn btn-primary w-full"
                      data-testid="go-register-ng"
                      onClick={onRegisterNg}
                    >
                      NG日時を登録
                    </button>
                  </div>
                ) : null}

                {step.n === '3' && answerNgEnabled ? (
                  <div className="pt-3">
                    <button
                      type="button"
                      className="btn btn-primary w-full"
                      data-testid="go-engineer"
                      onClick={onAnswerNg}
                    >
                      NG日時を回答
                    </button>
                  </div>
                ) : null}
              </li>
              {index < STEPS.length - 1 ? (
                <li
                  className="flex shrink-0 items-center justify-center self-center py-1 text-xl font-semibold text-muted lg:px-2.5 lg:py-0"
                  aria-hidden="true"
                >
                  <span className="lg:hidden">↓</span>
                  <span className="hidden lg:inline">→</span>
                </li>
              ) : null}
            </Fragment>
          ))}
        </ol>
      </section>
    </div>
  )
}
