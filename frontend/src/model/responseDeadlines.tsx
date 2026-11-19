import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { ApiError, api } from '../api/client'
import { getBootstrapCache } from '../api/bootstrapCache'

const USE_API = import.meta.env.VITE_USE_API !== 'false'

export type ResponseDeadlines = {
  /** YYYY-MM-DD（Mgr/営業の回答期限） */
  mgrSalesDeadline: string
  /** YYYY-MM-DD（エンジニアの回答期限） */
  engineerDeadline: string
}

type ResponseDeadlinesContextValue = ResponseDeadlines & {
  setDeadlines: (mgrSalesDeadline: string, engineerDeadline: string) => boolean | Promise<boolean>
}

const ResponseDeadlinesContext = createContext<ResponseDeadlinesContextValue | null>(null)

function isDateOnly(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function normalizeDeadlines(raw: Partial<ResponseDeadlines> | null | undefined): ResponseDeadlines {
  return {
    mgrSalesDeadline: isDateOnly(raw?.mgrSalesDeadline) ? raw.mgrSalesDeadline : '',
    engineerDeadline: isDateOnly(raw?.engineerDeadline) ? raw.engineerDeadline : '',
  }
}

/** YYYY-MM-DD の翌日（JST カレンダー日）を返す */
export function nextCalendarDay(dateIso: string): string | null {
  if (!isDateOnly(dateIso)) return null
  const nextMs = Date.parse(`${dateIso}T00:00:00+09:00`) + 24 * 60 * 60 * 1000
  if (Number.isNaN(nextMs)) return null
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(nextMs))
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '00'
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** 表示用: 2026-12-26 → 2026/12/26 */
export function formatDateSlash(dateIso: string): string {
  if (!isDateOnly(dateIso)) return dateIso
  return dateIso.replace(/-/g, '/')
}

/**
 * エンジニア入力開始日（Mgr/営業回答期限の翌日 00:00 JST）より前か。
 * 期限未設定時はロックしない（現行どおり入力可能）。
 */
export function isBeforeEngineerOpen(mgrSalesDeadline: string | null | undefined, nowMs: number): boolean {
  const openDay = mgrSalesDeadline ? nextCalendarDay(mgrSalesDeadline) : null
  if (!openDay) return false
  const openAt = Date.parse(`${openDay}T00:00:00+09:00`)
  if (Number.isNaN(openAt)) return false
  return nowMs < openAt
}

/**
 * エンジニア回答期限日の終了（翌日 00:00 JST）以降か。
 * 期限未設定時は期間外扱いにしない（編集可能のまま）。
 */
export function isAfterEngineerDeadline(engineerDeadline: string | null | undefined, nowMs: number): boolean {
  if (!isDateOnly(engineerDeadline)) return false
  const closeDay = nextCalendarDay(engineerDeadline)
  if (!closeDay) return false
  const closesAt = Date.parse(`${closeDay}T00:00:00+09:00`)
  if (Number.isNaN(closesAt)) return false
  return nowMs >= closesAt
}

export function ResponseDeadlinesProvider({ children }: { children: React.ReactNode }) {
  const [deadlines, setDeadlinesState] = useState<ResponseDeadlines>(() =>
    normalizeDeadlines(getBootstrapCache().responseDeadlines || null),
  )

  useEffect(() => {
    const apply = (raw: Partial<ResponseDeadlines> | undefined) => {
      if (!raw) return
      setDeadlinesState(normalizeDeadlines(raw))
    }
    apply(getBootstrapCache().responseDeadlines)
    const onBoot = (event: Event) => {
      apply((event as CustomEvent).detail?.responseDeadlines)
    }
    window.addEventListener('wizway:bootstrap', onBoot)
    return () => window.removeEventListener('wizway:bootstrap', onBoot)
  }, [])

  const setDeadlines = useCallback(async (mgrSalesDeadline: string, engineerDeadline: string) => {
    if (!isDateOnly(mgrSalesDeadline) || !isDateOnly(engineerDeadline)) return false
    const next = normalizeDeadlines({ mgrSalesDeadline, engineerDeadline })
    if (USE_API) {
      try {
        const saved = await api.put<ResponseDeadlines>('/response-deadlines', next)
        setDeadlinesState(normalizeDeadlines(saved))
        return true
      } catch (err) {
        console.error(err instanceof ApiError ? err.message : err)
        return false
      }
    }
    setDeadlinesState(next)
    return true
  }, [])

  const value = useMemo<ResponseDeadlinesContextValue>(
    () => ({
      mgrSalesDeadline: deadlines.mgrSalesDeadline,
      engineerDeadline: deadlines.engineerDeadline,
      setDeadlines,
    }),
    [deadlines.engineerDeadline, deadlines.mgrSalesDeadline, setDeadlines],
  )

  return (
    <ResponseDeadlinesContext.Provider value={value}>
      {children}
    </ResponseDeadlinesContext.Provider>
  )
}

export function useResponseDeadlines() {
  const ctx = useContext(ResponseDeadlinesContext)
  if (!ctx) {
    throw new Error('useResponseDeadlines must be used within ResponseDeadlinesProvider')
  }
  return ctx
}
