export interface ClubEvent {
  id: string
  title: string
  summary: string
  content: string
  cover: string
  location: string
  startsAt: string
  endsAt: string
  status: 'draft' | 'published' | 'disabled' | 'deleted'
  registrationEnabled: boolean
  registrationStartsAt: string
  registrationDeadline: string
  capacity: number | null
  allowCancellation: boolean
  approvalRequired: boolean
  notesEnabled: boolean
  notesRequired: boolean
  checkinEnabled: boolean
  checkinOpen: boolean
  managerIds: string[]
  registrationIds: string[]
  occupied: number
  publisherUid: string
  publisherName: string
  publishedAt: string | null
  createdAt: string
  updatedAt: string
}
export interface Registration {
  id: string
  eventId: string
  uid: string
  snapshot: {
    studentId: string
    name: string
    gender: string
    college: string
    major: string
    className: string
    grade: string
  }
  note: string
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'manual'
  registeredAt: string
  updatedAt: string
  reviewedBy?: string
  checkedInAt?: string
  checkinMethod?: 'code' | 'manual'
}
export interface ClubArticle {
  id: string
  title: string
  summary: string
  content: string
  cover: string
  category: string
  pinned: boolean
  status: 'draft' | 'published' | 'withdrawn' | 'deleted'
  publisherUid: string
  publisherName: string
  publishedAt: string | null
  createdAt: string
  updatedAt: string
}
export interface PopupAnnouncement {
  id: string
  version: string
  title: string
  summary: string
  image: string
  buttonText: string
  targetType: 'event' | 'article'
  targetId: string
  startsAt: string
  expiresAt: string
  priority: number
  enabled: boolean
  state: 'scheduled' | 'active' | 'retired' | 'disabled'
  createdAt: string
  updatedAt: string
}
