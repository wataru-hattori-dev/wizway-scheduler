import { useMemo, useState, type UIEvent } from 'react'
import { businessDays, HOURS } from '../model/calendar'
import {
  AvailabilityGrid,
  hourLabel,
  isDayFullyBlocked,
  isHourSelected,
  markDayBlocked,
  markDayOpen,
  toggleAvailabilityHour,
} from '../model/availability'
import { formatDate } from '../model/format'
import { useInterviewPeriod } from '../model/interviewPeriod'

type Props = {
  grid: AvailabilityGrid
  editing?: boolean
  disabled?: boolean
  onChange?: (next: AvailabilityGrid) => void
  label?: string
}

/** 枠いっぱいに塗りつぶす（余白・角丸による白い隙間を出さない／エンジニア優先度表と同構造） */
const CELL_BOX =
  'box-border m-0 flex h-full min-h-[40px] w-full min-w-[4.5rem] items-center justify-center border-line p-0 text-center leading-none transition'

/** sticky 時間列の右端: 薄い黒/グレー系ドロップシャドウ（日付セルとの境目用・横スクロール時のみ） */
const STICKY_TIME_EDGE_SHADOW =
  'transition-shadow duration-200 shadow-[4px_0_8px_-2px_rgba(0,0,0,0.12)]'
const STICKY_TIME_EDGE_NONE = 'transition-shadow duration-200 shadow-none'

function cellEdgeClass(isLastDay: boolean, isLastHour: boolean) {
  return `${isLastHour ? '' : 'border-b'} ${isLastDay ? '' : 'border-r'}`.trim()
}

