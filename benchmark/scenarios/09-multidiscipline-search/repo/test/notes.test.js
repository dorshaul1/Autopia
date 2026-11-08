import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createNotes } from '../lib/notes.js'
import { createServer } from '../server.js'

test('notes store', () => {
  const n = createNotes([{ title: 'a', body: 'b' }])
  n.add('c', 'd')
  assert.equal(n.all().length, 2)
  assert.throws(() => n.add(''), TypeError)
})

test('GET /api/notes', async () => {
  const server = createServer(createNotes([{ title: 'x', body: 'y' }])).listen(0)
  const { port } = server.address()
  const notes = await (await fetch(`http://127.0.0.1:${port}/api/notes`)).json()
  server.close()
  assert.equal(notes.length, 1)
})
