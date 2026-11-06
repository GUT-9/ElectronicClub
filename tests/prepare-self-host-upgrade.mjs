import { cp, readFile, writeFile, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { files, treeDigest } from '../scripts/build-self-host.mjs'
import { archive } from '../scripts/release-refresh.mjs'
const out = 'artifacts/selfhost-upgrade-fixture'
await rm(out, { recursive: true, force: true })
await cp('artifacts/self-host', out, { recursive: true })
await rm(out + '/payload/manifest.sha256')
await rm(out + '/payload/RELEASE_ID')
await rm(out + '/payload/BUILD_INFO.json')
await writeFile(
  out + '/payload/web/index.html',
  (await readFile(out + '/payload/web/index.html', 'utf8')) +
    '\n<!-- isolated upgrade fixture -->\n',
)
await writeFile(out + '/payload/RELEASE_ID', (await treeDigest(out)) + '\n')
const manifest = []
for (const name of await files(out + '/payload'))
  manifest.push(
    createHash('sha256')
      .update(await readFile(out + '/payload/' + name))
      .digest('hex') +
      '  ' +
      name,
  )
await writeFile(out + '/payload/manifest.sha256', manifest.join('\n') + '\n')
await archive(out, await files(out), 'artifacts/selfhost-upgrade-check.tar.gz')
