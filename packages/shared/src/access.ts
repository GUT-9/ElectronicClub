export interface AccessRoleSummary {
  id: string
  name: string
  super: boolean
}
export interface AccessMember {
  uid: string
  studentId: string
  name: string
  nickname: string
  status: 'active' | 'disabled' | 'deleted'
  roleIds: string[]
  roles: AccessRoleSummary[]
  sources: AccessRoleSummary[]
}
