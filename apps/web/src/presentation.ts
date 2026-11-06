import type { ClubArticle, ClubEvent } from '@electronic-club/shared'
export function shortDate(value: string | null | undefined) {
  if (!value) return '时间待定'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '时间待定'
    : date.toLocaleDateString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
}
export function excerpt(value: string, limit = 120) {
  return value
    .replace(/^!\[[^\]]*\]\(media:[^)]+\)\s*$/gm, '[图片]')
    .replace(/^#{1,3}\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit)
}
export function eventLabel(event: ClubEvent, now = Date.now()) {
  if (Date.parse(event.endsAt) <= now) return '已结束'
  if (Date.parse(event.startsAt) <= now) return '进行中'
  if (
    event.registrationEnabled &&
    (!event.registrationStartsAt ||
      Date.parse(event.registrationStartsAt) <= now) &&
    Date.parse(event.registrationDeadline) > now
  )
    return event.capacity!==null&&event.occupied>=event.capacity?'名额已满':'报名中'
  return '即将开始'
}
export const publicationSummary = (item: ClubArticle | ClubEvent) =>
  item.summary || excerpt(item.content)
