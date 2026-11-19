import { Fragment, useEffect, useMemo, useState } from 'react'
import { ApiError, api } from '../api/client'
import { getBootstrapCache, setBootstrapCache } from '../api/bootstrapCache'
import { HongoScheduleCalendar } from '../components/HongoScheduleCalendar'
import { confirmedWindow, formatRange } from '../model/format'
import { useInterviewPeriod } from '../model/interviewPeriod'
import { useResponseDeadlines } from '../model/responseDeadlines'
import {
  isGeneralEngineer,
  isHiddenFromUi,
  MEMBER_MASTER,
  type MemberRole,
} from '../model/membersMaster'
import { STATUS } from '../model/rules'
import { getRawRegistryMembers } from '../model/membersRegistry'
import { MEMBERS, SECTIONS, setRegistryMembers } from '../model/seed'
import { useApp } from '../model/store'

const DEFAULT_ROLE: MemberRole = 'engineer'

/** Admin 状態フィルタタブ（変更依頼ありは運用上 Slack 対応のため非表示） */
// const ADMIN_STATUS_FILTER_ENTRIES = Object.entries(STATUS).filter(([key]) => key !== 'change_requested')
const ADMIN_STATUS_FILTER_ENTRIES = Object.entries(STATUS).filter(([key]) => key !== 'change_requested' && key !== 'unadjusted')

function sectionLabelOf(sectionId) {
  if (!sectionId || sectionId === 'unset') return '未設定'
  return SECTIONS.find((section) => section.id === sectionId)?.name || sectionId
}

function normalizeMember(member, fallbackId) {
  const id = Number(member.id)
  const safeId = Number.isFinite(id) && id > 0 ? id : fallbackId
  const sectionId = member.sectionId || 'unset'
  const surname = member.surname || String(member.name || '').replace(/^.+セクション-/, '') || `社員${safeId}`
  const name =
    member.name ||
    (sectionId === 'unset' ? surname : `${sectionLabelOf(sectionId)}-${surname}`)
  return {
    ...member,
    id: safeId,
    surname,
    name,
    sectionId,
    section: sectionId,
    role: member.role || DEFAULT_ROLE,
    isInterviewer: member.isInterviewer !== false,
    isDeleted: Boolean(member.isDeleted),
  }
}

function defaultRoster() {
  // 本番では MEMBER_MASTER は空。レジストリ / シード / キャッシュ順でフォールバック
  const fromRegistry = getRawRegistryMembers(true)
    .filter((member) => !isHiddenFromUi(member))
    .map((member) => normalizeMember(member, member.id))
  if (fromRegistry.length) return fromRegistry
  const fromMaster = MEMBER_MASTER.filter((member) => !isHiddenFromUi(member)).map((member) =>
    normalizeMember(
      {
        id: member.id,
        surname: member.surname,
        sectionId: member.sectionId,
        isDeleted: member.isDeleted,
        role: member.role,
        isInterviewer: member.isInterviewer,
      },
      member.id,
    ),
  )
  if (fromMaster.length) return fromMaster
  return MEMBERS.map((member, index) => normalizeMember(member, index + 1))
}

function activeMembers(list) {
  // UI_HIDDEN_MEMBER_IDS（id=1）は画面上のどこにも出さない
  return list.filter((member) => !member.isDeleted && !isHiddenFromUi(member))
}

/** 管理画面カード内: 一般エンジニアのみ */
function engineerRosterMembers(list) {
  return activeMembers(list).filter((member) => isGeneralEngineer(member))
}

function applyRoster(list, setRoster, setListMembers, setListRenderKey) {
  const next = list.map((member, index) => normalizeMember(member, index + 1))
  // 画面非表示メンバー（id=1 等）はレジストリに残す
  const hidden = getRawRegistryMembers(true).filter((m) => isHiddenFromUi(m))
  const visible = next.filter((m) => !isHiddenFromUi(m))
  setRegistryMembers([...hidden, ...visible])
  setRoster(visible)
  setListMembers(visible.map((member) => ({ ...member })))
  setListRenderKey((key) => key + 1)
}

