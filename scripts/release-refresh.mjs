import { readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import archiver from 'archiver'
import yauzl from 'yauzl'
import { files, treeDigest, assembleSelfHost } from './build-self-host.mjs'
const root = 'deployment-packages',
  stateFile = root + '/release-state.json'
const sha = async (path) =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex')
export async function zipDigest(path) {
  const values = []
  await new Promise((resolve, reject) =>
    yauzl.open(path, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error)
      zip.on('error', reject)
      zip.on('end', resolve)
      zip.on('entry', (entry) => {
        const name = entry.fileName
        if (name.endsWith('/') || name.startsWith('node_modules/'))
          return zip.readEntry()
        zip.openReadStream(entry, (err, stream) => {
          if (err) return reject(err)
          const h = createHash('sha256')
          stream.on('data', (data) => h.update(data))
          stream.on('error', reject)
          stream.on('end', () => {
            values.push([name, h.digest()])
            zip.readEntry()
          })
        })
      })
      zip.readEntry()
    }),
  )
  const hash = createHash('sha256')
  for (const [name, digest] of values.sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
  )) {
    hash.update(name + '\0')
    hash.update(digest)
  }
  return hash.digest('hex')
}
export async function archive(rootDir, names, destination) {
  await mkdir(root, { recursive: true })
  const output = createWriteStream(destination),
    tar = archiver('tar', { gzip: true, gzipOptions: { level: 9 } })
  const done = new Promise((resolve, reject) => {
    output.on('close', resolve)
    output.on('error', reject)
    tar.on('error', reject)
  })
  tar.pipe(output)
  for (const name of [...names].sort())
    tar.file(rootDir + '/' + name, {
      name,
      date: new Date('2000-01-01T00:00:00Z'),
      mode: name.endsWith('.sh') ? 0o755 : 0o644,
    })
  await tar.finalize()
  await done
  await writeFile(
    destination + '.sha256',
    (await sha(destination)) + '  ' + destination.split('/').pop() + '\n',
  )
}
async function main() {
  const intent = JSON.parse(await readFile('release/major.json', 'utf8'))
  if (
    !Number.isSafeInteger(intent.generation) ||
    intent.generation < 1 ||
    typeof intent.reason !== 'string' ||
    !intent.reason
  )
    throw Error('Invalid major release intent')
  let state
  try {
    state = JSON.parse(await readFile(stateFile, 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    state = { generation: 0 }
  }
  const before = JSON.stringify(state),
    sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim()
  execFileSync('npm', ['run', 'build', '-w', '@electronic-club/functions'], {
    stdio: 'inherit',
  })
  const names = await files('apps/functions/deploy', '', ['node_modules'])
  const cloud = await treeDigest('apps/functions/deploy', names)
  if (!state.cloud) {
    state.cloud = {
      digest: await zipDigest(root + '/electronicclub-api.zip'),
      sha256: await sha(root + '/electronicclub-api.zip'),
      sourceCommit: execFileSync(
        'git',
        ['log', '-1', '--format=%H', '--', root + '/electronicclub-api.zip'],
        { encoding: 'utf8' },
      ).trim(),
    }
  }
  if (state.cloud.digest !== cloud) {
    execFileSync('npm', ['run', 'package:functions'], { stdio: 'inherit' })
    await writeFile(
      root + '/electronicclub-api.zip',
      await readFile('artifacts/electronicclub-api.zip'),
    )
    const checksum = await sha(root + '/electronicclub-api.zip')
    await writeFile(
      root + '/electronicclub-api.zip.sha256',
      checksum + '  electronicclub-api.zip\n',
    )
    state.cloud = { digest: cloud, sha256: checksum, sourceCommit }
    console.log('Updated CloudBase ZIP')
  } else console.log('CloudBase unchanged: preserved existing ZIP and checksum')
  if (intent.generation > state.generation) {
    const { out, id } = await assembleSelfHost()
    if (state.linux?.digest !== id) {
      await archive(
        out,
        await files(out),
        root + '/electronicclub-linux.tar.gz',
      )
      state.linux = {
        digest: id,
        sha256: await sha(root + '/electronicclub-linux.tar.gz'),
        sourceCommit,
        bytes: (await stat(root + '/electronicclub-linux.tar.gz')).size,
      }
    }
    const toolNames = (await files(out)).filter(
      (n) => n === 'club.sh' || n === 'README.md' || n.startsWith('ops/'),
    )
    const ops = await treeDigest(out, toolNames)
    if (state.operations?.digest !== ops) {
      await archive(out, toolNames, root + '/electronicclub-operations.tar.gz')
      state.operations = {
        digest: ops,
        sha256: await sha(root + '/electronicclub-operations.tar.gz'),
        sourceCommit,
      }
    }
    state.generation = intent.generation
    console.log('Major release processed; unchanged components were preserved')
  } else
    console.log(
      'No new major release: Linux/operations archives not regenerated',
    )
  if (JSON.stringify(state) !== before)
    await writeFile(stateFile, JSON.stringify(state, null, 2) + '\n')
}
if (process.argv[1] === new URL(import.meta.url).pathname) await main()
