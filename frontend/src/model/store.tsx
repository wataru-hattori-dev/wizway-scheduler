import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, api as http } from '../api/client'
import { fetchBootstrap } from '../api/bootstrap'
import { assignSection } from './assign'
import { businessDays, HOURS } from './calendar'
import { allCandidateSlots, candidateSlots, VOTER_LABEL } from './candidates'
import { buildMeetingUrl, datetimeLocalToIso, formatDateTime, formatRange, slotDay } from './format'
import { hasAnySalesOffer, isLocked, SALES_IDS, SALES_LABEL, salesOfferedOk, slotTakenBy, validateVotes } from './rules'
import {
  applySectionsFromApi,
  createInitialState,
  DEMO_MEMBER_ID,
  interviewMembersOf,
  memberById,
  SECTIONS,
  setRegistryMembers,
} from './seed'
import { getRawRegistryMembers } from './membersRegistry'
import { getSystemDateIso, getSystemNowMs } from './systemClock'

const AppContext = createContext<any>(null)
const USE_API = import.meta.env.VITE_USE_API !== 'false'

const PATH_BY_VIEW = {
  home: '/',
  admin: '/admin',
  manager: '/mgr',
  sales: '/sales',
  engineer: '/engineer',
}

function viewFromPath(pathname) {
  if (pathname === '/admin') return 'admin'
  if (pathname === '/mgr' || pathname === '/sales-mgr') return 'manager'
  if (pathname === '/sales') return 'sales'
  if (pathname === '/engineer' || pathname === '/member') return 'engineer'
  return 'home'
}

let navigateFn = null

function syncPath(view, options = {}) {
  const path = PATH_BY_VIEW[view] || '/'
  if (window.location.pathname === path) return
  if (navigateFn) {
    navigateFn(path, { replace: options.replace })
    return
  }
  if (options.replace) window.history.replaceState({}, '', path)
  else window.history.pushState({}, '', path)
}

function loadState() {
  // 本番 API 接続時は起動直後に fetchBootstrap で上書きする
  return createInitialState()
}

function interviewFromApi(iv: any) {
  return {
    status: iv.status || 'unadjusted',
    submittedAt: iv.submittedAt ?? null,
    confirmedSlotId: iv.confirmedSlotId ?? null,
    confirmedSalesId: iv.confirmedSalesId ?? null,
    confirmedOverride: iv.confirmedOverride ?? null,
    assignReason: iv.assignReason ?? null,
    meetingUrl: iv.meetingUrl ?? null,
    pendingNote: iv.pendingNote ?? null,
    remindedAt: iv.remindedAt ?? null,
    changeRequest: iv.changeRequest ?? null,
    preferences: {
      difficultDates: iv.preferences?.difficultDates || [],
      preferredTimeNote: iv.preferences?.preferredTimeNote || '',
      note: iv.preferences?.note || '',
    },
  }
}

function uid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

function sectionSlots(state, sectionId) {
  return candidateSlots(state, sectionId)
}

function engineerSlots(state, memberId) {
  const member = memberById(memberId)
  if (!member) return []
  return sectionSlots(state, member.sectionId).filter((slot) => salesOfferedOk(state, memberId, slot.id).length > 0)
}

function confirmedStarts(state) {
  const starts = new Set()
  for (const section of SECTIONS) {
    for (const member of interviewMembersOf(section.id)) {
      const interview = state.interviews[member.id]
      if (!interview || (interview.status !== 'confirmed' && interview.status !== 'change_requested')) continue
      const slot = sectionSlots(state, section.id).find((item) => item.id === interview.confirmedSlotId)
      if (slot) starts.add(slot.start)
    }
  }
  return starts
}

function salesBusyMap(state) {
  const busy = { salesA: [], salesB: [] }
  for (const [id, interview] of Object.entries(state.interviews)) {
    if (interview.status !== 'confirmed' && interview.status !== 'change_requested') continue
    const salesId = interview.confirmedSalesId
    if (!salesId || !busy[salesId]) continue
    let start = interview.confirmedOverride?.start
    if (!start) {
      const sectionId = memberById(id)?.sectionId
      const slot = sectionId && sectionSlots(state, sectionId).find((item) => item.id === interview.confirmedSlotId)
      start = slot?.start
    }
    if (start) busy[salesId].push(start)
  }
  return busy
}

function startHeldBy(state, start, exceptMemberId) {
  for (const [id, interview] of Object.entries(state.interviews)) {
    if (id === exceptMemberId) continue
    if (interview.status !== 'confirmed' && interview.status !== 'change_requested') continue
    if (interview.confirmedOverride?.start && Date.parse(interview.confirmedOverride.start) === Date.parse(start)) return id
    const sectionId = memberById(id)?.sectionId
    const slot = sectionId && sectionSlots(state, sectionId).find((item) => item.id === interview.confirmedSlotId)
    if (slot && Date.parse(slot.start) === Date.parse(start)) return id
  }
  return null
}

function salesHeldBy(state, salesId, start, exceptMemberId) {
  for (const [id, interview] of Object.entries(state.interviews)) {
    if (id === exceptMemberId) continue
    if (interview.status !== 'confirmed' && interview.status !== 'change_requested') continue
    if (interview.confirmedSalesId !== salesId) continue
    let held = interview.confirmedOverride?.start
    if (!held) {
      const sectionId = memberById(id)?.sectionId
      const slot = sectionId && sectionSlots(state, sectionId).find((item) => item.id === interview.confirmedSlotId)
      held = slot?.start
    }
    if (held && Date.parse(held) === Date.parse(start)) return id
  }
  return null
}

function offersForAssign(state, sectionId) {
  const map = {}
  for (const member of interviewMembersOf(sectionId)) {
    map[member.id] = {}
    for (const slot of sectionSlots(state, sectionId)) {
      const offered = salesOfferedOk(state, member.id, slot.id)
      if (offered.length) map[member.id][slot.id] = offered
    }
  }
  return map
}

