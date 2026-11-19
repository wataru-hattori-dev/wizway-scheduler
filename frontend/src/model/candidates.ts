import { businessDays, HOURS, slotBounds } from './calendar'
import { localVoterLabels } from './localSeedData'
import { salesLabelOf } from './rules'

/** 本番では空で始まり、API 水和（applySectionsFromApi）で氏名を復元 */
const VOTER_LABEL_STATIC: Record<string, string> = { ...localVoterLabels }

/** salesA/salesB は DB の営業メンバー名を動的参照 */
export const VOTER_LABEL = new Proxy(VOTER_LABEL_STATIC, {
  get(target, prop: string | symbol) {
    if (prop === 'salesA' || prop === 'salesB') return salesLabelOf(prop)
    if (typeof prop === 'string') return target[prop]
    return undefined
  },
})

/** セクション Mgr / 本郷の表示名を API 結果で上書き */
export function setVoterLabels(patch: Record<string, string>) {
  Object.assign(VOTER_LABEL_STATIC, patch)
}

export const PARTY_VOTERS = [
  'salesA',
  'salesB',
  'hongo',
  'meguro',
  'yamamoto',
  'ishibashi',
  'tanaka',
  'hamada',
]

/** セクション候補枠の前提参加者（営業は担当割当で別管理。同時2名は入らない） */
export function partyIdsFor(sectionId, hongoJoins) {
  return hongoJoins ? ['hongo', sectionId] : [sectionId]
}

export function blockingVoters(dayVotes, voterIds, day) {
  return voterIds.filter((id) => dayVotes?.[id]?.[day] === 'ng')
}

export function candidateDays(state, sectionId) {
  const voters = partyIdsFor(sectionId, state.hongoJoins)
  return businessDays().map((day) => {
    const blocking = blockingVoters(state.dayVotes, voters, day.iso)
    const open = blocking.length === 0
    return {
      ...day,
      open,
      blocking,
    }
  })
}

export function availableHours(state, voterIds, dayIso) {
  let selected = HOURS.map((hour) => hour.hour)
  for (const id of voterIds) {
    const picked = state.hourVotes?.[id]?.[dayIso]
    if (!Array.isArray(picked)) continue
    selected = selected.filter((hour) => picked.includes(hour))
  }
  return HOURS.filter((hour) => selected.includes(hour.hour))
}

export function candidateSlots(state, sectionId) {
  const voters = partyIdsFor(sectionId, state.hongoJoins)
  const slots = []
  for (const day of candidateDays(state, sectionId)) {
    if (!day.open) continue
    for (const hour of availableHours(state, voters, day.iso)) {
      const bounds = slotBounds(day.iso, hour.hour)
      slots.push({
        id: `${sectionId}-${day.iso}-${String(hour.hour).padStart(2, '0')}`,
        sectionId,
        day: day.iso,
        avoided: hour.avoided,
        ...bounds,
      })
    }
  }
  slots.sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
  return slots
}

/** 営業のどちらか1名以上が入れる日（本郷参加時はその空きも必須） */
export function sharedOpenDays(state) {
  return businessDays().filter((day) => {
    if (state.hongoJoins && state.dayVotes?.hongo?.[day.iso] === 'ng') return false
    const aNg = state.dayVotes?.salesA?.[day.iso] === 'ng'
    const bNg = state.dayVotes?.salesB?.[day.iso] === 'ng'
    return !(aNg && bNg)
  })
}

export function allCandidateSlots(state, sectionIds) {
  return sectionIds.flatMap((sectionId) => candidateSlots(state, sectionId))
}
