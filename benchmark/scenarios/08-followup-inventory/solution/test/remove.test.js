import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addStock, createInventory, InsufficientStockError, removeStock, stockOf } from '../lib/inventory.js'

test('remove', () => {
  const inv = createInventory()
  addStock(inv, 'a', 3)
  removeStock(inv, 'a', 1)
  assert.equal(stockOf(inv, 'a'), 2)
  assert.throws(() => removeStock(inv, 'a', 9), InsufficientStockError)
})
