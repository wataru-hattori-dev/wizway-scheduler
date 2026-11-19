import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { VoteEditor } from '../components/VoteEditor'
import { VotingPeriodBanner } from '../components/VotingPeriodBanner'
import { confirmedWindow, formatDateTime, formatRange } from '../model/format'
import {
  formatDateSlash,
  isAfterEngineerDeadline,
  isBeforeEngineerOpen,
  nextCalendarDay,
  useResponseDeadlines,
} from '../model/responseDeadlines'
import { isGeneralEngineer } from '../model/membersMaster'
import { assignedSalesId, hasAnySalesOffer, isLocked, SALES_LABEL, salesOfferedOk, validateVotes } from '../model/rules'
import { interviewMembersOf, memberById, SECTIONS, sectionById } from '../model/seed'
import { useApp } from '../model/store'
import { useSystemDate } from '../model/systemDate'

/** エンジニア画面の切替対象: 一般エンジニアのみ（Mgr / 営業 / 本郷 / 社長は除外） */
function engineerSwitchMembers(sectionId?: string) {
  return interviewMembersOf(sectionId).filter((member) => isGeneralEngineer(member))
}

type VoteMark = 'first' | 'ok' | 'ng'
type VotesMap = Record<string, VoteMark | null | undefined>

function slotDayIso(slot: { day?: string; start: string }) {
  return slot.day || String(slot.start).slice(0, 10)
}

export function EngineerView() {
  // メンバー切替で EngineerPanel が remount されても開閉状態を維持する
  const [memberSwitchOpen, setMemberSwitchOpen] = useState(false)
  // 初期は未選択。他人の予定の誤閲覧・上書きを防ぐ
  const [selectedEngineerId, setSelectedEngineerId] = useState('')
  return (
    <EngineerPanel
      key={selectedEngineerId || 'unset'}
      selectedEngineerId={selectedEngineerId}
      setSelectedEngineerId={setSelectedEngineerId}
      memberSwitchOpen={memberSwitchOpen}
      setMemberSwitchOpen={setMemberSwitchOpen}
    />
  )
}

