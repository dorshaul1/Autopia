import { test } from 'node:test'
import assert from 'node:assert/strict'
import { slugify } from '../lib/slug.js'

test('basic titles', () => {
  assert.equal(slugify('Hello World'), 'hello-world')
  assert.equal(slugify('Crème Brûlée — 2 ways!'), 'creme-brulee-2-ways')
})
test('ampersand becomes and', () => assert.equal(slugify('Salt & Pepper'), 'salt-and-pepper'))
test('separators are trimmed and collapsed', () => assert.equal(slugify('  --Hello--  World__ '), 'hello-world'))
test('custom separator', () => assert.equal(slugify('a b c', { separator: '_' }), 'a_b_c'))
test('maxLength exact fit keeps everything', () => assert.equal(slugify('hello', { maxLength: 5 }), 'hello'))
test('maxLength cuts and trims trailing separator', () => {
  assert.equal(slugify('hello world', { maxLength: 6 }), 'hello')
  assert.equal(slugify('hello wonderful world', { maxLength: 10 }), 'hello-wond')
})
test('empty and non-string input', () => {
  assert.equal(slugify(''), '')
  assert.throws(() => slugify(42), TypeError)
})
