import { useState, type UIEvent } from 'react'
import { businessDays, HOURS, hourOf } from '../model/calendar'
import { formatDate } from '../model/format'
import { hourLabel } from '../model/availability'
import { MARK_SYMBOL } from '../model/rules'

type Mark = 'first' | 'ok' | 'ng'
type Slot = {
  id: string
  start: string
  end: string
  day?: string
  avoided?: boolean
}

type Props = {
  slots: Slot[]
  votes: Record<string, Mark | null | undefined>
  onChange: (slotId: string, mark: Mark) => void
  onDayMark?: (day: string, mark: Mark | null) => void
  disabled?: boolean
  difficultDates?: string[]
}

/** 枠いっぱいに塗りつぶす（余白・角丸による白い隙間を出さない） */
const CELL_BOX =
  'box-border m-0 flex h-full min-h-[40px] w-full min-w-[5.5rem] items-center justify-center border-line p-0 text-center leading-none transition'

/** sticky 時間列の右端境界影（/mgr AvailabilityTimetable と同仕様・横スクロール時のみ） */
const STICKY_TIME_EDGE_SHADOW =
  'transition-shadow duration-200 shadow-[4px_0_8px_-2px_rgba(0,0,0,0.12)]'
const STICKY_TIME_EDGE_NONE = 'transition-shadow duration-200 shadow-none'

function cellEdgeClass(isLastDay: boolean, isLastHour: boolean) {
  return `${isLastHour ? '' : 'border-b'} ${isLastDay ? '' : 'border-r'}`.trim()
}

/** 空白（調整可能） → × → ◎ → 空白 ※〇 は廃止 */
const MARK_CYCLE: Array<Mark | null> = [null, 'ng', 'first']

const DAY_ACTIONS: Array<{ id: Exclude<Mark, 'ok'>; symbol: string; activeClass: string }> = [
  { id: 'first', symbol: '◎', activeClass: 'border-[#c6532a] bg-[#c6532a] font-bold text-white hover:brightness-95' },
  { id: 'ng', symbol: '×', activeClass: 'border-[#d0d0d0] bg-[#e8ecec] text-[#8a8580] hover:bg-[#dde2e2]' },
]

const ENGINEER_MARK_LABEL: Record<'first' | 'ng', string> = {
  first: '強い希望',
  ng: '不可',
}

function slotDayIso(slot: Slot) {
  return slot.day || String(slot.start).slice(0, 10)
}

/** 旧「〇」は空白（調整可能）として扱う */
function normalizeMark(mark: Mark | null | undefined): Mark | null {
  if (!mark || mark === 'ok') return null
  return mark
}

function nextMark(current: Mark | null | undefined): Mark | null {
  const index = MARK_CYCLE.indexOf(normalizeMark(current))
  return MARK_CYCLE[(index + 1) % MARK_CYCLE.length]
}

function uniformDayMark(votes: Props['votes'], daySlots: Slot[]) {
  const marks = daySlots.map((slot) => normalizeMark(votes?.[slot.id]))
  if (marks.length === 0 || marks.some((mark) => mark !== marks[0])) return null
  return marks[0]
}

function cellClass(mark: Mark | null | undefined, interactive: boolean) {
  const normalized = normalizeMark(mark)
  if (normalized === 'first') {
    return interactive
      ? 'bg-[#c6532a] font-bold text-white hover:brightness-95'
      : 'bg-[#c6532a] font-bold text-white'
  }
  if (normalized === 'ng') {
    return interactive
      ? 'bg-[#e8ecec] font-bold text-[#8a8580] hover:bg-[#dde2e2]'
      : 'bg-[#e8ecec] font-bold text-[#8a8580]'
  }
  return interactive ? 'bg-white hover:bg-[#f3f6f6]' : 'bg-white'
}

function renderMark(mark: Mark | null | undefined) {
  const normalized = normalizeMark(mark)
  if (!normalized) {
    return <span aria-hidden="true" className="block h-4 w-4 leading-none text-transparent">·</span>
  }
  return (
    <span
      aria-hidden="true"
      className="block text-base font-bold leading-none text-inherit"
    >
      {MARK_SYMBOL[normalized]}
    </span>
  )
}

