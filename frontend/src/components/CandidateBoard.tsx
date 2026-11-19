import { useEffect, useMemo, useState } from 'react'
import { Modal } from './Modal'
import { availableHours, blockingVoters, candidateSlots, VOTER_LABEL } from '../model/candidates'
import { businessDays, HOURS, hourOf, slotBounds } from '../model/calendar'
import { formatDate } from '../model/format'
import { useInterviewPeriod } from '../model/interviewPeriod'
import { assignedSalesId, salesCanTakeSlot } from '../model/rules'
import { isGeneralEngineer } from '../model/membersMaster'
import { interviewMembersOf, memberById, SECTIONS, sectionById } from '../model/seed'
import { useApp } from '../model/store'
import { useSystemDate } from '../model/systemDate'

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

/** 面談対象ペア: 担当Mgr + 担当営業 +（参加時）本郷 + 対象エンジニア */
function pairParty(state, sectionId, member) {
  const salesId = assignedSalesId(state, member.id)
  const voterIds = [sectionId]
  if (salesId) voterIds.push(salesId)
  if (state.hongoJoins) voterIds.push('hongo')
  const titleParts = voterIds.map((id) => VOTER_LABEL[id])
  titleParts.push(`${member.surname || member.name}さん`)
  return { voterIds, salesId, title: titleParts.join(' / ') }
}

function slotIdFor(sectionId, dayIso, hour) {
  return `${sectionId}-${dayIso}-${String(hour).padStart(2, '0')}`
}

function engineerMark(votes, slotId) {
  const mark = votes?.[slotId]
  if (mark === 'ng') return 'ng'
  if (mark === 'first') return 'first'
  return 'ok'
}

function markRank(mark) {
  if (mark === 'first') return 2
  if (mark === 'ok') return 1
  return 0
}

const SECTION_ORDER = SECTIONS.map((item) => item.id)

function mgrRank(sectionId) {
  const index = SECTION_ORDER.indexOf(sectionId)
  return index < 0 ? 99 : index
}

/** slotIdFor の逆（`${sectionId}-${YYYY-MM-DD}-${HH}`）。candidateSlots と同じ bounds を返す */
function parseSlotId(slotId) {
  const matched = String(slotId || '').match(/^(.+)-(\d{4}-\d{2}-\d{2})-(\d{2})$/)
  if (!matched) return null
  const hour = Number(matched[3])
  if (!Number.isFinite(hour)) return null
  return { sectionId: matched[1], day: matched[2], hour }
}

/**
 * 確定枠の開始/終了を解決。slotBounds / 既存 slots を使い、最終手段のみ candidateSlots。
 * （以前の isStartBusy / confirmedSlotForMember と同一の開始時刻になる）
 */
function resolveHeldTiming(state, interview, sectionId) {
  const overrideStart = interview?.confirmedOverride?.start || null
  const overrideEnd = interview?.confirmedOverride?.end || null
  if (overrideStart) {
    const day = String(overrideStart).slice(0, 10)
    const hour = hourOf(overrideStart)
    return {
      id: interview.confirmedSlotId || (Number.isFinite(hour) ? slotIdFor(sectionId, day, hour) : null),
      start: overrideStart,
      end: overrideEnd || (Number.isFinite(hour) ? slotBounds(day, hour).end : null),
      day,
      hour: Number.isFinite(hour) ? hour : null,
    }
  }

  const slotId = interview?.confirmedSlotId
  if (!slotId) return null

  const parsed = parseSlotId(slotId)
  if (parsed) {
    const bounds = slotBounds(parsed.day, parsed.hour)
    return { id: slotId, start: bounds.start, end: bounds.end, day: parsed.day, hour: parsed.hour }
  }

  const fromState = Array.isArray(state.slots) ? state.slots.find((item) => item.id === slotId) : null
  if (fromState?.start) {
    return {
      id: slotId,
      start: fromState.start,
      end: fromState.end || null,
      day: fromState.day || String(fromState.start).slice(0, 10),
      hour: fromState.hour ?? hourOf(fromState.start),
    }
  }

  if (sectionId) {
    const slot = candidateSlots(state, sectionId).find((item) => item.id === slotId)
    if (slot?.start) {
      return {
        id: slot.id,
        start: slot.start,
        end: slot.end || null,
        day: slot.day || String(slot.start).slice(0, 10),
        hour: hourOf(slot.start),
      }
    }
  }
  return null
}

/** 確定済み・変更依頼の開始時刻 → 衝突判定用エントリ（state ごとに1回） */
function buildConfirmedBusyIndex(state) {
  const byStartMs = new Map()
  for (const [id, interview] of Object.entries(state.interviews || {})) {
    if (interview?.status !== 'confirmed' && interview?.status !== 'change_requested') continue
    const owner = memberById(id)
    const sectionId = owner?.sectionId
    const held = resolveHeldTiming(state, interview, sectionId)
    if (!held?.start) continue
    const ms = Date.parse(held.start)
    if (!Number.isFinite(ms)) continue
    const list = byStartMs.get(ms) || []
    list.push({
      id: String(id),
      salesId: interview.confirmedSalesId || null,
      sectionId: sectionId || null,
    })
    byStartMs.set(ms, list)
  }
  return byStartMs
}

/** 確定済み・変更依頼ありの開始時刻が「予定あり」として塞がっているか */
function isStartBusy(state, start, salesId, exceptMemberId, busyIndex?) {
  const target = Date.parse(start)
  if (!Number.isFinite(target)) return false

  const index = busyIndex || buildConfirmedBusyIndex(state)
  const hits = index.get(target)
  if (!hits?.length) return false

  const except = String(exceptMemberId)
  for (const hit of hits) {
    if (hit.id === except) continue
    if (!salesId) return true
    if (!hit.salesId || hit.salesId === salesId) return true
    const self = memberById(exceptMemberId)
    if (hit.sectionId && self?.sectionId && hit.sectionId === self.sectionId) return true
  }
  return false
}

/** 確定済み面談をカレンダー表示用スロットへ復元（表示専用・自動割当には使わない） */
function confirmedSlotForMember(state, member) {
  const interview = state.interviews?.[member.id]
  if (!interview || (interview.status !== 'confirmed' && interview.status !== 'change_requested')) {
    return null
  }

  const held = resolveHeldTiming(state, interview, member.sectionId)
  if (!held?.start) return null

  const day = held.day || String(held.start).slice(0, 10)
  const hour = held.hour ?? hourOf(held.start)
  const id = held.id || slotIdFor(member.sectionId, day, hour)
  const end = held.end || slotBounds(day, hour).end

  const votes = state.votes?.[member.id] || {}
  const mark = engineerMark(votes, id)
  const salesId = interview.confirmedSalesId || assignedSalesId(state, member.id)

  return {
    id,
    sectionId: member.sectionId,
    memberId: member.id,
    salesId,
    day,
    hour,
    start: held.start,
    end,
    mark: mark === 'ng' ? 'ok' : mark,
    markScore: markRank(mark === 'ng' ? 'ok' : mark),
    mgrScore: mgrRank(member.sectionId),
    confirmed: true,
    meetingUrl: interview.meetingUrl || null,
  }
}

