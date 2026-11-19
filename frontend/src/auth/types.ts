export type AccessRole = 'admin' | 'mgr' | 'engineer' | 'denied'

export type AuthUser = {
  slackUserId: string
  slackTeamId: string
  displayName?: string
  accessRole: AccessRole
}

export type AuthSession = {
  authenticated: boolean
  token?: string
  user?: AuthUser
  homePath?: string
  allowedPaths?: string[]
}

export const AUTH_TOKEN_KEY = 'wizway_auth_token'

export const HOME_PATH_BY_ROLE: Record<AccessRole, string> = {
  admin: '/admin',
  mgr: '/mgr',
  engineer: '/engineer',
  denied: '/access-denied',
}

export const ALLOWED_PATHS_BY_ROLE: Record<AccessRole, string[]> = {
  admin: ['/', '/admin', '/mgr', '/sales', '/engineer'],
  mgr: ['/mgr'],
  engineer: ['/engineer'],
  denied: ['/access-denied'],
}

/** 画面 view id → パス */
export const PATH_BY_VIEW = {
  home: '/',
  admin: '/admin',
  manager: '/mgr',
  sales: '/sales',
  engineer: '/engineer',
} as const

export function isPathAllowed(accessRole: AccessRole, pathname: string): boolean {
  const allowed = ALLOWED_PATHS_BY_ROLE[accessRole] || []
  if (pathname === '/sales-mgr') return allowed.includes('/mgr')
  if (pathname === '/member') return allowed.includes('/engineer')
  if (pathname === '/access-denied') return accessRole === 'denied'
  if (pathname.startsWith('/auth/')) return true
  return allowed.includes(pathname)
}

export function defaultPathForRole(accessRole: AccessRole): string {
  return HOME_PATH_BY_ROLE[accessRole] || '/access-denied'
}
