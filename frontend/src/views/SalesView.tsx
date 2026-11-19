import { useEffect, useMemo, useState } from 'react'
import { AvailabilityTimetable } from '../components/AvailabilityTimetable'
import {
  availabilityFromVotes,
  AvailabilityGrid,
  votesFromAvailability,
} from '../model/availability'
import { isGeneralEngineer } from '../model/membersMaster'
import { assignedSalesId, SALES_IDS, SALES_LABEL } from '../model/rules'
import { allActiveMembers, SECTIONS } from '../model/seed'
import { useApp } from '../model/store'

type AssigneeDraft = Record<string, string | null>

/** 担当割り当ての対象: 一般エンジニアのみ（Mgr / 営業 / 本郷 / 社長は除外） */
function assignableEngineers() {
  return allActiveMembers().filter((member) => isGeneralEngineer(member) && !member.isDeleted)
}

function blankAssigneeDraft(): AssigneeDraft {
  return Object.fromEntries(assignableEngineers().map((member) => [member.id, null]))
}

function assigneeDraftFromState(state): AssigneeDraft {
  return Object.fromEntries(
    assignableEngineers().map((member) => [member.id, assignedSalesId(state, member.id)]),
  )
}

function memberAssignee(state, draft: AssigneeDraft, editing: boolean, memberId: string) {
  return editing ? draft[memberId] : assignedSalesId(state, memberId)
}

function AssignMark({
  selected,
  editing,
  label,
  onToggle,
  disabled = false,
}: {
  selected: boolean
  editing: boolean
  label: string
  onToggle?: () => void
  disabled?: boolean
}) {
  const mark = (
    <span
      aria-hidden="true"
      className={`inline-flex h-5 w-5 items-center justify-center text-base font-bold leading-none ${
        selected ? 'text-inherit' : 'text-transparent'
      }`}
    >
      〇
    </span>
  )

  if (!editing) {
    return (
      <span
        className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-base font-bold ${
          selected ? 'border-ok bg-ok text-white' : 'border-transparent bg-transparent text-transparent'
        }`}
        aria-label={selected ? '担当' : '未担当'}
      >
        {mark}
      </span>
    )
  }

  return (
    <button
      type="button"
      className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-base font-bold transition disabled:cursor-not-allowed disabled:opacity-45 ${
        selected
          ? 'border-ok bg-ok text-white hover:brightness-95'
          : 'border-line bg-white text-muted hover:bg-accent-soft'
      }`}
      aria-pressed={selected}
      aria-label={label}
      onClick={onToggle}
      disabled={disabled}
    >
      {mark}
    </button>
  )
}

