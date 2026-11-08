// What a project really is and what can really be run in it, from the files in its folder. Pure and token-free:
// every claim carries the file that shows it, and no file means no command. Nothing here runs anything.

import { declaredChecks, detectPackageManager, installCommand, runCommand, type PackageManager } from './delivery'

export type ProjectType = 'web' | 'backend' | 'desktop' | 'game' | 'native' | 'library' | 'cli' | 'unknown'
export type OpKind = 'install' | 'typecheck' | 'lint' | 'build' | 'test' | 'custom'

export const TYPE_WORD: Record<ProjectType, string> = { web: 'A web app', backend: 'A backend service', desktop: 'A desktop app', game: 'A game', native: 'A native app', library: 'A library', cli: 'A command-line tool', unknown: 'A project' }

export interface EnvCommand {
  id: string
  kind: OpKind
  label: string
  command: string
  /** The file or line that shows this command exists. */
  from: string
}

export interface RunOption {
  id: string
  label: string
  command: string
  from: string
  /** Whether it should open a port: a page to show, or a process to keep alive. */
  expects: 'port' | 'process'
}

export interface Runtime {
  name: string
  /** The program it needs on this Mac. */
  tool: string
  /** The version the project asks for, if it says. */
  wants: string | null
  from: string
}

/** Your own settings for this project, in `.autopia/operations.json`. Autopia never edits the project's own config for this. */
export interface OpsConfig {
  run?: string
  expects?: 'port' | 'process'
  build?: string
  test?: string
  typecheck?: string
  lint?: string
}

export interface ProjectEnvironment {
  type: ProjectType
  /** Why it was called that. */
  because: string
  languages: string[]
  frameworks: string[]
  packageManager: PackageManager | null
  runtimes: Runtime[]
  run: RunOption[]
  checks: EnvCommand[]
  install: EnvCommand | null
  docs: string[]
  /** Something Autopia can't do from here, and what to do instead. */
  limits: string[]
  /** What couldn't be read, so nothing is silently wrong. */
  problems: string[]
  configured: boolean
}

export interface FolderFacts {
  /** Names at the top of the folder. */
  files: string[]
  /** Contents of the few files that matter, by name. Missing means absent or unreadable. */
  read: Record<string, string>
  /** Whether a `package main` sits at the top of a Go module. */
  goMain?: boolean
  /** Go test files exist. */
  goTests?: boolean
  config?: OpsConfig | null
}

const WEB_FRAMEWORKS: [string, string][] = [['next', 'Next.js'], ['vite', 'Vite'], ['react-scripts', 'Create React App'], ['astro', 'Astro'], ['@sveltejs/kit', 'SvelteKit'], ['nuxt', 'Nuxt'], ['@angular/core', 'Angular'], ['gatsby', 'Gatsby'], ['@remix-run/dev', 'Remix']]
const SERVER_FRAMEWORKS: [string, string][] = [['express', 'Express'], ['fastify', 'Fastify'], ['koa', 'Koa'], ['@nestjs/core', 'NestJS'], ['hono', 'Hono']]
const GAME_LIBS: [string, string][] = [['phaser', 'Phaser'], ['pixi.js', 'PixiJS'], ['three', 'three.js'], ['kaboom', 'Kaboom'], ['excalibur', 'Excalibur']]
const TEST_FRAMEWORKS: [string, string][] = [['vitest', 'Vitest'], ['jest', 'Jest'], ['mocha', 'Mocha'], ['@playwright/test', 'Playwright']]
const LINT_SCRIPTS = ['lint', 'eslint']

const parse = <T>(text: string | undefined): T | null => {
  try {
    return text ? (JSON.parse(text) as T) : null
  } catch {
    return null
  }
}

/** Names of a Makefile's own targets. A variable or a pattern rule isn't one. */
export function makeTargets(text: string): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(/^([A-Za-z][\w-]*)\s*:(?!=)/gm)) out.add(m[1])
  return [...out]
}

interface Manifest {
  name?: string
  private?: boolean
  main?: string
  module?: string
  exports?: unknown
  bin?: unknown
  packageManager?: string
  engines?: { node?: string }
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  build?: unknown
}

