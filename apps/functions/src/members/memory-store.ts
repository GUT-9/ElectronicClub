import {memoryLoginList} from './login-query'
import {validateExpired} from '../media/query'
import {memoryAccessList} from './access-query'
import { memoryForumList } from '../forum/memory-query'
import type { Store, Transaction, ListOptions } from './store'
// Explicit test/local adapter only. Production never falls back to it.
export class MemoryStore implements Store {
  private data = new Map<string, object>()
  private queue: Promise<unknown> = Promise.resolve()
  async read<T>(collection: string, id: string): Promise<T | null> {
    return structuredClone(
      this.data.get(`${collection}/${id}`) ?? null,
    ) as T | null
  }
  async run<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    const work = this.queue.then(async () => {
      const copy = new Map(this.data)
      const tx: Transaction = {
        get: async <T>(c: string, id: string) =>
          structuredClone(copy.get(`${c}/${id}`) ?? null) as T | null,
        set: async (c, id, value) => {
          // Mirror the production login-privacy trigger in this local/test adapter.
          if(c==='users'&&(value as {anonymizedAt?:string}).anonymizedAt&&!(copy.get(`${c}/${id}`) as {anonymizedAt?:string})?.anonymizedAt){
            for(const [key,entry] of copy){const log=entry as {action?:string;actor?:string;login?:{memberUid?:string}};if(key.startsWith('audit_logs/')&&log.login&&(log.login.memberUid===id||log.action==='auth.login'&&log.actor===id)){const next={...log};delete next.login;copy.set(key,next)}}
          }
          copy.set(`${c}/${id}`, structuredClone(value))
        },
        remove: async (c, id) => {
          copy.delete(`${c}/${id}`)
        },
      }
      const result = await fn(tx)
      this.data = copy
      return result
    })
    this.queue = work.catch(() => undefined)
    return work
  }
  async list<T>(
    collection: string,
    filter: Record<string, unknown>,
    options: ListOptions,
  ) {
    if(collection==='login_history')return memoryLoginList<T>(this.data,filter,options)
    if(collection==='media_expired'){validateExpired(filter,options);const items=[...this.data.entries()].filter(([key])=>key.startsWith('media_images/')).map(([,v])=>v as {bindings:unknown[];createdAt:string}).filter(v=>!v.bindings.length&&v.createdAt<String(filter.before)).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).slice(0,options.limit);return {items:structuredClone(items) as T[],total:items.length}}
    if(collection==='access_members')return memoryAccessList<T>(this.data,filter,options)
    if (collection.startsWith('forum_') || filter._forumAudit === true) return memoryForumList<T>(collection, filter, options, this.data)
    const items = [...this.data]
      .filter(([key]) => key.startsWith(`${collection}/`))
      .map(([, v]) => structuredClone(v) as Record<string, unknown>)
      .filter((row) =>
        Object.entries(filter).every(([k, v]) =>
          k === '_search'
            ? ['studentId', 'name', 'nickname'].some((f) =>
                String(row[f]).toUpperCase().includes(String(v).toUpperCase()),
              )
            : k === '_notDeleted'
              ? row.status !== 'deleted'
              : Array.isArray(row[k])
                ? (row[k] as unknown[]).includes(v)
                : row[k] === v,
        ),
      )
      .sort(
        (a, b) =>
          String(b.createdAt).localeCompare(String(a.createdAt)) ||
          String(a.uid ?? a.id).localeCompare(String(b.uid ?? b.id)),
      )
    return {
      items: items.slice(options.offset, options.offset + options.limit) as T[],
      total: items.length,
    }
  }
}
