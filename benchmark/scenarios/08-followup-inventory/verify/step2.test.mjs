import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
const m = await import(pathToFileURL(join(process.env.BENCH_REPO, 'lib/inventory.js')).href)

test('over-removal throws InsufficientStockError and keeps stock', () => {
  const inv = m.createInventory()
  m.addStock(inv, 'apple', 2)
  assert.equal(typeof m.InsufficientStockError, 'function')
  let err
  try { m.removeStock(inv, 'apple', 5) } catch (e) { err = e }
  assert.ok(err instanceof m.InsufficientStockError)
  assert.ok(err instanceof Error)
  assert.equal(err.sku, 'apple')
  assert.equal(err.requested, 5)
  assert.equal(err.available, 2)
  assert.equal(m.stockOf(inv, 'apple'), 2)
  assert.throws(() => m.removeStock(inv, 'pear', 1), m.InsufficientStockError)
})
test('non-positive quantities are a RangeError', () => {
  const inv = m.createInventory()
  m.addStock(inv, 'apple', 2)
  assert.throws(() => m.removeStock(inv, 'apple', 0), RangeError)
  assert.throws(() => m.removeStock(inv, 'apple', -1), RangeError)
  assert.equal(m.stockOf(inv, 'apple'), 2)
})
