// Launches the packaged app for real, with its own empty data folder, and checks it through its debugging port.
// Starts no Claude session and touches no projects. Writes release/smoke.json, which release-manifest.mjs reads:
// an installer is only ever offered on the website after this has passed for that exact version.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const app = process.argv[2] ?? join(root, 'release/mac-arm64/Autopia.app/Contents/MacOS/Autopia')
if (!existsSync(app)) {
  console.error(`No packaged app at ${app}. Run npm run dist:dir first.`)
  process.exit(1)
}

const PORT = 9346
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const data = mkdtempSync(join(tmpdir(), 'autopia-smoke-'))
const env = { ...process.env, AUTOPIA_USER_DATA: data, AUTOPIA_TEST_WINDOW: '1' }
delete env.ELECTRON_RENDERER_URL
delete env.AUTOPIA_DEV_PORT
const child = spawn(app, [`--remote-debugging-port=${PORT}`], { env, stdio: 'ignore' })
let exited = null
child.on('exit', (code, signal) => (exited = signal ?? code))

const checks = []
const check = (name, ok, detail = '') => {
  checks.push({ name, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`)
}

let page = null
for (let i = 0; i < 40 && !page && exited === null; i++) {
  await sleep(1000)
  try {
    const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
    page = targets.find((t) => t.type === 'page' && t.url.includes('index.html'))
  } catch {
    // not up yet
  }
}
check('starts and opens its window', !!page, exited === null ? '' : `exited: ${exited}`)
if (page) {
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  let id = 0
  const waiting = new Map()
  const errors = []
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data)
    if (d.id && waiting.has(d.id)) {
      waiting.get(d.id)(d)
      waiting.delete(d.id)
    }
    if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.text)
    if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') errors.push(d.params.entry.text.slice(0, 160))
  }
  const cdp = (method, params = {}) =>
    new Promise((r) => {
      const i = ++id
      waiting.set(i, r)
      ws.send(JSON.stringify({ id: i, method, params }))
    })
  const ev = async (expression) => (await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.result?.value
  await cdp('Runtime.enable')
  await cdp('Log.enable')
  await cdp('Page.enable')
  await cdp('Page.reload')
  await sleep(7000)
  check('loads from inside the app, not a dev server', page.url.startsWith('file://') && page.url.includes('app.asar'))
  check('the interface renders', ((await ev('document.body.innerText')) ?? '').includes('What do you want to build?'))
  check('the database opened', existsSync(join(data, 'autopia.db')))
  check('it logs to its own folder', existsSync(join(data, 'logs/autopia.log')))
  check('no development handles', (await ev('typeof window.__store + typeof window.__office')) === 'undefinedundefined')
  check('its content policy names no dev server', !/localhost/.test((await ev(`document.querySelector('meta[http-equiv]').content`)) ?? 'localhost'))
  check('the office pixel font loads', (await ev(`document.fonts.load('10px Silkscreen').then((f) => f.length > 0)`)) === true)
  const claude = JSON.parse((await ev('window.autopia.bootstrap().then((b) => JSON.stringify(b.claude))')) ?? '{}')
  check('it looked for Claude Code and has an answer', typeof claude.available === 'boolean' && (claude.available || !!claude.error), claude.available ? claude.version : 'not found')
  const dir = join(data, 'projects')
  const made = await ev(`window.autopia.createProject({name:'Smoke',goal:'',mode:'new',directory:${JSON.stringify(dir)},initGit:true,officeType:'lab'}).then((p) => p.name + p.officeType, (e) => e.message)`)
  check('it can create a project', made === 'Smokelab', made === 'Smokelab' ? '' : made)
  await sleep(600)
  check('no errors on the page', errors.length === 0, errors.slice(0, 2).join(' | '))
}
child.kill()
await sleep(1200)
const passed = checks.length > 1 && checks.every((c) => c.ok)
writeFileSync(join(root, 'release/smoke.json'), JSON.stringify({ version, passed, at: new Date().toISOString(), checks }, null, 2))
console.log(passed ? `smoke test passed for ${version}` : 'smoke test FAILED')
process.exit(passed ? 0 : 1)
