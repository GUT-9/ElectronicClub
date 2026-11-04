import {validateExpired} from '../media/query'
import { validateAccessQuery } from './access-query'
import { validateForumQuery } from '../forum/query'
import type { Store, Transaction, ListOptions } from './store'
import { DatabaseFailure } from './pg-store'
import { cloudbaseAuthorization } from './cloudbase-auth'
import { rdbDiagnostic, rdbFailureCode } from './rdb-diagnostics'

export type Rpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<unknown>

// Same PostgREST endpoint and Bearer authentication used by the official Node SDK's rdb().
// The key must belong to a private, restricted server role; never use a browser/anon key.
export function cloudbaseRpc(): Rpc {
  const env = process.env.CLOUDBASE_ENV_ID
  if (!env || !/^[a-zA-Z0-9-]+$/.test(env))
    throw new DatabaseFailure('configuration', 'CLOUDBASE_ENV_REQUIRED')
  const auth = cloudbaseAuthorization(env)
  const base = `https://${env}.api.tcloudbasegateway.com/v1/rdb/rest/rpc/`
  return async (name, args) => {
    const authorization = await auth.header()
    let response: Response
    try {
      response = await fetch(base + name, {
        method: 'POST',
        headers: {
          Authorization: authorization,
          'Content-Type': 'application/json',
          'Accept-Profile': 'public',
          'Content-Profile': 'public',
        },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(15000),
      })
    } catch {
      throw new DatabaseFailure('http_connect', 'RDB_HTTP_UNREACHABLE')
    }
    if (!response.ok) {
      if (response.status === 401) auth.invalidate()
      const diagnostic = await rdbDiagnostic(response, name)
      throw new DatabaseFailure(
        'http_rpc',
        rdbFailureCode(diagnostic),
        diagnostic,
      )
    }
    try {
      return await response.json()
    } catch {
      throw new DatabaseFailure('http_decode', 'RDB_HTTP_INVALID_RESPONSE')
    }
  }
}

interface Snapshot {
  data: object | null
  etag: string | null
}
interface Read extends Snapshot {
  collection: string
  id: string
}
interface Write {
  collection: string
  id: string
  data: object | null
}

export class HttpStore implements Store {
  constructor(private rpc: Rpc = cloudbaseRpc()) {}

  async read<T>(collection: string, id: string): Promise<T | null> {
    const snapshot = (await this.rpc('ec_read', {
      p_collection: collection,
      p_id: id,
    })) as Snapshot
    return snapshot.data as T | null
  }

  async list<T>(
    collection: string,
    filter: Record<string, unknown>,
    options: ListOptions,
  ) {
    if(collection==='media_expired'){validateExpired(filter,options);return await this.rpc('ec_media_expired',{p_before:filter.before,p_limit:options.limit}) as {items:T[];total:number}}
    if(collection==='access_members'){validateAccessQuery(filter,options);return await this.rpc('ec_access_members',{p_filter:filter,p_offset:options.offset,p_limit:options.limit}) as {items:T[];total:number}}
    const forum = collection.startsWith('forum_') || filter._forumAudit === true
    if (forum) validateForumQuery(collection, filter, options)
    return (await this.rpc(forum ? 'ec_forum_list' : 'ec_list', {
      p_collection: collection,
      p_filter: filter,
      p_offset: options.offset,
      p_limit: options.limit,
    })) as { items: T[]; total: number }
  }

  async run<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 32; attempt++) {
      const reads = new Map<string, Promise<Read>>(),
        writes = new Map<string, Write>()
      // Share in-flight reads too: parallel role lookups must observe the same version.
      const load = (collection: string, id: string) => {
        const key = collection + '/' + id
        if (!reads.has(key))
          reads.set(
            key,
            this.rpc('ec_read', {
              p_collection: collection,
              p_id: id,
            }).then((snapshot) => ({
              collection,
              id,
              ...(snapshot as Snapshot),
            })),
          )
        return reads.get(key)!
      }
      const tx: Transaction = {
        get: async <R>(collection: string, id: string) => {
          const key = collection + '/' + id
          return structuredClone(
            writes.has(key)
              ? writes.get(key)!.data
              : (await load(collection, id)).data,
          ) as R | null
        },
        set: async (collection, id, data) => {
          await load(collection, id)
          writes.set(collection + '/' + id, {
            collection,
            id,
            data: structuredClone(data),
          })
        },
        remove: async (collection, id) => {
          await load(collection, id)
          writes.set(collection + '/' + id, { collection, id, data: null })
        },
      }
      const result = await fn(tx)
      // One database function call is one real SQL transaction. Never send HTTP BEGIN/COMMIT.
      const commit = (await this.rpc('ec_commit', {
        p_reads: (await Promise.all(reads.values())).map(
          ({ collection, id, etag }) => ({ collection, id, etag }),
        ),
        p_writes: [...writes.values()],
      })) as { ok: boolean; conflict?: boolean }
      if (commit.ok) return result
      if (commit.conflict)
        await new Promise((resolve) =>
          setTimeout(resolve, 5 + Math.floor(Math.random() * 20)),
        )
      if (!commit.conflict)
        throw new DatabaseFailure('http_commit', 'RDB_COMMIT_REJECTED')
    }
    throw new DatabaseFailure('http_commit', 'RDB_CONFLICT_RETRY_EXHAUSTED')
  }
}
