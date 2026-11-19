import type { ReactNode } from 'react'
import { confirmedWindow, formatRange } from '../model/format'
import { useInterviewPeriod } from '../model/interviewPeriod'
import {
  formatDateSlash,
  useResponseDeadlines,
} from '../model/responseDeadlines'
import { isGeneralEngineer } from '../model/membersMaster'
import { interviewMembersOf } from '../model/seed'
import { useApp } from '../model/store'
import { useSystemDate } from '../model/systemDate'

/** YYYY-MM-DD まであと何日か（JST・同日は 0）。未設定は null */
function calendarDaysUntil(deadlineYmd: string, nowMs: number): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deadlineYmd)) return null
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(nowMs))
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '00'
  const todayYmd = `${get('year')}-${get('month')}-${get('day')}`
  const todayMs = Date.parse(`${todayYmd}T00:00:00+09:00`)
  const deadlineMs = Date.parse(`${deadlineYmd}T00:00:00+09:00`)
  if (Number.isNaN(todayMs) || Number.isNaN(deadlineMs)) return null
  return Math.round((deadlineMs - todayMs) / (24 * 60 * 60 * 1000))
}

function remainingLabel(days: number | null): string {
  if (days === null) return '未設定'
  if (days > 0) return `残り ${days} 日`
  if (days === 0) return '本日締切'
  return `以降も変更可`
}

function PanelShell({
  label,
  children,
  testId,
}: {
  label: string
  children: ReactNode
  testId?: string
}) {
  return (
    <div className="grid gap-1.5" data-testid={testId}>
      <p className="text-xs text-[#d5cdc0]">{label}</p>
      <div className="rounded-xl bg-white/5 px-3 py-2.5 text-sm leading-snug">{children}</div>
    </div>
  )
}

/** 面談対象期間の概要 */
export function SidebarInterviewPeriod() {
  const { startDate, endDate } = useInterviewPeriod()
  return (
    <PanelShell label="面談実施期間" testId="sidebar-interview-period">
      <p>
        {formatDateSlash(startDate)}
        <span className="mx-1 text-[#d5cdc0]">〜</span>
        {formatDateSlash(endDate)}
      </p>
    </PanelShell>
  )
}

/** ロールに応じた回答期限と残日数 */
export function SidebarDeadlines() {
  const { role, view } = useApp()
  const { nowMs } = useSystemDate()
  const { mgrSalesDeadline, engineerDeadline } = useResponseDeadlines()

  const showMgrSales = view === 'home' || role === 'admin' || role === 'manager' || role === 'sales'
  const showEngineer = view === 'home' || role === 'admin' || role === 'engineer'

  const mgrDays = calendarDaysUntil(mgrSalesDeadline, nowMs)
  const engDays = calendarDaysUntil(engineerDeadline, nowMs)

  return (
    <PanelShell label="回答期限" testId="sidebar-deadlines">
      <ul className="m-0 grid list-none gap-2 p-0">
        {showMgrSales ? (
          <li>
            <span className="mr-2">Mgr/営業</span>
            {mgrSalesDeadline ? (
              <>
                {formatDateSlash(mgrSalesDeadline)}
                <span className="ml-2 text-xs text-[#d5cdc0]">{remainingLabel(mgrDays)}</span>
              </>
            ) : (
              <span className="text-[#d5cdc0]">未設定</span>
            )}
          </li>
        ) : null}
        {showEngineer ? (
          <li>
            <span className="mr-2">エンジニア</span>
            {engineerDeadline ? (
              <>
                {formatDateSlash(engineerDeadline)}
                <span className="ml-2 text-xs text-[#d5cdc0]">{remainingLabel(engDays)}</span>
              </>
            ) : (
              <span className="text-[#d5cdc0]">未設定</span>
            )}
          </li>
        ) : null}
      </ul>
    </PanelShell>
  )
}

/** いまの自分／担当まわりの回答・確定ステータス */
export function SidebarMyStatus() {
  const app = useApp()
  const { view, role, state, activeMemberId, activeSectionId, activeSalesId } = app

  if (view === 'home') {
    return (
      <PanelShell label="いまの状況" testId="sidebar-my-status">
        <p className="text-[#d5cdc0]">案内ページです。ロールを選ぶと進捗が表示されます。</p>
      </PanelShell>
    )
  }

  if (role === 'engineer') {
    const interview = state.interviews[activeMemberId]
    // サイドバーは面談確定の有無のみで表示（回答済み等は出さない）
    const label =
      interview?.status === 'confirmed'
        ? '確定済み'
        : interview?.status === 'change_requested'
          ? '変更依頼あり'
          : '未確定'
    const confirmed = confirmedWindow(interview, state.slots)
    return (
      <PanelShell label="自分のステータス" testId="sidebar-my-status">
        <p>{label}</p>
        {confirmed ? (
          <small className="mt-1 block text-xs text-[#d5cdc0]">{formatRange(confirmed.start, confirmed.end)}</small>
        ) : null}
      </PanelShell>
    )
  }

  if (role === 'manager') {
    // 分母・分子ともセクション内の一般エンジニアのみ（Mgr / 営業 / 本郷 等は含めない）
    const engineers = interviewMembersOf(activeSectionId).filter((member) => isGeneralEngineer(member))
    const confirmedCount = engineers.filter((member) => {
      const status = state.interviews[member.id]?.status
      return status === 'confirmed' || status === 'change_requested'
    }).length
    return (
      <PanelShell label="セクション進捗" testId="sidebar-my-status">
        <p className="mt-1">
          確定 {confirmedCount}/{engineers.length || 0}
        </p>
      </PanelShell>
    )
  }

  if (role === 'sales') {
    const assignedMemberIds = Object.entries(state.salesAssignee || {})
      .filter(([, id]) => id === activeSalesId)
      .map(([memberId]) => Number(memberId))
    const assignedCount = assignedMemberIds.length
    const confirmedCount = assignedMemberIds.filter((memberId) => {
      const status = state.interviews[memberId]?.status
      return status === 'confirmed' || status === 'change_requested'
    }).length
    return (
      <PanelShell label="自分のステータス" testId="sidebar-my-status">
        <p>担当エンジニア {assignedCount} 名</p>
        <p className="mt-1">
          確定 {confirmedCount}/{assignedCount}
        </p>
      </PanelShell>
    )
  }

  if (role === 'admin') {
    // 分母・分子とも一般エンジニアのみ（Mgr / 営業 / 本郷 / 社長は含めない）
    const engineers = interviewMembersOf().filter((member) => isGeneralEngineer(member))
    const confirmedCount = engineers.filter((member) => {
      const status = state.interviews[member.id]?.status
      return status === 'confirmed' || status === 'change_requested'
    }).length
    return (
      <PanelShell label="全体の状況" testId="sidebar-my-status">
        <p>
          確定 {confirmedCount}/{engineers.length || 0}
        </p>
      </PanelShell>
    )
  }

  return null
}