export function VoteEditor({
  slots,
  votes,
  onChange,
  onDayMark,
  disabled = false,
  difficultDates = [],
}: Props) {
  const interactive = !disabled
  const [scrolledX, setScrolledX] = useState(false)
  const stickyTimeEdge = scrolledX ? STICKY_TIME_EDGE_SHADOW : STICKY_TIME_EDGE_NONE

  const onTableScroll = (event: UIEvent<HTMLDivElement>) => {
    setScrolledX(event.currentTarget.scrollLeft > 0)
  }

  const slotByKey = new Map<string, Slot>()
  for (const slot of slots) {
    const day = slotDayIso(slot)
    const hour = hourOf(slot.start)
    slotByKey.set(`${day}-${hour}`, slot)
  }

  const slotsByDay = new Map<string, Slot[]>()
  for (const slot of slots) {
    const day = slotDayIso(slot)
    const list = slotsByDay.get(day) || []
    list.push(slot)
    slotsByDay.set(day, list)
  }

  /** 候補枠がある日付だけ表示（営業の全日カレンダーと同型だが、候補のない列は省く） */
  const days = businessDays().filter((day) => (slotsByDay.get(day.iso) || []).length > 0)

  if (slots.length === 0) {
    return <p className="text-muted">担当営業が参加可能な枠がありません。</p>
  }

  const onCellClick = (slot: Slot) => {
    if (!interactive) return
    const current = votes?.[slot.id] || null
    const next = nextMark(current)
    if (next === null) {
      if (current) onChange(slot.id, current)
      return
    }
    onChange(slot.id, next)
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          {interactive
            ? '候補日をクリックして選択してください。クリックごとに × → ◎ → 空白 と切り替わります。'
            : '閲覧モードです。'}
        </p>
      </div>

      <div className="w-full max-w-full min-w-0 px-2 pb-2">
        <div
          className="relative box-border mx-auto w-fit max-w-full min-w-0 overflow-x-auto rounded-sm border border-line bg-white"
          role="region"
          aria-label="担当営業の候補枠への優先度"
          onScroll={onTableScroll}
        >
          <table className="w-max min-w-max shrink-0 border-separate border-spacing-0 text-sm whitespace-nowrap">
            <thead>
              <tr>
                <th
                  scope="col"
                  className={`sticky left-0 z-30 box-border shrink-0 border-b border-r border-line bg-bg px-3 py-2 text-left align-bottom font-semibold text-ink ${stickyTimeEdge}`}
                >
                  時間
                </th>
                {days.map((day, dayIndex) => {
                  const daySlots = slotsByDay.get(day.iso) || []
                  const hasSlots = daySlots.length > 0
                  const dayMark = uniformDayMark(votes, daySlots)
                  const difficult = difficultDates.includes(day.iso)
                  const isLastDay = dayIndex === days.length - 1
                  return (
                    <th
                      key={day.iso}
                      scope="col"
                      className={`box-border w-[5.5rem] min-w-[5.5rem] shrink-0 border-b border-line px-1.5 py-2 text-center align-top font-semibold text-ink whitespace-nowrap ${
                        isLastDay ? '' : 'border-r'
                      } ${difficult ? 'bg-[#fff6ee]' : 'bg-bg'}`}
                    >
                      <div className="box-border flex h-[3.25rem] flex-col items-center justify-start gap-1.5">
                        <span className="inline-flex h-5 items-center leading-none">
                          {formatDate(day.iso)}
                          {difficult ? <span className="ml-0.5 text-[10px] font-bold text-warn">難</span> : null}
                        </span>
                        {interactive && hasSlots ? (
                          <div className="flex h-7 shrink-0 items-center justify-center gap-1">
                            {DAY_ACTIONS.map((action) => (
                              <button
                                key={action.id}
                                type="button"
                                className={`box-border inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border text-sm font-bold leading-none ${
                                  dayMark === action.id
                                    ? action.activeClass
                                    : 'border-line bg-white text-muted hover:bg-accent-soft'
                                }`}
                                aria-pressed={dayMark === action.id}
                                aria-label={
                                  dayMark === action.id
                                    ? `${formatDate(day.iso)}の${ENGINEER_MARK_LABEL[action.id]}を解除する`
                                    : `${formatDate(day.iso)}を${ENGINEER_MARK_LABEL[action.id]}にする`
                                }
                                onClick={() =>
                                  onDayMark?.(day.iso, dayMark === action.id ? null : action.id)
                                }
                              >
                                {action.symbol}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="flex h-7 shrink-0 items-center justify-center">
                            {dayMark ? (
                              <span className={`text-xs font-bold leading-none ${dayMark === 'first' ? 'text-[#c6532a]' : 'text-[#8a8580]'}`}>
                                {MARK_SYMBOL[dayMark]}
                              </span>
                            ) : null}
                          </div>
                        )}
                      </div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {HOURS.map((hour, hourIndex) => {
                const isLastHour = hourIndex === HOURS.length - 1
                return (
                <tr key={hour.hour} className="h-10">
                  <th
                    scope="row"
                    className={`sticky left-0 z-20 box-border h-10 min-h-[40px] border-r border-line bg-paper px-3 text-left font-medium text-ink whitespace-nowrap ${stickyTimeEdge} ${
                      isLastHour ? '' : 'border-b'
                    }`}
                  >
                    <span className="inline-flex h-10 items-center">
                      {hourLabel(hour.hour)}
                      {hour.avoided ? (
                        <span className="ml-1 text-[11px] font-normal text-warn">避</span>
                      ) : null}
                    </span>
                  </th>
                  {days.map((day, dayIndex) => {
                    const slot = slotByKey.get(`${day.iso}-${hour.hour}`)
                    const isLastDay = dayIndex === days.length - 1
                    const edges = cellEdgeClass(isLastDay, isLastHour)

                    if (!slot) {
                      return (
                        <td key={day.iso} className="box-border h-10 p-0 align-stretch">
                          <div
                            className={`${CELL_BOX} ${edges} bg-[#e8ecec] font-bold text-[#8a8580] hover:bg-[#dde2e2]`}
                            aria-label={`${formatDate(day.iso)} ${hourLabel(hour.hour)} 候補なし`}
                          >
                            —
                          </div>
                        </td>
                      )
                    }

                    const mark = normalizeMark(votes?.[slot.id])
                    const labelBase = `${formatDate(day.iso)} ${hourLabel(hour.hour)}`
                    const markText = mark ? ENGINEER_MARK_LABEL[mark] : '調整可能（空白）'

                    if (!interactive) {
                      return (
                        <td key={day.iso} className="box-border h-10 p-0 align-stretch">
                          <div
                            className={`${CELL_BOX} ${edges} ${cellClass(mark, false)}`}
                            aria-label={`${labelBase} ${markText}`}
                          >
                            {renderMark(mark)}
                          </div>
                        </td>
                      )
                    }

                    return (
                      <td key={day.iso} className="box-border h-10 p-0 align-stretch">
                        <button
                          type="button"
                          className={`${CELL_BOX} ${edges} ${cellClass(mark, true)}`}
                          aria-label={`${labelBase}（${markText}）。クリックで切り替え`}
                          onClick={() => onCellClick(slot)}
                        >
                          {renderMark(mark)}
                        </button>
                      </td>
                    )
                  })}
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
