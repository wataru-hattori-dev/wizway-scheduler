import type { Member } from './client'

export type BootstrapCache = {
  interviewPeriod?: { startDate: string; endDate: string }
  responseDeadlines?: { mgrSalesDeadline: string; engineerDeadline: string }
  members?: Member[]
}

const STORAGE_KEY = 'wizway.bootstrapCache.v1'

let cache: BootstrapCache = loadFromStorage()

function loadFromStorage(): BootstrapCache {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as BootstrapCache
    if (!parsed || typeof parsed !== 'object') return {}
    return {
      interviewPeriod: parsed.interviewPeriod,
      responseDeadlines: parsed.responseDeadlines,
      members: Array.isArray(parsed.members) ? parsed.members : undefined,
    }
  } catch {
    return {}
  }
}

function persist(next: BootstrapCache) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* quota / private mode — ignore */
  }
}

export function setBootstrapCache(next: BootstrapCache) {
  cache = { ...cache, ...next }
  persist(cache)
}

export function getBootstrapCache(): BootstrapCache {
  return cache
}
