/** Shared business identifier rules. Never coerce numbers or trim whitespace. */
export const STUDENT_ID_PATTERN = '[A-Za-z0-9]{4,24}'
export const STUDENT_ID_MESSAGE =
  '学号须为4–24位英文字母或数字，不允许空格或特殊字符'
export function isValidStudentId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 4 &&
    value.length <= 24 &&
    !/[^A-Za-z0-9]/.test(value)
  )
}
export function normalizeStudentId(value: unknown): string {
  if (!isValidStudentId(value)) throw new Error(STUDENT_ID_MESSAGE)
  return value.toUpperCase()
}
