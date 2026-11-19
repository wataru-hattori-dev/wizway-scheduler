import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { datetimeLocalToIso, deadlineState, isoToDatetimeLocal } from './format'
import {
  getSystemClockVersion,
  getSystemDate,
  getSystemNowMs,
  isSystemDateOverridden,
  setSystemNowMs,
  subscribeSystemClock,
} from './systemClock'

type SystemDateContextValue = {
  /** 疑似 or 実時刻のエポック ms */
  nowMs: number
  /** 疑似 or 実時刻 */
  now: Date
  /** YYYY-MM-DD（JST） */
  dateLocal: string
  /** datetime-local 用の表示値（JST） */
  datetimeLocal: string
  /** 疑似日時が有効か */
  isOverride: boolean
  /** クライアント側で日時コンテキストの初期同期が完了したか */
  ready: boolean
  /** 日付のみ設定（その日の 00:00 JST） */
  setDateLocal: (value: string) => void
  setDatetimeLocal: (value: string) => void
  /** 表示中の日付の 19:00（JST）へ設定 */
  setTo1900: () => void
  /** 実時刻へ戻す */
  resetToRealNow: () => void
}

const DateContext = createContext<SystemDateContextValue | null>(null)

export function DateProvider({ children }: { children: React.ReactNode }) {
  // version は emit 時だけ変わる安定値（Date.now() 直返しによる無限再レンダーを防ぐ）
  const clockVersion = useSyncExternalStore(
    subscribeSystemClock,
    getSystemClockVersion,
    getSystemClockVersion,
  )
  const [ready, setReady] = useState(false)
  // 実時刻モード用に、version 更新時点の「現在」をキャプチャして表示を安定させる
  const [wallMs, setWallMs] = useState(() => Date.now())

  useEffect(() => {
    setReady(true)
  }, [])

  useEffect(() => {
    if (!isSystemDateOverridden()) setWallMs(Date.now())
  }, [clockVersion])

  const setDateLocal = useCallback((value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return
    setSystemNowMs(Date.parse(`${value}T00:00:00+09:00`))
  }, [])

  const setDatetimeLocal = useCallback((value: string) => {
    const iso = datetimeLocalToIso(value)
    if (!iso) return
    setSystemNowMs(Date.parse(iso))
  }, [])

  const setTo1900 = useCallback(() => {
    const local = isoToDatetimeLocal(getSystemDate().toISOString())
    const date = local.slice(0, 10)
    setSystemNowMs(Date.parse(`${date}T19:00:00+09:00`))
  }, [])

  const resetToRealNow = useCallback(() => {
    setSystemNowMs(null)
  }, [])

  const nowMs = isSystemDateOverridden() ? getSystemNowMs() : wallMs
  const value = useMemo<SystemDateContextValue>(() => {
    const now = new Date(nowMs)
    const datetimeLocal = isoToDatetimeLocal(now.toISOString())
    return {
      nowMs,
      now,
      dateLocal: datetimeLocal.slice(0, 10),
      datetimeLocal,
      isOverride: isSystemDateOverridden(),
      ready,
      setDateLocal,
      setDatetimeLocal,
      setTo1900,
      resetToRealNow,
    }
  }, [nowMs, ready, setDateLocal, setDatetimeLocal, setTo1900, resetToRealNow])

  return <DateContext.Provider value={value}>{children}</DateContext.Provider>
}

/** 画面・コンポーネント用。疑似日時変更で再レンダーされる */
export function useSystemDate() {
  const ctx = useContext(DateContext)
  if (!ctx) {
    throw new Error('useSystemDate must be used within DateProvider')
  }
  return ctx
}

/**
 * 投票期間判定。DateContext 初期化完了前は期間外扱いにせず、画面を消さない。
 * isOutside のときも画面は表示し、バナー＋操作 disabled に留めること。
 */
export function useVotingPeriod(deadlineIso?: string | null) {
  const { nowMs, ready } = useSystemDate()
  if (!ready) {
    return { ready: false, isOutside: false }
  }
  const due = deadlineState(deadlineIso, nowMs)
  return { ready: true, isOutside: due === 'past' }
}

export { getSystemDate, getSystemDateIso, getSystemNowMs } from './systemClock'
