/** Canonicalize copied server configuration, never request-supplied values. */
export function normalizeProxySecret(value: unknown): string | null {
  if (typeof value !== 'string') return null
  let secret = value
    .trim()
    .replace(/^ECLUB_PROXY_SECRET\s*=\s*/, '')
    .trim()
  const quote = secret[0]
  if ((quote === '"' || quote === "'") && secret[secret.length - 1] === quote)
    secret = secret.slice(1, -1)
  // Proxy keys contain no meaningful whitespace. This also handles
  // line wrapping, CRLF and a clipboard BOM without changing case/key bytes.
  secret = secret.replace(/\s/g, '')
  return /^[0-9]{4}$/.test(secret) ||
    (secret.length === 64 && /^[a-f0-9]+$/i.test(secret))
    ? secret
    : null
}
