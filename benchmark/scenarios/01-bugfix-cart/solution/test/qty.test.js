import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addItem, cartTotal, createCart } from '../lib/cart.js'

test('quantity counts', () => {
  const cart = createCart()
  addItem(cart, { sku: 'coffee', name: 'Coffee', price: 3.5 }, 2)
  assert.equal(cartTotal(cart), 7)
})
