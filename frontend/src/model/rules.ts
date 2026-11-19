import { localSalesFallback } from './localSeedData'
import { getRegistryMembers } from './membersRegistry'

export const MIN_SLOTS = 10

export const STATUS = {
  unadjusted: '未調整',
  adjusting: '調整中',
  confirmed: '確定済み',
  change_requested: '変更依頼あり',
}

export const SALES_IDS = ['salesA', 'salesB']

/** role=sales のメンバーを ID 昇順（OpenAPI の salesA → salesB に対応） */
export function salesRoleMembers() {
  return getRegistryMembers()
    .filter((m) => (m.role || '') === 'sales' && !m.isDeleted)
    .sort((a, b) => Number(a.id) - Number(b.id))
}

/** 本番は汎用ラベル。実名はレジストリ（API）優先 */
const SALES_LABEL_FALLBACK: Record<string, string> = { ...localSalesFallback }

/** 営業スロット ID → 表示名（DB の営業メンバーから動的） */
export function salesLabelOf(salesId: string): string {
  const sales = salesRoleMembers()
  const idx = SALES_IDS.indexOf(salesId)
  if (idx >= 0 && sales[idx]) {
    return sales[idx].surname || sales[idx].name || SALES_LABEL_FALLBACK[salesId] || salesId
  }
  return SALES_LABEL_FALLBACK[salesId] || salesId
}

/** 営業メンバー名を「・」連結（セクション表示用） */
export function salesNamesJoined(separator = '・'): string {
  const names = salesRoleMembers()
    .map((m) => m.surname || m.name)
    .filter(Boolean)
  if (names.length) return names.join(separator)
  return SALES_IDS.map((id) => SALES_LABEL_FALLBACK[id]).join(separator)
}

/** 既存の SALES_LABEL[id] アクセスを動的解決に橋渡し */
export const SALES_LABEL = new Proxy({} as Record<string, string>, {
  get(_target, prop: string | symbol) {
    if (typeof prop !== 'string') return undefined
    return salesLabelOf(prop)
  },
  has(_target, prop: string | symbol) {
    return typeof prop === 'string' && SALES_IDS.includes(prop)
  },
  ownKeys() {
    return [...SALES_IDS]
  },
  getOwnPropertyDescriptor(_target, prop: string | symbol) {
    if (typeof prop !== 'string' || !SALES_IDS.includes(prop)) return undefined
    return { configurable: true, enumerable: true, value: salesLabelOf(prop) }
  },
})

export const MARK_SYMBOL = {
  first: '◎',
  ok: '〇',
  ng: '×',
}

export const MARK_LABEL = {
  first: '強い希望',
  ok: '調整OK',
  ng: '不可',
}

/** エンジニアに紐付いた担当営業（salesA / salesB のどちらか1名） */
export function assignedSalesId(state, memberId) {
  const id = state.salesAssignee?.[memberId]
  return SALES_IDS.includes(id) ? id : null
}

function dayAndHourFromSlot(slotOrId) {
  if (slotOrId && typeof slotOrId === 'object') {
    const day = slotOrId.day || (slotOrId.start ? String(slotOrId.start).slice(0, 10) : null)
    const hour = slotOrId.start ? Number(String(slotOrId.start).slice(11, 13)) : null
    return { day, hour }
  }
  const parts = String(slotOrId || '').split('-')
  if (parts.length < 5) return { day: null, hour: null }
  return {
    day: parts.slice(1, 4).join('-'),
    hour: Number(parts[4]),
  }
}

/** 担当営業がその枠に入れるか（日・時間の空き） */
export function salesCanTakeSlot(state, salesId, slotOrId) {
  if (!SALES_IDS.includes(salesId)) return false
  const { day, hour } = dayAndHourFromSlot(slotOrId)
  if (!day) return false
  if (state.dayVotes?.[salesId]?.[day] === 'ng') return false
  const hours = state.hourVotes?.[salesId]?.[day]
  if (Array.isArray(hours) && Number.isFinite(hour) && !hours.includes(hour)) return false
  return true
}

/** 担当営業が参加可能な枠の営業ID一覧（担当未設定なら空） */
export function salesOfferedOk(state, memberId, slotOrId) {
  const salesId = assignedSalesId(state, memberId)
  if (!salesId) return []
  return salesCanTakeSlot(state, salesId, slotOrId) ? [salesId] : []
}

export function hasAnySalesOffer(state, memberId) {
  return Boolean(assignedSalesId(state, memberId))
}

export function countSalesOffers(state, memberId) {
  const salesId = assignedSalesId(state, memberId)
  if (!salesId) return 0
  const slots = state.slots || []
  return slots.filter((slot) => salesOfferedOk(state, memberId, slot).length > 0).length
}

/**
 * 画面表示用の進捗ステータス。
 * hasSlots / hasSalesOffer は呼び出し側で渡す。
 */
export function progressStatus(interview, { hasSlots = false, hasSalesOffer = false } = {}) {
  if (!interview) return { key: 'unadjusted', label: '未調整' }
  if (interview.status === 'confirmed') return { key: 'confirmed', label: '確定済み' }
  if (interview.status === 'change_requested') return { key: 'change_requested', label: '変更依頼あり' }
  if (interview.status === 'adjusting' && hasSalesOffer) {
    return { key: 'awaiting_engineer', label: '回答待ち' }
  }
  if (hasSalesOffer) return { key: 'sales_set', label: '営業担当設定済み' }
  if (hasSlots) return { key: 'awaiting_sales', label: '営業担当設定待ち' }
  if (interview.status === 'adjusting') return { key: 'adjusting', label: '調整中' }
  return { key: 'unadjusted', label: '未調整' }
}

export function statusDetail(interview, context = {}) {
  return progressStatus(interview, context).label
}

export function statusTone(interview, context = {}) {
  return progressStatus(interview, context).key
}

export function validateVotes(votes, slots) {
  const marks = slots.map((slot) => votes?.[slot.id] || null)
  const first = marks.filter((mark) => mark === 'first').length
  const ng = marks.filter((mark) => mark === 'ng').length
  /** 旧「〇」と未設定は、エンジニア UI 上は空白（調整可能）として数える */
  const blank = marks.filter((mark) => !mark || mark === 'ok').length
  const ok = 0
  const unanswered = blank
  const errors = []
  return { valid: errors.length === 0, errors, first, ok, ng, blank, unanswered }
}

export function slotTakenBy(state, slotId, exceptMemberId) {
  for (const [id, interview] of Object.entries(state.interviews)) {
    if (id === exceptMemberId) continue
    if (interview.status !== 'confirmed' && interview.status !== 'change_requested') continue
    if (interview.confirmedSlotId === slotId) return id
  }
  return null
}

export function isLocked(interview) {
  return interview?.status === 'confirmed' || interview?.status === 'change_requested'
}
