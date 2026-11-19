import { jst } from './format'

export const RANGE_START = '2026-12-01'
export const RANGE_END = '2026-12-18'

/** 管理者設定の面談期間（未設定時はデモ既定レンジ） */
let activeStart = RANGE_START
let activeEnd = RANGE_END

export function getActiveInterviewRange() {
  return { startDate: activeStart, endDate: activeEnd }
}

export function setActiveInterviewRange(startDate: string, endDate: string) {
  if (startDate && endDate && startDate <= endDate) {
    activeStart = startDate
    activeEnd = endDate
    return
  }
  activeStart = RANGE_START
  activeEnd = RANGE_END
}

/** 追加の休日（手動指定）。計算祝日と合わせて除外する */
export const HOLIDAYS: string[] = []

function nthMonday(year: number, monthIndex: number, n: number) {
  const first = new Date(Date.UTC(year, monthIndex, 1))
  const firstDow = first.getUTCDay()
  const offset = (1 - firstDow + 7) % 7
  return 1 + offset + (n - 1) * 7
}

/** 春分・秋分の簡易近似（日本・2000〜2099） */
function equinoxDay(year: number, kind: 'vernal' | 'autumnal') {
  if (kind === 'vernal') {
    return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4))
  }
  return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4))
}

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

function toIso(year: number, month: number, day: number) {
  return `${year}-${pad2(month)}-${pad2(day)}`
}

/** 国民の祝日（振替休日含む）または HOLIDAYS 指定日か */
export function isJapaneseHoliday(iso: string): boolean {
  if (HOLIDAYS.includes(iso)) return true
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return false

  const fixedOrHappy = new Set<string>([
    toIso(y, 1, 1),
    toIso(y, 1, nthMonday(y, 0, 2)),
    toIso(y, 2, 11),
    toIso(y, 2, 23),
    toIso(y, 3, equinoxDay(y, 'vernal')),
    toIso(y, 4, 29),
    toIso(y, 5, 3),
    toIso(y, 5, 4),
    toIso(y, 5, 5),
    toIso(y, 7, nthMonday(y, 6, 3)),
    toIso(y, 8, 11),
    toIso(y, 9, nthMonday(y, 8, 3)),
    toIso(y, 9, equinoxDay(y, 'autumnal')),
    toIso(y, 10, nthMonday(y, 9, 2)),
    toIso(y, 11, 3),
    toIso(y, 11, 23),
  ])

  if (fixedOrHappy.has(iso)) return true

  // 振替休日: 祝日が日曜のとき翌平日
  const prev = new Date(Date.UTC(y, m - 1, d - 1))
  const prevIso = prev.toISOString().slice(0, 10)
  if (prev.getUTCDay() === 0 && fixedOrHappy.has(prevIso)) return true

  // 国民の休日: 祝日に挟まれた平日（5/4 など）
  const next = new Date(Date.UTC(y, m - 1, d + 1))
  const nextIso = next.toISOString().slice(0, 10)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  if (dow !== 0 && dow !== 6 && fixedOrHappy.has(prevIso) && fixedOrHappy.has(nextIso)) return true

  return false
}

export const HOURS = [
  { hour: 10, avoided: true },
  { hour: 11, avoided: false },
  { hour: 12, avoided: false },
  { hour: 14, avoided: false },
  { hour: 15, avoided: false },
  { hour: 16, avoided: false },
  { hour: 17, avoided: false },
  { hour: 18, avoided: false },
]

/**
 * 面談期間内の平日のみ（土日・日本の祝日を除外）。
 * 引数省略時は管理者設定のアクティブ期間を使う。
 */
export function businessDays(rangeStart = activeStart, rangeEnd = activeEnd) {
  const days = []
  const [sy, sm, sd] = String(rangeStart).split('-').map(Number)
  const [ey, em, ed] = String(rangeEnd).split('-').map(Number)
  if (!sy || !sm || !sd || !ey || !em || !ed) return days

  const cursor = new Date(Date.UTC(sy, sm - 1, sd))
  const end = new Date(Date.UTC(ey, em - 1, ed))
  if (cursor > end) return days

  while (cursor <= end) {
    const dow = cursor.getUTCDay()
    const iso = cursor.toISOString().slice(0, 10)
    if (dow !== 0 && dow !== 6 && !isJapaneseHoliday(iso)) {
      days.push({ iso, day: cursor.getUTCDate(), dow })
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return days
}

export function slotBounds(iso, hour) {
  const [year, month, day] = iso.split('-').map(Number)
  return {
    start: jst(year, month, day, hour, 0),
    end: jst(year, month, day, hour + 1, 0),
  }
}

export function hourOf(start) {
  return Number(String(start).slice(11, 13))
}
