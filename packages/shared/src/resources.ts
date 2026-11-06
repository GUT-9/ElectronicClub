export interface MemberStats {
  activeMembers: number
  loggedInMembers: number
  activatedMembers: number
  pendingMembers: number
  asOf: string
}
export interface ClubResource {
  id: string
  title: string
  description: string
  category: string
  originalName: string
  size: number
  mime: string
  status: 'uploading' | 'draft' | 'published' | 'deleting' | 'deleted'
  createdAt: string
  updatedAt: string
  publishedAt: string | null
}
export const RESOURCE_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
  '7z': 'application/x-7z-compressed',
  txt: 'text/plain',
  csv: 'text/csv',
}
export const RESOURCE_ACCEPT = Object.keys(RESOURCE_TYPES)
  .map((k) => '.' + k)
  .join(',')
