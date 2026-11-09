import { PublicSiteError, readPublicSite } from '@electronic-club/shared/public-site'
import type { PublicSiteStorage } from './public-site-storage'
import { ApiError } from './members/model'
import type { StageResult } from './stage3/service'
import { scheduledPopup } from './public-site-timed'
export async function publicSiteResponse(storage: PublicSiteStorage, path: string, query: Record<string, string>, now = Date.now()): Promise<StageResult> {
  try {
    const site = await storage.read()
    if (!site) throw Error('PUBLIC_SITE_NOT_PUBLISHED')
    if (site.hasTimedPopups && (path === '/api/public/popup' ||
        (!site.assets[path] && site.timedMediaIds?.includes(path.split('/').pop()!)))) {
      const timed = await storage.timed()
      if (!timed) throw Error('PUBLIC_TIMED_MISSING')
      timed.popups = timed.popups.filter((p) => (p.targetType === 'event' ? site.events : site.articles).some((v) => v.id === p.targetId))
      const selected = scheduledPopup(timed, now).popup
      if (path === '/api/public/popup') return { data: selected }
      if (!site.assets[path] && timed.assets[path]) {
        const image = timed.assets[path]!
        if (!selected || !image.popupIds.includes(selected.id)) throw new PublicSiteError(404, 'NOT_FOUND', '图片尚未公开或不存在')
        return { binary: Buffer.from(image.base64, 'base64'), contentType: image.mime }
      }
    }
    const result = readPublicSite(site, path, query, now)
    if (result.asset) return { binary: Buffer.from(await storage.asset(result.asset)), contentType: result.asset.mime }
    return { data: result.data }
  } catch (error) {
    if (error instanceof PublicSiteError) throw new ApiError(error.status, error.code, error.message)
    throw new ApiError(503, 'PUBLIC_SITE_UNAVAILABLE', '公开内容暂时无法读取，请稍后重试；管理员可检查公开发布状态')
  }
}
