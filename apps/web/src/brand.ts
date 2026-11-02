// User-approved second transparent-background version from this conversation.
import logoUrl from './assets/electronic-club-logo.png'

export const officialLogo = logoUrl

export function installOfficialFavicon() {
  const icon = document.createElement('link')
  icon.rel = 'icon'
  icon.type = 'image/png'
  icon.href = officialLogo
  document.head.append(icon)
}