export function SalesView() {
  const app = useApp()
  const { state, activeSalesId, setActiveSalesId } = app
  const [editingAssign, setEditingAssign] = useState(false)
  const [assignSubmitting, setAssignSubmitting] = useState(false)
  const [draft, setDraft] = useState<AssigneeDraft>(() => blankAssigneeDraft())

  const [editingAvail, setEditingAvail] = useState(false)
  const [availSubmitting, setAvailSubmitting] = useState(false)
  const [availDraft, setAvailDraft] = useState<AvailabilityGrid>(() =>
    availabilityFromVotes(state.dayVotes[activeSalesId], state.hourVotes?.[activeSalesId]),
  )

  useEffect(() => {
    if (editingAvail) return
    setAvailDraft(availabilityFromVotes(state.dayVotes[activeSalesId], state.hourVotes?.[activeSalesId]))
  }, [activeSalesId, state.dayVotes, state.hourVotes, editingAvail])

  const engineers = useMemo(() => assignableEngineers(), [state.salesAssignee, state.interviews])

  const grouped = useMemo(() => {
    const bySales: Record<string, typeof engineers> = Object.fromEntries(SALES_IDS.map((id) => [id, []]))
    const unassigned = []
    for (const member of engineers) {
      const salesId = memberAssignee(state, draft, editingAssign, member.id)
      if (salesId && bySales[salesId]) bySales[salesId].push(member)
      else unassigned.push(member)
    }
    return { bySales, unassigned }
  }, [draft, editingAssign, engineers, state])

  const focusSales = (salesId: string) => {
    if (editingAvail) {
      const confirmed = window.confirm('空き日時の編集中です。保存せずに営業を切り替えますか？')
      if (!confirmed) return
      setEditingAvail(false)
    }
    setActiveSalesId(salesId)
  }

  const startEditAssign = () => {
    setDraft(assigneeDraftFromState(state))
    setEditingAssign(true)
  }

  const cancelEditAssign = () => {
    setDraft(assigneeDraftFromState(state))
    setEditingAssign(false)
  }

  const saveEditAssign = async () => {
    if (assignSubmitting) return
    setAssignSubmitting(true)
    try {
      const ok = await app.setSalesAssignees(draft)
      if (ok !== false) setEditingAssign(false)
    } finally {
      setAssignSubmitting(false)
    }
  }

  const setAssignee = (memberId: string, salesId: string | null) => {
    setDraft((prev) => ({ ...prev, [memberId]: salesId }))
  }

  /** 同じ営業の〇をもう一度押すと未割り当て。別営業を押すとそちらへ移動（両方〇は不可） */
  const toggleAssignee = (memberId: string, salesId: string) => {
    setDraft((prev) => {
      const current = prev[memberId]
      return { ...prev, [memberId]: current === salesId ? null : salesId }
    })
  }

  const startEditAvail = () => {
    setAvailDraft(availabilityFromVotes(state.dayVotes[activeSalesId], state.hourVotes?.[activeSalesId]))
    setEditingAvail(true)
  }

  const cancelEditAvail = () => {
    setAvailDraft(availabilityFromVotes(state.dayVotes[activeSalesId], state.hourVotes?.[activeSalesId]))
    setEditingAvail(false)
  }

  const saveEditAvail = async () => {
    if (availSubmitting) return
    setAvailSubmitting(true)
    try {
      const payload = votesFromAvailability(availDraft)
      const ok = await app.setSalesAvailability(activeSalesId, payload)
      if (ok !== false) setEditingAvail(false)
    } finally {
      setAvailSubmitting(false)
    }
  }

  const otherSalesId = (salesId: string) => (salesId === SALES_IDS[0] ? SALES_IDS[1] : SALES_IDS[0])
  const salesNameList = SALES_IDS.map((id) => SALES_LABEL[id]).filter(Boolean)
  const salesChoiceHint =
    salesNameList.length >= 2
      ? `${salesNameList[0]}か${salesNameList[1]}のどちらか1名`
      : '営業のどちらか1名'

  const renderAssignedColumn = (salesId: (typeof SALES_IDS)[number], members: typeof engineers) => (
    <div className="flex min-h-[200px] flex-col rounded-2xl border border-line bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-line bg-[#f3efe8] px-3 py-2.5">
        <h3 className="text-sm font-bold text-ink">{SALES_LABEL[salesId]}の担当</h3>
        <span className="rounded-full bg-paper px-2.5 py-0.5 text-xs text-muted">{members.length}名</span>
      </div>
      <ul className="m-0 flex-1 list-none space-y-1 p-2" data-testid={`assign-column-${salesId}`}>
        {members.length === 0 ? (
          <li className="px-2 py-4 text-sm text-muted">担当エンジニアはいません</li>
        ) : (
          members.map((member) => (
            <li
              key={member.id}
              className="flex items-center gap-2 rounded-xl border border-transparent px-2 py-1.5 hover:border-line hover:bg-bg"
            >
              <AssignMark
                selected
                editing={editingAssign}
                label={`${member.name}の${SALES_LABEL[salesId]}担当を解除`}
                onToggle={() => toggleAssignee(member.id, salesId)}
                disabled={assignSubmitting}
              />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{member.name}</span>
              {editingAssign ? (
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    className="rounded-lg border border-line bg-white px-2 py-1 text-xs text-muted hover:bg-accent-soft disabled:opacity-45"
                    onClick={() => setAssignee(member.id, otherSalesId(salesId))}
                    disabled={assignSubmitting}
                  >
                    {SALES_LABEL[otherSalesId(salesId)]}へ
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-line bg-white px-2 py-1 text-xs text-muted hover:bg-accent-soft disabled:opacity-45"
                    aria-label={`${member.name}を待機中にする`}
                    onClick={() => setAssignee(member.id, null)}
                    disabled={assignSubmitting}
                  >
                    待機へ
                  </button>
                </div>
              ) : null}
            </li>
          ))
        )}
      </ul>
    </div>
  )

  return (
    <div className="grid w-full max-w-full min-w-0 gap-[18px] overflow-x-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold tracking-wider text-accent">営業</p>
          <h1>NG日程入力・担当割り当て</h1>
        </div>
      </header>

      <div className="flex flex-wrap gap-2" role="group" aria-label="営業">
        {SALES_IDS.map((id) => (
          <button
            key={id}
            type="button"
            data-testid={`sales-tab-${id}`}
            className={`rounded-full border px-3 py-1.5 ${
              id === activeSalesId
                ? 'border-[#c6532a] bg-[#c6532a] text-white'
                : 'border-line bg-white text-ink'
            }`}
            onClick={() => focusSales(id)}
          >
            {SALES_LABEL[id]}
          </button>
        ))}
      </div>

      <section className="grid w-full max-w-full min-w-0 gap-3.5 rounded-card border border-line bg-paper p-[18px] shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2>NG日程入力</h2>
            <p className="mt-1 text-sm text-muted">
              参加できない枠に × を付けます。「一日×」でその日すべてを不可にできます。保存すると候補日時に反映されます。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {editingAvail ? (
              <>
                <button
                  type="button"
                  className="btn btn-ghost btn-small"
                  onClick={cancelEditAvail}
                  disabled={availSubmitting}
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-small"
                  data-testid="sales-avail-save"
                  onClick={saveEditAvail}
                  disabled={availSubmitting}
                >
                  {availSubmitting ? '保存中…' : '保存'}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn btn-primary btn-small"
                data-testid="sales-avail-edit"
                onClick={startEditAvail}
              >
                編集
              </button>
            )}
          </div>
        </div>
        <AvailabilityTimetable
          key={`${activeSalesId}-${editingAvail ? 'edit' : 'view'}`}
          grid={
            editingAvail
              ? availDraft
              : availabilityFromVotes(state.dayVotes[activeSalesId], state.hourVotes?.[activeSalesId])
          }
          editing={editingAvail}
          onChange={setAvailDraft}
          disabled={availSubmitting}
          label={`${SALES_LABEL[activeSalesId]}の空き日時`}
        />
      </section>

      <section className="grid gap-3.5 rounded-card border border-line bg-paper p-[18px] shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2>担当割り当て</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {editingAssign ? (
              <>
                <button
                  type="button"
                  className="btn btn-ghost btn-small"
                  onClick={cancelEditAssign}
                  disabled={assignSubmitting}
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-small"
                  data-testid="sales-assign-save"
                  onClick={saveEditAssign}
                  disabled={assignSubmitting}
                >
                  {assignSubmitting ? '保存中…' : '保存'}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn btn-primary btn-small"
                data-testid="sales-assign-edit"
                onClick={startEditAssign}
              >
                編集
              </button>
            )}
          </div>
        </div>

        <div
          className="grid grid-cols-1 gap-3 lg:grid-cols-2"
          data-testid="sales-assign-columns"
        >
          {SALES_IDS.map((salesId) => renderAssignedColumn(salesId, grouped.bySales[salesId] || []))}
        </div>

        <div
          className="rounded-2xl border border-dashed border-line bg-[#faf7f2]"
          data-testid="assign-unassigned"
        >
          <div className="flex items-center justify-between gap-2 border-b border-dashed border-line px-3 py-2.5">
            <h3 className="text-sm font-bold text-ink">待機中のエンジニア</h3>
            <span className="rounded-full bg-white px-2.5 py-0.5 text-xs text-muted">
              {grouped.unassigned.length}名
            </span>
          </div>
          <ul className="m-0 list-none space-y-1 p-2">
            {grouped.unassigned.length === 0 ? (
              <li className="px-2 py-4 text-sm text-muted">待機中のエンジニアはいません。</li>
            ) : (
              grouped.unassigned.map((member) => (
                <li
                  key={member.id}
                  className="flex flex-wrap items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-white"
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{member.name}</span>
                  {editingAssign ? (
                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                      {SALES_IDS.map((salesId) => (
                        <button
                          key={salesId}
                          type="button"
                          className="rounded-lg border border-line bg-white px-2 py-1 text-xs text-muted hover:bg-accent-soft disabled:opacity-45"
                          aria-label={`${member.name}を${SALES_LABEL[salesId]}担当にする`}
                          onClick={() => setAssignee(member.id, salesId)}
                          disabled={assignSubmitting}
                        >
                          {SALES_LABEL[salesId]}へ
                        </button>
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs text-muted">待機中</span>
                  )}
                </li>
              ))
            )}
          </ul>
        </div>
      </section>
    </div>
  )
}
