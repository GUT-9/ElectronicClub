import cloudbase from '@cloudbase/node-sdk'
import type { Transaction as CloudTransaction } from '@cloudbase/database/dist/commonjs/transaction'
import type { Store, Transaction, ListOptions } from './store'
export function createDatabase() {
  if (!process.env.CLOUDBASE_ENV_ID)
    throw new Error('CLOUDBASE_ENV_ID is required')
  return cloudbase.init({ env: process.env.CLOUDBASE_ENV_ID }).database()
}
export class CloudStore implements Store {
  constructor(private db = createDatabase()) {}
  async read<T>(collection: string, id: string): Promise<T | null> {
    const response = await this.db.collection(collection).doc(id).get()
    return clean<T>(response.data[0])
  }
  async run<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const transaction: CloudTransaction = await this.db.startTransaction()
      try {
        const result = await fn({
          get: async <R>(c: string, id: string) => {
            const snapshot = await transaction.get(
              this.db.collection(c).doc(id),
            )
            return clean<R>(snapshot.data())
          },
          set: async (c, id, value) => {
            await transaction.set(this.db.collection(c).doc(id), value)
          },
          remove: async (c, id) => {
            await transaction.delete(this.db.collection(c).doc(id))
          },
        })
        await transaction.commit()
        return result
      } catch (error) {
        try {
          await transaction.rollback()
        } catch {
          /* preserve original failure */
        }
        const code = String((error as { code?: string }).code ?? '')
        if (
          attempt < 2 &&
          /CONFLICT|WRITE_CONFLICT|TRANSACTION_CONFLICT/.test(code)
        )
          continue
        throw error
      }
    }
  }
  async list<T>(
    collection: string,
    filter: Record<string, unknown>,
    options: ListOptions,
  ) {
    const where: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(filter)) {
      if (key === '_notDeleted') where.status = this.db.command.neq('deleted')
      else if (key === '_search') {
        const regexp = String(value)
          .split('')
          .map((char) =>
            '\\^$.*+?()[]{}|'.includes(char) ? '\\' + char : char,
          )
          .join('')
        where.$or = ['studentId', 'name', 'nickname'].map((k) => ({
          [k]: this.db.RegExp({ regexp, options: 'i' }),
        }))
      } else where[key] = value
    }
    const query = this.db.collection(collection).where(where)
    const [count, result] = await Promise.all([
      query.count(),
      query
        .orderBy('createdAt', 'desc')
        .orderBy('_id', 'asc')
        .skip(options.offset)
        .limit(options.limit)
        .get(),
    ])
    const items = result.data.map((raw) => {
      const value = { ...raw }
      delete value._id
      return value
    }) as T[]
    return { items, total: count.total }
  }
}

function clean<T>(raw: unknown): T | null {
  if (raw === null || raw === undefined) return null
  const value = { ...(raw as Record<string, unknown>) }
  delete value._id
  return Object.keys(value).length ? (value as T) : null
}