function toAssignInput(state, sectionId) {
  return {
    slots: sectionSlots(state, sectionId),
    members: interviewMembersOf(sectionId).map((member) => {
      const interview = state.interviews[member.id]
      return {
        id: member.id,
        status: interview.status,
        submittedAt: interview.submittedAt,
        confirmedSlotId: interview.confirmedSlotId,
        confirmedSalesId: interview.confirmedSalesId,
        votes: state.votes[member.id] || {},
      }
    }),
    salesOffers: offersForAssign(state, sectionId),
    salesBusy: salesBusyMap(state),
  }
}

function pickSalesForSlot(state, memberId, slot, exceptMemberId) {
  for (const salesId of salesOfferedOk(state, memberId, slot)) {
    if (!salesHeldBy(state, salesId, slot.start, exceptMemberId)) return salesId
  }
  return null
}

export function AppProvider({ children }) {
  const initialView = viewFromPath(window.location.pathname)
  const [state, setState] = useState(loadState)
  const [apiReady, setApiReady] = useState(!USE_API)
  const [apiError, setApiError] = useState<string | null>(null)
  const [role, setRoleState] = useState(initialView === 'home' ? 'admin' : initialView)
  const [view, setViewState] = useState(initialView)
  const setView = useCallback((next) => {
    if (next !== 'home' && next !== role) return
    syncPath(next)
    setViewState(next)
  }, [role])

  const bindNavigate = useCallback((fn) => {
    navigateFn = fn
  }, [])

  const syncFromPath = useCallback((pathname) => {
    const next = viewFromPath(pathname)
    const canonical = PATH_BY_VIEW[next] || '/'
    if (pathname !== canonical && pathname !== '/sales-mgr' && pathname !== '/member') {
      syncPath(next, { replace: true })
    }
    setViewState(next)
    if (next !== 'home') setRoleState(next)
  }, [])

  useEffect(() => {
    return () => {
      navigateFn = null
    }
  }, [])
  const [authMode, setAuthMode] = useState('slack')
  const [activeMemberId, setActiveMemberId] = useState(DEMO_MEMBER_ID)
  const [activeSectionId, setActiveSectionId] = useState('meguro')
  const [activeSalesId, setActiveSalesId] = useState('salesA')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sectionFilter, setSectionFilter] = useState('all')
  const [toast, setToast] = useState(null)
  const [busyCount, setBusyCount] = useState(0)
  const toastTimer = useRef(null)
  const apiBusy = busyCount > 0

  const runBusy = useCallback(async (fn) => {
    setBusyCount((count) => count + 1)
    try {
      return await fn()
    } finally {
      setBusyCount((count) => Math.max(0, count - 1))
    }
  }, [])

  const refreshNotifications = useCallback(async () => {
    if (!USE_API) return
    try {
      const res = await http.get<{
        notifications: Array<{ id: string; at: string; channel: string; body: string }>
      }>('/notifications')
      setState((prev) => ({ ...prev, notifications: res.notifications || [] }))
    } catch {
      /* mutation 本体のトーストを優先 */
    }
  }, [])

  const refreshFromApi = useCallback(async () => {
    if (!USE_API) return
    const boot = await fetchBootstrap()
    setRegistryMembers(boot.members)
    // 名簿反映後にセクション／営業／本郷の表示名を最終同期（UI 文言を API 値に合わせる）
    applySectionsFromApi(boot.sections)
    setState(boot.state)
    window.dispatchEvent(
      new CustomEvent('wizway:bootstrap', {
        detail: {
          interviewPeriod: boot.interviewPeriod,
          responseDeadlines: boot.responseDeadlines,
          members: boot.members,
        },
      }),
    )
    setApiReady(true)
    setApiError(null)
    return boot
  }, [])

  useEffect(() => {
    if (!USE_API) return
    let cancelled = false
    ;(async () => {
      try {
        await refreshFromApi()
      } catch (err) {
        if (cancelled) return
        console.error(err)
        setApiError(err instanceof Error ? err.message : 'API 接続に失敗しました')
        setApiReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refreshFromApi])

  const dismissToast = useCallback(() => {
    clearTimeout(toastTimer.current)
    setToast(null)
  }, [])

  const pushToast = useCallback((message, tone = 'ok') => {
    setToast({ message, tone, id: Date.now() })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 3800)
  }, [])

  const pushNotification = (prev, notification) => ({
    ...prev,
    notifications: [...prev.notifications, { id: uid('n'), at: getSystemDateIso(), ...notification }].slice(-40),
  })

  const chooseRole = useCallback((next) => {
    const allowed = ['admin', 'manager', 'sales', 'engineer']
    const viewNext = allowed.includes(next) ? next : 'admin'
    setRoleState(viewNext)
    setViewState(viewNext)
    syncPath(viewNext)
  }, [])

  const openMember = useCallback((memberId) => {
    if (role !== 'engineer') return
    const member = memberById(memberId)
    setActiveMemberId(memberId)
    if (member) setActiveSectionId(member.sectionId)
  }, [role])

  const api = useMemo(() => {
    const setVote = (memberId, slotId, mark) => {
      let blocked = false
      let reopened = false
      setState((prev) => {
        const interview = prev.interviews[memberId]
        if (isLocked(interview)) {
          blocked = true
          return prev
        }
        if (!salesOfferedOk(prev, memberId, slotId).length) {
          blocked = true
          return prev
        }
        const current = { ...(prev.votes[memberId] || {}) }
        if (current[slotId] === mark) delete current[slotId]
        else current[slotId] = mark
        reopened = Boolean(interview.submittedAt)
        return {
          ...prev,
          votes: { ...prev.votes, [memberId]: current },
          interviews: {
            ...prev.interviews,
            [memberId]: reopened
              ? { ...interview, submittedAt: null, pendingNote: null }
              : { ...interview, pendingNote: null },
          },
        }
      })
      if (blocked) pushToast('確定済みの回答は直接編集できません。変更希望を出してください', 'warn')
      else if (reopened) pushToast('回答を編集したため、未送信に戻しました', 'info')
    }

    const savePreferences = (memberId, preferences) => {
      setState((prev) => ({
        ...prev,
        interviews: {
          ...prev.interviews,
          [memberId]: { ...prev.interviews[memberId], preferences },
        },
      }))
      pushToast('希望条件を保存しました')
    }

    const submitVotes = (memberId) => {
      let message = ''
      let tone = 'ok'
      setState((prev) => {
        const interview = prev.interviews[memberId]
        if (isLocked(interview)) {
          message = '確定済みのため、投票は送信できません'
          tone = 'warn'
          return prev
        }
        const slots = engineerSlots(prev, memberId)
        const check = validateVotes(prev.votes[memberId] || {}, slots)
        if (!check.valid) {
          message = check.errors[0]
          tone = 'warn'
          return prev
        }
        message = '回答を送信しました。自動判定の対象になります'
        return {
          ...prev,
          interviews: {
            ...prev.interviews,
            [memberId]: {
              ...interview,
              status: interview.status === 'unadjusted' ? 'adjusting' : interview.status,
              submittedAt: getSystemDateIso(),
              pendingNote: null,
            },
          },
        }
      })
      if (message) pushToast(message, tone)
      return tone === 'ok'
    }

    /** エンジニアの優先度を一括保存（Mgr / 営業画面のコンテキストと即時連動） */
    const saveMemberVotes = async (memberId, votes) => {
      if (USE_API) {
        return runBusy(async () => {
          try {
            const nextVotes = { ...(votes || {}) }
            for (const [slotId, mark] of Object.entries(nextVotes)) {
              if (!mark || mark === 'ok') delete nextVotes[slotId]
            }
            const iv = await http.put<any>(`/interviews/${memberId}/votes`, { votes: nextVotes })
            setState((prev) => ({
              ...prev,
              votes: { ...prev.votes, [memberId]: iv.votes || {} },
              interviews: { ...prev.interviews, [memberId]: interviewFromApi(iv) },
            }))
            pushToast('優先度を保存しました。自動判定の対象になります')
            return true
          } catch (err) {
            pushToast(err instanceof ApiError ? err.message : '優先度の保存に失敗しました', 'warn')
            return false
          }
        })
      }
      let message = ''
      let tone = 'ok'
      setState((prev) => {
        const interview = prev.interviews[memberId]
        if (isLocked(interview)) {
          message = '確定済みのため、優先度は保存できません'
          tone = 'warn'
          return prev
        }
        const slots = engineerSlots(prev, memberId)
        const nextVotes = { ...(votes || {}) }
        for (const [slotId, mark] of Object.entries(nextVotes)) {
          if (!mark || mark === 'ok') delete nextVotes[slotId]
          else if (!salesOfferedOk(prev, memberId, slotId).length) delete nextVotes[slotId]
        }
        const check = validateVotes(nextVotes, slots)
        if (!check.valid) {
          message = check.errors[0]
          tone = 'warn'
          return prev
        }
        message = '優先度を保存しました。自動判定の対象になります'
        return {
          ...prev,
          votes: { ...prev.votes, [memberId]: nextVotes },
          interviews: {
            ...prev.interviews,
            [memberId]: {
              ...interview,
              status: interview.status === 'unadjusted' ? 'adjusting' : interview.status,
              submittedAt: getSystemDateIso(),
              pendingNote: null,
            },
          },
        }
      })
      if (message) pushToast(message, tone)
      return tone === 'ok'
    }

    const setPartyVote = (voterId, day, mark) => {
      setState((prev) => {
        const current = { ...(prev.dayVotes[voterId] || {}) }
        if (!mark || current[day] === mark) delete current[day]
        else current[day] = mark
        return { ...prev, dayVotes: { ...prev.dayVotes, [voterId]: current } }
      })
    }

    const setPartyHours = (voterId, day, hours) => {
      setState((prev) => {
        const all = HOURS.map((hour) => hour.hour)
        const unique = [...new Set(hours)].filter((hour) => all.includes(hour)).sort((a, b) => a - b)
        const hourVotes = { ...(prev.hourVotes || {}) }
        const person = { ...(hourVotes[voterId] || {}) }
        if (unique.length === all.length) delete person[day]
        else person[day] = unique
        if (Object.keys(person).length === 0) delete hourVotes[voterId]
        else hourVotes[voterId] = person
        return { ...prev, hourVotes }
      })
    }

    /** 営業の空き日時タイムテーブルを一括保存 */
    const setSalesAvailability = async (salesId, { dayMarks, hourMarks }) => {
      if (USE_API) {
        return runBusy(async () => {
          try {
            const saved = await http.put<{ dayMarks: any; hourMarks: any }>(`/availability/${salesId}`, {
              dayMarks: dayMarks || {},
              hourMarks: hourMarks || {},
            })
            setState((prev) => {
              const nextDayVotes = { ...prev.dayVotes, [salesId]: saved.dayMarks || {} }
              const nextHourVotes = { ...(prev.hourVotes || {}) }
              if (!saved.hourMarks || Object.keys(saved.hourMarks).length === 0) delete nextHourVotes[salesId]
              else nextHourVotes[salesId] = saved.hourMarks
              return { ...prev, dayVotes: nextDayVotes, hourVotes: nextHourVotes }
            })
            pushToast(`${SALES_LABEL[salesId] || '営業'}の空き日時を保存しました`)
            return true
          } catch (err) {
            pushToast(err instanceof ApiError ? err.message : '空き日時の保存に失敗しました', 'warn')
            return false
          }
        })
      }
      setState((prev) => {
        const dayVotes = {
          ...prev.dayVotes,
          [salesId]: { ...(dayMarks || {}) },
        }
        const hourVotes = { ...(prev.hourVotes || {}) }
        const cleanedHours = { ...(hourMarks || {}) }
        if (Object.keys(cleanedHours).length === 0) delete hourVotes[salesId]
        else hourVotes[salesId] = cleanedHours
        return { ...prev, dayVotes, hourVotes }
      })
      pushToast(`${SALES_LABEL[salesId] || '営業'}の空き日時を保存しました`)
      return true
    }

    /**
     * Mgr / 本郷などの空き日時を一括保存。
     * 従来の setPartyVote / setPartyHours 連打と同じ最終状態になるが、setState は1回だけ。
     */
    const setPartyAvailability = async (voterId, { dayMarks, hourMarks }) => {
      if (USE_API) {
        return runBusy(async () => {
          try {
            const saved = await http.put<{ dayMarks: any; hourMarks: any }>(`/availability/${voterId}`, {
              dayMarks: dayMarks || {},
              hourMarks: hourMarks || {},
            })
            setState((prev) => {
              const nextDayVotes = { ...prev.dayVotes, [voterId]: saved.dayMarks || {} }
              const nextHourVotes = { ...(prev.hourVotes || {}) }
              if (!saved.hourMarks || Object.keys(saved.hourMarks).length === 0) delete nextHourVotes[voterId]
              else nextHourVotes[voterId] = saved.hourMarks
              return { ...prev, dayVotes: nextDayVotes, hourVotes: nextHourVotes }
            })
            const label = VOTER_LABEL[voterId] || voterId
            pushToast(`${label}の空き日時を保存しました`)
            return true
          } catch (err) {
            pushToast(err instanceof ApiError ? err.message : '空き日時の保存に失敗しました', 'warn')
            return false
          }
        })
      }
      setState((prev) => {
        const days = businessDays().map((day) => day.iso)
        const all = HOURS.map((hour) => hour.hour)
        const current = { ...(prev.dayVotes[voterId] || {}) }
        const person = { ...((prev.hourVotes || {})[voterId] || {}) }

        for (const day of days) {
          delete current[day]
        }
        for (const day of days) {
          const mark = dayMarks?.[day]
          if (mark) current[day] = mark
          const unique = [...new Set(hourMarks?.[day] || all)]
            .filter((hour) => all.includes(hour))
            .sort((a, b) => a - b)
          if (unique.length === all.length) delete person[day]
          else person[day] = unique
        }

        const dayVotes = { ...prev.dayVotes, [voterId]: current }
        const hourVotes = { ...(prev.hourVotes || {}) }
        if (Object.keys(person).length === 0) delete hourVotes[voterId]
        else hourVotes[voterId] = person
        return { ...prev, dayVotes, hourVotes }
      })
      const label = VOTER_LABEL[voterId] || voterId
      pushToast(`${label}の空き日時を保存しました`)
      return true
    }

    /** エンジニア×営業の担当マトリクスを一括保存（各エンジニアは salesA/salesB のどちらか1名） */
    const setSalesAssignees = async (assigneeMap) => {
      if (USE_API) {
        return runBusy(async () => {
          try {
            const payload: Record<string, string | null> = {}
            for (const [memberId, salesId] of Object.entries(assigneeMap || {})) {
              payload[String(memberId)] = salesId && SALES_IDS.includes(salesId) ? salesId : null
            }
            const saved = await http.put<Record<string, string>>('/sales-assignees', payload)
            const salesAssignee: Record<number, string> = {}
            for (const [key, value] of Object.entries(saved || {})) {
              if (value) salesAssignee[Number(key)] = value
            }
            setState((prev) => ({ ...prev, salesAssignee }))
            pushToast('営業担当の割り当てを保存しました')
            return true
          } catch (err) {
            pushToast(err instanceof ApiError ? err.message : '営業担当の保存に失敗しました', 'warn')
            return false
          }
        })
      }
      setState((prev) => {
        const salesAssignee = { ...(prev.salesAssignee || {}) }
        for (const [memberId, salesId] of Object.entries(assigneeMap || {})) {
          if (!salesId) delete salesAssignee[memberId]
          else if (SALES_IDS.includes(salesId)) salesAssignee[memberId] = salesId
        }
        return { ...prev, salesAssignee }
      })
      pushToast('営業担当の割り当てを保存しました')
      return true
    }

    const setMemberDayMark = (memberId, day, mark) => {
      let outcome = 'updated'
      setState((prev) => {
        const interview = prev.interviews[memberId]
        if (isLocked(interview)) {
          outcome = 'locked'
          return prev
        }
        const current = { ...(prev.votes[memberId] || {}) }
        const targets = engineerSlots(prev, memberId).filter((slot) => slotDay(slot.start) === day)
        for (const slot of targets) {
          if (!mark) delete current[slot.id]
          else current[slot.id] = mark
        }
        outcome = interview.submittedAt ? 'reopened' : 'updated'
        return {
          ...prev,
          votes: { ...prev.votes, [memberId]: current },
          interviews: {
            ...prev.interviews,
            [memberId]: interview.submittedAt ? { ...interview, submittedAt: null, pendingNote: null } : interview,
          },
        }
      })
      if (outcome === 'locked') pushToast('確定済みの回答は直接編集できません', 'warn')
      else if (outcome === 'reopened') pushToast('この日の投票を変え、回答を未送信に戻しました', 'info')
    }

    const setDeadline = (sectionId, localValue) => {
      const iso = datetimeLocalToIso(localValue)
      if (!iso) return
      setState((prev) => ({ ...prev, deadlines: { ...prev.deadlines, [sectionId]: iso } }))
      pushToast(`${sectionByName(sectionId)}の回答期限を更新しました`)
    }

    const sendRequests = (sectionId) => {
      let message = ''
      let tone = 'ok'
      setState((prev) => {
        const slots = sectionSlots(prev, sectionId)
        const members = interviewMembersOf(sectionId)
        if (slots.length < members.length) {
          message = `共通の空きが${slots.length}枠です。エンジニア${members.length}名分の1時間枠が必要です`
          tone = 'warn'
          return prev
        }
        const withoutOffer = members.filter((member) => !hasAnySalesOffer(prev, member.id))
        if (withoutOffer.length) {
          message = `営業担当が未設定のエンジニアがいます（${withoutOffer.map((m) => m.surname).join('、')}）`
          tone = 'warn'
          return prev
        }
        const interviews = { ...prev.interviews }
        for (const member of members) {
          if (interviews[member.id].status === 'unadjusted') {
            interviews[member.id] = { ...interviews[member.id], status: 'adjusting' }
          }
        }
        const section = SECTIONS.find((item) => item.id === sectionId)
        message = `${section.name}のエンジニアへ調整依頼を送りました`
        const next = { ...prev, interviews }
        return pushNotification(next, {
          channel: `#面談-${section.name}`,
          body: `${section.mgr} さんが調整依頼を送りました。\n対象: ${members.map((member) => member.name).join('、')}\n回答期限: ${formatDateTime(prev.deadlines[sectionId])}\n共通空き枠: ${slots.length}件\nエンジニア画面では、担当営業が参加可能な枠だけに優先度を回答してください。`,
        })
      })
      pushToast(message, tone)
    }

    const applyJudge = (sectionIds, assignUnanswered) => {
      const summaries = []
      setState((prev) => {
        let next = { ...prev, interviews: { ...prev.interviews }, judgedAt: { ...prev.judgedAt }, deadlines: { ...prev.deadlines } }
        const now = getSystemDateIso()
        const usedStarts = confirmedStarts(next)
        for (const sectionId of sectionIds) {
          if (assignUnanswered && Date.parse(next.deadlines[sectionId]) > getSystemNowMs()) {
            next.deadlines[sectionId] = now
          }
          const result = assignSection({
            ...toAssignInput(next, sectionId),
            assignUnanswered,
            blockedStarts: [...usedStarts],
          })
          for (const item of result.assignments) {
            const slot = sectionSlots(next, sectionId).find((slotItem) => slotItem.id === item.slotId)
            if (slot) usedStarts.add(slot.start)
            next.interviews[item.memberId] = {
              ...next.interviews[item.memberId],
              status: 'confirmed',
              confirmedSlotId: item.slotId,
              confirmedSalesId: item.salesId,
              confirmedOverride: null,
              assignReason: item.reason,
              meetingUrl: buildMeetingUrl(next.provider, item.memberId, slot.start),
              pendingNote: null,
              changeRequest: null,
            }
          }
          for (const item of result.manual) {
            next.interviews[item.memberId] = {
              ...next.interviews[item.memberId],
              pendingNote: item.reason,
            }
          }
          next.judgedAt[sectionId] = now
          const section = SECTIONS.find((item) => item.id === sectionId)
          summaries.push(`${section.name}: 確定${result.assignments.length}名 / 手動待ち${result.manual.length}名`)
          const lines = result.assignments.map((item) => {
            const slot = sectionSlots(next, sectionId).find((slotItem) => slotItem.id === item.slotId)
            return `・${memberById(item.memberId).name}: ${formatRange(slot.start, slot.end)}（${item.reason}）`
          })
          if (result.manual.length) {
            lines.push(
              ...result.manual.map((item) => `・${memberById(item.memberId).name}: ${item.reason}`),
            )
          }
          next = pushNotification(next, {
            channel: `#面談-${section.name}`,
            body: `${assignUnanswered ? '期限到来の自動判定' : '回答済みの自動判定'}を実行しました。\n${lines.join('\n') || '新たに確定したメンバーはいません。'}`,
          })
        }
        return next
      })
      pushToast(summaries.join(' / '))
    }

    const manualAssign = (memberId, slotId) => {
      let message = ''
      let tone = 'ok'
      setState((prev) => {
        const slot = sectionSlots(prev, memberById(memberId).sectionId).find((item) => item.id === slotId)
        if (!slot) {
          message = '枠が見つかりません'
          tone = 'warn'
          return prev
        }
        const holder = slotTakenBy(prev, slotId, memberId) || startHeldBy(prev, slot.start, memberId)
        if (holder) {
          message = `その時間は${memberById(holder).name}さんの確定枠です`
          tone = 'warn'
          return prev
        }
        const salesId = pickSalesForSlot(prev, memberId, slot, memberId)
        if (!salesId) {
          message = 'その時間に空いている営業がいません'
          tone = 'warn'
          return prev
        }
        message = `${memberById(memberId).name}さんを手動で確定しました（${SALES_LABEL[salesId]}）`
        const next = {
          ...prev,
          interviews: {
            ...prev.interviews,
            [memberId]: {
              ...prev.interviews[memberId],
              status: 'confirmed',
              confirmedSlotId: slotId,
              confirmedSalesId: salesId,
              confirmedOverride: null,
              assignReason: `Mgrによる手動割り当て（${SALES_LABEL[salesId]}担当）`,
              meetingUrl: buildMeetingUrl(prev.provider, memberId, slot.start),
              pendingNote: null,
              changeRequest: null,
            },
          },
        }
        const section = SECTIONS.find((item) => item.id === memberById(memberId).sectionId)
        return pushNotification(next, {
          channel: `#面談-${section.name}`,
          body: `${memberById(memberId).name}さんの面談日時を手動で確定しました。\n${formatRange(slot.start, slot.end)}\n担当: ${SALES_LABEL[salesId]}\n会議URL（モック）を発行しました。`,
        })
      })
      pushToast(message, tone)
    }

    /** Mgrセル詳細モーダル「保存」: 確定前の割当を状態・APIへ永続化 */
    const saveAssignmentOverride = async (memberId, slotId) => {
      if (USE_API) {
        return runBusy(async () => {
          try {
            await http.put(`/assignments/overrides/${memberId}`, { slotId })
            setState((prev) => ({
              ...prev,
              assignmentOverrides: { ...(prev.assignmentOverrides || {}), [memberId]: slotId },
            }))
            pushToast('割当を保存しました')
            return true
          } catch (err) {
            pushToast(err instanceof ApiError ? err.message : '割当の保存に失敗しました', 'warn')
            return false
          }
        })
      }
      setState((prev) => {
        const member = memberById(memberId)
        if (!member || !slotId) return prev
        const slot = sectionSlots(prev, member.sectionId).find((entry) => entry.id === slotId)
        if (!slot) return prev

        const nextOverrides = { ...(prev.assignmentOverrides || {}) }
        for (const [otherId, otherSlotId] of Object.entries(nextOverrides)) {
          if (String(otherId) === String(memberId)) continue
          const otherMember = memberById(otherId)
          if (!otherMember) continue
          const otherSlot = sectionSlots(prev, otherMember.sectionId).find((entry) => entry.id === otherSlotId)
          if (otherSlot && otherSlot.start === slot.start) delete nextOverrides[otherId]
        }
        nextOverrides[memberId] = slotId
        return { ...prev, assignmentOverrides: nextOverrides }
      })
      return true
    }

    /** カレンダー上の自動割当を一括で面談確定データへ保存・更新 */
    const confirmAssignments = async (items) => {
      if (USE_API) {
        return runBusy(async () => {
          try {
            const result = await http.post<{ message: string; interviews: any[] }>('/assignments/confirm', {
              items: (items || []).map((item) => ({ memberId: Number(item.memberId), slotId: item.slotId })),
            })
            setState((prev) => {
              const interviews = { ...prev.interviews }
              const overrides = { ...(prev.assignmentOverrides || {}) }
              for (const iv of result.interviews || []) {
                const id = Number(iv.memberId)
                interviews[id] = interviewFromApi(iv)
                delete overrides[id]
                delete overrides[String(id)]
              }
              return { ...prev, interviews, assignmentOverrides: overrides }
            })
            await refreshNotifications()
            pushToast(result.message || '面談を確定しました')
            return true
          } catch (err) {
            pushToast(err instanceof ApiError ? err.message : '確定に失敗しました', 'warn')
            return false
          }
        })
      }
      let message = ''
      let tone = 'ok'
      setState((prev) => {
        let next = {
          ...prev,
          interviews: { ...prev.interviews },
          assignmentOverrides: { ...(prev.assignmentOverrides || {}) },
        }
        const lines = []
        for (const item of items || []) {
          const memberId = item.memberId
          const slotId = item.slotId
          const member = memberById(memberId)
          if (!member) continue
          const slot = sectionSlots(next, member.sectionId).find((entry) => entry.id === slotId)
          if (!slot) continue
          const holder = slotTakenBy(next, slotId, memberId) || startHeldBy(next, slot.start, memberId)
          if (holder) continue
          const salesId = pickSalesForSlot(next, memberId, slot, memberId)
          if (!salesId) continue
          next.interviews[memberId] = {
            ...next.interviews[memberId],
            status: 'confirmed',
            confirmedSlotId: slotId,
            confirmedSalesId: salesId,
            confirmedOverride: null,
            assignReason: `（${SALES_LABEL[salesId]}担当）`,
            meetingUrl: buildMeetingUrl(next.provider, memberId, slot.start),
            pendingNote: null,
            changeRequest: null,
          }
          delete next.assignmentOverrides[memberId]
          delete next.assignmentOverrides[String(memberId)]
          lines.push(`・${member.name}: ${formatRange(slot.start, slot.end)}（${SALES_LABEL[salesId]}）`)
        }
        if (!lines.length) {
          message = '確定できる割当がありません'
          tone = 'warn'
          return prev
        }
        message = `${lines.length}名の面談を確定しました`
        const section = SECTIONS.find((entry) => entry.id === memberById(items[0].memberId)?.sectionId)
        return pushNotification(next, {
          channel: `#面談-${section?.name || ''}`,
          body: `Mgrが面談を確定しました。\n${lines.join('\n')}\n会議URL（モック）を発行しました。`,
        })
      })
      pushToast(message, tone)
      return tone === 'ok'
    }

    /** 確定済み面談の日時変更（/mgr 変更モード。source で通知文を切替） */
    const changeConfirmedTime = async (memberId, payload, source = 'admin') => {
      if (USE_API) {
        return runBusy(async () => {
          try {
            const iv = await http.put<any>(`/interviews/${memberId}/confirmed-time`, {
              ...payload,
              source,
            })
            setState((prev) => ({
              ...prev,
              interviews: { ...prev.interviews, [memberId]: interviewFromApi(iv) },
            }))
            await refreshNotifications()
            pushToast(source === 'mgr' ? '面談日時を変更し、該当者へ通知しました' : '確定日時を変更しました')
            return true
          } catch (err) {
            pushToast(err instanceof ApiError ? err.message : '日時変更に失敗しました', 'warn')
            return false
          }
        })
      }
      let message = ''
      let tone = 'ok'
      setState((prev) => {
        const interview = prev.interviews[memberId]
        if (!interview) {
          message = '面談データがありません'
          tone = 'warn'
          return prev
        }
        let start = payload.start
        let end = payload.end
        let confirmedSlotId = null
        let salesId = payload.salesId || interview.confirmedSalesId
        if (payload.slotId) {
          const slot = sectionSlots(prev, memberById(memberId).sectionId).find((item) => item.id === payload.slotId)
          if (!slot) {
            message = '枠が見つかりません'
            tone = 'warn'
            return prev
          }
          const holder = slotTakenBy(prev, payload.slotId, memberId) || startHeldBy(prev, slot.start, memberId)
          if (holder) {
            message = `その時間は${memberById(holder).name}さんの確定枠です`
            tone = 'warn'
            return prev
          }
          start = slot.start
          end = slot.end
          confirmedSlotId = slot.id
          salesId = pickSalesForSlot(prev, memberId, slot, memberId)
          if (!salesId) {
            message = 'その時間に空いている営業がいません'
            tone = 'warn'
            return prev
          }
        } else if (!salesId) {
          salesId = 'salesA'
        }
        const hadRequest = Boolean(interview.changeRequest)
        const byMgr = source === 'mgr'
        message = hadRequest
          ? '変更依頼を反映して日時を更新しました'
          : byMgr
            ? '面談日時を変更し、該当者へ通知しました'
            : '確定日時を変更しました'
        const next = {
          ...prev,
          interviews: {
            ...prev.interviews,
            [memberId]: {
              ...interview,
              status: 'confirmed',
              confirmedSlotId,
              confirmedSalesId: salesId,
              confirmedOverride: confirmedSlotId ? null : { start, end },
              assignReason: byMgr
                ? `Mgrによる日時変更（${SALES_LABEL[salesId]}担当）`
                : `管理者による手動変更（${SALES_LABEL[salesId]}担当）`,
              meetingUrl: buildMeetingUrl(prev.provider, memberId, start),
              pendingNote: null,
              changeRequest: null,
            },
          },
        }
        const section = SECTIONS.find((item) => item.id === memberById(memberId).sectionId)
        const actor = byMgr ? 'Mgr' : '管理者'
        return pushNotification(next, {
          channel: `#面談-${section.name}`,
          body: `${memberById(memberId).name}さんの確定日時を${actor}が変更しました。\n${formatRange(start, end)}\n担当: ${SALES_LABEL[salesId]}`,
        })
      })
      pushToast(message, tone)
      return tone === 'ok'
    }

    /** /mgr「日時の変更」モード（確定後）: 確定日時の更新と該当者通知。確定前は saveAssignmentOverride を使う */
    const mgrChangeTime = (memberId, payload) => changeConfirmedTime(memberId, payload, 'mgr')

    const requestChange = async (memberId, { reason, preferredDates }) => {
      const cleanReason = reason.trim()
      const cleanDates = preferredDates.trim()
      if (!cleanReason || !cleanDates) {
        pushToast('理由と希望日を入力してください', 'warn')
        return false
      }
      if (USE_API) {
        return runBusy(async () => {
          try {
            const iv = await http.post<any>(`/interviews/${memberId}/change-requests`, {
              reason: cleanReason,
              preferredDates: cleanDates,
            })
            setState((prev) => ({
              ...prev,
              interviews: { ...prev.interviews, [memberId]: interviewFromApi(iv) },
            }))
            await refreshNotifications()
            pushToast('日程変更の希望を送信しました')
            return true
          } catch (err) {
            pushToast(err instanceof ApiError ? err.message : '変更希望の送信に失敗しました', 'warn')
            return false
          }
        })
      }
      const member = memberById(memberId)
      let applied = false
      setState((prev) => {
        const interview = prev.interviews[memberId]
        if (!isLocked(interview)) return prev
        applied = true
        const section = SECTIONS.find((item) => item.id === member.sectionId)
        const next = {
          ...prev,
          interviews: {
            ...prev.interviews,
            [memberId]: {
              ...interview,
              status: 'change_requested',
              changeRequest: { reason: cleanReason, preferredDates: cleanDates, at: getSystemDateIso() },
            },
          },
        }
        return pushNotification(next, {
          channel: `#面談-${section.name}`,
          body: `${member.name}さんから日程変更の希望が届きました。\n理由: ${cleanReason}\n希望: ${cleanDates}`,
        })
      })
      if (!applied) {
        pushToast('確定後に変更希望を出せます', 'warn')
        return false
      }
      pushToast('日程変更の希望を送信しました')
      return true
    }

    const reopen = async (memberId) => {
      if (USE_API) {
        return runBusy(async () => {
          try {
            const iv = await http.post<any>(`/interviews/${memberId}/reopen`)
            setState((prev) => ({
              ...prev,
              interviews: { ...prev.interviews, [memberId]: interviewFromApi(iv) },
            }))
            pushToast(`${memberById(memberId)?.name || 'メンバー'}さんを調整中に戻しました`)
            return true
          } catch (err) {
            pushToast(err instanceof ApiError ? err.message : '再開に失敗しました', 'warn')
            return false
          }
        })
      }
      setState((prev) => ({
        ...prev,
        interviews: {
          ...prev.interviews,
          [memberId]: {
            ...prev.interviews[memberId],
            status: 'adjusting',
            confirmedSlotId: null,
            confirmedSalesId: null,
            confirmedOverride: null,
            assignReason: null,
            meetingUrl: null,
            pendingNote: null,
            changeRequest: null,
          },
        },
      }))
      pushToast(`${memberById(memberId).name}さんを調整中に戻しました`)
      return true
    }

    const setHongoJoins = async (value) => {
      if (USE_API) {
        return runBusy(async () => {
          try {
            const settings = await http.patch<{ hongoJoins: boolean }>('/settings', { hongoJoins: value })
            // 本郷メンバーの面談フラグも同期
            const hongo = getRawRegistryMembers(true).find((m) => m.role === 'hongo')
            if (hongo) {
              try {
                await http.patch(`/members/${hongo.id}`, { isInterviewer: value })
                setRegistryMembers(
                  getRawRegistryMembers(true).map((m) =>
                    m.id === hongo.id ? { ...m, isInterviewer: value } : m,
                  ),
                )
              } catch {
                // 設定本体の更新は成功しているので続行
              }
            }
            setState((prev) => ({ ...prev, hongoJoins: settings.hongoJoins }))
            pushToast(settings.hongoJoins ? '今期は本郷が参加します' : '今期は本郷不参加にしました', 'info')
            return true
          } catch (err) {
            pushToast(err instanceof ApiError ? err.message : '設定の更新に失敗しました', 'warn')
            return false
          }
        })
      }
      const hongo = getRawRegistryMembers(true).find((m) => m.role === 'hongo')
      if (hongo) {
        setRegistryMembers(
          getRawRegistryMembers(true).map((m) =>
            m.id === hongo.id ? { ...m, isInterviewer: value } : m,
          ),
        )
      }
      setState((prev) => ({ ...prev, hongoJoins: value }))
      pushToast(value ? '今期は本郷が参加します' : '今期は本郷不参加にしました', 'info')
      return true
    }

    const setProvider = (provider) => {
      setState((prev) => {
        const interviews = { ...prev.interviews }
        for (const [id, interview] of Object.entries(interviews)) {
          const slot = sectionSlots(prev, memberById(id).sectionId).find((item) => item.id === interview.confirmedSlotId)
          const start = interview.confirmedOverride?.start || slot?.start
          if (!interview.meetingUrl || !start) continue
          interviews[id] = { ...interview, meetingUrl: buildMeetingUrl(provider, id, start) }
        }
        return { ...prev, provider, interviews }
      })
      pushToast(provider === 'zoom' ? '会議URLを Zoom 形式に切り替えました' : '会議URLを Google Meet 形式に切り替えました')
    }

    const fillRemainingNg = (memberId) => {
      let outcome = 'updated'
      setState((prev) => {
        const interview = prev.interviews[memberId]
        if (isLocked(interview)) {
          outcome = 'locked'
          return prev
        }
        const current = { ...(prev.votes[memberId] || {}) }
        for (const slot of engineerSlots(prev, memberId)) {
          if (!current[slot.id]) current[slot.id] = 'ng'
        }
        outcome = interview.submittedAt ? 'reopened' : 'updated'
        return {
          ...prev,
          votes: { ...prev.votes, [memberId]: current },
          interviews: {
            ...prev.interviews,
            [memberId]: interview.submittedAt ? { ...interview, submittedAt: null, pendingNote: null } : interview,
          },
        }
      })
      if (outcome === 'locked') pushToast('確定済みの回答は直接編集できません', 'warn')
      else if (outcome === 'reopened') pushToast('未選択を × にし、回答を未送信に戻しました', 'info')
      else pushToast('未選択の枠を × にしました')
    }

    const resetDemo = async () => {
      if (USE_API) {
        return runBusy(async () => {
          try {
            const result = await http.post<{ message?: string }>('/dev/reseed')
            await refreshFromApi()
            pushToast(result?.message || 'デモデータを復元しました')
            return true
          } catch (err) {
            pushToast(err instanceof ApiError ? err.message : 'リセットに失敗しました', 'warn')
            return false
          }
        })
      }
      setState(createInitialState())
      pushToast('デモデータを復元しました')
      return true
    }

    return {
      setVote,
      setPartyVote,
      setPartyHours,
      setPartyAvailability,
      setSalesAvailability,
      setSalesAssignees,
      setMemberDayMark,
      savePreferences,
      submitVotes,
      saveMemberVotes,
      setDeadline,
      sendRequests,
      applyJudge,
      manualAssign,
      saveAssignmentOverride,
      confirmAssignments,
      mgrChangeTime,
      requestChange,
      reopen,
      setHongoJoins,
      setProvider,
      fillRemainingNg,
      resetDemo,
      refreshFromApi,
    }
  }, [refreshFromApi, refreshNotifications, runBusy])

  const slots = useMemo(
    () => allCandidateSlots(state, SECTIONS.map((section) => section.id)),
    [state],
  )

  // slots 付き state の参照を安定させ、自動割当などの useMemo が toast 等で無効化されないようにする
  const stateWithSlots = useMemo(() => ({ ...state, slots }), [state, slots])

  const engineerSlotsFor = useCallback(
    (memberId) => engineerSlots(stateWithSlots, memberId),
    [stateWithSlots],
  )

  const value = useMemo(
    () => ({
      state: stateWithSlots,
      role,
      view,
      setView,
      chooseRole,
      bindNavigate,
      syncFromPath,
      authMode,
      setAuthMode,
      activeMemberId,
      setActiveMemberId,
      activeSectionId,
      setActiveSectionId,
      activeSalesId,
      setActiveSalesId,
      statusFilter,
      setStatusFilter,
      sectionFilter,
      setSectionFilter,
      toast,
      pushToast,
      dismissToast,
      runBusy,
      openMember,
      engineerSlotsFor,
      apiReady,
      apiError,
      apiBusy,
      ...api,
    }),
    [
      stateWithSlots,
      role,
      view,
      setView,
      chooseRole,
      bindNavigate,
      syncFromPath,
      authMode,
      activeMemberId,
      activeSectionId,
      activeSalesId,
      statusFilter,
      sectionFilter,
      toast,
      pushToast,
      dismissToast,
      openMember,
      engineerSlotsFor,
      apiReady,
      apiError,
      apiBusy,
      runBusy,
      api,
    ],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

function sectionByName(sectionId) {
  return SECTIONS.find((section) => section.id === sectionId)?.name || sectionId
}

export function useApp() {
  const context = useContext(AppContext)
  if (!context) throw new Error('useApp must be used within AppProvider')
  return context
}
