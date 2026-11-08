import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addStock, createInventory, stockOf } from '../lib/inventory.js'

test('adding stock', () => {
  const inv = createInventory()
  addStock(inv, 'apple', 3)
  addStock(inv, 'apple', 2)
  assert.equal(stockOf(inv, 'apple'), 5)
  assert.equal(stockOf(inv, 'pear'), 0)
})
