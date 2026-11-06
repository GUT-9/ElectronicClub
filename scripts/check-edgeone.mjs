import { build } from 'esbuild'
for (const entry of [
  'edge-functions/api/index.ts',
  'edge-functions/api/[[path]].ts',
]) {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'browser',
    target: 'es2022',
    format: 'esm',
    write: false,
  })
  if (!result.outputFiles.length) throw Error('Missing edge function bundle')
}
console.log('EdgeOne Web API function bundles passed (no Node.js dependencies)')
