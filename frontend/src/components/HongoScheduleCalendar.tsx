import { useMemo, useState } from 'react'
import { availabilityFromVotes, isHourSelected } from '../model/availability'
import { businessDays, HOURS, hourOf, isJapaneseHoliday, slotBounds } from '../model/calendar'
import { candidateSlots } from '../model/candidates'
import { formatDate } from '../model/format'
import { useInterviewPeriod } from '../model/interviewPeriod'
import { assignedSalesId, SALES_IDS, SALES_LABEL } from '../model/rules'
import { memberById, MEMBERS, sectionById } from '../model/seed'
import { autoAssignInterviews } from './CandidateBoard'
import { Modal } from './Modal'

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

/** 面談期間内の全日（土日含む）。表示用 */
function calendarDaysInRange(rangeStart: string, rangeEnd: string) {
  const [sy, sm, sd] = rangeStart.split('-').map(Number)
  const [ey, em, ed] = rangeEnd.split('-').map(Number)
  const days = []
  const cursor = new Date(Date.UTC(sy, sm - 1, sd))
  const end = new Date(Date.UTC(ey, em - 1, ed))
  while (cursor <= end) {
    const dow = cursor.getUTCDay()
    days.push({
      iso: cursor.toISOString().slice(0, 10),
      day: cursor.getUTCDate(),
      dow,
      weekend: dow === 0 || dow === 6,
    })
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return days
}

function surnameOf(member) {
  return member?.surname || String(member?.name || '').replace(/^.+セクション-/, '') || '—'
}

function interviewLabel(member) {
  return `${surnameOf(member)}`
}

function formatHmRange(start, end) {
  if (!start) return '—'
  const hm = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const endLabel = end ? hm.format(new Date(end)) : ''
  return `${hm.format(new Date(start))}${endLabel ? `-${endLabel}` : ''}`
}

function resolveInterviewWindow(state, memberId, interview) {
  if (interview?.confirmedOverride?.start) {
    const start = interview.confirmedOverride.start
    const day = String(start).slice(0, 10)
    const hour = hourOf(start)
    return {
      start,
      end: interview.confirmedOverride.end || (Number.isFinite(hour) ? slotBounds(day, hour).end : null),
    }
  }
  if (!interview?.confirmedSlotId) return null
  const member = memberById(memberId)
  if (!member?.sectionId) return null
  const slot = candidateSlots(state, member.sectionId).find((item) => item.id === interview.confirmedSlotId)
  if (!slot?.start) return null
  const day = String(slot.start).slice(0, 10)
  const hour = hourOf(slot.start)
  return {
    start: slot.start,
    end: slot.end || (Number.isFinite(hour) ? slotBounds(day, hour).end : null),
  }
}

type HongoMeeting = {
  key: string
  memberId: number | string
  member: ReturnType<typeof memberById>
  start: string
  end: string | null
  day: string
  hour: number
  salesId: string | null
  sectionId: string
  source: 'confirmed' | 'assigned'
  pairTitle: string
  meetingUrl: string | null
  note: string
  preferredTimeNote: string
  pendingNote: string | null
  assignReason: string | null
}

function pairTitle(state, member, salesId: string | null) {
  const section = sectionById(member?.sectionId)
  const parts = [section?.mgr || member?.sectionId, salesId ? SALES_LABEL[salesId] : '営業未設定', '本郷', surnameOf(member)]
  return parts.join(' / ')
}

function collectHongoMeetings(state, assignments: Map<any, any>): HongoMeeting[] {
  if (!state.hongoJoins) return []

  const meetings: HongoMeeting[] = []
  const seen = new Set<string>()

  for (const member of MEMBERS.filter((m) => m.isInterviewer !== false)) {
    const interview = state.interviews?.[member.id]
    const salesId =
      interview?.confirmedSalesId ||
      assignments.get(member.id)?.salesId ||
      assignedSalesId(state, member.id)

    if (interview?.status === 'confirmed' || interview?.status === 'change_requested') {
      const window = resolveInterviewWindow(state, member.id, interview)
      if (!window?.start) continue
      const key = `${member.id}|${window.start}`
      if (seen.has(key)) continue
      seen.add(key)
      meetings.push({
        key,
        memberId: member.id,
        member,
        start: window.start,
        end: window.end || null,
        day: String(window.start).slice(0, 10),
        hour: Number(String(window.start).slice(11, 13)),
        salesId,
        sectionId: member.sectionId,
        source: 'confirmed',
        pairTitle: pairTitle(state, member, salesId),
        meetingUrl: interview.meetingUrl || null,
        note: interview.preferences?.note || '',
        preferredTimeNote: interview.preferences?.preferredTimeNote || '',
        pendingNote: interview.pendingNote || null,
        assignReason: interview.assignReason || null,
      })
      continue
    }

    const assigned = assignments.get(member.id)
    if (!assigned?.start) continue
    const key = `${member.id}|${assigned.start}`
    if (seen.has(key)) continue
    seen.add(key)
    meetings.push({
      key,
      memberId: member.id,
      member,
      start: assigned.start,
      end:
        assigned.end ||
        (Number.isFinite(Number(assigned.hour))
          ? slotBounds(assigned.day, Number(assigned.hour)).end
          : null),
      day: assigned.day,
      hour: Number(assigned.hour),
      salesId: assigned.salesId || salesId,
      sectionId: member.sectionId,
      source: 'assigned',
      pairTitle: pairTitle(state, member, assigned.salesId || salesId),
      meetingUrl: interview?.meetingUrl || null,
      note: interview?.preferences?.note || '',
      preferredTimeNote: interview?.preferences?.preferredTimeNote || '',
      pendingNote: interview?.pendingNote || null,
      assignReason: interview?.assignReason || assigned.assignReason || null,
    })
  }

  return meetings.sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
}

type DayCell = {
  iso: string
  dow: number
  kind: 'off' | 'blocked' | 'open' | 'booked'
  meetings: HongoMeeting[]
  openHours: number
}

function statusLabel(source: HongoMeeting['source']) {
  return source === 'confirmed' ? '面談確定' : '面談予定'
}

function StatusBadge({ source }: { source: HongoMeeting['source'] }) {
  return (
    <span
      className={`inline-flex shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
        source === 'confirmed' ? 'bg-ok-bg text-ok' : 'bg-accent-soft text-accent'
      }`}
    >
      {statusLabel(source)}
    </span>
  )
}

type SalesFilterId = 'all' | (typeof SALES_IDS)[number]

const SALES_FILTER_TABS: { id: SalesFilterId; label: string }[] = [
  { id: 'all', label: '全員' },
  ...SALES_IDS.map((id) => ({ id, label: SALES_LABEL[id] || id })),
]

export function HongoScheduleCalendar({
  state,
  enableSalesFilter = false,
}: {
  state: any
  /** Admin の面談スケジュールのみ担当者フィルターを表示 */
  enableSalesFilter?: boolean
}) {
  const { startDate, endDate } = useInterviewPeriod()
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [dayMeetings, setDayMeetings] = useState<HongoMeeting[] | null>(null)
  const [salesFilter, setSalesFilter] = useState<SalesFilterId>('all')

  const hongoGrid = useMemo(
    () => availabilityFromVotes(state.dayVotes?.hongo, state.hourVotes?.hongo),
    [state.dayVotes, state.hourVotes],
  )

  const assignments = useMemo(() => autoAssignInterviews(state), [state])
  const allMeetings = useMemo(() => collectHongoMeetings(state, assignments), [state, assignments])

  const meetings = useMemo(() => {
    if (!enableSalesFilter || salesFilter === 'all') return allMeetings
    return allMeetings.filter((meeting) => meeting.salesId === salesFilter)
  }, [allMeetings, enableSalesFilter, salesFilter])

  const meetingsByDay = useMemo(() => {
    const map = new Map<string, HongoMeeting[]>()
    for (const meeting of meetings) {
      const list = map.get(meeting.day) || []
      list.push(meeting)
      map.set(meeting.day, list)
    }
    return map
  }, [meetings])

  const businessIso = useMemo(
    () => new Set(businessDays(startDate, endDate).map((day) => day.iso)),
    [startDate, endDate],
  )

  const calendarDays = useMemo((): DayCell[] => {
    return calendarDaysInRange(startDate, endDate).map((day) => {
      if (day.weekend || isJapaneseHoliday(day.iso) || !businessIso.has(day.iso)) {
        return { iso: day.iso, dow: day.dow, kind: 'off', meetings: [], openHours: 0 }
      }

      const dayMeetingsForCell = meetingsByDay.get(day.iso) || []
      const openHours = HOURS.filter((hour) => isHourSelected(hongoGrid, day.iso, hour.hour)).length
      const blocked = openHours === 0

      if (dayMeetingsForCell.length) {
        return { iso: day.iso, dow: day.dow, kind: 'booked', meetings: dayMeetingsForCell, openHours }
      }
      if (blocked) {
        return { iso: day.iso, dow: day.dow, kind: 'blocked', meetings: [], openHours: 0 }
      }
      return { iso: day.iso, dow: day.dow, kind: 'open', meetings: [], openHours }
    })
  }, [startDate, endDate, businessIso, meetingsByDay, hongoGrid])

  const bookedCount = meetings.length
  const confirmedCount = meetings.filter((item) => item.source === 'confirmed').length

  const leadPad = calendarDays.length ? calendarDays[0].dow : 0
  const lastDow = calendarDays.length ? calendarDays[calendarDays.length - 1].dow : 0
  const trailPad = calendarDays.length ? (6 - lastDow + 7) % 7 : 0

  const selectedMeeting =
    dayMeetings?.find((item) => item.key === selectedKey) || dayMeetings?.[0] || null

  const openMeetingDetail = (items: HongoMeeting[]) => {
    if (!items.length) return
    setDayMeetings(items)
    setSelectedKey(items[0].key)
  }

  const closeMeetingDetail = () => {
    setSelectedKey(null)
    setDayMeetings(null)
  }

  const changeSalesFilter = (next: SalesFilterId) => {
    if (next === salesFilter) return
    setSalesFilter(next)
    closeMeetingDetail()
  }

  const fillerCell = (key: string) => (
    <div
      key={key}
      role="gridcell"
      className="flex min-h-[4.5rem] flex-col items-center justify-center gap-1 bg-[#d8d8d8] px-1.5 py-2 text-center"
      aria-hidden="true"
    >
      <span className="text-lg font-bold leading-none text-[#5c5c5c]">—</span>
    </div>
  )

  const section = selectedMeeting ? sectionById(selectedMeeting.sectionId) : null

  return (
    <>
      <article
        className="grid gap-3.5 rounded-card border border-line bg-paper p-[18px] text-ink shadow-card"
        data-testid="hongo-schedule-calendar"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="m-0 text-ink">面談スケジュール</h2>
              {enableSalesFilter ? (
                <div
                  className="flex flex-wrap gap-1 rounded-md bg-[#f7f4ef] p-1"
                  role="tablist"
                  aria-label="担当者フィルター"
                  data-testid="hongo-sales-filter"
                >
                  {SALES_FILTER_TABS.map((tab) => {
                    const active = salesFilter === tab.id
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        data-testid={`hongo-sales-filter-${tab.id}`}
                        className={`shrink-0 rounded-full border px-3 py-1 text-sm transition ${
                          active
                            ? 'border-[#c6532a] bg-[#c6532a] text-white'
                            : 'border-transparent bg-transparent text-ink hover:bg-white'
                        }`}
                        onClick={() => changeSalesFilter(tab.id)}
                      >
                        {tab.label}
                      </button>
                    )
                  })}
                </div>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-muted">
              全セクションの面談ペア（Mgr / 担当営業 / エンジニア）への同席予定と空き状況を集計しています。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="shrink-0 rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-accent">
              面談 {bookedCount}件（確定 {confirmedCount}）
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <div
            className="inline-grid min-w-full grid-cols-7 gap-px overflow-hidden rounded-sm border border-line bg-line"
            role="grid"
            aria-label="本郷の面談スケジュール"
          >
            {WEEKDAY_LABELS.map((label) => (
              <div
                key={label}
                className="bg-bg px-2 py-1.5 text-center text-xs font-semibold text-muted"
                role="columnheader"
              >
                {label}
              </div>
            ))}
            {Array.from({ length: leadPad }, (_, index) => fillerCell(`lead-${index}`))}
            {calendarDays.map((day) => {
              if (day.kind === 'off') {
                return (
                  <div
                    key={day.iso}
                    role="gridcell"
                    className="flex min-h-[4.5rem] flex-col items-center justify-center gap-1 bg-[#d8d8d8] px-1.5 py-2 text-center"
                    title={`${formatDate(day.iso)} 対象外（土日祝）`}
                    aria-label={`${formatDate(day.iso)} 対象外`}
                  >
                    <span className="text-lg font-bold leading-none text-[#5c5c5c]">—</span>
                  </div>
                )
              }

              if (day.kind === 'blocked') {
                return (
                  <div
                    key={day.iso}
                    role="gridcell"
                    className="box-border flex min-h-[4.5rem] w-full flex-col items-center justify-center gap-1 bg-[#e8ecec] p-0 text-center font-bold leading-none"
                    title={`${formatDate(day.iso)} 本郷不可`}
                    aria-label={`${formatDate(day.iso)} — 不可`}
                  >
                    <span className="text-xs text-[#8a8580]">{formatDate(day.iso)}</span>
                    <span className="text-lg font-bold leading-none text-[#8a8580]">—</span>
                  </div>
                )
              }

              if (day.kind === 'open') {
                return (
                  <div
                    key={day.iso}
                    role="gridcell"
                    className="box-border flex min-h-[4.5rem] w-full flex-col items-center justify-center gap-1 bg-white px-1.5 py-2 text-center leading-none"
                    title={`${formatDate(day.iso)} 空き ${day.openHours}枠`}
                    aria-label={`${formatDate(day.iso)} 空き`}
                  >
                    <span className="text-xs text-muted">{formatDate(day.iso)}</span>
                    <span className="text-base font-bold leading-none text-ok">〇</span>
                    <span className="text-[10px] font-normal text-muted">{day.openHours}枠空き</span>
                  </div>
                )
              }

              const primary = day.meetings[0]
              const names = day.meetings.map((item) => interviewLabel(item.member)).join('・')
              const pairDetail = day.meetings.map((item) => item.pairTitle).join(' / ')
              const ariaSummary =
                day.meetings.length === 1 ? names : `${names} ${day.meetings.length}件`

              return (
                <button
                  key={day.iso}
                  type="button"
                  role="gridcell"
                  className="box-border flex min-h-[4.5rem] w-full cursor-pointer flex-col items-center justify-center gap-1 bg-paper px-1.5 py-2 text-center leading-none transition-colors hover:bg-[#F3EFE7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
                  title={`${formatDate(day.iso)} ${names}\n${pairDetail}`}
                  aria-label={`${formatDate(day.iso)} ${ariaSummary}の詳細を開く`}
                  data-testid={`hongo-meeting-cell-${day.iso}`}
                  onClick={() => openMeetingDetail(day.meetings)}
                >
                  <span className="text-xs text-muted">{formatDate(day.iso)}</span>
                  <span className="max-w-full truncate text-sm font-bold leading-tight text-ok">{names}</span>
                  {day.meetings.length === 1 ? (
                    <span className="text-[10px] font-normal text-muted">
                      {String(primary.hour).padStart(2, '0')}:00
                      {primary.source === 'confirmed' ? ' · 確定' : ''}
                    </span>
                  ) : (
                    <span className="text-[10px] font-normal text-muted">{day.meetings.length}件</span>
                  )}
                </button>
              )
            })}
            {Array.from({ length: trailPad }, (_, index) => fillerCell(`trail-${index}`))}
          </div>
        </div>
      </article>

      {selectedMeeting ? (
        <Modal
          title={`${surnameOf(selectedMeeting.member)}　面談日時`}
          onClose={closeMeetingDetail}
          footer={
            <button type="button" className="btn btn-primary" onClick={closeMeetingDetail}>
              閉じる
            </button>
          }
        >
          {dayMeetings && dayMeetings.length > 1 ? (
            <div
              className="mt-0 grid gap-2 rounded-lg border border-ok/30 bg-[#F3EFE7] px-3.5 py-3 text-sm text-ink"
              data-testid="hongo-meeting-picker"
            >
              <div className="font-semibold">{formatDate(selectedMeeting.day)}</div>
              <div
                className="grid gap-1 overflow-x-auto"
                role="radiogroup"
                aria-label={`${formatDate(selectedMeeting.day)}の面談`}
              >
                {dayMeetings.map((item) => (
                  <div key={item.key} className="flex flex-wrap items-center gap-2">
                    <label className="flex cursor-pointer flex-row items-center gap-1 whitespace-nowrap rounded-md bg-[#F3EFE7] px-1 py-1 text-xs">
                      <input
                        type="radio"
                        className="m-0 h-auto w-auto shrink-0 p-0"
                        name="hongo-meeting-detail"
                        checked={item.key === selectedMeeting.key}
                        onChange={() => setSelectedKey(item.key)}
                      />
                      <span className="whitespace-nowrap">{formatHmRange(item.start, item.end)}</span>
                      <span className="whitespace-nowrap">{item.pairTitle}</span>
                    </label>
                    <StatusBadge source={item.source} />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div
              className="mt-0 grid gap-2 rounded-lg border border-ok/30 bg-[#F3EFE7] px-3.5 py-3 text-sm text-ink"
              data-testid="hongo-meeting-slot"
            >
              <div className="font-semibold">面談日時</div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex flex-row items-center gap-1 whitespace-nowrap rounded-md bg-[#F3EFE7] px-1 py-1 text-xs">
                  <span className="whitespace-nowrap">
                    {formatHmRange(selectedMeeting.start, selectedMeeting.end)}
                  </span>
                  <span className="whitespace-nowrap">{selectedMeeting.pairTitle}</span>
                </div>
                <StatusBadge source={selectedMeeting.source} />
              </div>
            </div>
          )}

          <dl className="mt-3 grid gap-3 text-sm">
            <div data-testid="hongo-meet-url">
              <dt className="m-0 font-semibold">Google Meet URL</dt>
              <dd className="m-0 mt-1.5">
                {selectedMeeting.meetingUrl ? (
                  <a
                    href={selectedMeeting.meetingUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block break-all rounded-lg border border-line bg-bg px-2.5 py-2 font-mono text-sm text-accent underline-offset-2 hover:underline"
                  >
                    {selectedMeeting.meetingUrl}
                  </a>
                ) : (
                  <p className="m-0 text-muted">未発行</p>
                )}
              </dd>
            </div>

            {selectedMeeting.note ? (
              <div>
                <dt className="m-0 text-xs text-muted">メモ</dt>
                <dd className="m-0 mt-1 whitespace-pre-wrap text-ink">{selectedMeeting.note}</dd>
              </div>
            ) : null}

            {selectedMeeting.preferredTimeNote ? (
              <div>
                <dt className="m-0 text-xs text-muted">希望時間メモ</dt>
                <dd className="m-0 mt-1 whitespace-pre-wrap text-ink">{selectedMeeting.preferredTimeNote}</dd>
              </div>
            ) : null}

            {selectedMeeting.pendingNote ? (
              <div>
                <dt className="m-0 text-xs text-muted">保留メモ</dt>
                <dd className="m-0 mt-1 whitespace-pre-wrap text-ink">{selectedMeeting.pendingNote}</dd>
              </div>
            ) : null}
          </dl>
        </Modal>
      ) : null}
    </>
  )
}
