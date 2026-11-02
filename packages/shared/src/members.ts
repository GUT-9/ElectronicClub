export interface Member {
  uid: string
  studentId: string
  name: string
  nickname: string
  gender: string
  college: string
  major: string
  className: string
  grade: string
  phone: string
  email: string
  avatar: string
  roleIds: string[]
  position: string
  status: 'active' | 'disabled' | 'deleted'
  mustChangePassword: boolean
  createdAt: string
  updatedAt: string
  version: number
  activationExpiresAt: string
  deletedAt?: string
  anonymizedAt?: string
}
export interface Role {
  id: string
  name: string
  description: string
  permissionIds: string[]
  memberCount: number
  builtin: boolean
  super: boolean
  createdAt: string
}
export interface Permission {
  id: string
  name: string
  group: string
  implemented: boolean
}
export interface Identity {
  roles: { id: string; name: string }[]
  member: Member
  permissions: string[]
  super: boolean
}
export interface Page<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}
export interface ImportRow {
  line: number
  member?: Pick<
    Member,
    | 'studentId'
    | 'name'
    | 'gender'
    | 'college'
    | 'major'
    | 'className'
    | 'grade'
  >
  error?: string
  uid?: string
}
export interface ImportJob {
  id: string
  owner: string
  hash: string
  rows: ImportRow[]
  offset: number
  created: number
  skipped: number
  status: 'preview' | 'processing' | 'completed'
  createdAt: string
  updatedAt: string
}
export interface AuditLog {
  id: string
  actor: string
  action: string
  target: string
  fields: string[]
  createdAt: string
}
