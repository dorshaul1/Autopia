import { createServer as http } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createNotes } from './lib/notes.js'

const PUBLIC = fileURLToPath(new URL('./public/', import.meta.url))
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }
const SEED = [
  { title: 'Groceries', body: 'Milk, eggs, coffee' },
  { title: 'Ideas', body: 'A tiny notes app with search' },
  { title: 'Call Ana', body: 'About the trip to Porto' }
]

export function createServer(notes = createNotes(SEED)) {
  return http(async (req, res) => {
    const url = new URL(req.url, 'http://x')
    const json = (code, data) => (res.writeHead(code, { 'content-type': 'application/json' }), res.end(JSON.stringify(data)))
    if (url.pathname === '/api/notes' && req.method === 'GET') return json(200, notes.all())
    if (url.pathname === '/api/notes' && req.method === 'POST') {
      let raw = ''
      for await (const c of req) raw += c
      try {
        const { title, body } = JSON.parse(raw || '{}')
        return json(201, notes.add(title, body))
      } catch (e) {
        return json(400, { error: e.message })
      }
    }
    const file = join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname)
    if (!file.startsWith(PUBLIC)) return json(403, { error: 'forbidden' })
    try {
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'text/plain' })
      res.end(await readFile(file))
    } catch {
      json(404, { error: 'not found' })
    }
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000
  createServer().listen(port, () => console.log(`Notes on http://localhost:${port}`))
}
