import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { ApiError, api } from '../api/client'
import { getBootstrapCache } from '../api/bootstrapCache'
import { RANGE_END, RANGE_START, setActiveInterviewRange } from './calendar'

const USE_API = import.meta.env.VITE_USE_API !== 'false'

export type InterviewPeriod = {
  startDate: string
  endDate: string
}

type InterviewPeriodContextValue = InterviewPeriod & {
  setPeriod: (startDate: string, endDate: string) => boolean | Promise<boolean>
}

const InterviewPeriodContext = createContext<InterviewPeriodContextValue | null>(null)

function normalizePeriod(raw: Partial<InterviewPeriod> | null | undefined): InterviewPeriod {
  const startDate = typeof raw?.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.startDate)
    ? raw.startDate
    : RANGE_START
  const endDate = typeof raw?.endDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.endDate)
    ? raw.endDate
    : RANGE_END
  if (startDate <= endDate) return { startDate, endDate }
  return { startDate: RANGE_START, endDate: RANGE_END }
}

function syncCalendarRange(period: InterviewPeriod) {
  setActiveInterviewRange(period.startDate, period.endDate)
}

export function InterviewPeriodProvider({ children }: { children: React.ReactNode }) {
  const [period, setPeriodState] = useState<InterviewPeriod>(() => {
    const cached = getBootstrapCache().interviewPeriod
    const initial = normalizePeriod(cached || null)
    syncCalendarRange(initial)
    return initial
  })

  useEffect(() => {
    const apply = (raw: Partial<InterviewPeriod> | undefined) => {
      if (!raw) return
      const next = normalizePeriod(raw)
      syncCalendarRange(next)
      setPeriodState(next)
    }
    apply(getBootstrapCache().interviewPeriod)
    const onBoot = (event: Event) => {
      apply((event as CustomEvent).detail?.interviewPeriod)
    }
    window.addEventListener('wizway:bootstrap', onBoot)
    return () => window.removeEventListener('wizway:bootstrap', onBoot)
  }, [])

  const setPeriod = useCallback(async (startDate: string, endDate: string) => {
    const next = normalizePeriod({ startDate, endDate })
    if (startDate && endDate && startDate > endDate) return false
    if (USE_API) {
      try {
        const saved = await api.put<InterviewPeriod>('/interview-period', next)
        const normalized = normalizePeriod(saved)
        syncCalendarRange(normalized)
        setPeriodState(normalized)
        return true
      } catch (err) {
        console.error(err instanceof ApiError ? err.message : err)
        return false
      }
    }
    syncCalendarRange(next)
    setPeriodState(next)
    return true
  }, [])

  const value = useMemo<InterviewPeriodContextValue>(
    () => ({
      startDate: period.startDate,
      endDate: period.endDate,
      setPeriod,
    }),
    [period.endDate, period.startDate, setPeriod],
  )

  return (
    <InterviewPeriodContext.Provider value={value}>
      {children}
    </InterviewPeriodContext.Provider>
  )
}

export function useInterviewPeriod() {
  const ctx = useContext(InterviewPeriodContext)
  if (!ctx) {
    throw new Error('useInterviewPeriod must be used within InterviewPeriodProvider')
  }
  return ctx
}
