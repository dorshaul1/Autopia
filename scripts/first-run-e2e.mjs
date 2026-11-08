// The first-run experience, through the real packaged app, with throwaway data and a throwaway home folder: your settings,
// projects and Claude login aren't reachable from here. Claude Code is replaced by scripts/fixtures/claude-standin.mjs.
// It refuses to send a request unless the CLI Autopia found is that stand-in, so nothing here can be billed.
//   npm run dist:dir && npm run test:first-run
import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const APP = process.env.AUTOPIA_APP ?? join(root, 'release/mac-arm64/Autopia.app/Contents/MacOS/Autopia')
const SHOTS = process.env.SHOTS ?? null
const only = process.argv[2] ?? null
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const fails = []
const ok = (name, pass, detail = '') => {
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${String(detail).slice(0, 220)})` : ''}`)
  if (!pass) fails.push(name)
}

/** A brand-new person's Mac, as far as the app can tell. */
function sandbox(name, { standin = true, git = true } = {}) {
  const base = mkdtempSync(join(tmpdir(), `autopia-${name}-`))
  const dirs = { base, home: join(base, 'home'), data: join(base, 'data'), bin: join(base, 'bin'), standin: join(base, 'standin') }
  for (const d of [dirs.home, dirs.data, dirs.bin, dirs.standin]) mkdirSync(d, { recursive: true })
  dirs.install = () => writeFileSync(join(dirs.bin, 'claude'), `#!${process.execPath}\nimport(${JSON.stringify(join(root, 'scripts/fixtures/claude-standin.mjs'))})\n`, { mode: 0o755 })
  if (standin) dirs.install()
  dirs.set = (flag, value = '1') => writeFileSync(join(dirs.standin, flag), value)
  dirs.clear = (flag) => existsSync(join(dirs.standin, flag)) && unlinkSync(join(dirs.standin, flag))
  dirs.path = git ? `${dirs.bin}:/usr/bin:/bin` : dirs.bin
  return dirs
}