export function readEnvironment(f: FolderFacts): ProjectEnvironment {
  const has = (n: string) => f.files.includes(n)
  const env: ProjectEnvironment = { type: 'unknown', because: 'Nothing in the folder says what this is yet.', languages: [], frameworks: [], packageManager: null, runtimes: [], run: [], checks: [], install: null, docs: f.files.filter((n) => /^(readme|contributing|changelog)(\.|$)/i.test(n)), limits: [], problems: [], configured: false }
  const say = (type: ProjectType, because: string) => {
    if (env.type === 'unknown') {
      env.type = type
      env.because = because
    }
  }
  const check = (kind: OpKind, label: string, command: string, from: string) => {
    if (!env.checks.some((c) => c.kind === kind)) env.checks.push({ id: kind, kind, label, command, from })
  }
  const run = (id: string, label: string, command: string, from: string, expects: RunOption['expects']) => {
    if (!env.run.some((r) => r.command === command)) env.run.push({ id, label, command, from, expects })
  }

  // engines first: they decide the type whatever else is in the folder
  if (has('project.godot')) {
    env.frameworks.push('Godot')
    env.languages.push('GDScript')
    env.runtimes.push({ name: 'Godot', tool: 'godot', wants: null, from: 'project.godot' })
    say('game', 'It has a project.godot file.')
  }
  const uproject = f.files.find((n) => n.endsWith('.uproject'))
  if (uproject) {
    env.frameworks.push('Unreal Engine')
    env.languages.push('C++')
    say('game', `It has ${uproject}.`)
    env.limits.push('Unreal projects are built and run from Unreal Editor, not from here.')
  }
  if (has('ProjectSettings') && has('Assets')) {
    env.frameworks.push('Unity')
    env.languages.push('C#')
    say('game', 'It has Unity’s Assets and ProjectSettings folders.')
    env.limits.push('Unity projects are built and run from Unity, not from here.')
  }
  const xcode = f.files.find((n) => n.endsWith('.xcworkspace')) ?? f.files.find((n) => n.endsWith('.xcodeproj'))
  if (xcode) {
    env.languages.push('Swift')
    say('native', `It has ${xcode}.`)
    env.limits.push('Xcode projects are built and run from Xcode. Autopia can open it there, but can’t see it run.')
  }

  // JavaScript and TypeScript
  if (has('package.json')) {
    const m = parse<Manifest>(f.read['package.json'])
    if (!m) env.problems.push('package.json can’t be read, so its scripts are unknown.')
    else {
      const all = { ...m.dependencies, ...m.devDependencies }
      const pm = detectPackageManager(f.files, m.packageManager)
      env.packageManager = pm
      env.languages.push(has('tsconfig.json') || 'typescript' in all ? 'TypeScript' : 'JavaScript')
      env.runtimes.push({ name: 'Node.js', tool: 'node', wants: m.engines?.node ?? f.read['.nvmrc']?.trim() ?? null, from: m.engines?.node ? 'package.json engines' : f.read['.nvmrc'] ? '.nvmrc' : 'package.json' })
      if (pm !== 'npm') env.runtimes.push({ name: pm, tool: pm, wants: null, from: m.packageManager ? 'package.json packageManager' : 'its lockfile' })
      if (Object.keys(all).length) env.install = { id: 'install', kind: 'install', label: 'Install', command: installCommand(pm), from: 'package.json' }
      const named = (list: [string, string][]) => list.filter(([dep]) => dep in all).map(([, name]) => name)
      env.frameworks.push(...named(WEB_FRAMEWORKS), ...named(SERVER_FRAMEWORKS), ...named(GAME_LIBS), ...named(TEST_FRAMEWORKS))
      for (const c of declaredChecks(m.scripts, pm)) check(c.id === 'typecheck' ? 'typecheck' : c.id === 'build' ? 'build' : 'test', c.label, c.command, `the ${c.command.split(' ').pop()} script in package.json`)
      const lint = LINT_SCRIPTS.find((s) => m.scripts?.[s])
      if (lint) check('lint', 'Lint', runCommand(pm, lint), `the ${lint} script in package.json`)
      const electron = 'electron' in all
      const server = named(SERVER_FRAMEWORKS).length > 0
      const web = named(WEB_FRAMEWORKS).length > 0
      const game = named(GAME_LIBS).length > 0
      if (electron) say('desktop', 'It depends on Electron.')
      else if (game && (web || m.scripts?.dev || has('index.html'))) say('game', `It uses ${named(GAME_LIBS)[0]}.`)
      else if (web) say('web', `It uses ${named(WEB_FRAMEWORKS)[0]}.`)
      else if (server) say('backend', `It uses ${named(SERVER_FRAMEWORKS)[0]}.`)
      else if (m.bin) say('cli', 'Its package.json declares a command in bin.')
      else if (!m.private && (m.main || m.module || m.exports)) say('library', 'Its package.json exports code for others to use.')
      else if (has('index.html')) say('web', 'It has an index.html.')
      for (const s of ['dev', 'start', 'serve', 'preview']) {
        if (m.scripts?.[s]) run(s, s === 'dev' ? 'Development server' : s === 'start' ? 'Start' : s === 'serve' ? 'Serve' : 'Preview the build', runCommand(pm, s), `the ${s} script in package.json`, electron ? 'process' : web || server || game ? 'port' : /\b(serve|server|http|listen|vite|next|webpack|parcel)\b/i.test(m.scripts[s]) ? 'port' : 'process')
      }
    }
  }

  // Python: only what its own files name
  const python = has('pyproject.toml') || has('requirements.txt') || has('setup.py') || has('manage.py') || has('Pipfile')
  if (python) {
    const deps = `${f.read['pyproject.toml'] ?? ''}\n${f.read['requirements.txt'] ?? ''}\n${f.read['Pipfile'] ?? ''}`.toLowerCase()
    const dep = (n: string) => new RegExp(`(^|[\\s"'\\[])${n}([\\s"'=<>~!\\[,;]|$)`, 'm').test(deps)
    env.languages.push('Python')
    const wants = f.read['.python-version']?.trim() ?? /requires-python\s*=\s*["']([^"']+)/.exec(f.read['pyproject.toml'] ?? '')?.[1] ?? null
    env.runtimes.push({ name: 'Python', tool: 'python3', wants, from: f.read['.python-version'] ? '.python-version' : wants ? 'pyproject.toml' : has('pyproject.toml') ? 'pyproject.toml' : has('requirements.txt') ? 'requirements.txt' : 'its project files' })
    if (has('requirements.txt')) env.install ??= { id: 'install', kind: 'install', label: 'Install', command: 'python3 -m pip install -r requirements.txt', from: 'requirements.txt' }
    if (has('manage.py')) {
      env.frameworks.push('Django')
      say('backend', 'It has Django’s manage.py.')
      run('django', 'Django server', 'python3 manage.py runserver 127.0.0.1:$PORT', 'manage.py', 'port')
      check('test', 'Tests', 'python3 manage.py test', 'manage.py')
    }
    if (dep('fastapi')) {
      env.frameworks.push('FastAPI')
      say('backend', 'Its dependencies include FastAPI.')
      const module = has('main.py') ? 'main' : has('app.py') ? 'app' : null
      if (module && dep('uvicorn')) run('uvicorn', 'API server', `python3 -m uvicorn ${module}:app --host 127.0.0.1 --port $PORT`, `${module}.py and uvicorn in its dependencies`, 'port')
    }
    if (dep('flask')) {
      env.frameworks.push('Flask')
      say('backend', 'Its dependencies include Flask.')
      if (has('app.py') || has('wsgi.py')) run('flask', 'Flask server', 'python3 -m flask run --host 127.0.0.1 --port $PORT', has('app.py') ? 'app.py' : 'wsgi.py', 'port')
    }
    if (dep('streamlit')) {
      env.frameworks.push('Streamlit')
      say('web', 'Its dependencies include Streamlit.')
      if (has('app.py')) run('streamlit', 'Streamlit app', 'python3 -m streamlit run app.py --server.address 127.0.0.1 --server.port $PORT --server.headless true', 'app.py', 'port')
    }
    if (dep('pytest') || has('pytest.ini') || has('conftest.py') || /\[tool\.pytest/.test(f.read['pyproject.toml'] ?? '')) {
      env.frameworks.push('pytest')
      check('test', 'Tests', 'python3 -m pytest', dep('pytest') ? 'pytest in its dependencies' : has('pytest.ini') ? 'pytest.ini' : has('conftest.py') ? 'conftest.py' : 'pyproject.toml')
    }
    if (dep('mypy') || has('mypy.ini')) check('typecheck', 'Types', 'python3 -m mypy .', has('mypy.ini') ? 'mypy.ini' : 'mypy in its dependencies')
    if (dep('ruff') || has('ruff.toml')) check('lint', 'Lint', 'python3 -m ruff check .', has('ruff.toml') ? 'ruff.toml' : 'ruff in its dependencies')
    if (/\[project\]|\[tool\.poetry\]/.test(f.read['pyproject.toml'] ?? '') && !has('manage.py')) {
      if (/\[project\.scripts\]|\[tool\.poetry\.scripts\]/.test(f.read['pyproject.toml'] ?? '')) say('cli', 'Its pyproject.toml declares a command.')
      else say('library', 'Its pyproject.toml describes a package.')
    }
    if (has('main.py') && env.type === 'unknown') run('main', 'Run it', 'python3 main.py', 'main.py', 'process')
    if (has('main.py')) say('cli', 'It has a main.py and no web framework.')
  }

  // Go
  if (has('go.mod')) {
    env.languages.push('Go')
    env.runtimes.push({ name: 'Go', tool: 'go', wants: /^go\s+([\d.]+)/m.exec(f.read['go.mod'] ?? '')?.[1] ?? null, from: 'go.mod' })
    const web = /\b(gin-gonic|labstack\/echo|gofiber|go-chi|gorilla\/mux)\b/.exec(f.read['go.mod'] ?? '')?.[1]
    if (web) env.frameworks.push({ 'gin-gonic': 'Gin', 'labstack/echo': 'Echo', gofiber: 'Fiber', 'go-chi': 'chi', 'gorilla/mux': 'gorilla/mux' }[web] ?? web)
    say(web ? 'backend' : f.goMain ? 'cli' : 'library', web ? `It uses ${env.frameworks.at(-1)}.` : f.goMain ? 'It’s a Go module with a main package.' : 'It’s a Go module without a main package.')
    if (f.goMain) run('go', web ? 'Service' : 'Run it', 'go run .', 'a main package at the top of the module', web ? 'port' : 'process')
    check('build', 'Build', 'go build ./...', 'go.mod')
    if (f.goTests) check('test', 'Tests', 'go test ./...', 'its _test.go files')
  }

  // Rust
  if (has('Cargo.toml')) {
    const c = f.read['Cargo.toml'] ?? ''
    env.languages.push('Rust')
    env.runtimes.push({ name: 'Rust', tool: 'cargo', wants: /rust-version\s*=\s*"([^"]+)/.exec(c)?.[1] ?? null, from: 'Cargo.toml' })
    const web = /^(actix-web|axum|rocket|warp)\b/m.exec(c)?.[1]
    const engine = /^(bevy|macroquad|ggez)\b/m.exec(c)?.[1]
    if (web) env.frameworks.push(web)
    if (engine) env.frameworks.push(engine)
    const tauri = /^tauri\b/m.test(c)
    say(engine ? 'game' : tauri ? 'desktop' : web ? 'backend' : has('src') && /\[lib\]/.test(c) ? 'library' : 'cli', engine ? `It uses ${engine}.` : tauri ? 'It uses Tauri.' : web ? `It uses ${web}.` : 'It’s a Rust crate.')
    if (!/\[lib\]/.test(c) || /\[\[bin\]\]/.test(c)) run('cargo', web ? 'Service' : 'Run it', 'cargo run', 'Cargo.toml', web ? 'port' : 'process')
    check('build', 'Build', 'cargo build', 'Cargo.toml')
    check('test', 'Tests', 'cargo test', 'Cargo.toml')
    check('lint', 'Lint', 'cargo clippy', 'Cargo.toml')
  }

  // Others that say clearly what they are
  if (has('Package.swift')) {
    env.languages.push('Swift')
    env.runtimes.push({ name: 'Swift', tool: 'swift', wants: null, from: 'Package.swift' })
    say(/\.executable(Target)?\(/.test(f.read['Package.swift'] ?? '') ? 'cli' : 'library', 'It’s a Swift package.')
    if (/\.executable(Target)?\(/.test(f.read['Package.swift'] ?? '')) run('swift', 'Run it', 'swift run', 'Package.swift', 'process')
    check('build', 'Build', 'swift build', 'Package.swift')
    check('test', 'Tests', 'swift test', 'Package.swift')
  }
  if (has('Gemfile')) {
    const g = f.read['Gemfile'] ?? ''
    env.languages.push('Ruby')
    env.runtimes.push({ name: 'Bundler', tool: 'bundle', wants: null, from: 'Gemfile' })
    env.install ??= { id: 'install', kind: 'install', label: 'Install', command: 'bundle install', from: 'Gemfile' }
    if (/gem ['"]rails['"]/.test(g)) {
      env.frameworks.push('Rails')
      say('backend', 'Its Gemfile includes Rails.')
      run('rails', 'Rails server', 'bundle exec rails server -b 127.0.0.1 -p $PORT', 'Gemfile', 'port')
    }
    if (/gem ['"]rspec/.test(g)) check('test', 'Tests', 'bundle exec rspec', 'Gemfile')
  }
  if (has('pom.xml')) {
    env.languages.push('Java')
    env.runtimes.push({ name: 'Maven', tool: 'mvn', wants: null, from: 'pom.xml' })
    say('backend', 'It has a Maven pom.xml.')
    check('build', 'Build', 'mvn -q compile', 'pom.xml')
    check('test', 'Tests', 'mvn -q test', 'pom.xml')
  }
  if (has('gradlew')) {
    env.languages.push('Java or Kotlin')
    say('backend', 'It has a Gradle wrapper.')
    check('build', 'Build', './gradlew build -x test', 'gradlew')
    check('test', 'Tests', './gradlew test', 'gradlew')
  }

  // a Makefile's own targets fill what's still missing
  if (has('Makefile') || has('makefile')) {
    const targets = makeTargets(f.read.Makefile ?? f.read.makefile ?? '')
    const from = (t: string) => `the ${t} target in the Makefile`
    if (targets.length) env.runtimes.push({ name: 'make', tool: 'make', wants: null, from: 'Makefile' })
    for (const [t, kind, label] of [['build', 'build', 'Build'], ['test', 'test', 'Tests'], ['lint', 'lint', 'Lint']] as const) if (targets.includes(t)) check(kind, label, `make ${t}`, from(t))
    for (const t of ['run', 'dev', 'serve', 'start']) if (targets.includes(t) && !env.run.length) run(t, 'Run it', `make ${t}`, from(t), 'process')
    if (has('CMakeLists.txt') === false && !env.languages.length) env.languages.push('Unknown, built with make')
  }
  if (has('CMakeLists.txt')) {
    env.languages.push('C or C++')
    env.runtimes.push({ name: 'CMake', tool: 'cmake', wants: null, from: 'CMakeLists.txt' })
    say('cli', 'It has a CMakeLists.txt.')
    env.limits.push('CMake projects need their own build folder set up first. Tell Autopia the build command below if you have one.')
  }
  if (has('docker-compose.yml') || has('compose.yaml') || has('Dockerfile')) env.limits.push('It has Docker files. Autopia doesn’t start containers; run them yourself if the project needs them.')

  // a page that is nothing but a canvas, with a script driving it: a game or something very like one
  const html = f.read['index.html'] ?? ''
  const words = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  if (env.type === 'unknown' && /<canvas\b/i.test(html) && /<script\b/i.test(html) && words.length < 120) say('game', 'Its page is a canvas driven by a script, with almost no text.')
  // plain pages are served read-only by Autopia itself, without any of the project's code running
  if (env.type === 'unknown' && (has('index.html') || ['public', 'dist', 'build', 'site'].some((d) => has(d) && f.read[`${d}/index.html`] !== undefined))) say('web', 'It has an index.html.')
  if (has('index.html') && !env.languages.length) env.languages.push('HTML')

  // what you set yourself outranks what was worked out
  const c = f.config
  if (c) {
    env.configured = true
    if (c.run) {
      env.run = env.run.filter((r) => r.command !== c.run)
      env.run.unshift({ id: 'configured', label: 'Your run command', command: c.run, from: '.autopia/operations.json', expects: c.expects ?? 'process' })
    }
    for (const [kind, label] of [['build', 'Build'], ['test', 'Tests'], ['typecheck', 'Types'], ['lint', 'Lint']] as const) {
      const command = c[kind]
      if (!command) continue
      env.checks = env.checks.filter((x) => x.kind !== kind)
      env.checks.push({ id: kind, kind, label, command, from: '.autopia/operations.json' })
    }
  }
  const order: OpKind[] = ['typecheck', 'lint', 'build', 'test']
  env.checks.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
  env.languages = [...new Set(env.languages)]
  env.frameworks = [...new Set(env.frameworks)]
  return env
}

/** Words typed into a setting that must never go to a shell as more than one program with its arguments. */
const SHELLY = /[;&|`<>\n]|\$\(/

/** Why this can't be a command Autopia runs for you; null when it can. */
export function commandProblem(command: string): string | null {
  const c = command.trim()
  if (!c) return 'Write the command to run.'
  if (c.length > 300) return 'That’s too long for one command.'
  if (SHELLY.test(c)) return 'Use one command, without ; & | < > or $( ). Put anything longer in a script and run that.'
  return null
}

/** A command as a program and its arguments. Autopia starts these directly: there's no shell to interpret anything. */
export function splitCommand(command: string, port?: number): { bin: string; args: string[] } {
  const parts = command.trim().split(/\s+/).map((p) => (port ? p.replace(/\$PORT\b/g, String(port)) : p))
  return { bin: parts[0], args: parts.slice(1) }
}
