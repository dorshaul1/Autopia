import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildReport } from '../lib/report.js'

test('report summarises paid orders', () => {
  const out = buildReport([
    { id: 1, customer: 'Ana', region: 'North', date: '2026-01-05', status: 'paid', items: [{ sku: 'A', qty: 2, price: 5 }] },
    { id: 2, customer: 'Ben', region: 'South', date: '2026-02-01', status: 'refunded', items: [{ sku: 'B', qty: 1, price: 3 }] }
  ])
  assert.match(out, /Paid orders: 1/)
  assert.match(out, /Revenue: \$10\.00/)
  assert.match(out, /Best seller: A \(2 units\)/)
})