// a fresh range each run, so a run can never talk to an app left over from an earlier one
let port = 20000 + Math.floor(Math.random() * 20000)
const running = new Set()
async function launch(box) {
  port++
  const env = { PATH: box.path, HOME: box.home, SHELL: '/bin/false', USER: 'tester', TMPDIR: tmpdir(), AUTOPIA_USER_DATA: box.data, AUTOPIA_TEST_WINDOW: '1', STANDIN_DIR: box.standin }
  const child = spawn(APP, [`--remote-debugging-port=${port}`], { env, stdio: 'ignore' })
  running.add(child)
  let page = null
  for (let i = 0; i < 40 && !page; i++) {
    await sleep(700)
    try {
      page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page' && t.url.includes('index.html'))
    } catch {
      // not up yet
    }
  }
  if (!page) throw new Error('the app did not open')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  let id = 0
  const waiting = new Map()
  const errors = []
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data)
    if (d.id && waiting.has(d.id)) (waiting.get(d.id)(d), waiting.delete(d.id))
    if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text)
  }
  const cdp = (method, params = {}) => new Promise((r) => (waiting.set(++id, r), ws.send(JSON.stringify({ id, method, params }))))
  await cdp('Runtime.enable')
  await cdp('Page.enable')
  await cdp('Emulation.setFocusEmulationEnabled', { enabled: true })
  const js = async (expression) => {
    const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'page error')
    return r.result.result.value
  }
  const app = {
    js,
    errors,
    text: () => js('document.body.innerText'),
    has: async (t) => (await js('document.body.innerText')).includes(t),
    until: async (t, ms = 15000) => {
      const end = Date.now() + ms
      while (Date.now() < end) {
        if (typeof t === 'function' ? await t() : await app.has(t)) return true
        await sleep(250)
      }
      return false
    },
    click: (label) => js(`(()=>{const b=[...document.querySelectorAll('button,a,summary')].find(x=>x.innerText.trim().startsWith(${JSON.stringify(label)})&&!x.disabled);if(b)b.click();return !!b})()`),
    disabled: (label) => js(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.innerText.trim().startsWith(${JSON.stringify(label)}));return b?b.disabled:null})()`),
    type: async (text) => {
      await js(`document.querySelector('.create textarea').focus()`)
      await cdp('Input.insertText', { text })
      await sleep(250)
    },
    box: () => js(`document.querySelector('.create textarea')?.value ?? null`),
    claude: () => js('window.autopia.bootstrap().then(b=>({available:b.claude.available,path:b.claude.path,error:b.claude.error,account:b.claude.account}))'),
    focusWindow: () => js(`window.dispatchEvent(new Event('focus'))`),
    shot: async (name) => {
      if (!SHOTS) return
      const r = await cdp('Page.captureScreenshot', { format: 'png' })
      writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(r.result.data, 'base64'))
    },
    quit: async () => {
      child.kill()
      running.delete(child)
      await sleep(1200)
    }
  }
  await app.until(() => js(`!!document.querySelector('.home, .ws-scroll, .office')`), 15000)
  await sleep(800)
  return app
}

/** The one gate: no request is ever sent unless the app really found the stand-in. */
async function assertStandin(app, box) {
  const c = await app.claude()
  if (!c.path?.startsWith(box.bin)) throw new Error(`Refusing to continue: Autopia found a CLI other than the stand-in (${c.path})`)
}

const scenarios = {
  async missing() {
    const box = sandbox('missing', { standin: false })
    let app = await launch(box)
    const c = await app.claude()
    if (c.path) return ok('skipped: a real Claude Code is reachable from a clean PATH, so this Mac can’t test "missing"', true, c.path)
    ok('says what Autopia is', await app.has('small software company'))
    ok('shows the real office', await app.js(`document.querySelector('.welcome-window img')?.naturalWidth > 0`))
    ok('asks one plain thing', await app.has('One thing first: Claude Code'))
    ok('offers the command to copy', await app.has('claude.ai/install.sh'))
    ok('no raw error on show', !(await app.js(`[...document.querySelectorAll('.connect-needed > p, .connect-needed > b')].some(e=>/PATH/.test(e.innerText))`)))
    ok('the technical detail is folded away', await app.js(`!document.querySelector('.connect-detail').open && /PATH/.test(document.querySelector('.connect-detail').textContent)`))
    ok('no second alarm in the header', !(await app.has('isn’t ready')))
    await app.shot('1-missing')
    await app.type('A landing page for my bakery')
    ok('Start waits for Claude Code', (await app.disabled('Start')) === true)
    ok('and says why, and that your words are safe', await app.has('What you wrote stays here'))
    await app.shot('1-missing-typed')
    ok('Start is on screen, not below the fold, at the default window size', await app.js(`(()=>{const b=[...document.querySelectorAll('.create-foot button')].pop();b.scrollIntoView({block:'nearest'});return document.querySelector('.home').scrollTop<220})()`), await app.js(`document.querySelector('.home').scrollTop`))
    await sleep(400)
    await app.quit()
    // the app is closed halfway through setup
    app = await launch(box)
    ok('restart in the middle: your words are still there', (await app.box()) === 'A landing page for my bakery', await app.box())
    ok('restart in the middle: still asks the same one thing', await app.has('One thing first'))
    // you install it in a terminal and come back to the window
    box.install()
    await app.focusWindow()
    ok('coming back to the window notices, with no button', await app.until('Connect your Claude account', 10000))
    ok('your words survive setup', (await app.box()) === 'A landing page for my bakery')
    await app.shot('1-after-install')
    ok('no page errors', app.errors.length === 0, app.errors[0])
    await app.quit()
  },

  async outdated() {
    const box = sandbox('outdated')
    box.set('outdated')
    const app = await launch(box)
    ok('says it needs an update, in plain words', await app.until('Claude Code needs an update'))
    ok('offers the command', await app.has('claude update'))
    ok('no flag names on show', !(await app.js(`[...document.querySelectorAll('.connect-needed > p')].some(e=>/--/.test(e.innerText))`)))
    await app.shot('2-outdated')
    box.clear('outdated')
    box.set('signed-in')
    await app.click('Check again')
    ok('Check again recovers', await app.until(() => app.js(`!document.querySelector('.connect-needed')`)))
    await app.quit()
  },

  async signin() {
    const box = sandbox('signin')
    const app = await launch(box)
    ok('found but not signed in is not treated as ready', await app.until('Connect your Claude account'))
    await app.type('A tiny site')
    ok('Start waits for sign-in', (await app.disabled('Start')) === true)
    await app.shot('3-signed-out')
    // a sign-in that never finishes can be walked away from
    box.set('login-hangs')
    await app.click('Connect Claude')
    ok('shows it’s waiting for the browser', await app.until('Waiting for your browser'))
    await app.shot('3-waiting')
    await app.click('Cancel')
    ok('Cancel gets you back straight away', await app.until(() => app.js(`[...document.querySelectorAll('button')].some(b=>b.innerText.trim()==='Connect Claude'&&!b.disabled)`), 5000))
    ok('cancelling isn’t reported as a failure', !(await app.js(`!!document.querySelector('.connect-needed .bad-text')`)))
    box.clear('login-hangs')
    // a sign-in that fails says so, in words
    box.set('login-fails')
    await app.click('Connect Claude')
    ok('a failed sign-in explains itself', await app.until('Sign-in didn’t finish'))
    ok('without the raw command', !(await app.has('Command failed')))
    box.clear('login-fails')
    await app.click('Connect Claude')
    ok('a real sign-in clears the card', await app.until(() => app.js(`!document.querySelector('.connect-needed')`)))
    ok('then says who you are', await app.has('someone@example.invalid'))
    ok('your words survive sign-in, and Start is on', (await app.box()) === 'A tiny site' && (await app.disabled('Start')) === false)
    await app.shot('3-ready')
    await app.quit()
  },

  async unconfirmed() {
    const box = sandbox('unconfirmed')
    box.set('auth-unknown')
    const app = await launch(box)
    ok('couldn’t tell is never shown as connected', await app.until('couldn’t confirm you’re signed in'))
    await app.type('A tiny site')
    ok('it doesn’t block you', (await app.disabled('Start')) === false)
    await app.shot('4-unconfirmed')
    await app.quit()
  },

  async nogit() {
    const box = sandbox('nogit', { git: false })
    box.set('signed-in')
    const app = await launch(box)
    await assertStandin(app, box)
    await app.type('A tiny site')
    ok('says Git is missing and how to get it', await app.until('xcode-select --install'))
    ok('Start waits', (await app.disabled('Start')) === true)
    await app.shot('5-no-git')
    await app.quit()
  },

  async folder() {
    const box = sandbox('folder')
    box.set('signed-in')
    const app = await launch(box)
    await assertStandin(app, box)
    const dir = await app.js('window.autopia.defaultProjectsDir()')
    mkdirSync(dir, { recursive: true })
    chmodSync(dir, 0o555)
    await app.type('A tiny site')
    await app.click('Start')
    ok('a folder it can’t write to is explained', await app.until('isn’t allowed to write there'), await app.js(`document.querySelector('.create-error')?.innerText`))
    ok('your words stay', (await app.box()) === 'A tiny site')
    ok('and the way out is in front of you', await app.has('Put it somewhere else'))
    await app.shot('6-folder-denied')
    chmodSync(dir, 0o755)
    await app.click('Try again')
    ok('Try again works once it’s fixed', await app.until(() => app.js(`!!document.querySelector('.ws-scroll')`)))
    await app.quit()
  },

  async journey() {
    const box = sandbox('journey')
    box.set('signed-in')
    box.set('session-ms', '6000')
    let app = await launch(box)
    await assertStandin(app, box)
    ok('nothing runs until you ask', !readFileSync(join(box.standin, 'calls.log'), 'utf8').includes('-p'))
    const puffyAt = () => app.js(`document.querySelector('.welcome-puffy')?.getBoundingClientRect().left`)
    const before = await puffyAt()
    await sleep(1500)
    ok('Puffy really walks across the welcome picture', (await puffyAt()) > before, `${before} → ${await puffyAt()}`)
    await app.shot('7-welcome')
    await app.js(`[...document.querySelectorAll('.create-ideas button')][0].click()`)
    await sleep(300)
    ok('an idea fills the box and shows the plan', await app.has('Start'))
    await app.shot('7-plan')
    await app.click('Start')
    ok('lands on the product', await app.until(() => app.js(`!!document.querySelector('.ws-scroll')`)))
    ok('your request is in the conversation', await app.until('landing page for my bakery'))
    ok('the first Overview points at the office', await app.until('Your team is in the office'))
    ok('the draft is gone once it’s sent', await app.js(`localStorage.getItem('autopia:creator-draft')===null`))
    ok('it says the team is planning, while it is', await app.until(() => app.js(`/plan/i.test(document.querySelector('.ws-scroll')?.innerText ?? '')`)))
    await app.shot('7-planning')
    ok('a plan waits for your OK before anything is built', await app.until('Start building', 25000))
    ok('nothing was built before you said so', !existsSync(join(await app.js(`window.autopia.bootstrap().then(b=>b.projects[0].path)`), 'index.html')))
    await app.shot('7-plan-ready')
    await app.click('Start building')
    ok('real work is shown', await app.until(() => app.js(`/is working|Writing code|In progress/.test(document.body.innerText)`), 15000))
    await app.shot('7-working')
    await app.click('Go and see them')
    ok('the office opens', await app.until(() => app.js(`!!document.querySelector('.office canvas')`)))
    ok('one card explains it', await app.until('This is your team'))
    await sleep(2500)
    await app.shot('7-office')
    await app.click('Got it')
    ok('Got it dismisses it', !(await app.has('This is your team')))
    const done = await app.until(() => app.js(`window.autopia.bootstrap().then(b=>window.autopia.deliveries(b.projects[0].id)).then(d=>d[0]?.status==='review')`), 60000)
    ok('a result arrives to review', done, await app.js(`window.autopia.bootstrap().then(b=>window.autopia.deliveries(b.projects[0].id)).then(d=>d[0]?.status+'/'+d[0]?.verification?.state)`))
    ok('the file really exists', existsSync(join(await app.js(`window.autopia.bootstrap().then(b=>b.projects[0].path)`), 'index.html')))
    await app.click('Overview')
    await sleep(1200)
    await app.shot('7-result')
    ok('and you can ask for a change', await app.until('Request a change', 3000))
    ok('no page errors', app.errors.length === 0, app.errors[0])
    await app.quit()
    // coming back
    app = await launch(box)
    ok('returning opens your product', await app.until('bakery'))
    ok('the office card stays gone', !(await app.has('This is your team')))
    ok('the Overview hint stays gone', !(await app.has('Your team is in the office')))
    await app.shot('7-return')
    await app.quit()
  },

  async permission() {
    const box = sandbox('permission')
    box.set('signed-in')
    box.set('asks-permission')
    const app = await launch(box)
    await assertStandin(app, box)
    await app.type('A landing page')
    await app.click('Start')
    const asked = await app.until(() => app.js(`window.autopia.bootstrap().then(b=>b.projects[0]?window.autopia.getProject(b.projects[0].id):{approvals:[]}).then(s=>s.approvals.some(a=>a.status==='pending'&&a.kind==='permission'))`), 30000)
    ok('a permission prompt reaches you', asked)
    ok('the exact command is on screen', await app.until('rm -rf ./build-output', 8000))
    await app.shot('8-permission')
    // this suite only ever declines
    const id = await app.js(`window.autopia.bootstrap().then(b=>window.autopia.getProject(b.projects[0].id)).then(s=>s.approvals.find(a=>a.status==='pending').id)`)
    await app.js(`window.autopia.resolveApproval(${JSON.stringify(id)},{kind:'permission',action:'deny'})`)
    await app.until(() => existsSync(join(box.standin, 'permission-answer.json')), 8000)
    ok('declining reaches Claude Code as a denial', JSON.parse(readFileSync(join(box.standin, 'permission-answer.json'), 'utf8')).behavior === 'deny')
    await app.quit()
  },

  async failure() {
    const box = sandbox('failure')
    box.set('signed-in')
    box.set('session-fails', 'Invalid API key · Please run /login')
    const app = await launch(box)
    await assertStandin(app, box)
    await app.type('A landing page')
    await app.click('Start')
    ok('your request is kept', await app.until('A landing page', 10000))
    const said = await app.until(() => app.js(`/isn’t signed in/.test(document.querySelector('.sheet')?.innerText ?? '')`), 30000)
    ok('a session that can’t start says why in plain words', said, (await app.text()).replace(/\s+/g, ' ').slice(0, 400))
    ok('no raw error on show', !(await app.js(`/Invalid API key/.test(document.body.innerText)`)))
    ok('nothing claims to be working when it’s stopped', await app.until(() => app.js(`!document.querySelector('.work-line .spinner') && /Waiting for you/.test(document.querySelector('.work-line')?.innerText ?? '')`), 5000), await app.js(`document.querySelector('.work-line')?.innerText`))
    ok('it says the fix once, not twice', (await app.js(`(document.querySelector('.sheet').innerText.match(/run claude in a terminal/g) ?? []).length`)) === 1)
    await app.click('Details')
    await sleep(300)
    ok('the original is one click away', await app.has('Invalid API key'))
    await app.click('Hide details')
    await app.shot('9-session-failed')
    ok('there’s something to do next', await app.js(`[...document.querySelectorAll('button')].some(b=>/try again|retry|sign in/i.test(b.innerText))`))
    await app.quit()
  },

  async existing() {
    const box = sandbox('existing')
    box.set('signed-in')
    let app = await launch(box)
    await assertStandin(app, box)
    const dir = await app.js('window.autopia.defaultProjectsDir()')
    mkdirSync(dir, { recursive: true })
    await app.js(`window.autopia.createProject({name:'Old product',goal:'',mode:'new',directory:${JSON.stringify(dir)},initGit:true,officeType:'startup'})`)
    // someone who has been using Autopia since before any of this existed
    await app.js(`localStorage.clear()`)
    await app.quit()
    app = await launch(box)
    ok('no first-run state is created', (await app.js(`localStorage.getItem('autopia:first-run')`)) === null)
    await app.click('Home')
    await app.until(() => app.js(`!!document.querySelector('.home')`))
    ok('no welcome', !(await app.js(`!!document.querySelector('.welcome')`)))
    ok('the product is there', await app.has('Old product'))
    await app.shot('10-existing')
    await app.quit()
  }
}

const names = only ? [only] : Object.keys(scenarios)
for (const name of names) {
  console.log(`\n=== ${name}`)
  try {
    await scenarios[name]()
  } catch (err) {
    ok(`${name} ran to the end`, false, err.message)
  }
  for (const child of running) child.kill()
  running.clear()
}
console.log(fails.length ? `\n${fails.length} PROBLEM(S):\n  ${fails.join('\n  ')}` : '\nALL OK')
process.exit(fails.length ? 1 : 0)
