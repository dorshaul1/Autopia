// Looks inside a packaged app before anyone relies on it: what shipped, and that nothing private or
// development-only came along. Read-only. Run after `npm run dist:dir` or `npm run dist:mac`.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const asar = require('@electron/asar')
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const appDir = process.argv[2] ?? join(root, 'release/mac-arm64/Autopia.app/Contents/Resources')
const archive = join(appDir, 'app.asar')
const problems = []
const files = asar.listPackage(archive).map((f) => f.replace(/\\/g, '/'))

const banned = [/^\/(src|test|benchmark|docs|website|scripts|\.claude)\//, /\/\.env/, /autopia\.db/, /\.pem$/, /\.p12$/, /\.map$/, /^\/node_modules\/(typescript|vitest|vite|electron|electron-builder|electron-vite)\//]
for (const f of files) if (banned.some((b) => b.test(f))) problems.push(`shipped by mistake: ${f}`)
for (const need of ['/out/main/index.js', '/out/preload/index.cjs', '/out/renderer/index.html', '/node_modules/better-sqlite3/package.json', '/package.json']) if (!files.includes(need)) problems.push(`missing: ${need}`)

const read = (f) => asar.extractFile(archive, f.slice(1)).toString('utf8')
const secrets = [
  [/sk-ant-[a-z0-9-]{10,}/i, 'an Anthropic key'],
  [/gh[pousr]_[A-Za-z0-9]{20,}/, 'a GitHub token'],
  [/AKIA[0-9A-Z]{16}/, 'an AWS key'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY/, 'a private key']
]
const ours = files.filter((f) => f.startsWith('/out/') && /\.(js|cjs|html|css|json)$/.test(f))
for (const f of ours) {
  const text = read(f)
  if (text.includes(homedir())) problems.push(`mentions this machine's home folder: ${f}`)
  if (text.includes(root)) problems.push(`mentions this repository's path: ${f}`)
  for (const [re, what] of secrets) if (re.test(text)) problems.push(`looks like ${what}: ${f}`)
}
const html = read('/out/renderer/index.html')
if (/localhost/.test(html)) problems.push('the page still points at a dev server')
if (!/Content-Security-Policy/.test(html)) problems.push('no content security policy')
// dev handles are for scripted checks and never ship
const bundle = ours.filter((f) => f.startsWith('/out/renderer/') && f.endsWith('.js')).map(read).join('\n')
for (const h of ['__store', '__actions', '__office']) if (bundle.includes(h)) problems.push(`development handle in the build: ${h}`)

const size = (d) => readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? size(join(d, e.name)) : statSync(join(d, e.name)).size), 0)
console.log(`app.asar: ${files.length} entries, ${(statSync(archive).size / 1e6).toFixed(1)} MB; unpacked: ${(size(`${archive}.unpacked`) / 1e6).toFixed(1)} MB`)
console.log(`version ${JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version}`)
if (problems.length) {
  console.error(`${problems.length} problem(s):\n  ${problems.join('\n  ')}`)
  process.exit(1)
}
console.log('package check passed')
