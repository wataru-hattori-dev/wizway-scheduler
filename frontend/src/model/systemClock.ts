/** 開発用疑似日付のモジュール級クロック（React 外からも参照可能・時刻は 00:00 JST 想定） */

const STORAGE_KEY = 'dev_current_date'

type Listener = () => void

function readStoredOverrideMs(): number | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw == null || raw === '') return null
    const ms = Number(raw)
    return Number.isFinite(ms) ? ms : null
  } catch {
    return null
  }
}

function writeStoredOverrideMs(ms: number | null) {
  try {
    if (ms == null) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, String(ms))
  } catch {
    /* ignore quota / private mode */
  }
}

let overrideMs: number | null = readStoredOverrideMs()
/** useSyncExternalStore 用。emit 時だけ増える安定スナップショット */
let clockVersion = 0
const listeners = new Set<Listener>()

function emit() {
  clockVersion += 1
  for (const listener of listeners) listener()
}

export function subscribeSystemClock(listener: Listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * React の useSyncExternalStore 向け。
 * store 未変更時は必ず同一値を返す（Date.now() を直接返さない）。
 */
export function getSystemClockVersion(): number {
  return clockVersion
}

export function getSystemNowMs(): number {
  return overrideMs == null ? Date.now() : overrideMs
}

export function getSystemDate(): Date {
  return new Date(getSystemNowMs())
}

export function getSystemDateIso(): string {
  return getSystemDate().toISOString()
}

export function isSystemDateOverridden(): boolean {
  return overrideMs != null
}

/** null で実時刻に戻す */
export function setSystemNowMs(ms: number | null) {
  overrideMs = ms == null || !Number.isFinite(ms) ? null : ms
  writeStoredOverrideMs(overrideMs)
  emit()
}