/** 関係者全員が可能な時間枠（エンジニア × 除外） */
function memberOpenSlots(state, member, busyIndex?, days?) {
  const sectionId = member.sectionId
  const { voterIds, salesId } = pairParty(state, sectionId, member)
  if (!salesId) return []

  const interview = state.interviews?.[member.id]
  if (interview?.status === 'confirmed' || interview?.status === 'change_requested') {
    return []
  }

  const difficult = interview?.preferences?.difficultDates || []
  const difficultSet = difficult.length ? new Set(difficult) : null
  const votes = state.votes?.[member.id] || {}
  const open = []
  const index = busyIndex || buildConfirmedBusyIndex(state)
  const periodDays = days || businessDays()

  for (const day of periodDays) {
    if (difficultSet ? difficultSet.has(day.iso) : difficult.includes(day.iso)) continue
    if (blockingVoters(state.dayVotes, voterIds, day.iso).length) continue

    for (const hour of availableHours(state, voterIds, day.iso)) {
      const bounds = slotBounds(day.iso, hour.hour)
      const id = slotIdFor(sectionId, day.iso, hour.hour)
      if (!salesCanTakeSlot(state, salesId, { day: day.iso, start: bounds.start })) continue
      const mark = engineerMark(votes, id)
      if (mark === 'ng') continue
      if (isStartBusy(state, bounds.start, salesId, member.id, index)) continue
      open.push({
        id,
        sectionId,
        memberId: member.id,
        salesId,
        day: day.iso,
        hour: hour.hour,
        start: bounds.start,
        end: bounds.end,
        mark,
        markScore: markRank(mark),
        mgrScore: mgrRank(sectionId),
      })
    }
  }

  return open
}

/** Mgr / 営業 / 本郷の同日コマ数キー */
function partyDayKey(partyId, day) {
  return `${partyId}|${day}`
}

function dayLoadOf(map, partyId, day) {
  return map.get(partyDayKey(partyId, day)) || 0
}

function bumpDayLoad(map, partyId, day) {
  const key = partyDayKey(partyId, day)
  map.set(key, (map.get(key) || 0) + 1)
}

/**
 * 役割別の同日コマ上限パス。
 * Mgr・営業は強めに1コマを守り、本郷は先に2コマ目を許容する。
 * 全員とも最大2コマ（3コマ以上は不可）。
 */
const DAY_LOAD_PASSES = [
  { mgr: 1, sales: 1, hongo: 1 },
  { mgr: 1, sales: 1, hongo: 2 },
  { mgr: 2, sales: 2, hongo: 2 },
]

/** 割当後の同日負荷が、指定パスの役割別上限に収まるか */
function fitsDayLoadLimits(mgrDayLoad, salesDayLoad, hongoDayLoad, hongoJoins, sectionId, salesId, day, limits) {
  if (dayLoadOf(mgrDayLoad, sectionId, day) + 1 > limits.mgr) return false
  if (dayLoadOf(salesDayLoad, salesId, day) + 1 > limits.sales) return false
  if (hongoJoins && dayLoadOf(hongoDayLoad, 'hongo', day) + 1 > limits.hongo) return false
  return true
}

/** 同一 state 参照なら空き列挙＋割当を再利用（ロジック自体は不変） */
let scheduleBundleCacheState = null
let scheduleBundleCache = null

/**
 * 全社の空き列挙と自動割当を一度に計算する。
 * CandidateBoard 表示と autoAssignInterviews で共有し、二重計算を避ける。
 */
function buildScheduleBundle(state) {
  if (scheduleBundleCacheState === state && scheduleBundleCache) {
    return scheduleBundleCache
  }

  const allMembers = SECTIONS.flatMap((section) => interviewMembersOf(section.id))
  const busyIndex = buildConfirmedBusyIndex(state)
  const periodDays = businessDays()
  const openByMember = new Map()
  const candidates = []
  const hongoJoins = Boolean(state.hongoJoins)

  for (const member of allMembers) {
    const open = memberOpenSlots(state, member, busyIndex, periodDays)
    openByMember.set(member.id, open)
    for (const slot of open) candidates.push(slot)
  }

  // 第4・第5優先の並び（第1〜第3はパス分割で動的に適用）
  candidates.sort((a, b) => {
    if (a.mgrScore !== b.mgrScore) return a.mgrScore - b.mgrScore
    return Date.parse(a.start) - Date.parse(b.start)
  })

  const assignedMember = new Set()
  const takenStarts = new Set()
  const busySales = { salesA: new Set(), salesB: new Set() }
  const hongoBusy = new Set()
  const mgrDayLoad = new Map()
  const salesDayLoad = new Map()
  const hongoDayLoad = new Map()

  // 既存確定を埋まり・同日負荷として扱う
  for (const member of allMembers) {
    const interview = state.interviews?.[member.id]
    if (!interview || (interview.status !== 'confirmed' && interview.status !== 'change_requested')) continue
    const held = resolveHeldTiming(state, interview, member.sectionId)
    const start = held?.start || null
    if (!start || !held) continue
    const day = held.day || String(start).slice(0, 10)
    takenStarts.add(start)
    assignedMember.add(member.id)
    bumpDayLoad(mgrDayLoad, member.sectionId, day)
    if (interview.confirmedSalesId) {
      busySales[interview.confirmedSalesId]?.add(start)
      bumpDayLoad(salesDayLoad, interview.confirmedSalesId, day)
    }
    if (hongoJoins) {
      hongoBusy.add(start)
      bumpDayLoad(hongoDayLoad, 'hongo', day)
    }
  }

  const assignments = new Map()

  const tryAssign = (slot, limits, avoidTen) => {
    if (assignedMember.has(slot.memberId)) return false
    if (takenStarts.has(slot.start)) return false
    if (busySales[slot.salesId]?.has(slot.start)) return false
    if (hongoJoins && hongoBusy.has(slot.start)) return false
    if (avoidTen && Number(slot.hour) === 10) return false

    if (
      !fitsDayLoadLimits(
        mgrDayLoad,
        salesDayLoad,
        hongoDayLoad,
        hongoJoins,
        slot.sectionId,
        slot.salesId,
        slot.day,
        limits,
      )
    ) {
      return false
    }

    assignedMember.add(slot.memberId)
    takenStarts.add(slot.start)
    busySales[slot.salesId]?.add(slot.start)
    bumpDayLoad(mgrDayLoad, slot.sectionId, slot.day)
    bumpDayLoad(salesDayLoad, slot.salesId, slot.day)
    if (hongoJoins) {
      hongoBusy.add(slot.start)
      bumpDayLoad(hongoDayLoad, 'hongo', slot.day)
    }
    assignments.set(slot.memberId, slot)
    return true
  }

  // 第1: ◎→○ / 第2: 役割別負荷パス1→2→3 / 第3: 11時以降→10時（最終手段）
  for (const markScore of [2, 1]) {
    const pool = candidates.filter((slot) => slot.markScore === markScore)
    for (const limits of DAY_LOAD_PASSES) {
      for (const avoidTen of [true, false]) {
        for (const slot of pool) {
          tryAssign(slot, limits, avoidTen)
        }
      }
    }
  }

  const bundle = { assignments, openByMember, busyIndex }
  scheduleBundleCacheState = state
  scheduleBundleCache = bundle
  return bundle
}

