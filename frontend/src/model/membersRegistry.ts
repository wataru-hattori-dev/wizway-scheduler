import {
  isHiddenFromUi,
  MEMBER_MASTER,
  SECTION_DISPLAY_NAMES,
  type MemberRole,
} from './membersMaster'

export type RegistryMember = {
  id: number
  surname: string
  sectionId: string
  name: string
  role?: MemberRole | string
  isInterviewer?: boolean
  isDeleted?: boolean
}

function sectionName(sectionId: string) {
  if (!sectionId || sectionId === 'unset') return ''
  return SECTION_DISPLAY_NAMES[sectionId] || sectionId
}

function displayName(surname: string, sectionId: string) {
  if (!sectionId || sectionId === 'unset') return surname
  return `${sectionName(sectionId)}-${surname}`
}

function fromMaster(): RegistryMember[] {
  return MEMBER_MASTER.filter((m) => !m.isDeleted).map((member) => ({
    id: member.id,
    surname: member.surname,
    sectionId: member.sectionId,
    name: displayName(member.surname, member.sectionId),
    role: member.role,
    isInterviewer: member.isInterviewer,
    isDeleted: false,
  }))
}

let members: RegistryMember[] = fromMaster()

export function setRegistryMembers(list: RegistryMember[]) {
  members = (list || []).map((m) => ({
    id: Number(m.id),
    surname: m.surname,
    sectionId: m.sectionId || 'unset',
    name:
      m.name ||
      displayName(m.surname, m.sectionId || 'unset'),
    role: m.role || 'engineer',
    isInterviewer: m.isInterviewer !== false,
    isDeleted: Boolean(m.isDeleted),
  }))
}

/** DB 同期用（非表示枠を含む生データ）。画面表示には getRegistryMembers を使う */
export function getRawRegistryMembers(includeDeleted = false): RegistryMember[] {
  return includeDeleted ? [...members] : members.filter((m) => !m.isDeleted)
}

export function getRegistryMembers(includeDeleted = false): RegistryMember[] {
  // UI_HIDDEN_MEMBER_IDS（id=1）は DB 保持のみ。画面向け一覧からは常に除外
  return getRawRegistryMembers(includeDeleted).filter((m) => !isHiddenFromUi(m))
}

export function registryMemberById(id: number | string) {
  const n = Number(id)
  const found = members.find((m) => m.id === n || String(m.id) === String(id))
  if (!found || isHiddenFromUi(found)) return undefined
  return found
}

export function registryMembersOf(sectionId: string) {
  return getRegistryMembers().filter((m) => m.sectionId === sectionId)
}

/** 日程調整対象（面談フラグ true） */
export function registryInterviewMembers(sectionId?: string) {
  return getRegistryMembers().filter((m) => {
    if (m.isInterviewer === false) return false
    if (sectionId != null) return m.sectionId === sectionId
    return true
  })
}
