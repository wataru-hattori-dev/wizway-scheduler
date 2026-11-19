/**
 * 期限到来時の自動判定。
 * 1. 回答済みの ◎ は先着順。空いており、担当（〇）した営業が1名空いていれば第一希望で確定する。
 * 2. ◎ を取れなかった人は、10:00開始を避けたうえで早い順に空いている自分の 〇 へスライドする。
 * 3. 未回答は、期限到来処理のときだけ残枠からランダムに割り当てる。
 * 営業は必ずどちらか1名のみ。同じ時刻に同じ営業は重複しない。
 * 確定済み・変更依頼ありの枠は埋まりとして扱い、未調整（依頼前）は対象外。
 */
import { SALES_IDS, SALES_LABEL } from './rules'

function hourOf(start) {
  return Number(String(start).slice(11, 13))
}

function byOpenPreference(a, b) {
  const avoid = (hourOf(a.start) === 10 ? 1 : 0) - (hourOf(b.start) === 10 ? 1 : 0)
  if (avoid !== 0) return avoid
  return Date.parse(a.start) - Date.parse(b.start)
}

function offeredSales(salesOffers, memberId, slotId) {
  if (!salesOffers) return [...SALES_IDS]
  const entry = salesOffers[memberId]?.[slotId]
  if (!entry) return []
  if (Array.isArray(entry)) return entry.filter((id) => SALES_IDS.includes(id))
  return SALES_IDS.filter((id) => entry[id] === 'ok')
}

function pickSales(candidates, start, busy) {
  return candidates.find((salesId) => !busy[salesId]?.has(start)) || null
}

export function assignSection({
  slots,
  members,
  assignUnanswered,
  blockedStarts = [],
  salesBusy = {},
  salesOffers = null,
}) {
  const ordered = [...slots].sort(byOpenPreference)
  const takenIds = new Set()
  const takenStarts = new Set(blockedStarts)
  const locked = new Set()
  const busy = {
    salesA: new Set(salesBusy.salesA || []),
    salesB: new Set(salesBusy.salesB || []),
  }

  const isFree = (slot) => !takenIds.has(slot.id) && !takenStarts.has(slot.start)
  const take = (slot, salesId) => {
    takenIds.add(slot.id)
    takenStarts.add(slot.start)
    busy[salesId].add(slot.start)
  }

  for (const member of members) {
    const lockedStatus = member.status === 'confirmed' || member.status === 'change_requested'
    if (lockedStatus && member.confirmedSlotId) {
      takenIds.add(member.confirmedSlotId)
      const held = ordered.find((slot) => slot.id === member.confirmedSlotId)
      if (held) {
        takenStarts.add(held.start)
        const salesId = member.confirmedSalesId || 'salesA'
        busy[salesId]?.add(held.start)
      }
      locked.add(member.id)
    }
  }

  const open = members.filter((member) => !locked.has(member.id) && member.status !== 'unadjusted')
  const submitted = open
    .filter((member) => member.submittedAt)
    .sort((a, b) => {
      const delta = Date.parse(a.submittedAt) - Date.parse(b.submittedAt)
      if (delta !== 0) return delta
      return a.id.localeCompare(b.id)
    })

  const assignments = []
  const manual = []
  const assigned = new Set()

  const tryAssign = (member, slot, reasonBase) => {
    const salesId = pickSales(offeredSales(salesOffers, member.id, slot.id), slot.start, busy)
    if (!salesId || !isFree(slot)) return false
    take(slot, salesId)
    assigned.add(member.id)
    assignments.push({
      memberId: member.id,
      slotId: slot.id,
      salesId,
      reason: `${reasonBase}（${SALES_LABEL[salesId]}担当）`,
    })
    return true
  }

  for (const member of submitted) {
    const votes = member.votes || {}
    const first = ordered.find((slot) => votes[slot.id] === 'first')
    if (first) tryAssign(member, first, '第一希望で確定')
  }

  for (const member of submitted) {
    if (assigned.has(member.id)) continue
    const votes = member.votes || {}
    // 空白（未投票）は UI 上の「調整可能」扱い（〇 廃止）。× 以外を候補にする。
    const fallback = ordered.find((slot) => votes[slot.id] !== 'ng' && isFree(slot)
      && pickSales(offeredSales(salesOffers, member.id, slot.id), slot.start, busy))
    if (fallback && tryAssign(member, fallback, '調整可能枠へスライド（先着順）')) continue
    manual.push({
      memberId: member.id,
      reason: '空いている調整可能枠と担当可能な営業がいないため、手動割り当てが必要です',
    })
  }

  if (assignUnanswered) {
    const waiting = open.filter((member) => !member.submittedAt)
    const pool = ordered.filter((slot) => isFree(slot))
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[pool[i], pool[j]] = [pool[j], pool[i]]
    }
    for (const member of waiting) {
      let placed = false
      for (let i = 0; i < pool.length; i += 1) {
        const slot = pool[i]
        if (tryAssign(member, slot, '未回答のため残枠からランダム割当')) {
          pool.splice(i, 1)
          placed = true
          break
        }
      }
      if (!placed) {
        manual.push({ memberId: member.id, reason: '残枠または担当可能な営業がないため、手動割り当てが必要です' })
      }
    }
  }

  return { assignments, manual, takenStarts: [...takenStarts] }
}