export function AdminView() {
  const app = useApp()
  const { state } = app
  const interviewPeriod = useInterviewPeriod()
  const responseDeadlines = useResponseDeadlines()
  const cachedBoot = getBootstrapCache()
  const [roster, setRoster] = useState(() =>
    cachedBoot.members?.length ? cachedBoot.members.map((m, i) => normalizeMember(m, i + 1)) : defaultRoster(),
  )
  /** メイン一覧専用。移動時に明示更新してタブ切替とリスト再描画を同期する */
  const [listMembers, setListMembers] = useState(() =>
    cachedBoot.members?.length ? cachedBoot.members.map((m, i) => normalizeMember(m, i + 1)) : defaultRoster(),
  )
  const [listRenderKey, setListRenderKey] = useState(0)
  const [newName, setNewName] = useState('')
  const [addSectionId, setAddSectionId] = useState(SECTIONS[0].id)
  const [removeId, setRemoveId] = useState('')
  const [moveId, setMoveId] = useState('')
  const [moveSectionId, setMoveSectionId] = useState(SECTIONS[0].id)
  const [settingsNote, setSettingsNote] = useState('')
  const [periodStartDraft, setPeriodStartDraft] = useState(
    () => cachedBoot.interviewPeriod?.startDate || interviewPeriod.startDate,
  )
  const [periodEndDraft, setPeriodEndDraft] = useState(
    () => cachedBoot.interviewPeriod?.endDate || interviewPeriod.endDate,
  )
  const [periodNote, setPeriodNote] = useState('')
  const [periodSubmitting, setPeriodSubmitting] = useState(false)
  const [deadlineSubmitting, setDeadlineSubmitting] = useState(false)
  const [rosterSubmitting, setRosterSubmitting] = useState(false)
  const [memberActionId, setMemberActionId] = useState(null)
  const [mgrSalesDeadlineDraft, setMgrSalesDeadlineDraft] = useState(
    () => cachedBoot.responseDeadlines?.mgrSalesDeadline || responseDeadlines.mgrSalesDeadline,
  )
  const [engineerDeadlineDraft, setEngineerDeadlineDraft] = useState(
    () => cachedBoot.responseDeadlines?.engineerDeadline || responseDeadlines.engineerDeadline,
  )
  const [deadlineNote, setDeadlineNote] = useState('')

  useEffect(() => {
    const apply = (detail: any) => {
      if (Array.isArray(detail?.members)) {
        applyRoster(detail.members, setRoster, setListMembers, setListRenderKey)
      }
      if (detail?.interviewPeriod) {
        setPeriodStartDraft(detail.interviewPeriod.startDate)
        setPeriodEndDraft(detail.interviewPeriod.endDate)
      }
      if (detail?.responseDeadlines) {
        setMgrSalesDeadlineDraft(detail.responseDeadlines.mgrSalesDeadline || '')
        setEngineerDeadlineDraft(detail.responseDeadlines.engineerDeadline || '')
      }
    }
    apply(getBootstrapCache())
    const onBoot = (event: Event) => apply((event as CustomEvent).detail)
    window.addEventListener('wizway:bootstrap', onBoot)
    return () => window.removeEventListener('wizway:bootstrap', onBoot)
  }, [])

  useEffect(() => {
    setPeriodStartDraft(interviewPeriod.startDate)
    setPeriodEndDraft(interviewPeriod.endDate)
  }, [interviewPeriod.startDate, interviewPeriod.endDate])

  useEffect(() => {
    setMgrSalesDeadlineDraft(responseDeadlines.mgrSalesDeadline)
    setEngineerDeadlineDraft(responseDeadlines.engineerDeadline)
  }, [responseDeadlines.mgrSalesDeadline, responseDeadlines.engineerDeadline])

  const matchesSectionFilter = (member, filter) => {
    if (filter === 'all') return true
    if (filter === 'unset') return member.sectionId === 'unset'
    return member.sectionId === filter
  }

  const sectionSortIndex = (sectionId) => {
    const index = SECTIONS.findIndex((section) => section.id === sectionId)
    return index === -1 ? SECTIONS.length : index
  }

  const rows = useMemo(() => {
    // 当該カード: 一般エンジニアのみ（Mgr / 営業 / 本郷 / 社長は出さない）
    return engineerRosterMembers(listMembers)
      .filter((member) => {
        const interview = state.interviews[member.id]
        const sectionOk = matchesSectionFilter(member, app.sectionFilter)
        const status = interview?.status || 'unadjusted'
        const statusOk = app.statusFilter === 'all' || status === app.statusFilter
        return sectionOk && statusOk
      })
      .slice()
      .sort((a, b) => {
        const bySection = sectionSortIndex(a.sectionId) - sectionSortIndex(b.sectionId)
        if (bySection !== 0) return bySection
        return Number(a.id) - Number(b.id)
      })
  }, [listMembers, app.sectionFilter, app.statusFilter, state.interviews, listRenderKey])

  const counts = useMemo(() => {
    const base = engineerRosterMembers(listMembers).filter((member) =>
      matchesSectionFilter(member, app.sectionFilter),
    )
    return Object.fromEntries(
      ['all', ...ADMIN_STATUS_FILTER_ENTRIES.map(([key]) => key)].map((key) => [
        key,
        key === 'all'
          ? base.length
          : base.filter((member) => (state.interviews[member.id]?.status || 'unadjusted') === key).length,
      ]),
    )
  }, [app.sectionFilter, listMembers, state.interviews, listRenderKey])

  /** 設定カード内の名簿操作は一般エンジニアのみ（非表示枠・Mgr・営業・本郷ロールは出さない） */
  const selectableMembers = useMemo(
    () =>
      engineerRosterMembers(roster)
        .slice()
        .sort((a, b) => {
          const bySection = sectionSortIndex(a.sectionId) - sectionSortIndex(b.sectionId)
          if (bySection !== 0) return bySection
          return Number(a.id) - Number(b.id)
        }),
    [roster],
  )

  const addRosterName = async () => {
    if (rosterSubmitting) return
    const name = newName.trim()
    if (!name) {
      setSettingsNote('氏名を入力してください')
      app.pushToast?.('氏名を入力してください', 'warn')
      return
    }
    const section = addSectionId === 'unset' ? null : SECTIONS.find((item) => item.id === addSectionId)
    const sectionId = section?.id || 'unset'
    const label = section?.name || '未設定'
    setRosterSubmitting(true)
    try {
      await (app.runBusy || ((fn) => fn()))(async () => {
        const created = await api.post<any>('/members', {
          surname: name,
          sectionId,
          role: DEFAULT_ROLE,
          isInterviewer: true,
        })
        const entry = normalizeMember(created, created.id)
        const next = [...roster, entry]
        applyRoster(next, setRoster, setListMembers, setListRenderKey)
        await app.refreshFromApi?.()
        setNewName('')
        const message = `${entry.name}（ID:${entry.id}）を ${label} に追加・保存しました`
        setSettingsNote(message)
        app.pushToast?.(message)
      })
    } catch (err) {
      const message = err instanceof ApiError ? err.message : '社員の追加に失敗しました'
      setSettingsNote(message)
      app.pushToast?.(message, 'warn')
    } finally {
      setRosterSubmitting(false)
    }
  }

  const removeRosterName = async () => {
    if (rosterSubmitting) return
    if (removeId === '' || removeId == null) {
      setSettingsNote('削除する氏名を選んでください')
      app.pushToast?.('削除する氏名を選んでください', 'warn')
      return
    }
    const selectedId = Number(removeId)
    const target = roster.find((member) => Number(member.id) === selectedId && !member.isDeleted)
    if (!target) {
      setSettingsNote('選択したメンバーが見つかりません')
      app.pushToast?.('選択したメンバーが見つかりません', 'warn')
      return
    }
    setRosterSubmitting(true)
    try {
      await (app.runBusy || ((fn) => fn()))(async () => {
        const deleted = await api.delete<any>(`/members/${selectedId}`)
        const next = roster.map((member) =>
          Number(member.id) === selectedId ? normalizeMember(deleted, selectedId) : { ...member },
        )
        applyRoster(next, setRoster, setListMembers, setListRenderKey)
        await app.refreshFromApi?.()
        setRemoveId('')
        if (Number(moveId) === selectedId) setMoveId('')
        const message = `${target.name}（ID:${target.id}）を論理削除しました（IDは欠番のまま残ります）`
        setSettingsNote(message)
        app.pushToast?.(message)
      })
    } catch (err) {
      const message = err instanceof ApiError ? err.message : '社員の削除に失敗しました'
      setSettingsNote(message)
      app.pushToast?.(message, 'warn')
    } finally {
      setRosterSubmitting(false)
    }
  }

  const saveInterviewPeriod = async () => {
    if (periodSubmitting) return
    if (!periodStartDraft || !periodEndDraft) {
      setPeriodNote('開始日と終了日を入力してください')
      app.pushToast?.('開始日と終了日を入力してください', 'warn')
      return
    }
    if (periodStartDraft > periodEndDraft) {
      setPeriodNote('終了日は開始日以降にしてください')
      app.pushToast?.('終了日は開始日以降にしてください', 'warn')
      return
    }
    setPeriodSubmitting(true)
    try {
      const ok = await interviewPeriod.setPeriod(periodStartDraft, periodEndDraft)
      if (!ok) {
        setPeriodNote('期間の保存に失敗しました')
        app.pushToast?.('期間の保存に失敗しました', 'warn')
        return
      }
      const message = `面談実施期間を ${periodStartDraft} 〜 ${periodEndDraft} に保存しました`
      setPeriodNote(`${message}（Mgr・営業カレンダーに反映）`)
      app.pushToast?.(message)
    } finally {
      setPeriodSubmitting(false)
    }
  }

  const moveRosterMember = async () => {
    if (rosterSubmitting) return
    const selectedId = String(moveId || '')
    if (!selectedId) {
      setSettingsNote('移動するメンバーを選んでください')
      app.pushToast?.('移動するメンバーを選んでください', 'warn')
      return
    }
    const destination = String(moveSectionId || '')
    const section = destination === 'unset' ? null : SECTIONS.find((item) => item.id === destination)
    const nextSectionId = section ? section.id : 'unset'
    const label = section ? section.name : '未設定'
    const target =
      listMembers.find((member) => String(member.id) === selectedId && !member.isDeleted) ||
      roster.find((member) => String(member.id) === selectedId && !member.isDeleted)
    if (!target) {
      setSettingsNote('選択したメンバーが見つかりません')
      app.pushToast?.('選択したメンバーが見つかりません', 'warn')
      return
    }
    const currentSectionId = target.sectionId || 'unset'
    if (currentSectionId === nextSectionId) {
      setSettingsNote('同じセクションです')
      app.pushToast?.('同じセクションです', 'warn')
      return
    }
    setRosterSubmitting(true)
    try {
      await (app.runBusy || ((fn) => fn()))(async () => {
        const updated = await api.patch<any>(`/members/${selectedId}`, { sectionId: nextSectionId })
        // PATCH 応答で即時反映し、続けて名簿を API から再取得して DB 永続化を確認する
        const next = (listMembers.length ? listMembers : roster).map((member) =>
          String(member.id) === selectedId ? normalizeMember(updated, Number(selectedId)) : { ...member },
        )
        applyRoster(next, setRoster, setListMembers, setListRenderKey)
        const verified = await api.get<{ members: any[] }>('/members?includeDeleted=true')
        if (Array.isArray(verified?.members)) {
          applyRoster(verified.members, setRoster, setListMembers, setListRenderKey)
          // リロード直後にシード名簿（未設定）が一瞬出ないようキャッシュを更新
          setBootstrapCache({ members: verified.members })
        }
        await app.refreshFromApi?.()
        app.setSectionFilter(nextSectionId)
        setMoveId('')
        const message = `${updated.name}（ID:${updated.id}）を ${label} へ移動・保存しました`
        setSettingsNote(message)
        app.pushToast?.(message)
      })
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'セクション移動に失敗しました'
      setSettingsNote(message)
      app.pushToast?.(message, 'warn')
    } finally {
      setRosterSubmitting(false)
    }
  }

  const runMemberAction = async (memberId, action) => {
    if (memberActionId != null || app.apiBusy) return
    setMemberActionId(memberId)
    try {
      await action()
    } finally {
      setMemberActionId(null)
    }
  }

  /** 面談参加フラグ（isInterviewer）を切替。false だと自動割当・対象抽出から除外される */
  const toggleParticipation = async (member) => {
    const next = member.isInterviewer === false
    try {
      await (app.runBusy || ((fn) => fn()))(async () => {
        const updated = await api.patch<any>(`/members/${member.id}`, { isInterviewer: next })
        const nextList = (listMembers.length ? listMembers : roster).map((item) =>
          Number(item.id) === Number(member.id) ? normalizeMember(updated, Number(member.id)) : { ...item },
        )
        applyRoster(nextList, setRoster, setListMembers, setListRenderKey)
        await app.refreshFromApi?.()
        const message = next
          ? `${updated.name || member.name}さんを面談参加にしました`
          : `${updated.name || member.name}さんを面談不参加にしました（自動割当対象外）`
        app.pushToast?.(message)
      })
    } catch (err) {
      const message = err instanceof ApiError ? err.message : '面談参加の切替に失敗しました'
      app.pushToast?.(message, 'warn')
    }
  }

  return (
    <div className="grid gap-[18px]">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold tracking-wider text-accent">管理者</p>
          <h1>全体進捗</h1>
          {app.apiError ? <p className="mt-1 text-sm text-red-700">API: {app.apiError}</p> : null}
          {!app.apiReady ? <p className="mt-1 text-sm text-muted">API から読込中…</p> : null}
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-small"
          onClick={() => app.resetDemo()}
          disabled={app.apiBusy || rosterSubmitting}
        >
          デモデータを元に戻す
        </button>
      </header>

      <section className="grid gap-3.5 rounded-card border border-line bg-paper p-[18px] shadow-card" aria-label="設定">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="m-0 text-base font-semibold text-ink">設定</h2>
            <p className="mt-1 text-sm text-muted">今期の参加とメンバー名簿の調整です。</p>
          </div>
          <label className="inline-flex items-center gap-2 text-sm text-muted">
            <span>本郷参加</span>
            <button
              type="button"
              role="switch"
              aria-checked={state.hongoJoins}
              data-testid="hongo-switch"
              className={`${state.hongoJoins ? 'switch is-on' : 'switch'} disabled:opacity-50`}
              onClick={() => app.setHongoJoins(!state.hongoJoins)}
              disabled={app.apiBusy}
            >
              <span />
            </button>
          </label>
        </div>

        <div className="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2">
          <div className="min-w-0 grid h-full gap-3 rounded-md border border-line bg-paper p-3.5">
            <h3 className="m-0 text-sm font-semibold text-ink">面談実施期間</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="grid min-w-0 gap-1 text-sm">
                面談開始日
                <input
                  type="date"
                  value={periodStartDraft}
                  onChange={(event) => setPeriodStartDraft(event.target.value)}
                  data-testid="interview-period-start"
                />
              </label>
              <label className="grid min-w-0 gap-1 text-sm">
                面談終了日
                <input
                  type="date"
                  value={periodEndDraft}
                  onChange={(event) => setPeriodEndDraft(event.target.value)}
                  data-testid="interview-period-end"
                />
              </label>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {periodNote ? <p className="m-0 text-sm text-muted">{periodNote}</p> : null}
              <button
                type="button"
                className="btn btn-primary btn-small"
                onClick={saveInterviewPeriod}
                disabled={periodSubmitting}
              >
                {periodSubmitting ? '保存中…' : '期間を保存'}
              </button>
            </div>
          </div>

          <div className="min-w-0 grid h-full gap-3 rounded-md border border-line bg-paper p-3.5">
            <h3 className="m-0 text-sm font-semibold text-ink">Mgr/営業 と エンジニアの回答期限を設定</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="grid min-w-0 gap-1 text-sm">
                Mgr/営業の回答期限
                <input
                  type="date"
                  value={mgrSalesDeadlineDraft}
                  onChange={(event) => setMgrSalesDeadlineDraft(event.target.value)}
                  data-testid="mgr-sales-deadline"
                />
              </label>
              <label className="grid min-w-0 gap-1 text-sm">
                エンジニアの回答期限
                <input
                  type="date"
                  value={engineerDeadlineDraft}
                  onChange={(event) => setEngineerDeadlineDraft(event.target.value)}
                  data-testid="engineer-deadline"
                />
              </label>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {deadlineNote ? <p className="m-0 text-sm text-muted">{deadlineNote}</p> : null}
              <button
                type="button"
                className="btn btn-primary btn-small"
                disabled={deadlineSubmitting}
                onClick={async () => {
                  if (deadlineSubmitting) return
                  if (!mgrSalesDeadlineDraft || !engineerDeadlineDraft) {
                    setDeadlineNote('Mgr/営業とエンジニアの回答期限を両方入力してください')
                    app.pushToast?.('Mgr/営業とエンジニアの回答期限を両方入力してください', 'warn')
                    return
                  }
                  setDeadlineSubmitting(true)
                  try {
                    const ok = await responseDeadlines.setDeadlines(mgrSalesDeadlineDraft, engineerDeadlineDraft)
                    if (!ok) {
                      setDeadlineNote('回答期限の保存に失敗しました')
                      app.pushToast?.('回答期限の保存に失敗しました', 'warn')
                      return
                    }
                    const message = `回答期限を Mgr/営業: ${mgrSalesDeadlineDraft} / エンジニア: ${engineerDeadlineDraft} に設定しました`
                    setDeadlineNote(message)
                    app.pushToast?.(message)
                  } finally {
                    setDeadlineSubmitting(false)
                  }
                }}
              >
                {deadlineSubmitting ? '保存中…' : '回答期限を保存'}
              </button>
            </div>
          </div>

          <div className="min-w-0 grid h-full gap-3 rounded-md border border-line bg-paper p-3.5">
            <h3 className="m-0 text-sm font-semibold text-ink">氏名の追加 / 削除</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)] sm:items-start sm:gap-4">
              <div className="grid min-w-0 gap-2">
                <label className="grid min-w-0 gap-1 text-sm">
                  追加する氏名
                  <input
                    type="text"
                    value={newName}
                    placeholder="例: 山田"
                    onChange={(event) => setNewName(event.target.value)}
                    disabled={rosterSubmitting}
                    className="box-border h-11 w-full min-w-0"
                  />
                </label>
                <label className="grid min-w-0 gap-1 text-sm">
                  追加先セクション
                  <select
                    value={addSectionId}
                    onChange={(event) => setAddSectionId(event.target.value)}
                    disabled={rosterSubmitting}
                    className="box-border h-11 w-full min-w-0"
                  >
                    {SECTIONS.map((section) => (
                      <option key={section.id} value={section.id}>{section.name}</option>
                    ))}
                    <option value="unset">未設定</option>
                  </select>
                </label>
                <div className="flex items-end justify-end">
                  <button
                    type="button"
                    className="btn btn-primary btn-small"
                    onClick={addRosterName}
                    disabled={rosterSubmitting}
                  >
                    {rosterSubmitting ? '処理中…' : '氏名を追加'}
                  </button>
                </div>
              </div>
              <div className="hidden bg-line sm:block" aria-hidden="true" />
              <div className="grid min-w-0 gap-2">
                <label className="grid min-w-0 gap-1 text-sm">
                  削除する氏名
                  <select
                    value={removeId}
                    onChange={(event) => setRemoveId(event.target.value)}
                    disabled={rosterSubmitting}
                    className="box-border h-11 w-full min-w-0"
                  >
                    <option value="">選択してください</option>
                    {selectableMembers.map((member) => (
                      <option key={member.id} value={member.id}>{member.name}</option>
                    ))}
                  </select>
                </label>
                <div className="flex items-end justify-end">
                  <button
                    type="button"
                    className="btn btn-primary btn-small"
                    onClick={removeRosterName}
                    disabled={rosterSubmitting}
                  >
                    {rosterSubmitting ? '処理中…' : '氏名を削除'}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="min-w-0 grid h-full gap-3 rounded-md border border-line bg-paper p-3.5">
            <h3 className="m-0 text-sm font-semibold text-ink">セクションへの追加 / 移動</h3>
            <label className="grid gap-1 text-sm">
              メンバー
              <select
                value={moveId}
                onChange={(event) => setMoveId(event.target.value)}
                disabled={rosterSubmitting}
              >
                <option value="">選択してください</option>
                {selectableMembers.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              移動先セクション
              <select
                value={moveSectionId}
                onChange={(event) => setMoveSectionId(event.target.value)}
                disabled={rosterSubmitting}
              >
                {SECTIONS.map((section) => (
                  <option key={section.id} value={section.id}>{section.name}</option>
                ))}
                <option value="unset">未設定</option>
              </select>
            </label>
            <div className="flex justify-end">
              <button
                type="button"
                className="btn btn-primary btn-small"
                onClick={moveRosterMember}
                disabled={rosterSubmitting}
              >
                {rosterSubmitting ? '処理中…' : 'セクションへ移動'}
              </button>
            </div>
          </div>
        </div>

        {settingsNote ? <p className="m-0 text-sm text-muted">{settingsNote}</p> : null}
      </section>

      <HongoScheduleCalendar state={state} enableSalesFilter />

      <section className="grid w-fit max-w-full gap-3.5 rounded-card border border-line bg-paper p-[18px] shadow-card">
        <div className="grid gap-3">
          <div
            className="flex w-full flex-wrap gap-1 overflow-x-auto rounded-md bg-white p-1"
            role="group"
            aria-label="セクション"
          >
            <button
              type="button"
              className={`shrink-0 rounded-full border px-3 py-1.5 text-sm transition ${
                app.sectionFilter === 'all'
                  ? 'border-[#c6532a] bg-[#c6532a] text-white'
                  : 'border-line bg-white text-ink hover:bg-accent-soft'
              }`}
              onClick={() => app.setSectionFilter('all')}
            >
              すべて
            </button>
            {SECTIONS.map((section) => (
              <button
                key={section.id}
                type="button"
                className={`shrink-0 rounded-full border px-3 py-1.5 text-sm transition ${
                  app.sectionFilter === section.id
                    ? 'border-[#c6532a] bg-[#c6532a] text-white'
                    : 'border-line bg-white text-ink hover:bg-accent-soft'
                }`}
                onClick={() => app.setSectionFilter(section.id)}
              >
                {section.name}
              </button>
            ))}
            <button
              type="button"
              className={`shrink-0 rounded-full border px-3 py-1.5 text-sm transition ${
                app.sectionFilter === 'unset'
                  ? 'border-[#c6532a] bg-[#c6532a] text-white'
                  : 'border-line bg-white text-ink hover:bg-accent-soft'
              }`}
              onClick={() => app.setSectionFilter('unset')}
            >
              未設定
            </button>
          </div>

          <div
            className="inline-flex w-fit max-w-full flex-wrap gap-1.5"
            role="group"
            aria-label="状態"
          >
            {[
              ['all', 'すべて'],
              ...ADMIN_STATUS_FILTER_ENTRIES,
            ].map(([key, label]) => {
              const active = app.statusFilter === key
              const toneClass =
                key === 'all' || key === 'unadjusted'
                  ? 'bg-[#eeeae4] text-ink'
                  : key === 'adjusting'
                    ? 'bg-warn-bg text-warn'
                    : key === 'confirmed'
                      ? 'bg-ok-bg text-ok'
                      : 'bg-danger-bg text-danger'
              return (
                <button
                  key={key}
                  type="button"
                  className={`flex min-w-[4.5rem] flex-col items-center justify-center gap-1 rounded-md border bg-white px-2.5 py-1.5 text-center transition ${
                    active
                      ? 'border-[#c6532a] shadow-[inset_0_0_0_1px_#c6532a]'
                      : 'border-line hover:border-[#d8cfc0]'
                  }`}
                  onClick={() => app.setStatusFilter(key)}
                >
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${toneClass}`}>
                    {label}
                  </span>
                  <strong className="text-base font-semibold leading-none text-ink tabular-nums">
                    {counts[key]}
                  </strong>
                </button>
              )
            })}
          </div>
        </div>

        <ul
          key={`member-list-${listRenderKey}-${app.sectionFilter}`}
          className="m-0 grid w-fit max-w-full list-none gap-2.5 p-0"
        >
          {rows.map((member, index) => {
            const interview = state.interviews[member.id] || {
              status: 'unadjusted',
              pendingNote: null,
              changeRequest: null,
            }
            const window = confirmedWindow(interview, state.slots)
            const showSectionHeading =
              index === 0 || rows[index - 1].sectionId !== member.sectionId
            const displayName =
              member.surname ||
              String(member.name || '').replace(/^.+セクション-/, '') ||
              member.name
            return (
              <Fragment key={member.id}>
                {showSectionHeading ? (
                  <li
                    className={`pointer-events-none px-0.5 text-xs font-semibold tracking-wide text-muted ${
                      index > 0 ? 'mt-3' : ''
                    }`}
                  >
                    {sectionLabelOf(member.sectionId)}
                  </li>
                ) : null}
                <li
                  className={`ml-3 grid w-fit max-w-full cursor-pointer grid-cols-[9rem_12rem_7.5rem] items-center gap-x-6 gap-y-1 rounded-md border border-line bg-white px-4 py-2.5 transition hover:border-[#c6532a]/35 hover:bg-[#faf7f2] ${
                    interview.status === 'change_requested'
                      ? 'has-request border-danger bg-danger-bg hover:bg-danger-bg'
                      : ''
                  }`}
                >
                  <strong className="min-w-0 truncate">{displayName}</strong>
                  <div className="min-w-0">
                    <b className="whitespace-nowrap tabular-nums">
                      {window ? formatRange(window.start, window.end) : '日時未確定'}
                    </b>
                    {interview.pendingNote ? <small className="block">{interview.pendingNote}</small> : null}
                    {interview.changeRequest ? (
                      <small className="request-text block">
                        変更希望: {interview.changeRequest.preferredDates} / {interview.changeRequest.reason}
                      </small>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                    <label
                      className="inline-flex items-center gap-2 text-sm text-muted"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <span>{member.isInterviewer === false ? '不参加' : '参加'}</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={member.isInterviewer !== false}
                        aria-label={`${member.name}の面談参加`}
                        data-testid={`participation-switch-${member.id}`}
                        className={`${member.isInterviewer !== false ? 'switch is-on' : 'switch'} disabled:opacity-50`}
                        disabled={app.apiBusy || memberActionId === member.id || rosterSubmitting}
                        onClick={(event) => {
                          event.stopPropagation()
                          void runMemberAction(member.id, () => toggleParticipation(member))
                        }}
                      >
                        <span />
                      </button>
                    </label>
                  </div>
                </li>
              </Fragment>
            )
          })}
          {rows.length === 0 ? <li className="text-muted">該当するメンバーはいません。</li> : null}
        </ul>
      </section>
    </div>
  )
}
