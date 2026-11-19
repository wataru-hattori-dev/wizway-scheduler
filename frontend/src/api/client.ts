import { AUTH_TOKEN_KEY } from '../auth/types'

const API_BASE = import.meta.env.VITE_API_BASE || '/api/v1'

export class ApiError extends Error {
  status: number
  code?: string

  constructor(status: number, message: string, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

function authHeaders(): Record<string, string> {
  try {
    const token = localStorage.getItem(AUTH_TOKEN_KEY)
    if (token) return { Authorization: `Bearer ${token}` }
  } catch {
    /* ignore */
  }
  return {}
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(init?.headers || {}),
    },
  })
  if (response.status === 204) return undefined as T
  const text = await response.text()
  let body: any = null
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = { message: text }
    }
  }
  if (!response.ok) {
    throw new ApiError(response.status, body?.message || `HTTP ${response.status}`, body?.code)
  }
  return body as T
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body !== undefined ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body !== undefined ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}

export type Member = {
  id: number
  surname: string
  sectionId: string
  name: string
  role: string
  isInterviewer: boolean
  isDeleted: boolean
}

export type Interview = {
  memberId: number
  status: string
  submittedAt?: string | null
  confirmedSlotId?: string | null
  confirmedSalesId?: string | null
  confirmedOverride?: { start: string; end: string } | null
  assignReason?: string | null
  meetingUrl?: string | null
  pendingNote?: string | null
  remindedAt?: string | null
  changeRequest?: unknown
  preferences?: {
    difficultDates?: string[]
    preferredTimeNote?: string
    note?: string
  }
  votes?: Record<string, string>
  salesAssigneeId?: string | null
  sectionId?: string
}
