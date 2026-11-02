// The original asset must be supplied by the club; generated artwork is never a fallback.
const originals = import.meta.glob('./assets/electronic-club-logo.png', {
  eager: true,
  query: '?url',
  import: 'default',
})
export const officialLogo = Object.values(originals)[0] as string | undefined

export function installOfficialFavicon() {
  if (!officialLogo) return
  const icon = document.createElement('link')
  icon.rel = 'icon'
  icon.type = 'image/png'
  icon.href = officialLogo
  document.head.append(icon)
}
