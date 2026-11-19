import { api, type Interview, type Member } from './client'
import { setBootstrapCache } from './bootstrapCache'
import { PARTY_VOTERS } from '../model/candidates'
import { applySectionsFromApi, SECTIONS } from '../model/seed'

export type BootstrapResult = {
  state: any
  members: Member[]
  sections: Array<{ id: string; name?: string; mgr?: string; sales?: string }>
  interviewPeriod: { startDate: string; endDate: string }
  responseDeadlines: { mgrSalesDeadline: string; engineerDeadline: string }
}

function emptyInterview() {
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
    preferences: { difficultDates: [], preferredTimeNote: '', note: '' },
  }
}

export async function fetchBootstrap(): Promise<BootstrapResult> {
  const [
    settings,
    interviewPeriod,
    responseDeadlines,
    membersRes,
    interviewsRes,
    salesAssignees,
    notificationsRes,
    sectionsRes,
  ] = await Promise.all([
    api.get<{ quarterLabel: string; hongoJoins: boolean; provider: string }>('/settings'),
    api.get<{ startDate: string; endDate: string }>('/interview-period'),
    api.get<{ mgrSalesDeadline: string; engineerDeadline: string }>('/response-deadlines'),
    api.get<{ members: Member[] }>('/members?includeDeleted=true'),
    api.get<{ interviews: Interview[] }>('/interviews'),
    api.get<Record<string, string>>('/sales-assignees'),
    api.get<{ notifications: Array<{ id: string; at: string; channel: string; body: string }> }>(
      '/notifications',
    ),
    api.get<{
      sections: Array<{ id: string; name?: string; mgr?: string; sales?: string }>
    }>('/sections'),
  ])

  const availResults = await Promise.all(
    PARTY_VOTERS.map(async (voterId) => {
      const avail = await api.get<{ voterId: string; dayMarks: Record<string, string>; hourMarks: Record<string, number[]> }>(
        `/availability/${voterId}`,
      )
      return [voterId, avail] as const
    }),
  )

  const dayVotes: Record<string, Record<string, string>> = {}
  const hourVotes: Record<string, Record<string, number[]>> = {}
  for (const [voterId, avail] of availResults) {
    dayVotes[voterId] = avail.dayMarks || {}
    if (avail.hourMarks && Object.keys(avail.hourMarks).length) {
      hourVotes[voterId] = avail.hourMarks
    }
  }

  const members = membersRes.members || []
  const sections = sectionsRes.sections || []
  // セクション見出し用（Mgr 名など）。営業名は store 側で名簿セット後に再同期する
  applySectionsFromApi(sections)
  const interviews: Record<number, any> = {}
  const votes: Record<number, Record<string, string>> = {}
  for (const member of members) {
    interviews[member.id] = emptyInterview()
    votes[member.id] = {}
  }
  for (const iv of interviewsRes.interviews || []) {
    const id = Number(iv.memberId)
    interviews[id] = {
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
    votes[id] = iv.votes || {}
  }

  const salesAssignee: Record<number, string> = {}
  for (const [key, value] of Object.entries(salesAssignees || {})) {
    if (value) salesAssignee[Number(key)] = value
  }

  const deadlines: Record<string, string | null> = {}
  const judgedAt: Record<string, string | null> = {}
  const sectionIds = (sectionsRes.sections || SECTIONS).map((s) => s.id)
  await Promise.all(
    sectionIds.map(async (sectionId) => {
      try {
        const d = await api.get<{ sectionId: string; deadline: string | null; judgedAt: string | null }>(
          `/sections/${sectionId}/deadline`,
        )
        deadlines[sectionId] = d.deadline
        judgedAt[sectionId] = d.judgedAt
      } catch {
        deadlines[sectionId] = null
        judgedAt[sectionId] = null
      }
    }),
  )

  // assignment overrides (best-effort; not listed in a bulk API)
  const assignmentOverrides: Record<number | string, string> = {}

  setBootstrapCache({ members, interviewPeriod, responseDeadlines })

  return {
    members,
    sections,
    interviewPeriod,
    responseDeadlines,
    state: {
      version: 6,
      quarterLabel: settings.quarterLabel,
      hongoJoins: settings.hongoJoins,
      provider: settings.provider,
      deadlines,
      judgedAt,
      dayVotes,
      hourVotes,
      votes,
      interviews,
      assignmentOverrides,
      salesAssignee,
      salesOffers: { salesA: {}, salesB: {} },
      notifications: notificationsRes.notifications || [],
    },
  }
}