/**
 * 優先度ルールで面談候補を自動割り当て（重複排除）
 * 1. エンジニア評価 ◎ > ○
 * 2. 同日負荷（役割別）:
 *    パス1: Mgr1 / 営業1 / 本郷1
 *    パス2: Mgr1 / 営業1 / 本郷2（本郷のみ先に2コマ許容）
 *    パス3: Mgr2 / 営業2 / 本郷2（最大。3コマ以上は不可）
 * 3. 開始時間（11:00以降 > 10:00）
 * 4. セクション定義順（若い方優先）
 * 5. 日時の早さ
 */
export function autoAssignInterviews(state) {
  return buildScheduleBundle(state).assignments
}

/** 面談期間内の全日（土日含む）。判定は触らず表示用 */
function calendarDaysInRange(rangeStart: string, rangeEnd: string) {
  const [sy, sm, sd] = rangeStart.split('-').map(Number)
  const [ey, em, ed] = rangeEnd.split('-').map(Number)
  const days = []
  const cursor = new Date(Date.UTC(sy, sm - 1, sd))
  const end = new Date(Date.UTC(ey, em - 1, ed))
  while (cursor <= end) {
    const dow = cursor.getUTCDay()
    days.push({
      iso: cursor.toISOString().slice(0, 10),
      day: cursor.getUTCDate(),
      dow,
      weekend: dow === 0 || dow === 6,
    })
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return days
}

function surnameOf(member) {
  return member?.surname || String(member?.name || '').replace(/^.+セクション-/, '') || '—'
}

/** 確定済みモーダル用: 時刻のみ（例: 16:00-17:00） */
function formatHmRange(start, end) {
  if (!start) return '—'
  const hm = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const endLabel = end ? hm.format(new Date(end)) : ''
  return `${hm.format(new Date(start))}${endLabel ? `-${endLabel}` : ''}`
}

type DayCellMember = {
  member: ReturnType<typeof memberById>
  slot: ReturnType<typeof memberOpenSlots>[number] | null
  assigned: boolean
  confirmed: boolean
  possibleHours: ReturnType<typeof memberOpenSlots>
}

const TODAY_CELL_BORDER = '#C6532A'
const CELL_BG_ADJUSTABLE = '#FFFDF9'
const CELL_BG_BLOCKED = '#E8ECEC'
const CELL_BG_OFF = '#D8D8D8'

/**
 * 変更モード用: 参加メンバー（担当Mgr・担当営業・本郷・対象エンジニア）のいずれかが
 * その日に × を付けているか。
 */
function partyHasDayNg(state, sectionId, members, dayIso) {
  if (state.dayVotes?.[sectionId]?.[dayIso] === 'ng') return true
  if (state.hongoJoins && state.dayVotes?.hongo?.[dayIso] === 'ng') return true

  const checkedSales = new Set()
  for (const member of members) {
    const salesId = assignedSalesId(state, member.id)
    if (salesId && !checkedSales.has(salesId)) {
      checkedSales.add(salesId)
      if (state.dayVotes?.[salesId]?.[dayIso] === 'ng') return true
    }

    const difficult = state.interviews?.[member.id]?.preferences?.difficultDates || []
    if (difficult.includes(dayIso)) return true

    const votes = state.votes?.[member.id] || {}
    const dayMarks = HOURS.map((item) => engineerMark(votes, slotIdFor(sectionId, dayIso, item.hour)))
    if (dayMarks.length > 0 && dayMarks.every((mark) => mark === 'ng')) return true
  }

  return false
}

function isInterviewConfirmed(interview) {
  return interview?.status === 'confirmed' || interview?.status === 'change_requested'
}

/**
 * 変更モードの重複判定: 確定済みに加え、他メンバーの現行割当（自動/オーバーライド）も考慮。
 * Mgr・担当営業の同一開始時刻、本郷参加時の同一開始時刻を塞ぐ。
 */
function isChangeSlotBooked(state, start, salesId, exceptMemberId, peerAssignments, busyIndex?) {
  if (isStartBusy(state, start, salesId, exceptMemberId, busyIndex)) return true
  if (!peerAssignments?.size) return false

  const target = Date.parse(start)
  if (!Number.isFinite(target)) return false

  for (const [id, slot] of peerAssignments) {
    if (String(id) === String(exceptMemberId)) continue
    if (!slot?.start || Date.parse(slot.start) !== target) continue
    if (state.hongoJoins) return true
    if (!salesId) return true
    if (slot.salesId && slot.salesId === salesId) return true
    const owner = memberById(id)
    const self = memberById(exceptMemberId)
    if (owner?.sectionId && self?.sectionId && owner.sectionId === self.sectionId) return true
  }
  return false
}

/**
 * 変更モード: 指定日の調整可能枠（確定前・確定後とも算出）。
 * 関係者（Mgr・担当営業・本郷参加時・エンジニア）のいずれかが × の枠は除外。
 * 他面談で埋まった枠は booked。
 */
function changeModeDaySlots(state, member, dayIso, peerAssignments?, busyIndex?) {
  const sectionId = member.sectionId
  const { voterIds, salesId } = pairParty(state, sectionId, member)
  if (!salesId) return []
  if (blockingVoters(state.dayVotes, voterIds, dayIso).length) return []

  const difficult = state.interviews?.[member.id]?.preferences?.difficultDates || []
  if (difficult.includes(dayIso)) return []

  const votes = state.votes?.[member.id] || {}
  const slots = []
  for (const hour of availableHours(state, voterIds, dayIso)) {
    const bounds = slotBounds(dayIso, hour.hour)
    const id = slotIdFor(sectionId, dayIso, hour.hour)
    if (!salesCanTakeSlot(state, salesId, { day: dayIso, start: bounds.start })) continue
    const mark = engineerMark(votes, id)
    if (mark === 'ng') continue
    slots.push({
      id,
      sectionId,
      memberId: member.id,
      salesId,
      day: dayIso,
      hour: hour.hour,
      start: bounds.start,
      end: bounds.end,
      mark,
      booked: isChangeSlotBooked(state, bounds.start, salesId, member.id, peerAssignments, busyIndex),
    })
  }
  slots.sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
  return slots
}

/** 変更モード: 面談期間内で調整可能な日付一覧（空き枠がある日のみ） */
function changeModeSelectableDays(state, member, rangeStart, rangeEnd, peerAssignments?, busyIndex?) {
  return businessDays(rangeStart, rangeEnd)
    .map((day) => day.iso)
    .filter((iso) => {
      const slots = changeModeDaySlots(state, member, iso, peerAssignments, busyIndex)
      return slots.some((slot) => !slot.booked)
    })
}

/** 候補枠リストを日付ごとにまとめる（日付セレクト用） */
function uniqueDaysFromSlots(slots) {
  const seen = new Set()
  const days = []
  for (const slot of slots || []) {
    if (!slot?.day || seen.has(slot.day)) continue
    seen.add(slot.day)
    days.push(slot.day)
  }
  days.sort()
  return days
}

function preferSlotId(slots) {
  if (!slots?.length) return ''
  const sorted = slots.slice().sort((a, b) => {
    if ((b.markScore || markRank(b.mark)) !== (a.markScore || markRank(a.mark))) {
      return (b.markScore || markRank(b.mark)) - (a.markScore || markRank(a.mark))
    }
    return Date.parse(a.start) - Date.parse(b.start)
  })
  const free = sorted.find((slot) => !slot.booked)
  return (free || sorted[0])?.id || ''
}

export function CandidateBoard({ state, section }) {
  const app = useApp()
  const { startDate, endDate } = useInterviewPeriod()
  const { dateLocal: todayIso } = useSystemDate()
  const [filterId, setFilterId] = useState('all')
  const [modal, setModal] = useState(null)
  const [changeMode, setChangeMode] = useState(false)
  const [confirmSubmitting, setConfirmSubmitting] = useState(false)
  const [changeSubmitting, setChangeSubmitting] = useState(false)
  const [overrideSubmitting, setOverrideSubmitting] = useState(false)
  const [changeBusyDots, setChangeBusyDots] = useState(1)

  useEffect(() => {
    setFilterId('all')
    setModal(null)
    setChangeMode(false)
  }, [section.id])

  useEffect(() => {
    const busy = modal?.kind === 'change' || changeSubmitting
    if (!busy) {
      setChangeBusyDots(1)
      return
    }
    const timer = window.setInterval(() => {
      setChangeBusyDots((prev) => (prev % 3) + 1)
    }, 350)
    return () => window.clearInterval(timer)
  }, [modal?.kind, changeSubmitting])

  /** state 更新時のみ名簿を取り直す（毎レンダーの新配列で memo が無効化されないようにする） */
  const sectionMembers = useMemo(() => interviewMembersOf(section.id), [section.id, state])

  /** 全社の空き＋自動割当（同一 state ならキャッシュ再利用） */
  const scheduleBundle = useMemo(() => buildScheduleBundle(state), [state])

  /** 絞り込みタブ用: セクション所属の一般エンジニアのみ（Mgr は除外） */
  const filterTabMembers = useMemo(
    () => sectionMembers.filter((member) => isGeneralEngineer(member)),
    [sectionMembers],
  )

  useEffect(() => {
    if (filterId === 'all') return
    const stillVisible = filterTabMembers.some((member) => String(member.id) === String(filterId))
    if (!stillVisible) setFilterId('all')
  }, [filterId, filterTabMembers])

  const visibleMembers = useMemo(() => {
    if (filterId === 'all') return sectionMembers
    return sectionMembers.filter((member) => String(member.id) === String(filterId))
  }, [sectionMembers, filterId])

  const openByMember = useMemo(() => {
    const map = new Map()
    for (const member of sectionMembers) {
      map.set(member.id, scheduleBundle.openByMember.get(member.id) || [])
    }
    return map
  }, [scheduleBundle, sectionMembers])

  /** 確定済み面談（名前・開始時間の表示維持用） */
  const confirmedByMember = useMemo(() => {
    const map = new Map()
    for (const member of sectionMembers) {
      const slot = confirmedSlotForMember(state, member)
      if (slot) map.set(member.id, slot)
    }
    return map
  }, [state, sectionMembers])

  /** 永続化された手動割当（LocalStorage経由の state.assignmentOverrides） */
  const assignmentOverrides = useMemo(() => {
    const map = new Map()
    for (const [memberId, slotId] of Object.entries(state.assignmentOverrides || {})) {
      if (!slotId) continue
      map.set(Number(memberId), slotId)
    }
    return map
  }, [state.assignmentOverrides])

  const assignments = useMemo(() => {
    const base = scheduleBundle.assignments
    if (!assignmentOverrides.size) return base

    const merged = new Map(base)
    const overriddenStarts = new Set()

    for (const [memberId, slotId] of assignmentOverrides) {
      const slot = (openByMember.get(memberId) || []).find((item) => item.id === slotId)
      if (!slot) continue
      merged.set(memberId, slot)
      overriddenStarts.add(slot.start)
    }

    for (const [memberId, slot] of [...merged.entries()]) {
      if (assignmentOverrides.has(memberId)) continue
      if (overriddenStarts.has(slot.start)) merged.delete(memberId)
    }

    return merged
  }, [scheduleBundle, assignmentOverrides, openByMember])

  /** 表示用: 自動割当に加え、確定済み枠もセルに残す */
  const displayAssignments = useMemo(() => {
    const merged = new Map(assignments)
    for (const [memberId, slot] of confirmedByMember) {
      merged.set(memberId, slot)
    }
    return merged
  }, [assignments, confirmedByMember])

  const businessIso = useMemo(
    () => new Set(businessDays(startDate, endDate).map((day) => day.iso)),
    [startDate, endDate],
  )

  const calendarDays = useMemo(() => {
    return calendarDaysInRange(startDate, endDate).map((day) => {
      if (day.weekend || !businessIso.has(day.iso)) {
        return { ...day, kind: 'off', entries: [] as DayCellMember[] }
      }

      const entries: DayCellMember[] = []
      for (const member of visibleMembers) {
        const assignedSlot = displayAssignments.get(member.id)
        // 別日に自動割当／確定済みの人は、この日の「可能」に出さない
        if (assignedSlot && assignedSlot.day !== day.iso) continue

        const possibleHours = (openByMember.get(member.id) || []).filter((slot) => slot.day === day.iso)
        const assignedHere = assignedSlot && assignedSlot.day === day.iso ? assignedSlot : null
        const isConfirmed = confirmedByMember.has(member.id)
        if (assignedHere || possibleHours.length) {
          entries.push({
            member,
            slot: assignedHere,
            assigned: Boolean(assignedHere),
            confirmed: isConfirmed,
            possibleHours,
          })
        }
      }

      return { ...day, kind: 'work', entries }
    })
  }, [startDate, endDate, businessIso, visibleMembers, openByMember, displayAssignments, confirmedByMember])

  const assignedInView = visibleMembers.filter((member) => assignments.has(member.id)).length
  const openDayCount = calendarDays.filter((day) => day.kind === 'work' && day.entries.some((e) => e.assigned || e.possibleHours.length)).length

  const leadPad = calendarDays.length ? calendarDays[0].dow : 0
  const lastDow = calendarDays.length ? calendarDays[calendarDays.length - 1].dow : 0
  const trailPad = calendarDays.length ? (6 - lastDow + 7) % 7 : 0

  const fillerCell = (key: string) => (
    <div
      key={key}
      role="gridcell"
      className="flex min-h-[4.5rem] flex-col items-center justify-center gap-1 px-1.5 py-2 text-center"
      style={{ backgroundColor: CELL_BG_OFF }}
      aria-hidden="true"
    >
      <span className="text-lg font-bold leading-none text-[#5c5c5c]">—</span>
    </div>
  )

  const confirmedMembers = useMemo(
    () => visibleMembers.filter((member) => isInterviewConfirmed(state.interviews?.[member.id])),
    [visibleMembers, state.interviews],
  )

  const busyIndex = scheduleBundle.busyIndex

  /** 日時変更の対象: 確定済み、または関係者空きがある未確定メンバー（変更モード時のみ算出） */
  const changeableMembers = useMemo(() => {
    if (!changeMode) return []
    return visibleMembers.filter((member) => {
      if (isInterviewConfirmed(state.interviews?.[member.id])) return true
      return changeModeSelectableDays(state, member, startDate, endDate, displayAssignments, busyIndex).length > 0
    })
  }, [changeMode, visibleMembers, state, startDate, endDate, displayAssignments, busyIndex])

  const openConfirmModal = (dayIso: string, entries: DayCellMember[]) => {
    const actionable = entries.filter((entry) => entry.assigned || entry.possibleHours.length)
    if (!actionable.length) return

    // 確定済みが含まれる日は、早い時間の面談を初期選択（Meet URL 連動の起点）
    const confirmedSorted = actionable
      .filter((entry) => entry.confirmed && entry.slot)
      .slice()
      .sort((a, b) => Date.parse(a.slot.start) - Date.parse(b.slot.start))

    if (confirmedSorted.length) {
      const earliest = confirmedSorted[0]
      setModal({
        kind: 'assign',
        dayIso,
        entries: actionable,
        memberId: earliest.member.id,
        slotId: earliest.slot.id || '',
      })
      return
    }

    const preferred =
      actionable.find((entry) => entry.assigned) ||
      actionable.slice().sort((a, b) => {
        const aBest = Math.max(...a.possibleHours.map((slot) => slot.markScore), 0)
        const bBest = Math.max(...b.possibleHours.map((slot) => slot.markScore), 0)
        if (bBest !== aBest) return bBest - aBest
        return mgrRank(a.member.sectionId) - mgrRank(b.member.sectionId)
      })[0]

    const defaultSlots = preferred.assigned
      ? [preferred.slot]
      : preferred.possibleHours.slice().sort((a, b) => {
          if (b.markScore !== a.markScore) return b.markScore - a.markScore
          return Date.parse(a.start) - Date.parse(b.start)
        })

    setModal({
      kind: 'assign',
      dayIso,
      entries: actionable,
      memberId: preferred.member.id,
      slotId: defaultSlots[0]?.id || '',
    })
  }

  const openChangeModal = (dayIso: string) => {
    if (!changeableMembers.length) {
      setModal({ kind: 'change', dayIso, memberId: null, slotId: '' })
      return
    }
    const preferred =
      (filterId !== 'all' && changeableMembers.find((member) => String(member.id) === String(filterId))) ||
      changeableMembers.find((member) => {
        const slots = changeModeDaySlots(state, member, dayIso, displayAssignments, busyIndex)
        return slots.some((slot) => !slot.booked)
      }) ||
      changeableMembers[0]
    const slots = changeModeDaySlots(state, preferred, dayIso, displayAssignments, busyIndex)
    const firstFree = slots.find((slot) => !slot.booked)
    setModal({
      kind: 'change',
      dayIso,
      memberId: preferred.id,
      slotId: firstFree?.id || '',
    })
  }

  const handleWorkCellClick = (dayIso: string, entries: DayCellMember[], adjustable: boolean) => {
    if (changeMode) {
      if (!adjustable) return
      openChangeModal(dayIso)
      return
    }
    openConfirmModal(dayIso, entries)
  }

  const isChangeModal = modal?.kind === 'change'
  const modalMember = modal?.memberId != null ? memberById(modal.memberId) : null
  const modalInterview = modalMember ? state.interviews?.[modalMember.id] : null
  const modalConfirmed =
    !isChangeModal &&
    (modalInterview?.status === 'confirmed' || modalInterview?.status === 'change_requested')
  const modalMeetUrl = modalConfirmed ? modalInterview?.meetingUrl || null : null
  /** 同日の確定済み面談（時間昇順）— ラジオ選択用 */
  const modalConfirmedEntries =
    !isChangeModal && modal
      ? modal.entries
          .filter((entry) => entry.confirmed && entry.slot)
          .slice()
          .sort((a, b) => Date.parse(a.slot.start) - Date.parse(b.slot.start))
      : []

  /** 確定前モーダル: メンバーの全日候補（日付変更対応） */
  const modalMemberAllSlots = useMemo(() => {
    if (isChangeModal || !modalMember || modalConfirmed) return []
    const open = openByMember.get(modalMember.id) || []
    const assigned = assignments.get(modalMember.id)
    if (!assigned) return open.slice()
    if (open.some((slot) => slot.id === assigned.id)) return open.slice()
    return [assigned, ...open]
  }, [isChangeModal, modalMember, modalConfirmed, openByMember, assignments])

  const modalAssignableDays = useMemo(
    () => uniqueDaysFromSlots(modalMemberAllSlots),
    [modalMemberAllSlots],
  )

  const modalSlots = useMemo(() => {
    if (!modal?.dayIso) return []
    return modalMemberAllSlots
      .filter((slot) => slot.day === modal.dayIso)
      .slice()
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
  }, [modalMemberAllSlots, modal?.dayIso])

  const modalHasFirstMark = modalSlots.some((slot) => slot.mark === 'first')

  const changeModalDays = useMemo(() => {
    if (!isChangeModal || !modalMember) return []
    return changeModeSelectableDays(state, modalMember, startDate, endDate, displayAssignments, busyIndex)
  }, [isChangeModal, modalMember, state, startDate, endDate, displayAssignments, busyIndex])

  const changeModalSlots =
    isChangeModal && modalMember && modal?.dayIso
      ? changeModeDaySlots(state, modalMember, modal.dayIso, displayAssignments, busyIndex)
      : []

  const changeModalTargetConfirmed = Boolean(
    isChangeModal && modalMember && isInterviewConfirmed(state.interviews?.[modalMember.id]),
  )

  const confirmModal = async () => {
    if (!modal?.memberId || isChangeModal || overrideSubmitting) return
    if (modalConfirmed) {
      setModal(null)
      return
    }
    if (!modal.slotId) return
    setOverrideSubmitting(true)
    try {
      const ok = await app.saveAssignmentOverride(modal.memberId, modal.slotId)
      if (ok !== false) setModal(null)
    } finally {
      setOverrideSubmitting(false)
    }
  }

  const saveChangeModal = async () => {
    if (!isChangeModal || !modal?.memberId || !modal.slotId || changeSubmitting) return
    const selected = changeModalSlots.find((slot) => slot.id === modal.slotId)
    if (!selected || selected.booked) return
    setChangeSubmitting(true)
    const startedAt = Date.now()
    try {
      // 確定前は割当オーバーライド保存、確定後は確定日時変更＋通知
      const ok = changeModalTargetConfirmed
        ? await app.mgrChangeTime(modal.memberId, { slotId: modal.slotId })
        : await app.saveAssignmentOverride(modal.memberId, modal.slotId)
      if (ok) setModal(null)
    } finally {
      const elapsed = Date.now() - startedAt
      const minBusyMs = 700
      if (elapsed < minBusyMs) {
        await new Promise((resolve) => window.setTimeout(resolve, minBusyMs - elapsed))
      }
      setChangeSubmitting(false)
    }
  }

  const todayBorderStyle = (iso: string) =>
    iso === todayIso ? { borderColor: TODAY_CELL_BORDER, borderWidth: 2, borderStyle: 'solid' as const } : undefined
  const todayBorderClass = (iso: string) => (iso === todayIso ? '' : 'border-2 border-transparent')

  /** 変更モード時は回答×の有無で塗り分け。通常時は従来どおり。 */
  const workCellBg = (dayIso: string, open: boolean) => {
    if (changeMode) {
      return partyHasDayNg(state, section.id, visibleMembers, dayIso)
        ? CELL_BG_BLOCKED
        : CELL_BG_ADJUSTABLE
    }
    return open ? CELL_BG_ADJUSTABLE : CELL_BG_BLOCKED
  }

  const confirmAssignedInterviews = async () => {
    if (confirmSubmitting) return
    const targets = visibleMembers
      .map((member) => {
        const slot = assignments.get(member.id)
        return slot ? { memberId: member.id, slotId: slot.id } : null
      })
      .filter(Boolean)
    if (!targets.length) return
    setConfirmSubmitting(true)
    try {
      await app.confirmAssignments(targets)
    } finally {
      setConfirmSubmitting(false)
    }
  }

  return (
    <>
      <article
        className="grid gap-3.5 rounded-card border border-line bg-paper p-[18px] text-ink shadow-card"
        data-testid={`candidate-${section.id}`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-ink">候補日時カレンダー</h2>
            <p className="mt-1 text-sm text-muted">
              {state.hongoJoins
                ? '関係者（Mgr・担当営業・本郷・エンジニア）の共通空き枠（〇/◎）から、1日1コマを優先して重複なく自動割当しています。'
                : '関係者（Mgr・担当営業・エンジニア）の共通空き枠（〇/◎）から、1日1コマを優先して重複なく自動割当しています。'}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
              assignedInView >= visibleMembers.length && visibleMembers.length
                ? 'bg-ok-bg text-ok'
                : 'bg-warn-bg text-warn'
            }`}
          >
            自動割当 {assignedInView}/{visibleMembers.length}名 · 空き日 {openDayCount}日
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="メンバー絞り込み">
          <span className="text-xs font-semibold text-muted">メンバー絞り込み</span>
          <button
            type="button"
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
              filterId === 'all' ? 'border-[#c6532a] bg-[#c6532a] text-white' : 'border-line bg-white text-ink'
            }`}
            onClick={() => setFilterId('all')}
          >
            全員表示
          </button>
          {filterTabMembers.map((member) => (
            <button
              key={member.id}
              type="button"
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                String(filterId) === String(member.id)
                  ? 'border-[#c6532a] bg-[#c6532a] text-white'
                  : 'border-line bg-white text-ink'
              }`}
              onClick={() => setFilterId(String(member.id))}
            >
              {surnameOf(member)}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          <div
            className="inline-grid min-w-full grid-cols-7 gap-px overflow-hidden rounded-sm border border-line bg-line"
            role="grid"
            aria-label={`${section.name}の統合候補日`}
          >
            {WEEKDAY_LABELS.map((label) => (
              <div
                key={label}
                className="bg-bg px-2 py-1.5 text-center text-xs font-semibold text-muted"
                role="columnheader"
              >
                {label}
              </div>
            ))}
            {Array.from({ length: leadPad }, (_, index) => fillerCell(`lead-${index}`))}
            {calendarDays.map((day) => {
              if (day.kind === 'off') {
                return (
                  <div
                    key={day.iso}
                    role="gridcell"
                    className={`box-border flex min-h-[4.5rem] flex-col items-center justify-center gap-1 px-1.5 py-2 text-center ${todayBorderClass(day.iso)}`}
                    style={{ backgroundColor: CELL_BG_OFF, ...todayBorderStyle(day.iso) }}
                    title={`${formatDate(day.iso)} 対象外（土日・祝日）`}
                    aria-label={`${formatDate(day.iso)} 対象外`}
                  >
                    <span className="text-lg font-bold leading-none text-[#5c5c5c]">—</span>
                  </div>
                )
              }

              const assignedEntries = day.entries.filter((entry) => entry.assigned)
              const possibleOnly = day.entries.filter((entry) => !entry.assigned)
              const open = day.entries.length > 0
              const names = (assignedEntries.length ? assignedEntries : possibleOnly).map((entry) =>
                surnameOf(entry.member),
              )
              const detail = names.join('・')
              const bg = workCellBg(day.iso, open)
              const blockedInChange = changeMode && bg === CELL_BG_BLOCKED
              const title = changeMode
                ? blockedInChange
                  ? `${formatDate(day.iso)} 調整不可（×あり）`
                  : `${formatDate(day.iso)} 調整可能`
                : open
                  ? assignedEntries.length
                    ? `${formatDate(day.iso)} 割当: ${detail}`
                    : `${formatDate(day.iso)} 候補: ${detail}`
                  : `${formatDate(day.iso)} 可能枠なし`

              const primarySlot = assignedEntries.find((entry) => entry.slot)?.slot
              const timeLabel = primarySlot
                ? `${String(primarySlot.hour).padStart(2, '0')}:00～${
                    assignedEntries.length === 1 && primarySlot.mark === 'first' ? ' ◎' : ''
                  }`
                : ''
              const adjustableInChange = changeMode && !blockedInChange
              const clickable = changeMode ? adjustableInChange : open

              if (!clickable) {
                return (
                  <div
                    key={day.iso}
                    role="gridcell"
                    className={`box-border flex min-h-[4.5rem] w-full flex-col items-center justify-center gap-1 p-0 text-center font-bold leading-none ${todayBorderClass(day.iso)}`}
                    style={{ backgroundColor: bg, ...todayBorderStyle(day.iso) }}
                    title={title}
                    aria-label={`${formatDate(day.iso)} — ${changeMode ? (blockedInChange ? '調整不可' : '調整可能') : '可能枠なし'}`}
                  >
                    <span className="text-xs text-[#8a8580]">{formatDate(day.iso)}</span>
                    <span className="text-lg font-bold leading-none text-[#8a8580]">—</span>
                  </div>
                )
              }

              return (
                <button
                  key={day.iso}
                  type="button"
                  role="gridcell"
                  className={`box-border flex min-h-[4.5rem] w-full flex-col items-center justify-center gap-1 px-1.5 py-2 text-center leading-none hover:brightness-[0.98] ${todayBorderClass(day.iso)}`}
                  style={{ backgroundColor: bg, ...todayBorderStyle(day.iso) }}
                  title={title}
                  aria-label={
                    changeMode
                      ? `${formatDate(day.iso)} 調整可能・日時変更`
                      : `${formatDate(day.iso)} ${detail}`
                  }
                  onClick={() => handleWorkCellClick(day.iso, day.entries, adjustableInChange || !changeMode)}
                >
                  <span className={`text-xs ${open ? 'text-muted' : 'text-[#8a8580]'}`}>
                    {formatDate(day.iso)}
                  </span>
                  {open ? (
                    <>
                      <span className="max-w-full truncate text-sm font-bold leading-tight text-ok">
                        {detail}
                      </span>
                      {timeLabel ? (
                        <span className="text-[10px] font-normal text-muted">{timeLabel}</span>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-sm font-semibold text-muted">日時を変更</span>
                  )}
                </button>
              )
            })}
            {Array.from({ length: trailPad }, (_, index) => fillerCell(`trail-${index}`))}
          </div>
        </div>

        <div className="flex flex-col items-end gap-1">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              className={`btn btn-ghost hover:bg-accent-soft ${
                changeMode
                  ? '!border-accent !bg-accent-soft !text-accent hover:!bg-accent-soft'
                  : 'text-ink'
              }`}
              data-testid="change-datetime"
              aria-pressed={changeMode}
              aria-busy={isChangeModal || changeSubmitting}
              disabled={confirmSubmitting || isChangeModal || changeSubmitting}
              onClick={() => setChangeMode((prev) => !prev)}
            >
              {isChangeModal || changeSubmitting ? (
                <span className="relative inline-grid place-items-center">
                  <span className="invisible col-start-1 row-start-1 whitespace-nowrap" aria-hidden="true">
                    日時の変更...
                  </span>
                  <span className="col-start-1 row-start-1 whitespace-nowrap">
                    {`日時の変更${'.'.repeat(changeBusyDots)}`}
                  </span>
                </span>
              ) : (
                '日時の変更'
              )}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              data-testid="confirm-interviews"
              disabled={assignedInView === 0 || confirmSubmitting || changeMode}
              onClick={confirmAssignedInterviews}
            >
              {confirmSubmitting
                ? '確定中…'
                : confirmedMembers.length > 0 && assignedInView === 0
                  ? '日程を確定しました'
                  : '日程を確定する'}
            </button>
          </div>
          <p className="text-xs text-muted">※確定すると各セクションのSlackへ自動通知されます</p>
        </div>
      </article>

      {modal && isChangeModal ? (
        <Modal
          title="面談日時の変更"
          onClose={() => setModal(null)}
          closeDisabled={changeSubmitting}
          footer={
            <>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setModal(null)}
                disabled={changeSubmitting}
              >
                キャンセル
              </button>
              <button
                type="button"
                className="btn btn-primary"
                data-testid="mgr-change-save-notify"
                disabled={
                  changeSubmitting ||
                  !modal.memberId ||
                  !modal.slotId ||
                  !changeModalSlots.some((slot) => slot.id === modal.slotId && !slot.booked)
                }
                onClick={saveChangeModal}
              >
                {changeSubmitting
                  ? '保存中…'
                  : changeModalTargetConfirmed
                    ? '日時確定/Slack通知'
                    : '変更を保存'}
              </button>
            </>
          }
        >
          <p className="mt-0 text-sm text-muted">
            {formatDate(modal.dayIso)}
            {modalMember
              ? ` · ${pairParty(state, modalMember.sectionId, modalMember).title}`
              : null}
          </p>
          {!changeableMembers.length ? (
            <p className="mb-0 text-sm text-muted">
              変更できる面談がありません。関係者全員が参加可能な候補日時があるか確認してください。
            </p>
          ) : (
            <>
              {changeableMembers.length > 1 ? (
                <label className="mt-3 grid gap-1.5 text-sm">
                  エンジニア
                  <select
                    value={String(modal.memberId ?? '')}
                    data-testid="mgr-change-member"
                    onChange={(event) => {
                      const nextId = Number(event.target.value)
                      const nextMember = memberById(nextId)
                      const days = nextMember
                        ? changeModeSelectableDays(
                            state,
                            nextMember,
                            startDate,
                            endDate,
                            displayAssignments,
                            busyIndex,
                          )
                        : []
                      const nextDay =
                        (modal.dayIso && days.includes(modal.dayIso) && modal.dayIso) || days[0] || modal.dayIso
                      const slots = nextMember && nextDay
                        ? changeModeDaySlots(state, nextMember, nextDay, displayAssignments, busyIndex)
                        : []
                      setModal({
                        ...modal,
                        memberId: nextId,
                        dayIso: nextDay,
                        slotId: preferSlotId(slots),
                      })
                    }}
                  >
                    {changeableMembers.map((member) => (
                      <option key={member.id} value={member.id}>
                        {surnameOf(member)}
                        {isInterviewConfirmed(state.interviews?.[member.id]) ? '（確定済）' : ''}
                      </option>
                    ))}
                  </select>
                </label>
              ) : modalMember ? (
                <p className="mt-3 mb-0 text-sm font-semibold">{surnameOf(modalMember)}さん</p>
              ) : null}

              <label className="mt-3 grid gap-1.5 text-sm">
                日付
                <select
                  value={modal.dayIso}
                  data-testid="mgr-change-date"
                  onChange={(event) => {
                    const nextDay = event.target.value
                    const slots = modalMember
                      ? changeModeDaySlots(state, modalMember, nextDay, displayAssignments, busyIndex)
                      : []
                    setModal({
                      ...modal,
                      dayIso: nextDay,
                      slotId: preferSlotId(slots),
                    })
                  }}
                >
                  {(changeModalDays.includes(modal.dayIso)
                    ? changeModalDays
                    : modal.dayIso
                      ? [modal.dayIso, ...changeModalDays]
                      : changeModalDays
                  ).map((iso) => (
                    <option key={iso} value={iso}>
                      {formatDate(iso)}
                    </option>
                  ))}
                </select>
              </label>

              <div className="mt-3 grid gap-1.5 text-sm">
                <span className="font-semibold">時間帯</span>
                {changeModalSlots.length ? (
                  <div
                    className="grid gap-1.5"
                    role="radiogroup"
                    aria-label={`${formatDate(modal.dayIso)}の調整可能時間帯`}
                    data-testid="mgr-change-slot-list"
                  >
                    {changeModalSlots.map((slot) => {
                      const selected = slot.id === modal.slotId
                      return (
                        <label
                          key={slot.id}
                          className={`flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm ${
                            slot.booked
                              ? 'cursor-not-allowed text-[#8a8580]'
                              : 'cursor-pointer text-ink'
                          }`}
                          style={{ backgroundColor: slot.booked ? CELL_BG_BLOCKED : CELL_BG_ADJUSTABLE }}
                        >
                          <input
                            type="radio"
                            className="m-0 h-auto w-auto shrink-0 p-0"
                            name="mgr-change-slot"
                            value={slot.id}
                            checked={selected}
                            disabled={slot.booked}
                            onChange={() => setModal({ ...modal, slotId: slot.id })}
                          />
                          <span className="min-w-0 flex-1">
                            {formatHmRange(slot.start, slot.end)}
                            {slot.mark === 'first' ? ' ◎' : ''}
                          </span>
                          {slot.booked ? (
                            <span className="shrink-0 text-xs font-semibold text-[#8a8580]">予約済み</span>
                          ) : null}
                        </label>
                      )
                    })}
                  </div>
                ) : (
                  <p className="m-0 text-sm text-muted">この日に選べる時間帯がありません。</p>
                )}
              </div>
            </>
          )}
        </Modal>
      ) : null}

      {modal && !isChangeModal && modalMember ? (
        <Modal
          title={`${surnameOf(modalMember)}　面談日時`}
          onClose={() => setModal(null)}
          closeDisabled={overrideSubmitting}
          footer={
            modalConfirmed ? (
              <button
                type="button"
                className="btn btn-primary"
                data-testid="candidate-confirm-assign"
                onClick={confirmModal}
              >
                閉じる
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setModal(null)}
                  disabled={overrideSubmitting}
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  data-testid="candidate-confirm-assign"
                  disabled={!modal.slotId || overrideSubmitting}
                  onClick={confirmModal}
                >
                  {overrideSubmitting ? '保存中…' : '保存'}
                </button>
              </>
            )
          }
        >
          {!modalConfirmed ? (
            <p className="mt-0 text-sm text-muted">
              {pairParty(state, modalMember.sectionId, modalMember).title}
            </p>
          ) : null}
          {!modalConfirmed && modal.entries.length > 1 ? (
            <label className="grid gap-1.5 text-sm">
              エンジニア
              <select
                value={String(modal.memberId)}
                data-testid="candidate-assign-member"
                onChange={(event) => {
                  const nextId = Number(event.target.value)
                  const open = openByMember.get(nextId) || []
                  const assigned = assignments.get(nextId)
                  const all =
                    assigned && !open.some((slot) => slot.id === assigned.id)
                      ? [assigned, ...open]
                      : open
                  const days = uniqueDaysFromSlots(all)
                  const nextDay =
                    (modal.dayIso && days.includes(modal.dayIso) && modal.dayIso) ||
                    days[0] ||
                    modal.dayIso
                  const daySlots = all.filter((slot) => slot.day === nextDay)
                  setModal({
                    ...modal,
                    memberId: nextId,
                    dayIso: nextDay,
                    slotId: preferSlotId(daySlots),
                  })
                }}
              >
                {modal.entries.map((entry) => (
                  <option key={entry.member.id} value={entry.member.id}>
                    {surnameOf(entry.member)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {modalConfirmed ? (
            <>
              <div
                className="mt-0 grid gap-2 rounded-lg border border-ok/30 bg-[#F3EFE7] px-3.5 py-3 text-sm text-ink"
                data-testid="mgr-confirmed-slot"
              >
                <div className="font-semibold">{formatDate(modal.dayIso)}</div>
                <div
                  className="grid gap-1 overflow-x-auto"
                  role="radiogroup"
                  aria-label={`${formatDate(modal.dayIso)}の確定済み面談`}
                >
                  {modalConfirmedEntries.map((entry) => {
                    const salesId =
                      entry.slot.salesId ||
                      state.interviews?.[entry.member.id]?.confirmedSalesId ||
                      null
                    const partyIds = [entry.member.sectionId]
                    if (salesId) partyIds.push(salesId)
                    if (state.hongoJoins) partyIds.push('hongo')
                    const pairLabel = [
                      ...partyIds.map((id) => VOTER_LABEL[id] || id),
                      `${surnameOf(entry.member)}`,
                    ].join(' / ')
                    return (
                      <label
                        key={`${entry.member.id}-${entry.slot.id}`}
                        className="flex cursor-pointer flex-row items-center gap-1 whitespace-nowrap rounded-md bg-[#F3EFE7] px-1 py-1 text-xs"
                      >
                        <input
                          type="radio"
                          className="m-0 h-auto w-auto shrink-0 p-0"
                          name="mgr-confirmed-interview"
                          checked={String(entry.member.id) === String(modal.memberId)}
                          onChange={() =>
                            setModal({
                              ...modal,
                              memberId: entry.member.id,
                              dayIso: entry.slot.day || modal.dayIso,
                              slotId: entry.slot.id || '',
                            })
                          }
                        />
                        <span className="whitespace-nowrap">
                          {formatHmRange(entry.slot.start, entry.slot.end)}
                        </span>
                        <span className="whitespace-nowrap">{pairLabel}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
              <div className="mt-3 grid gap-1.5 text-sm" data-testid="mgr-meet-url">
                <span className="font-semibold">Google Meet URL</span>
                {modalMeetUrl ? (
                  <a
                    href={modalMeetUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block break-all rounded-lg border border-line bg-bg px-2.5 py-2 font-mono text-sm text-accent underline-offset-2 hover:underline"
                  >
                    {modalMeetUrl}
                  </a>
                ) : (
                  <p className="m-0 text-muted">未発行</p>
                )}
              </div>
            </>
          ) : (
            <>
              <label className="mt-3 grid gap-1.5 text-sm">
                日付
                <select
                  value={modal.dayIso}
                  data-testid="candidate-assign-date"
                  onChange={(event) => {
                    const nextDay = event.target.value
                    const daySlots = modalMemberAllSlots.filter((slot) => slot.day === nextDay)
                    setModal({
                      ...modal,
                      dayIso: nextDay,
                      slotId: preferSlotId(daySlots),
                    })
                  }}
                >
                  {(modalAssignableDays.includes(modal.dayIso)
                    ? modalAssignableDays
                    : modal.dayIso
                      ? [modal.dayIso, ...modalAssignableDays]
                      : modalAssignableDays
                  ).map((iso) => (
                    <option key={iso} value={iso}>
                      {formatDate(iso)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="mt-3 grid gap-1.5 text-sm">
                時間帯（◎優先・早い時刻順）
                <select
                  value={modal.slotId}
                  data-testid="candidate-assign-slot"
                  onChange={(event) => setModal({ ...modal, slotId: event.target.value })}
                >
                  {modalSlots.map((slot) => (
                    <option key={slot.id} value={slot.id}>
                      {formatHmRange(slot.start, slot.end)}
                      {slot.mark === 'first' ? ' ◎' : ''}
                    </option>
                  ))}
                </select>
              </label>
              {modalHasFirstMark ? (
                <p className="mb-0 text-sm text-muted">
                  ※ ◎ は {surnameOf(modalMember)}さんの希望時間
                </p>
              ) : null}
            </>
          )}
        </Modal>
      ) : null}
    </>
  )
}
