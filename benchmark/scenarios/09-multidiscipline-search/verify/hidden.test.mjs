import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const repo = process.env.BENCH_REPO
const { createServer } = await import(pathToFileURL(join(repo, 'server.js')).href)
const { createNotes } = await import(pathToFileURL(join(repo, 'lib/notes.js')).href)

async function withServer(fn) {
  const notes = createNotes([{ title: 'Groceries', body: 'Milk and COFFEE' }, { title: 'Coffee beans', body: 'order more' }, { title: 'Trip', body: 'Porto in May' }])
  const server = createServer(notes).listen(0)
  await new Promise((r) => server.once('listening', r))
  try { return await fn(`http://127.0.0.1:${server.address().port}`) } finally { server.close() }
}
const titles = (list) => list.map((n) => n.title).sort()

test('search filters title and body, case-insensitively', () => withServer(async (base) => {
  assert.deepEqual(titles(await (await fetch(`${base}/api/notes?q=coffee`)).json()), ['Coffee beans', 'Groceries'])
  assert.deepEqual(titles(await (await fetch(`${base}/api/notes?q=PORTO`)).json()), ['Trip'])
  assert.deepEqual(await (await fetch(`${base}/api/notes?q=zzz`)).json(), [])
  assert.equal((await (await fetch(`${base}/api/notes`)).json()).length, 3)
  assert.equal((await (await fetch(`${base}/api/notes?q=`)).json()).length, 3)
}))
test('creating notes still works and is searchable', () => withServer(async (base) => {
  const r = await fetch(`${base}/api/notes`, { method: 'POST', body: JSON.stringify({ title: 'New idea', body: 'search me' }) })
  assert.equal(r.status, 201)
  assert.deepEqual(titles(await (await fetch(`${base}/api/notes?q=search%20me`)).json()), ['New idea'])
}))
test('frontend has a labelled search box that calls the API', () => {
  const pub = join(repo, 'public')
  const html = readFileSync(join(pub, 'index.html'), 'utf8')
  const js = readdirSync(pub).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(pub, f), 'utf8')).join('\n') + html
  const input = html.match(/<input\b[^>]*(type=["']search["']|id=["'][^"']*search[^"']*["']|name=["']q["'])[^>]*>/i)?.[0]
  assert.ok(input, 'no search input')
  const id = input.match(/\bid=["']([^"']+)["']/)?.[1]
  assert.ok((id && new RegExp(`<label[^>]*for=["']${id}["']`).test(html)) || /aria-label=/.test(input), 'search input has no label')
  assert.match(js, /\/api\/notes\?q=|searchParams\.set\(\s*["']q["']|[?&]q=/)
  assert.match(js, /addEventListener\(\s*["']input["']|oninput/)
})
test('backend tests and README cover search', () => {
  const files = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return f === 'node_modules' ? [] : statSync(p).isDirectory() ? files(p) : [p] })
  const tests = files(repo).filter((f) => /\.test\.[cm]?js$/.test(f) || f.includes('/test/')).map((f) => readFileSync(f, 'utf8')).join('\n')
  assert.match(tests, /[?&]q=|search/i)
  assert.match(readFileSync(join(repo, 'README.md'), 'utf8'), /^#+\s*Search/im)
})
