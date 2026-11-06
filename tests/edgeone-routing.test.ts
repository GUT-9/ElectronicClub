import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

test('EdgeOne serves every Vue page on direct access without rewriting APIs or assets', async () => {
  const config = JSON.parse(
    await readFile(new URL('../edgeone.json', import.meta.url), 'utf8'),
  ) as { rewrites: { source: string; destination: string }[] }
  const source = ts.createSourceFile(
    'router.ts',
    await readFile(
      new URL('../apps/web/src/router.ts', import.meta.url),
      'utf8',
    ),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const paths: string[] = []
  const property = (node: ts.ObjectLiteralExpression, name: string) =>
    node.properties.find(
      (item): item is ts.PropertyAssignment =>
        ts.isPropertyAssignment(item) && item.name.getText(source) === name,
    )?.initializer
  const collect = (routes: ts.ArrayLiteralExpression, parent = '') => {
    for (const route of routes.elements) {
      assert.ok(ts.isObjectLiteralExpression(route))
      const path = property(route, 'path')
      assert.ok(path && ts.isStringLiteral(path))
      // The client-only catch-all is not a deployed page.
      if (path.text.includes(':pathMatch')) continue
      const fullPath = path.text.startsWith('/')
        ? path.text
        : `${parent.replace(/\/$/, '')}/${path.text}`
      paths.push(fullPath.replace(/:[\w]+/g, 'test-id'))
      const children = property(route, 'children')
      if (children) {
        assert.ok(ts.isArrayLiteralExpression(children))
        collect(children, fullPath)
      }
    }
  }
  let routeTrees = 0
  const visit = (node: ts.Node) => {
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(source) === 'routes' &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      routeTrees++
      collect(node.initializer)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.equal(routeTrees, 1, 'Expected the Vue router route tree')
  const rewriteFor = (path: string) =>
    config.rewrites.find(({ source }) =>
      source.endsWith('/*')
        ? path.startsWith(source.slice(0, -1))
        : path === source,
    )
  for (const path of paths) {
    if (path === '/') continue // Served by the static index.html.
    assert.equal(rewriteFor(path)?.destination, '/index.html', path)
  }
  for (const path of [
    '/api',
    '/api/health',
    '/api/resources',
    '/assets/app.js',
    '/favicon.ico',
  ]) {
    assert.equal(rewriteFor(path), undefined, path)
  }
})
