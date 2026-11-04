export const HEALTH_PATH = '/api/health' as const
export interface HealthData {
  status: 'ok'
  service: 'ElectronicClub API'
  timestamp: string
}
export type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string } }
export type HealthResponse = ApiResponse<HealthData>

export type {
  Member,
  Role,
  Permission,
  Identity,
  Page,
  ImportRow,
  ImportJob,
  AuditLog,
} from './members'

export {
  STUDENT_ID_PATTERN,
  STUDENT_ID_MESSAGE,
  isValidStudentId,
  normalizeStudentId,
} from './student-id'
export type {
  ClubEvent,
  Registration,
  ClubArticle,
  PopupAnnouncement,
} from './stage3'
export * from './forum'
