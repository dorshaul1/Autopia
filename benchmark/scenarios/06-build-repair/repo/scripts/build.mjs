// "Build": syntax-check every source file, load the public API, and write its manifest to dist/.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const files = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]))
for (const f of files('src')) execFileSync(process.execPath, ['--check', f], { stdio: 'inherit' })
const api = await import(pathToFileURL(join(process.cwd(), 'src/index.js')).href)
mkdirSync('dist', { recursive: true })
writeFileSync('dist/api.json', JSON.stringify({ exports: Object.keys(api).sort() }, null, 2))
console.log('built dist/api.json')
