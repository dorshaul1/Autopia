import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addItem, cartTotal, createCart } from '../lib/cart.js'

test('empty cart totals zero', () => {
  assert.equal(cartTotal(createCart()), 0)
})

test('single items add up', () => {
  const cart = createCart()
  addItem(cart, { sku: 'tea', name: 'Tea', price: 2.25 })
  addItem(cart, { sku: 'cake', name: 'Cake', price: 4 })
  assert.equal(cartTotal(cart), 6.25)
})
