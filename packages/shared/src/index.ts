export const HEALTH_PATH = '/api/health' as const
export interface HealthData { status: 'ok'; service: 'ElectronicClub API'; timestamp: string }
export type ApiResponse<T> = { success: true; data: T } | { success: false; error: { code: string; message: string } }
export type HealthResponse = ApiResponse<HealthData>
