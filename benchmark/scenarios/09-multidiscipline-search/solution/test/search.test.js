import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createNotes } from '../lib/notes.js'
import { createServer } from '../server.js'

test('search via ?q=', async () => {
  const server = createServer(createNotes([{ title: 'Tea', body: 'green' }, { title: 'Coffee', body: 'black' }])).listen(0)
  const notes = await (await fetch(`http://127.0.0.1:${server.address().port}/api/notes?q=TEA`)).json()
  server.close()
  assert.deepEqual(notes.map((n) => n.title), ['Tea'])
})
