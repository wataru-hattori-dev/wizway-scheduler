/**
 * 社員マスタ（型・ヘルパー・表示用メタ）。
 * 実名データ本体は `localSeedData.ts`（VITE_USE_API=false のみバンドル残存）。
 * 本番（API 接続）では認証後の `/members` / `/sections` から名簿・セクション名を復元する。
 *
 * 画面アクセス権限（Slack OAuth）はメンバー個別の Slack ID 登録ではなく、
 * backend 環境変数で管理する:
 * - SLACK_ADMIN_USER_IDS … 管理者マスター → 全画面
 * - SLACK_MGR_USER_IDS … Mgr + 本郷 → /mgr のみ
 * - それ以外の社内 team_id 一致 → /engineer
 */
import {
  localMemberMaster,
  localSectionDisplayNames,
} from './localSeedData'

export type MemberRole = 'engineer' | 'mgr' | 'sales' | 'hongo' | 'other'

export type MemberMasterRecord = {
  id: number
  surname: string
  sectionId: string
  role: MemberRole
  isInterviewer: boolean
  isDeleted: boolean
}

/** 画面上に出さないメンバー ID（社長枠・DB 保持用） */
export const UI_HIDDEN_MEMBER_IDS = new Set<number>([1])

export function isHiddenFromUi(member: { id: number | string }) {
  return UI_HIDDEN_MEMBER_IDS.has(Number(member.id))
}

export function isGeneralEngineer(member: { role?: string }) {
  return (member.role || 'engineer') === 'engineer'
}

/** セクション ID → 表示名（API 水和で更新される可変オブジェクト） */
export const SECTION_DISPLAY_NAMES: Record<string, string> = {
  ...localSectionDisplayNames,
}

export function setSectionDisplayNames(next: Record<string, string>) {
  for (const key of Object.keys(SECTION_DISPLAY_NAMES)) {
    delete SECTION_DISPLAY_NAMES[key]
  }
  Object.assign(SECTION_DISPLAY_NAMES, next)
}

export const MEMBER_ROLE_LABELS: Record<MemberRole, string> = {
  engineer: 'エンジニア',
  mgr: 'Mgr',
  sales: '営業',
  hongo: '本郷',
  other: '社長（その他）',
}

/**
 * 静的マスタ。本番 API モードでは空（実名はバンドルに含めない）。
 * ローカルモック（VITE_USE_API=false）のみ初期名簿が入る。
 */
export const MEMBER_MASTER: MemberMasterRecord[] = localMemberMaster

export function nextEmployeeId(members: { id: number | string }[]) {
  let max = 0
  for (const member of members) {
    const n = Number(member.id)
    if (Number.isFinite(n) && n > max) max = n
  }
  return max + 1
}