export function AvailabilityTimetable({
  grid,
  editing = false,
  disabled = false,
  onChange,
  label = '空き日時タイムテーブル',
}: Props) {
  const { startDate, endDate } = useInterviewPeriod()
  const days = useMemo(() => businessDays(startDate, endDate), [startDate, endDate])
  const interactive = editing && !disabled && Boolean(onChange)
  const [scrolledX, setScrolledX] = useState(false)
  const stickyTimeEdge = scrolledX ? STICKY_TIME_EDGE_SHADOW : STICKY_TIME_EDGE_NONE

  const onTableScroll = (event: UIEvent<HTMLDivElement>) => {
    setScrolledX(event.currentTarget.scrollLeft > 0)
  }

  const onToggle = (dayIso: string, hour: number) => {
    if (!interactive || !onChange) return
    onChange(toggleAvailabilityHour(grid, dayIso, hour))
  }

  const onDayBlocked = (dayIso: string) => {
    if (!interactive || !onChange) return
    onChange(markDayBlocked(grid, dayIso))
  }

  const onDayOpen = (dayIso: string) => {
    if (!interactive || !onChange) return
    onChange(markDayOpen(grid, dayIso))
  }

  /** × = 不可（空きでない）。空欄 = 空き */
  const renderMark = (blocked: boolean) => (
    <span
      aria-hidden="true"
      className={`block text-base font-bold leading-none ${
        blocked ? 'text-[#8a8580]' : 'text-transparent'
      }`}
    >
      ×
    </span>
  )

  return (
    <div className="grid w-full max-w-full min-w-0 gap-3">
      <p className="min-w-0 text-sm text-muted">
        {interactive
          ? 'マスをクリックすると × → 空欄 という順番で切り替わります。「一日×」でその日すべてを不可にできます。'
          : '閲覧モードです。右上の「編集」から変更できます。'}
      </p>

      <div className="w-full max-w-full min-w-0 px-2 pb-2">
        <div
          className="relative box-border mx-auto w-fit max-w-full min-w-0 overflow-x-auto rounded-sm border border-line bg-white"
          role="region"
          aria-label={label}
          onScroll={onTableScroll}
        >
          <table className="w-max min-w-max shrink-0 border-separate border-spacing-0 text-sm whitespace-nowrap">
            <thead>
              <tr className="relative">
                <th
                  scope="col"
                  className={`sticky left-0 z-30 box-border border-b border-r border-line bg-bg px-3 py-2 text-left align-bottom font-semibold text-ink ${stickyTimeEdge}`}
                >
                  時間
                </th>
                {days.map((day, dayIndex) => {
                  const dayBlocked = isDayFullyBlocked(grid, day.iso)
                  const isLastDay = dayIndex === days.length - 1
                  return (
                    <th
                      key={day.iso}
                      scope="col"
                      className={`box-border w-[4.5rem] min-w-[4.5rem] border-b border-line bg-bg px-1 py-2 text-center align-top font-semibold text-ink whitespace-nowrap ${
                        isLastDay ? '' : 'border-r'
                      }`}
                    >
                      <div className="box-border flex h-[3rem] flex-col items-center justify-start gap-1">
                        <span className="inline-flex h-5 items-center leading-none">{formatDate(day.iso)}</span>
                        <div className="flex h-[22px] w-full shrink-0 items-center justify-center">
                          {interactive ? (
                            dayBlocked ? (
                              <button
                                type="button"
                                className="box-border inline-flex h-[22px] min-w-[2.125rem] items-center justify-center rounded-sm border border-line bg-white px-1.5 text-[10px] font-medium leading-none text-muted hover:bg-accent-soft"
                                aria-label={`${formatDate(day.iso)}の×をすべて解除`}
                                onClick={() => onDayOpen(day.iso)}
                              >
                                解除
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="box-border inline-flex h-[22px] min-w-[2.125rem] items-center justify-center rounded-sm border border-[#d0d0d0] bg-[#e8ecec] px-1.5 text-[10px] font-medium leading-none text-[#8a8580] hover:bg-[#dde2e2]"
                                aria-label={`${formatDate(day.iso)}を一日×にする`}
                                onClick={() => onDayBlocked(day.iso)}
                              >
                                ×
                              </button>
                            )
                          ) : dayBlocked ? (
                            <span className="text-[10px] font-bold leading-none text-[#8a8580]">×</span>
                          ) : null}
                        </div>
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
                  <tr key={hour.hour} className="relative h-10">
                    <th
                      scope="row"
                      className={`sticky left-0 z-20 box-border h-10 min-h-[40px] border-r border-line bg-paper px-3 text-left font-medium text-ink whitespace-nowrap ${stickyTimeEdge} ${
                        isLastHour ? '' : 'border-b'
                      }`}
                    >
                      <span className="inline-flex h-10 items-center bg-paper">
                        {hourLabel(hour.hour)}
                        {hour.avoided ? (
                          <span className="ml-1 text-[11px] font-normal text-warn">避</span>
                        ) : null}
                      </span>
                    </th>
                    {days.map((day, dayIndex) => {
                      const available = isHourSelected(grid, day.iso, hour.hour)
                      const blocked = !available
                      const isLastDay = dayIndex === days.length - 1
                      const edges = cellEdgeClass(isLastDay, isLastHour)
                      const blockedClass = 'bg-[#e8ecec] font-bold hover:bg-[#dde2e2]'
                      const openClass = 'bg-white hover:bg-[#f3f6f6]'
                      const viewBlocked = 'bg-[#e8ecec] font-bold'
                      const viewOpen = 'bg-white'

                      if (!interactive) {
                        return (
                          <td key={day.iso} className="box-border h-10 p-0 align-stretch">
                            <div
                              className={`${CELL_BOX} ${edges} ${blocked ? viewBlocked : viewOpen}`}
                              aria-label={`${formatDate(day.iso)} ${hourLabel(hour.hour)} ${blocked ? '不可' : '空き'}`}
                            >
                              {renderMark(blocked)}
                            </div>
                          </td>
                        )
                      }

                      return (
                        <td key={day.iso} className="box-border h-10 p-0 align-stretch">
                          <button
                            type="button"
                            className={`${CELL_BOX} ${edges} ${blocked ? blockedClass : openClass}`}
                            aria-pressed={blocked}
                            aria-label={`${formatDate(day.iso)} ${hourLabel(hour.hour)}を${blocked ? '空きに戻す' : '不可（×）にする'}`}
                            onClick={() => onToggle(day.iso, hour.hour)}
                          >
                            {renderMark(blocked)}
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
