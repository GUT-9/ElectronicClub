import { HttpStore } from './members/http-store'
import { PgStore } from './members/pg-store'
import { cleanupStagedImages } from './forum/storage'
async function main() {
  if (!process.argv.includes('--cleanup-staged'))
    throw new Error('Use --cleanup-staged in an authorized private terminal')
  const store =
    process.env.DB_DRIVER === 'postgres-tcp' ? new PgStore() : new HttpStore()
  try {
    console.log(JSON.stringify(await cleanupStagedImages(store)))
  } finally {
    if (store instanceof PgStore) await store.pool.end()
  }
}
if (require.main === module)
  main().catch(() => {
    console.error('FORUM_PRIVATE_MAINTENANCE_FAILED')
    process.exitCode = 1
  })
