import { build } from 'esbuild'
import { mkdir, writeFile, readFile, copyFile } from 'node:fs/promises'
await mkdir('deploy', { recursive: true })
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'deploy/index.js',
  platform: 'node',
  target: 'node22',
  bundle: true,
  format: 'cjs',
  packages: 'external',
})
// Only runtime dependencies; the type-only workspace dependency must never reach cloud installation.
await writeFile(
  'deploy/package.json',
  JSON.stringify(
    {
      name: 'electronic-club-api',
      private: true,
      main: 'index.js',
      dependencies: {
        '@cloudbase/node-sdk': '3.18.7',
        exceljs: '4.4.0',
        yauzl: '3.2.0',
        zod: '4.6.7',
        '@cloudbase/database': '1.4.3',
      },
      overrides: { axios: '0.34.0' },
    },
    null,
    2,
  ) + '\n',
)

const runtimeLock = JSON.parse(
  await readFile('../../cloudbase/runtime-package-lock.json', 'utf8'),
)
const runtimeManifest = JSON.parse(
  await readFile('deploy/package.json', 'utf8'),
)
if (
  JSON.stringify(runtimeLock.packages[''].dependencies) !==
  JSON.stringify(runtimeManifest.dependencies)
) {
  const sort = (value) => JSON.stringify(Object.entries(value).sort())
  if (
    sort(runtimeLock.packages[''].dependencies) !==
    sort(runtimeManifest.dependencies)
  )
    throw new Error(
      'Refresh cloudbase/runtime-package-lock.json for updated runtime dependencies',
    )
}
await copyFile(
  '../../cloudbase/runtime-package-lock.json',
  'deploy/package-lock.json',
)
