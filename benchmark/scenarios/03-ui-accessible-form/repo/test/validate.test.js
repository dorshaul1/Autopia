import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validate } from '../public/validate.js'

test('valid input has no errors', () => {
  assert.deepEqual(validate({ displayName: 'Ana', email: 'ana@example.com', password: 'longenough' }), {})
})
