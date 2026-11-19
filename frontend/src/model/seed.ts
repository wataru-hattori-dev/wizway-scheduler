import { isHiddenFromUi, MEMBER_MASTER, SECTION_DISPLAY_NAMES, setSectionDisplayNames } from './membersMaster'
import { localSections } from './localSeedData'
import { setVoterLabels } from './candidates'
import {
  getRegistryMembers,
  registryInterviewMembers,
  registryMemberById,
  registryMembersOf,
  setRegistryMembers,
} from './membersRegistry'
import { salesNamesJoined } from './rules'

export type SectionRecord = {
  id: string
  name: string
  mgr: string
  sales: string
}

/** セクション一覧（API 水和で name/mgr/sales を更新。参照は維持） */
export const SECTIONS: SectionRecord[] = localSections.map((s) => ({ ...s }))

const DEFAULT_SALES_LABEL = salesNamesJoined()
for (const section of SECTIONS) {
  if (!section.sales) section.sales = DEFAULT_SALES_LABEL
}

export const SECTION_HEADCOUNT = 6

function sectionName(sectionId: string) {
  return (
    SECTION_DISPLAY_NAMES[sectionId] ||
    SECTIONS.find((section) => section.id === sectionId)?.name ||
    sectionId
  )
}

function displayName(surname: string, sectionId: string) {
  if (!sectionId || sectionId === 'unset') return surname
  return `${sectionName(sectionId)}-${surname}`
}

/** API `/sections` の結果で表示名を復元（ログイン後の UI を維持） */
export function applySectionsFromApi(
  sections: Array<{ id: string; name?: string; mgr?: string; sales?: string }>,
) {
  const display: Record<string, string> = { ...SECTION_DISPLAY_NAMES }
  const voterPatch: Record<string, string> = {}
  for (const section of SECTIONS) {
    const hit = sections.find((s) => s.id === section.id)
    if (!hit) continue
    if (hit.name) {
      section.name = hit.name
      display[section.id] = hit.name
    }
    if (hit.mgr) {
      section.mgr = hit.mgr
      voterPatch[section.id] = hit.mgr
    }
    if (hit.sales) section.sales = hit.sales
  }
  setSectionDisplayNames(display)

  const hongo = getRegistryMembers(true).find((m) => m.role === 'hongo')
  if (hongo?.surname) voterPatch.hongo = hongo.surname
  if (Object.keys(voterPatch).length) setVoterLabels(voterPatch)

  const salesLabel = salesNamesJoined()
  for (const section of SECTIONS) {
    section.sales = salesLabel
  }
}

/** 初期シード（レジストリ未更新時のフォールバック） */
const SEED_MEMBERS = MEMBER_MASTER.filter((member) => !member.isDeleted && !isHiddenFromUi(member)).map(
  (member) => ({
    id: member.id,
    name: displayName(member.surname, member.sectionId),
    surname: member.surname,
    sectionId: member.sectionId,
    isDeleted: false,
    role: member.role,
    isInterviewer: member.isInterviewer,
  }),
)

setRegistryMembers(
  MEMBER_MASTER.filter((member) => !member.isDeleted).map((member) => ({
    id: member.id,
    name: displayName(member.surname, member.sectionId),
    surname: member.surname,
    sectionId: member.sectionId,
    isDeleted: false,
    role: member.role,
    isInterviewer: member.isInterviewer,
  })),
)

/** アクティブな社員（画面表示用。非表示 ID は含まない） */
export const MEMBERS = SEED_MEMBERS

/** デモ用: 先頭の表示可能エンジニア */
export const DEMO_MEMBER_ID =
  SEED_MEMBERS.find((member) => member.role === 'engineer')?.id ??
  SEED_MEMBERS[0]?.id ??
  2

export function sectionById(id) {
  return SECTIONS.find((section) => section.id === id)
}

export function memberById(id) {
  return registryMemberById(id) || SEED_MEMBERS.find((m) => m.id === Number(id))
}

