import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
const m = await import(pathToFileURL(join(process.env.BENCH_REPO, 'lib/inventory.js')).href)

test('removeStock takes stock away', () => {
  const inv = m.createInventory()
  m.addStock(inv, 'apple', 5)
  m.removeStock(inv, 'apple', 2)
  assert.equal(m.stockOf(inv, 'apple'), 3)
  m.removeStock(inv, 'apple', 3)
  assert.equal(m.stockOf(inv, 'apple'), 0)
})
