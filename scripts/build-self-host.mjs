import { build } from 'esbuild'
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
  chmod,
} from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { resolve, join } from 'node:path'
export async function files(root, base = '', skipDirs = []) {
  const result = []
  for (const e of (
    await readdir(join(root, base), { withFileTypes: true })
  ).sort((a, b) => a.name.localeCompare(b.name))) {
    if (skipDirs.includes(e.name)) continue
    const name = base ? base + '/' + e.name : e.name
    if (e.isDirectory()) result.push(...(await files(root, name, skipDirs)))
    else if (e.isFile()) result.push(name)
    else throw Error('Archive links are not allowed: ' + name)
  }
  return result
}
export async function treeDigest(root, names) {
  const hash = createHash('sha256')
  for (const name of [...(names ?? (await files(root)))].sort()) {
    hash.update(name + '\0')
    hash.update(
      createHash('sha256')
        .update(await readFile(join(root, name)))
        .digest(),
    )
  }
  return hash.digest('hex')
}
export async function assembleSelfHost() {
  const out = resolve('artifacts/self-host'),
    payload = join(out, 'payload')
  await rm(out, { recursive: true, force: true })
  await mkdir(join(payload, 'api'), { recursive: true })
  execFileSync('npm', ['run', 'build', '-w', '@electronic-club/functions'], {
    stdio: 'inherit',
  })
  execFileSync('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], {
    cwd: 'apps/functions/deploy',
    stdio: 'inherit',
  })
  for (const name of ['package.json', 'package-lock.json', 'node_modules'])
    await cp('apps/functions/deploy/' + name, join(payload, 'api', name), {
      recursive: true,
      dereference: true,
    })
  const dependencies = Object.keys(
    JSON.parse(await readFile('apps/functions/deploy/package.json', 'utf8'))
      .dependencies,
  )
  for (const name of ['main', 'bootstrap'])
    await build({
      entryPoints: [`apps/functions/src/self-host/${name}.ts`],
      outfile: join(
        payload,
        'api',
        name === 'main' ? 'server.cjs' : 'bootstrap.cjs',
      ),
      platform: 'node',
      target: 'node22',
      format: 'cjs',
      bundle: true,
      external: dependencies,
    })
  for (const name of ['admin.mjs', 'crypto.mjs'])
    await cp('deploy/linux/' + name, join(payload, 'api', name))
  for (const name of [
    'Dockerfile.api',
    'Dockerfile.web',
    'compose.yaml',
    'Caddyfile',
    'web-start.sh',
    'pg_hba.conf',
  ])
    await cp('deploy/linux/' + name, join(payload, name))
  await mkdir(join(payload, 'sql'))
  const migrations = JSON.parse(
    await readFile('deploy/linux/migrations.json', 'utf8'),
  )
  for (const file of migrations)
    await cp('cloudbase/sql/' + file, join(payload, 'sql', file))
  await cp('deploy/linux/migrations.json', join(payload, 'sql/migrations.json'))
  execFileSync(
    'npm',
    [
      'run',
      'build',
      '-w',
      '@electronic-club/web',
      '--',
      '--outDir',
      join(payload, 'web'),
    ],
    { stdio: 'inherit', env: { ...process.env, VITE_API_BASE_URL: '' } },
  )
  await cp('deploy/linux/club.sh', join(out, 'club.sh'))
  await cp('deploy/linux/ops', join(out, 'ops'), { recursive: true })
  for (const name of ['admin.mjs', 'crypto.mjs'])
    await cp('deploy/linux/' + name, join(out, 'ops', name))
  await cp('docs/linux-server.md', join(out, 'README.md'))
  for (const name of await files(out)) {
    await chmod(join(out, name), name.endsWith('.sh') ? 0o755 : 0o644)
  }
  const id = await treeDigest(out)
  await writeFile(join(payload, 'RELEASE_ID'), id + '\n')
  await writeFile(
    join(payload, 'BUILD_INFO.json'),
    JSON.stringify(
      {
        sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
          encoding: 'utf8',
        }).trim(),
        contentDigest: id,
      },
      null,
      2,
    ) + '\n',
  )
  const manifest = []
  for (const name of await files(payload))
    manifest.push(
      createHash('sha256')
        .update(await readFile(join(payload, name)))
        .digest('hex') +
        '  ' +
        name,
    )
  await writeFile(join(payload, 'manifest.sha256'), manifest.join('\n') + '\n')
  return { out, id }
}
if (process.argv[1] === new URL(import.meta.url).pathname)
  await assembleSelfHost()
