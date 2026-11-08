import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildReport as original } from './original/report.js'

const repo = process.env.BENCH_REPO
const { buildReport } = await import(pathToFileURL(join(repo, 'lib/report.js')).href)

// deterministic pseudo-random datasets
function rng(seed) { return () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) }
function dataset(seed, n) {
  const r = rng(seed), pick = (a) => a[Math.floor(r() * a.length)]
  return Array.from({ length: n }, (_, i) => ({
    id: i, customer: pick(['Ana', 'Ben', 'Cy', 'Dee', 'Eve', 'Fay']), region: pick(['North', 'South', 'East', 'West']),
    date: `2026-${String(1 + Math.floor(r() * 12)).padStart(2, '0')}-${String(1 + Math.floor(r() * 28)).padStart(2, '0')}`,
    status: pick(['paid', 'paid', 'paid', 'refunded', 'pending']),
    items: Array.from({ length: 1 + Math.floor(r() * 3) }, () => ({ sku: pick(['A', 'B', 'C', 'D']), qty: 1 + Math.floor(r() * 4), price: Math.round(r() * 5000) / 100 }))
  }))
}

test('output identical on generated datasets', () => {
  for (let s = 1; s <= 40; s++) {
    const d = dataset(s, s % 7 === 0 ? 0 : s * 3)
    assert.equal(buildReport(d), original(d), `dataset ${s}`)
    assert.equal(buildReport(d, { currency: '€', top: 5 }), original(d, { currency: '€', top: 5 }), `dataset ${s} with options`)
  }
})
test('edge cases identical', () => {
  for (const d of [[], [{ id: 1, customer: 'A', region: 'X', date: '2026-01-01', status: 'pending', items: [] }]]) assert.equal(buildReport(d), original(d))
})

// longest function body, by brace matching from each function/arrow/method opener
function longestFunction(src) {
  const lines = src.split('\n')
  let worst = 0
  lines.forEach((line, i) => {
    if (!/\bfunction\b|=>\s*\{|^\s*(async\s+)?[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{/.test(line)) return
    let depth = 0, started = false
    for (let j = i; j < lines.length; j++) {
      for (const ch of lines[j].replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '')) {
        if (ch === '{') { depth++; started = true } else if (ch === '}') depth--
      }
      if (started && depth <= 0) { worst = Math.max(worst, j - i + 1); return }
    }
  })
  return worst
}
const files = (dir) => existsSync(dir) ? readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : f.endsWith('.js') ? [p] : [] }) : []
test('no function longer than 40 lines', () => {
  for (const f of [join(repo, 'lib/report.js'), ...files(join(repo, 'lib/report'))]) {
    const n = longestFunction(readFileSync(f, 'utf8'))
    assert.ok(n <= 40, `${f.slice(repo.length + 1)} has a ${n}-line function`)
  }
})
