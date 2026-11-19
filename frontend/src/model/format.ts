import { getSystemNowMs } from './systemClock'

export function jst(y, m, d, hh, mm) {
  const p = (n) => String(n).padStart(2, '0')
  return `${y}-${p(m)}-${p(d)}T${p(hh)}:${p(mm)}:00+09:00`
}

export function datetimeLocalToIso(value) {
  if (!value || !value.includes('T')) return null
  const [date, time] = value.split('T')
  const [hh = '00', mm = '00'] = time.split(':')
  return `${date}T${hh}:${mm}:00+09:00`
}

export function isoToDatetimeLocal(iso) {
  if (!iso) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso))
  const get = (type) => parts.find((part) => part.type === type)?.value || '00'
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
}

export function formatDateTime(iso) {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso))
}

export function formatRange(start, end) {
  if (!start) return '—'
  const day = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  }).format(new Date(start))
  const hm = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const endLabel = end ? hm.format(new Date(end)) : ''
  return `${day} ${hm.format(new Date(start))}${endLabel ? `–${endLabel}` : ''}`
}

export function formatDate(dateStr) {
  if (!dateStr) return '—'
  const [y, m, d] = dateStr.split('-').map(Number)
  const utc = new Date(Date.UTC(y, m - 1, d))
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'UTC',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  }).format(utc)
}

export function hashString(value) {
  let h = 2166136261
  for (const char of value) {
    h ^= char.codePointAt(0)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function buildMeetingUrl(provider, memberId, startIso) {
  const n = hashString(`${provider}|${memberId}|${startIso}`)
  if (provider === 'zoom') {
    const id = String(10000000000 + (n % 89999999999))
    return `https://zoom.us/j/${id}`
  }
  const alphabet = 'abcdefghijklmnopqrstuvwxyz'
  const chunk = (length, salt) => {
    let x = (n + salt * 997) >>> 0
    let text = ''
    for (let i = 0; i < length; i += 1) {
      x = (Math.imul(x, 1664525) + 1013904223 + i) >>> 0
      text += alphabet[x % 26]
    }
    return text
  }
  return `https://meet.google.com/${chunk(3, 1)}-${chunk(4, 2)}-${chunk(3, 3)}`
}

export function nextWeekdayMornings(count, existingMs, startFrom = '2026-11-16') {
  const [y, m, d] = startFrom.split('-').map(Number)
  const cursor = new Date(Date.UTC(y, m - 1, d))
  const out = []
  let guard = 0
  while (out.length < count && guard < 80) {
    guard += 1
    const day = cursor.getUTCDay()
    if (day !== 0 && day !== 6) {
      const start = jst(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, cursor.getUTCDate(), 10, 0)
      const end = jst(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, cursor.getUTCDate(), 11, 0)
      if (!existingMs.has(Date.parse(start))) out.push({ start, end })
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return out
}

export function confirmedWindow(interview, slots) {
  if (!interview) return null
  if (interview.confirmedOverride?.start) return interview.confirmedOverride
  const slot = slots.find((item) => item.id === interview.confirmedSlotId)
  if (!slot) return null
  return { start: slot.start, end: slot.end }
}

export function deadlineState(iso, now: number = getSystemNowMs()) {
  if (!iso) return 'unset'
  return Date.parse(iso) <= now ? 'past' : 'future'
}

export function slotDay(iso) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(iso))
  const get = (type) => parts.find((part) => part.type === type)?.value || '00'
  return `${get('year')}-${get('month')}-${get('day')}`
}

/**
 * 表示名からセクション接頭辞を除去する。
 * 例: "○○セクション-姓" / "Section A-Surname"（個人名・社内 ID はハードコードしない）
 */
export function stripSectionNamePrefix(name: string) {
  const raw = String(name || '')
  // 「○○セクション-姓」または「Section A-Surname」（先頭が Section の場合も含む）
  const stripped = raw.replace(/^(?:.+セクション|Section\s+\w+)-/, '')
  return stripped || raw
}