function EngineerPanel({
  selectedEngineerId,
  setSelectedEngineerId,
  memberSwitchOpen,
  setMemberSwitchOpen,
}: {
  selectedEngineerId: string
  setSelectedEngineerId: (id: string) => void
  memberSwitchOpen: boolean
  setMemberSwitchOpen: Dispatch<SetStateAction<boolean>>
}) {
  const app = useApp()
  const member = selectedEngineerId ? memberById(selectedEngineerId) : undefined
  const sectionId = member?.sectionId || 'unset'
  const section = sectionById(sectionId)
  const sectionLabel = section?.name || 'セクション未設定'
  const sectionUnset = !section
  const { nowMs, ready: dateReady } = useSystemDate()
  const { mgrSalesDeadline, engineerDeadline } = useResponseDeadlines()
  const interview = member ? app.state.interviews[member.id] : undefined
  const sectionSlotCount = member
    ? app.state.slots.filter((slot) => slot.sectionId === sectionId).length
    : 0
  const salesId = member ? assignedSalesId(app.state, member.id) : null
  const salesName = salesId ? SALES_LABEL[salesId] : null
  const slots = member
    ? app.state.slots
        .filter((slot) => slot.sectionId === sectionId)
        .filter((slot) => salesOfferedOk(app.state, member.id, slot).length > 0)
        .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
    : []
  const savedVotes = (member && app.state.votes[member.id]) || {}
  const locked = isLocked(interview)
  const confirmed = confirmedWindow(interview, app.state.slots)
  const hasOffer = member ? hasAnySalesOffer(app.state, member.id) : false
  // Mgr/営業回答期限の翌日 00:00 まで入力・フォームをロック（未設定時はロックしない）
  const engineerOpenDay = nextCalendarDay(mgrSalesDeadline)
  const beforeEngineerOpen = dateReady && isBeforeEngineerOpen(mgrSalesDeadline, nowMs)
  // エンジニア回答期限日の翌日 00:00 以降は操作だけ止める（未設定時は止めない）
  const afterEngineerDeadline = dateReady && isAfterEngineerDeadline(engineerDeadline, nowMs)
  const votingClosed = afterEngineerDeadline && !locked
  const [editingVotes, setEditingVotes] = useState(false)
  const [votesDraft, setVotesDraft] = useState<VotesMap>(() => ({
    ...((member && app.state.votes[member.id]) || {}),
  }))
  const [votesSubmitting, setVotesSubmitting] = useState(false)

  const switchGroups = SECTIONS.map((sectionItem) => ({
    id: sectionItem.id,
    name: sectionItem.name,
    members: engineerSwitchMembers(sectionItem.id),
  }))

  useEffect(() => {
    if (editingVotes || !member) return
    setVotesDraft({ ...(app.state.votes[member.id] || {}) })
  }, [member?.id, app.state.votes, editingVotes, member])

  const activeVotes = editingVotes ? votesDraft : savedVotes
  const check = validateVotes(activeVotes, slots)

  const providerLabel = app.state.provider === 'zoom' ? 'Zoom' : 'Google Meet'

  const switchMember = (nextId: string) => {
    if (editingVotes && nextId !== selectedEngineerId) {
      const leave = window.confirm('優先度の編集中です。保存せずに切り替えますか？')
      if (!leave) return
      setEditingVotes(false)
    }
    setSelectedEngineerId(nextId)
    if (nextId) app.setActiveMemberId(nextId)
  }

  const engineerSelect = (
      <section className="grid gap-3.5" aria-label="メンバー切り替え">
        <button
          type="button"
          data-testid="member-switch"
          aria-expanded={memberSwitchOpen}
          aria-controls="member-switch-panel"
          className="flex w-full items-center justify-between gap-3 rounded-card border border-line bg-paper px-4 py-3 text-left shadow-card transition hover:bg-accent-soft md:w-[calc((100%-3.75rem)*5/6+3rem)]"
          onClick={() => setMemberSwitchOpen((open) => !open)}
        >
          <span className="grid min-w-0 gap-0.5">
            <span className="text-xs font-bold tracking-wider text-muted">表示するエンジニア</span>
            <span className="truncate text-sm font-bold text-ink">
              {member?.name || '選択してください'}
              <span className="font-normal text-muted"></span>
            </span>
          </span>
          <span
            className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line text-muted transition-transform duration-300 ease-out ${
              memberSwitchOpen ? 'rotate-180' : 'rotate-0'
            }`}
            aria-hidden="true"
          >
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </span>
        </button>

        <div
          id="member-switch-panel"
          className={`grid transition-[grid-template-rows] duration-300 ease-out ${
            memberSwitchOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
          }`}
          aria-hidden={!memberSwitchOpen}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
              {switchGroups.map((group) => (
                <div
                  key={group.id}
                  className="rounded-card border border-line bg-paper p-3 shadow-card"
                >
                  <h3 className="m-0 text-sm font-bold text-ink">{group.name}</h3>
                  <ul className="m-0 mt-2 grid list-none gap-1.5 p-0">
                    {group.members.length === 0 ? (
                      <li className="px-1 text-xs text-muted">（なし）</li>
                    ) : (
                      group.members.map((item) => {
                        const active = String(item.id) === selectedEngineerId
                        return (
                          <li key={item.id}>
                            <button
                              type="button"
                              className={`w-full rounded-xl border px-3 py-2 text-left text-sm transition ${
                                active
                                  ? 'border-[#c6532a] bg-[#c6532a] text-white'
                                  : 'border-line bg-white text-ink hover:bg-accent-soft'
                              }`}
                              onClick={() => switchMember(String(item.id))}
                              aria-current={active ? 'true' : undefined}
                            >
                              {item.surname}
                            </button>
                          </li>
                        )
                      })
                    )}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
  )

  if (!selectedEngineerId) {
    return (
      <div className="grid w-full max-w-full min-w-0 gap-[18px] overflow-x-hidden">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 max-w-xl flex-1">
            <p className="text-xs font-bold tracking-wider text-accent">エンジニア</p>
            <h1>エンジニア画面</h1>
          </div>
        </header>
        {engineerSelect}
        <section
          className="grid w-full max-w-full min-w-0 place-items-center rounded-card border border-line bg-paper p-6 shadow-card"
          aria-label="エンジニア未選択の案内"
        >
          <div className="grid max-w-lg gap-2 text-center">
            <p className="m-0 text-base font-semibold text-ink">エンジニアを選択してください</p>
            <p className="m-0 text-sm text-muted">
              表示するエンジニアを選ぶと、候補日時への参加可否を確認・入力できます。
            </p>
          </div>
        </section>
      </div>
    )
  }

  if (!member) {
    return (
      <div className="grid w-full max-w-full min-w-0 gap-[18px] overflow-x-hidden">
        {engineerSelect}
        <section
          className="grid w-full max-w-full min-w-0 place-items-center rounded-card border border-line bg-paper p-6 shadow-card"
          aria-label="メンバー未選択"
        >
          <div className="grid max-w-lg gap-2 text-center">
            <p className="m-0 text-base font-semibold text-ink">表示するエンジニアが見つかりません</p>
            <p className="m-0 text-sm text-muted">管理者画面でメンバーを確認してください。</p>
          </div>
        </section>
      </div>
    )
  }

  const startEditVotes = () => {
    setVotesDraft({ ...savedVotes })
    setEditingVotes(true)
  }

  const cancelEditVotes = () => {
    setVotesDraft({ ...savedVotes })
    setEditingVotes(false)
  }

  const saveEditVotes = async () => {
    if (votesSubmitting) return
    setVotesSubmitting(true)
    try {
      const ok = await app.saveMemberVotes(member.id, votesDraft)
      if (ok) setEditingVotes(false)
    } finally {
      setVotesSubmitting(false)
    }
  }

  const applyDraftVote = (slotId: string, mark: VoteMark) => {
    setVotesDraft((prev) => {
      const next = { ...prev }
      if (next[slotId] === mark) delete next[slotId]
      else next[slotId] = mark
      return next
    })
  }

  const applyDraftDayMark = (day: string, mark: VoteMark | null) => {
    setVotesDraft((prev) => {
      const next = { ...prev }
      for (const slot of slots) {
        if (slotDayIso(slot) !== day) continue
        if (!mark) delete next[slot.id]
        else next[slot.id] = mark
      }
      return next
    })
  }

  return (
    <div className="grid w-full max-w-full min-w-0 gap-[18px] overflow-x-hidden">
      <VotingPeriodBanner show={afterEngineerDeadline} />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-xl flex-1">
          <p className="text-xs font-bold tracking-wider text-accent">エンジニア</p>
          <h1>{member.name}</h1>
          <p className="mt-2 leading-relaxed text-red-600">
            {sectionUnset
              ? 'セクション未設定 · 管理者による所属設定をお待ちください'
              : `回答期限 ${formatDateTime(app.state.deadlines[sectionId])}`}
          </p>
        </div>
        {salesId || interview?.confirmedSalesId ? (
          <section className="ml-auto grid min-w-0 max-w-full shrink-0 gap-3.5 rounded-card border border-line bg-paper p-[18px] shadow-card">
            <h2 className="m-0 text-base">担当</h2>
            <dl className="m-0 grid grid-cols-3 gap-3">
              <div className="min-w-0">
                <dt className="m-0 text-xs text-muted">マネージャー</dt>
                <dd className="m-0 mt-1 text-sm font-bold text-ink">{section?.mgr || '—'}</dd>
              </div>
              <div className="min-w-0">
                <dt className="m-0 text-xs text-muted">営業</dt>
                <dd className="m-0 mt-1 text-sm font-bold text-ink">
                  {SALES_LABEL[interview?.confirmedSalesId || salesId] || salesName}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="m-0 text-xs text-muted">本郷</dt>
                <dd className="m-0 mt-1 text-sm font-bold text-ink">
                  {app.state.hongoJoins ? '参加' : '不参加'}
                </dd>
              </div>
            </dl>
          </section>
        ) : null}
      </header>

      {engineerSelect}

      {sectionUnset ? (
        <section
          className="grid w-full max-w-full min-w-0 place-items-center rounded-card border border-line bg-paper p-6 shadow-card"
          data-testid="engineer-section-unset-notice"
          aria-label="セクション未設定の案内"
        >
          <div className="grid max-w-lg gap-2 text-center">
            <p className="m-0 text-base font-semibold text-ink">セクションがまだ設定されていません</p>
            <p className="m-0 text-sm text-muted">
              管理者画面で所属セクションを設定すると、候補枠への優先度回答ができるようになります。
            </p>
          </div>
        </section>
      ) : beforeEngineerOpen ? (
        <section
          className="grid w-full max-w-full min-w-0 place-items-center rounded-card border border-line bg-paper p-6 shadow-card"
          data-testid="engineer-locked-notice"
          aria-label="回答開始前の案内"
        >
          <div className="grid max-w-lg gap-2 text-center">
            <p className="m-0 text-base font-semibold text-ink">
              {engineerOpenDay
                ? `${formatDateSlash(engineerOpenDay)} 以降に面談希望日時を入力できます`
                : '面談希望日時の入力開始までお待ちください'}
            </p>
            <p className="m-0 text-sm text-muted">
              ※Mgr・営業による調整枠の確定まで今しばらくお待ちください。
            </p>
          </div>
        </section>
      ) : (
        <>
          <section className="grid w-full max-w-full min-w-0 gap-3.5 rounded-card border border-line bg-paper p-[18px] shadow-card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2>{locked ? '保存した参加可否' : '候補日時への参加可否'}</h2>
                {slots.length > 0 && !locked ? (
                  <p className="mt-1 text-sm text-muted">
                    空白: 調整可能　×: 不可　◎: 第一希望　（空白OK／第一希望は任意）
                  </p>
                ) : null}
                {slots.length > 0 && !locked && !interview?.submittedAt ? (
                  <p className="mt-1 text-sm text-muted">保存するまで自動判定の対象になりません。</p>
                ) : null}
              </div>
              {!locked && slots.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {editingVotes ? (
                    <>
                      <button
                        type="button"
                        className="btn btn-ghost btn-small"
                        onClick={cancelEditVotes}
                        disabled={votesSubmitting}
                      >
                        キャンセル
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary btn-small"
                        data-testid="engineer-votes-save"
                        disabled={votingClosed || !check.valid || votesSubmitting}
                        onClick={saveEditVotes}
                      >
                        {votesSubmitting ? '保存中…' : '保存'}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary btn-small"
                      data-testid="engineer-votes-edit"
                      disabled={votingClosed}
                      onClick={startEditVotes}
                    >
                      編集
                    </button>
                  )}
                </div>
              ) : null}
            </div>
            {slots.length === 0 ? (
              <p className="text-muted">
                {sectionSlotCount === 0
                  ? 'Mgrからの候補日登録をお待ちください。'
                  : !hasOffer
                    ? '担当営業がまだ設定されていません。営業画面での担当（〇）設定をお待ちください。'
                    : `${salesName}さんが参加可能な候補枠がまだありません。営業の空き日程の更新をお待ちください。`}
              </p>
            ) : (
              <>
                <VoteEditor
                  key={`${member.id}-${editingVotes ? 'edit' : 'view'}`}
                  slots={slots}
                  votes={activeVotes}
                  onChange={applyDraftVote}
                  onDayMark={applyDraftDayMark}
                  disabled={locked || votingClosed || !editingVotes || votesSubmitting}
                  difficultDates={interview?.preferences?.difficultDates}
                />
                {editingVotes && !votingClosed && !check.valid ? (
                  <ul className="m-0 list-disc pl-[18px] text-danger" id="vote-errors">
                    {check.errors.map((error) => <li key={error}>{error}</li>)}
                  </ul>
                ) : null}
              </>
            )}
          </section>

          {locked && confirmed ? (
            <section className="grid w-fit max-w-full min-w-0 justify-self-start gap-3.5 rounded-card border border-line bg-paper p-[18px] shadow-card">
              <p className="text-xs font-bold tracking-wider text-accent">{interview?.status === 'change_requested' ? '現在の確定（変更希望を受付中）' : '日程が確定しました'}</p>
              <h2 className="m-0 text-ink">{formatRange(confirmed.start, confirmed.end)}</h2>
              <div className="grid gap-1.5 text-sm">
                <span className="font-semibold">{providerLabel} URL</span>
                {interview?.meetingUrl ? (
                  <a
                    href={interview.meetingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block w-fit max-w-full break-all rounded-lg border border-line bg-bg px-2.5 py-2 font-mono text-sm text-accent underline-offset-2 hover:underline"
                  >
                    {interview.meetingUrl}
                  </a>
                ) : (
                  <p className="m-0 text-muted">未発行</p>
                )}
              </div>
            </section>
          ) : (
            <section
              className="grid gap-3 rounded-card border border-line bg-paper p-[18px] shadow-card"
              data-testid="confirmed-interview-date"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="m-0">面談確定日</h2>
                <span className="rounded-full bg-warn-bg px-3 py-1 text-xs font-semibold text-warn">確定待ち</span>
              </div>
              <div className="rounded-2xl bg-warn-bg px-3.5 py-3 text-warn">
                <p className="m-0 font-semibold">マネージャーによる確定待ち</p>
                <p className="m-0 mt-1 text-sm">Mgr画面で面談日時が確定されると、ここに表示されます。</p>
              </div>
              <p className="m-0 leading-relaxed text-muted">
              ※日程の変更・調整をご希望の場合は、SlackでMgrまで直接ご連絡ください。
            </p>
            </section>
          )}
        </>
      )}
    </div>
  )
}
