import { useEffect, useMemo, useState } from 'react'
import { AvailabilityTimetable } from '../components/AvailabilityTimetable'
import { CandidateBoard } from '../components/CandidateBoard'
import { HongoScheduleCalendar } from '../components/HongoScheduleCalendar'
import {
  availabilityFromVotes,
  AvailabilityGrid,
  votesFromAvailability,
} from '../model/availability'
import { sectionById, SECTIONS } from '../model/seed'
import { useApp } from '../model/store'

export function ManagerView() {
  const app = useApp()
  const { state, activeSectionId, setActiveSectionId } = app
  const section = sectionById(activeSectionId)
  const [voterId, setVoterId] = useState(activeSectionId)

  const [editingAvail, setEditingAvail] = useState(false)
  const [availSubmitting, setAvailSubmitting] = useState(false)
  const [availDraft, setAvailDraft] = useState<AvailabilityGrid>(() =>
    availabilityFromVotes(state.dayVotes[voterId], state.hourVotes?.[voterId]),
  )

  /** 閲覧時の grid を安定させ、親再描画だけでタイムテーブルが再計算されないようにする */
  const viewAvailGrid = useMemo(
    () => availabilityFromVotes(state.dayVotes[voterId], state.hourVotes?.[voterId]),
    [state.dayVotes, state.hourVotes, voterId],
  )

  useEffect(() => {
    if (!state.hongoJoins && voterId === 'hongo') setVoterId(activeSectionId)
  }, [state.hongoJoins, voterId, activeSectionId])

  useEffect(() => {
    if (editingAvail) return
    setAvailDraft(availabilityFromVotes(state.dayVotes[voterId], state.hourVotes?.[voterId]))
  }, [voterId, state.dayVotes, state.hourVotes, editingAvail])

  const partyTabs = [
    ...SECTIONS.map((item) => ({ id: item.id, label: item.mgr })),
    ...(state.hongoJoins ? [{ id: 'hongo', label: '本郷' }] : []),
  ]
  const voter = partyTabs.find((item) => item.id === voterId) || partyTabs[0]
  const isMgr = SECTIONS.some((item) => item.id === voter.id)

  const focusVoter = (nextId: string) => {
    if (editingAvail && nextId !== voterId) {
      const confirmed = window.confirm('空き日時の編集中です。保存せずに切り替えますか？')
      if (!confirmed) return
      setEditingAvail(false)
    }
    setVoterId(nextId)
    if (SECTIONS.some((sectionItem) => sectionItem.id === nextId)) setActiveSectionId(nextId)
  }

  const startEditAvail = () => {
    setAvailDraft(availabilityFromVotes(state.dayVotes[voterId], state.hourVotes?.[voterId]))
    setEditingAvail(true)
  }

  const cancelEditAvail = () => {
    setAvailDraft(availabilityFromVotes(state.dayVotes[voterId], state.hourVotes?.[voterId]))
    setEditingAvail(false)
  }

  const saveEditAvail = async () => {
    if (availSubmitting) return
    setAvailSubmitting(true)
    try {
      const { dayMarks, hourMarks } = votesFromAvailability(availDraft)
      const ok = await app.setPartyAvailability(voterId, { dayMarks, hourMarks })
      if (ok !== false) setEditingAvail(false)
    } finally {
      setAvailSubmitting(false)
    }
  }

  return (
    <div className="grid w-full max-w-full min-w-0 gap-4 overflow-x-hidden pb-2">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold tracking-wider text-accent">{isMgr ? 'Mgr' : '今期は参加'}</p>
          <h1>{isMgr ? `${section.mgr}セクション` : `${voter.label}の空いている日時`}</h1>
        </div>
      </header>

      <div className="flex flex-wrap gap-2" role="group" aria-label="マネージャー切り替え">
        {partyTabs.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`rounded-full border px-3 py-1.5 ${
              item.id === voter.id
                ? 'border-[#c6532a] bg-[#c6532a] text-white'
                : 'border-line bg-white text-ink'
            }`}
            onClick={() => focusVoter(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <section className="grid w-full max-w-full min-w-0 gap-3.5 rounded-card border border-line bg-paper p-[18px] shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2>NG日程入力</h2>
            <p className="mt-1 text-sm text-muted">
              参加できない枠に × を付けてください。保存すると候補日時に反映されます。
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
                  data-testid="mgr-avail-save"
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
                data-testid="mgr-avail-edit"
                onClick={startEditAvail}
              >
                編集
              </button>
            )}
          </div>
        </div>
        <AvailabilityTimetable
          key={`${voterId}-${editingAvail ? 'edit' : 'view'}`}
          grid={editingAvail ? availDraft : viewAvailGrid}
          editing={editingAvail}
          onChange={setAvailDraft}
          disabled={availSubmitting}
          label={`${voter.label}の空き日時`}
        />
      </section>

      {isMgr ? <CandidateBoard state={state} section={section} /> : null}
      {!isMgr && state.hongoJoins ? <HongoScheduleCalendar state={state} /> : null}
    </div>
  )
}
