// Cache only responses whose service path is independent of the caller's identity.
// Sessions, permissions, forum content, media and signed download URLs never enter it.
export function publicReadKey(
  method: string,
  path: string,
  query: Record<string, string>,
): string | null {
  if (method !== 'GET') return null
  const publication =
    /^\/api\/public\/(events|articles)(?:\/[a-f0-9-]{36})?$/.test(path)
  const resources = path === '/api/resources' && !query.admin && !query.status
  if (!publication && !resources) return null
  const entries = Object.entries(query).sort(([a], [b]) => a.localeCompare(b))
  if (
    entries.some(([key]) =>
      !['page', 'pageSize', 'search', 'category'].includes(key),
    )
  )
    return null
  const key = path + '?' + new URLSearchParams(entries).toString()
  return key.length <= 1024 ? key : null
}

export class PublicReadCache<T> {
  private entries = new Map<
    string,
    { value: T; expires: number; bytes: number }
  >()
  private pending = new Map<string, Promise<T>>()
  private bytes = 0
  private generation = 0
  constructor(
    private clock = () => Date.now(),
    private maxEntries = 64,
    private maxBytes = 4 * 1024 * 1024,
  ) {}

  clear() {
    this.generation++
    this.entries.clear()
    this.pending.clear()
    this.bytes = 0
  }

  async load(key: string, ttl: number, work: () => Promise<T>): Promise<T> {
    for (const [id, entry] of this.entries) {
      if (entry.expires <= this.clock()) {
        this.bytes -= entry.bytes
        this.entries.delete(id)
      }
    }
    const cached = this.entries.get(key)
    if (cached) return structuredClone(cached.value)
    const pending = this.pending.get(key)
    if (pending) return structuredClone(await pending)
    // Bound both stored responses and distinct concurrent cache loads.
    if (this.pending.size >= this.maxEntries) return work()
    const generation = this.generation
    const loading = Promise.resolve()
      .then(work)
      .then((value) => {
        const bytes = Buffer.byteLength(JSON.stringify(value))
        if (generation === this.generation && bytes <= this.maxBytes / 4) {
          while (
            this.entries.size >= this.maxEntries ||
            this.bytes + bytes > this.maxBytes
          ) {
            const id = this.entries.keys().next().value
            if (id === undefined) break
            this.bytes -= this.entries.get(id)!.bytes
            this.entries.delete(id)
          }
          this.entries.set(key, {
            value: structuredClone(value),
            expires: this.clock() + ttl,
            bytes,
          })
          this.bytes += bytes
        }
        return value
      })
    this.pending.set(key, loading)
    try {
      return structuredClone(await loading)
    } finally {
      if (this.pending.get(key) === loading) this.pending.delete(key)
    }
  }
}
