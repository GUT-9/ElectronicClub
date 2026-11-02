import archiver from 'archiver'
import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
execFileSync('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], {
  cwd: 'apps/functions/deploy',
  stdio: 'inherit',
})
await mkdir('artifacts', { recursive: true })
const output = createWriteStream('artifacts/electronicclub-api.zip'),
  archive = archiver('zip', { zlib: { level: 9 } })
const complete = new Promise((resolve, reject) => {
  output.on('close', resolve)
  archive.on('error', reject)
  output.on('error', reject)
})
archive.pipe(output)
archive.glob('**/*', {
  cwd: 'apps/functions/deploy',
  dot: true,
  ignore: ['**/.env', '**/.env.*', '**/*.pem', '**/*.key'],
})
await archive.finalize()
await complete
console.log(
  'Created artifacts/electronicclub-api.zip (no injected credentials)',
)
