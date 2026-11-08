import { test } from 'node:test'
import assert from 'node:assert/strict'
import { badge, formatName, toTitleCase } from '../src/index.js'

test('formats names', () => {
  assert.equal(formatName('ada', 'LOVELACE'), 'Lovelace, Ada')
  assert.equal(badge('grace', 'hopper'), '[GH] Grace')
  assert.equal(toTitleCase('hello  big world'), 'Hello Big World')
})
