import { build } from 'esbuild'
import { mkdir, writeFile, readFile, copyFile, cp } from 'node:fs/promises'
const dependencies = {
  '@cloudbase/signature-nodejs': '2.2.2',
  pg: '8.16.3',
  exceljs: '4.4.0',
  yauzl: '3.2.0',
  zod: '4.6.7',
}
await mkdir('deploy', { recursive: true })
for (const [name, source] of Object.entries({
  index: 'index',
  bootstrap: 'bootstrap',
  diagnose: 'diagnose',
  maintenance: 'maintenance',
  'forum-maintenance': 'forum-maintenance',
  'offline-bootstrap': 'offline-bootstrap',
}))
  await build({
    entryPoints: [`src/${source}.ts`],
    outfile: `deploy/${name}.js`,
    platform: 'node',
    target: 'node18',
    bundle: true,
    format: 'cjs',
    external: Object.keys(dependencies),
  })
await writeFile(
  'deploy/package.json',
  JSON.stringify(
    {
      name: 'electronic-club-api',
      private: true,
      main: 'index.js',
      engines: { node: '>=18.15.0' },
      dependencies,
    },
    null,
    2,
  ) + '\n',
)
const lock = JSON.parse(
  await readFile('../../cloudbase/runtime-package-lock.json', 'utf8'),
)
const sort = (x) => JSON.stringify(Object.entries(x).sort())
if (sort(lock.packages[''].dependencies) !== sort(dependencies))
  throw new Error('Refresh runtime package lock')
await copyFile(
  '../../cloudbase/runtime-package-lock.json',
  'deploy/package-lock.json',
)
await cp('../../cloudbase/sql', 'deploy/sql', { recursive: true })
await copyFile(
  '../../cloudbase/backend.env.example',
  'deploy/backend.env.example',
)

await copyFile(
  '../../scripts/deploy-preflight.mjs',
  'deploy/deploy-preflight.mjs',
)
await copyFile('../../scripts/verify-api.mjs', 'deploy/verify-api.mjs')

await copyFile('../../docs/stage3-deploy.md', 'deploy/DEPLOY-STAGE3.md')

await copyFile('../../docs/stage4-deploy.md', 'deploy/DEPLOY-STAGE4.md')
await copyFile('../../docs/access-workspace-deploy.md', 'deploy/DEPLOY-ACCESS.md')
await copyFile('../../docs/content-media-deploy.md', 'deploy/DEPLOY-MEDIA.md')
await copyFile('../../docs/login-history-deploy.md', 'deploy/DEPLOY-LOGIN-HISTORY.md')
await copyFile('../../docs/resources-deploy.md', 'deploy/DEPLOY-RESOURCES.md')
await copyFile('../../docs/member-purge-deploy.md', 'deploy/DEPLOY-MEMBER-PURGE.md')
await copyFile('../../docs/event-operations-deploy.md', 'deploy/DEPLOY-EVENT-OPERATIONS.md')