export function membersOf(sectionId) {
  const live = registryMembersOf(sectionId)
  return live.length ? live : SEED_MEMBERS.filter((member) => member.sectionId === sectionId)
}

export function allActiveMembers() {
  const live = getRegistryMembers()
  return live.length ? live : SEED_MEMBERS
}

/** 面談候補（isInterviewer=true） */
export function interviewMembersOf(sectionId?: string) {
  const live = registryInterviewMembers(sectionId)
  if (live.length) return live
  return SEED_MEMBERS.filter((member) => {
    if (member.isInterviewer === false) return false
    if (sectionId != null) return member.sectionId === sectionId
    return true
  })
}

export { setRegistryMembers }

function interview(partial = {}) {
  return {
    status: 'unadjusted',
    submittedAt: null,
    confirmedSlotId: null,
    confirmedSalesId: null,
    confirmedOverride: null,
    assignReason: null,
    meetingUrl: null,
    pendingNote: null,
    remindedAt: null,
    changeRequest: null,
    ...partial,
    preferences: {
      difficultDates: [],
      preferredTimeNote: '',
      note: '',
      ...(partial.preferences || {}),
    },
  }
}

function dayKey(day) {
  return `2026-12-${String(day).padStart(2, '0')}`
}

function markDays(days, mark) {
  return Object.fromEntries(days.map((day) => [dayKey(day), mark]))
}

export function createDayVotes() {
  return {
    salesA: markDays([2, 17], 'ng'),
    salesB: markDays([3, 10], 'ng'),
    hongo: markDays([3, 15], 'ng'),
    meguro: { ...markDays([1, 9, 17], 'ng'), ...markDays([2, 10], 'ok') },
    yamamoto: { ...markDays([2, 10, 18], 'ng'), ...markDays([11], 'ok') },
    ishibashi: { ...markDays([3, 11, 14], 'ng'), ...markDays([4, 16], 'ok') },
    tanaka: { ...markDays([2, 14], 'ng'), ...markDays([8, 9, 15], 'ok') },
    hamada: markDays([7, 15, 17], 'ng'),
  }
}

/** エンジニアごとの担当営業（セクション内の並び 0,3 → salesA / それ以外 → salesB） */
function createSalesAssignee() {
  const assignee = {}
  const bySection = {}
  for (const member of interviewMembersOf()) {
    if (!bySection[member.sectionId]) bySection[member.sectionId] = []
    bySection[member.sectionId].push(member)
  }
  for (const list of Object.values(bySection)) {
    list.sort((a, b) => a.id - b.id)
    list.forEach((member, index) => {
      assignee[member.id] = index === 0 || index === 3 ? 'salesA' : 'salesB'
    })
  }
  return assignee
}

export function createInitialState() {
  const interviews = {}
  const votes = {}
  for (const member of interviewMembersOf()) {
    interviews[member.id] = interview()
    votes[member.id] = {}
  }

  const seedBody = `各セクションの候補日枠と、${salesNamesJoined()}の担当（〇）設定を取り込みました。\n面談は営業のどちらか1名が担当します（同時2名は入りません）。\nエンジニアは担当営業が参加可能な枠だけに優先度を投票します。\n面談は1人1時間、期間内に終了します。`

  return {
    version: 6,
    quarterLabel: '2026年12月 三者面談',
    hongoJoins: true,
    provider: 'meet',
    deadlines: Object.fromEntries(SECTIONS.map((section) => [section.id, '2026-11-27T18:00:00+09:00'])),
    judgedAt: Object.fromEntries(SECTIONS.map((section) => [section.id, null])),
    dayVotes: createDayVotes(),
    hourVotes: {},
    votes,
    interviews,
    /** Mgrカレンダーモーダル「保存」による確定前の手動割当 { [memberId]: slotId } */
    assignmentOverrides: {},
    salesAssignee: createSalesAssignee(),
    salesOffers: { salesA: {}, salesB: {} },
    notifications: [
      {
        id: 'n-seed',
        at: '2026-10-26T10:00:00+09:00',
        channel: '#面談-全体',
        body: seedBody,
      },
    ],
  }
}
