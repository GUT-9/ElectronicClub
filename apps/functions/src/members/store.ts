export interface ListOptions {
  offset: number
  limit: number
}
export interface Transaction {
  get<T>(collection: string, id: string): Promise<T | null>
  set<T extends object>(collection: string, id: string, value: T): Promise<void>
  remove(collection: string, id: string): Promise<void>
}
export interface Store {
  run<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>
  read<T>(collection: string, id: string): Promise<T | null>
  list<T>(
    collection: string,
    filter: Record<string, unknown>,
    options: ListOptions,
  ): Promise<{ items: T[]; total: number }>
}
