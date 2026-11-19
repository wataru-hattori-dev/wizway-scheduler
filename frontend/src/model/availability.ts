import { businessDays, getActiveInterviewRange, HOURS } from './calendar'

export type DayMark = 'first' | 'ok' | 'ng' | null
export type DayVotes = Record<string, DayMark>
export type HourVotes = Record<string, number[]>
export type AvailabilityGrid = Record<string, number[]>

export function hourLabel(hour: number) {
  return `${String(hour).padStart(2, '0')}:00`
}

function periodBusinessDays() {
  const { startDate, endDate } = getActiveInterviewRange()
  return businessDays(startDate, endDate)
}

/** state の dayVotes / hourVotes から、日付→空き時間のグリッドを復元 */
export function availabilityFromVotes(
  dayVotes: DayVotes | undefined,
  hourVotes: HourVotes | undefined,
): AvailabilityGrid {
  const grid: AvailabilityGrid = {}
  for (const day of periodBusinessDays()) {
    if (dayVotes?.[day.iso] === 'ng') {
      grid[day.iso] = []
      continue
    }
    const picked = hourVotes?.[day.iso]
    if (Array.isArray(picked)) {
      grid[day.iso] = picked.filter((hour) => HOURS.some((item) => item.hour === hour))
    } else {
      grid[day.iso] = HOURS.map((item) => item.hour)
    }
  }
  return grid
}

/** グリッドを dayVotes / hourVotes 形式へ変換して保存用にする */
export function votesFromAvailability(grid: AvailabilityGrid): {
  dayMarks: DayVotes
  hourMarks: HourVotes
} {
  const dayMarks: DayVotes = {}
  const hourMarks: HourVotes = {}
  const allHours = HOURS.map((item) => item.hour)

  for (const day of periodBusinessDays()) {
    const hours = [...(grid[day.iso] || [])]
      .filter((hour) => allHours.includes(hour))
      .sort((a, b) => a - b)

    if (hours.length === 0) {
      dayMarks[day.iso] = 'ng'
      continue
    }

    dayMarks[day.iso] = 'ok'
    if (hours.length < allHours.length) {
      hourMarks[day.iso] = hours
    }
  }

  return { dayMarks, hourMarks }
}

export function isHourSelected(grid: AvailabilityGrid, dayIso: string, hour: number) {
  return (grid[dayIso] || []).includes(hour)
}

export function toggleAvailabilityHour(
  grid: AvailabilityGrid,
  dayIso: string,
  hour: number,
): AvailabilityGrid {
  const current = new Set(grid[dayIso] || [])
  if (current.has(hour)) current.delete(hour)
  else current.add(hour)
  return {
    ...grid,
    [dayIso]: [...current].sort((a, b) => a - b),
  }
}

/** その日の全時間を不可（×）にする */
export function markDayBlocked(grid: AvailabilityGrid, dayIso: string): AvailabilityGrid {
  return { ...grid, [dayIso]: [] }
}

/** その日の全時間を空きに戻す */
export function markDayOpen(grid: AvailabilityGrid, dayIso: string): AvailabilityGrid {
  return { ...grid, [dayIso]: HOURS.map((item) => item.hour) }
}

export function isDayFullyBlocked(grid: AvailabilityGrid, dayIso: string) {
  return (grid[dayIso] || []).length === 0
}

export function countSelectedSlots(grid: AvailabilityGrid) {
  return Object.values(grid).reduce((sum, hours) => sum + hours.length, 0)
}

export function countBlockedSlots(grid: AvailabilityGrid) {
  const total = periodBusinessDays().length * HOURS.length
  return total - countSelectedSlots(grid)
}
