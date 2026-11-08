import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
const { addItem, cartTotal, createCart } = await import(pathToFileURL(join(process.env.BENCH_REPO, 'lib/cart.js')).href)

test('quantity multiplies the price', () => {
  const cart = createCart()
  addItem(cart, { sku: 'coffee', name: 'Coffee', price: 3.5 }, 2)
  assert.equal(cartTotal(cart), 7)
})
test('adding the same item twice counts both', () => {
  const cart = createCart()
  addItem(cart, { sku: 'coffee', name: 'Coffee', price: 3.5 })
  addItem(cart, { sku: 'coffee', name: 'Coffee', price: 3.5 })
  assert.equal(cartTotal(cart), 7)
})
test('mixed lines and cent rounding', () => {
  const cart = createCart()
  addItem(cart, { sku: 'a', name: 'A', price: 0.1 }, 3)
  assert.equal(cartTotal(cart), 0.3)
  addItem(cart, { sku: 'b', name: 'B', price: 1.99 }, 3)
  assert.equal(cartTotal(cart), 6.27)
})
test('existing behaviour kept', () => {
  assert.equal(cartTotal(createCart()), 0)
  const cart = createCart()
  addItem(cart, { sku: 'tea', name: 'Tea', price: 2.25 })
  assert.equal(cartTotal(cart), 2.25)
})
