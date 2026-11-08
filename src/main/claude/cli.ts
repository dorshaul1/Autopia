import { billingFor, billingVarsIn, withoutApiKeys } from './usage'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, extname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { promisify } from 'node:util'
import type { ClaudeInfo, PermissionProfile } from '@shared/types'
import { copiesByVersion, NO_CAPABILITIES, type ClaudeCapabilities } from '@shared/claudeCode'
import { parseStreamLine, type ParsedEvent } from './streamParser'

const execFileAsync = promisify(execFile)

const EXTRA_PATHS = [join(homedir(), '.local/bin'), join(homedir(), '.claude/local'), '/opt/homebrew/bin', '/usr/local/bin']

/**
 * When Autopia is started from inside a Claude Code session (a terminal tab, an IDE or the desktop app),
 * it inherits that host session's identity: its account/organization ids, session ids and auth-refresh
 * socket. Passing those on would make agents run as the host session instead of the Claude Code login
 * you use in a terminal, so they are removed. Variables you set yourself (API keys, Bedrock/Vertex) stay.
 */
const HOST_SESSION_VARS = /^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_AGENT_SDK_\w+|CLAUDE_PREVIEW_\w+|USE_STAGING_OAUTH|USE_LOCAL_OAUTH|CLAUDE_CODE_(?!USE_BEDROCK$|USE_VERTEX$|USE_FOUNDRY$|SKIP_\w+_AUTH$|MAX_OUTPUT_TOKENS$)\w+)$/

export function hostSessionVars(env: NodeJS.ProcessEnv): string[] {
  if (!env.CLAUDECODE && !env.CLAUDE_CODE_HOST_SESSION_ID && !env.CLAUDE_CODE_SESSION_ID) return []
  return Object.keys(env).filter((k) => HOST_SESSION_VARS.test(k))
}

export function cleanEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out = { ...env }
  for (const k of hostSessionVars(env)) delete out[k]
  return out
}

function withPath(path: string): NodeJS.ProcessEnv {
  const parts = new Set([...path.split(':'), ...EXTRA_PATHS].filter(Boolean))
  return { ...cleanEnv(process.env), PATH: [...parts].join(':') }
}

let loginEnv: Promise<NodeJS.ProcessEnv> | null = null

/**
 * Apps launched from Finder get a minimal PATH. Ask the user's login shell for the real one so
 * both `claude` and the tools it shells out to (npm, node, git…) resolve as they do in a terminal.
 * Heavy shell profiles can take many seconds, so this is resolved once and cached.
 */
export function resolveLoginEnv(): Promise<NodeJS.ProcessEnv> {
  loginEnv ??= (async () => {
    const shell = process.env.SHELL || '/bin/zsh'
    try {
      const { stdout } = await execFileAsync(shell, ['-ilc', 'printf "__AUTOPIA_PATH__%s" "$PATH"'], { timeout: 30000, env: cleanEnv(process.env) })
      const m = stdout.match(/__AUTOPIA_PATH__(.*)$/m)
      if (m?.[1]) return withPath(m[1])
    } catch {
      // fall back to the inherited PATH plus common install locations
    }
    return withPath(process.env.PATH ?? '')
  })()
  return loginEnv
}

/**
 * Your choice in Settings to use the Claude subscription even when API-key variables are set:
 * agents' environment then leaves ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN out. Off by default
 * (Claude Code decides, exactly as in a terminal). Nothing else about authentication is touched.
 */
let ignoreApiKeys = false
export function setIgnoreApiKeys(on: boolean): void {
  ignoreApiKeys = on
}
const agentEnv = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => (ignoreApiKeys ? (withoutApiKeys(env) as NodeJS.ProcessEnv) : env)

/** Every official copy we know where to find: Claude Code's own installs, the desktop app's and the VS Code extension's. */
function installedClaudes(): string[] {
  const home = homedir()
  const under = (dir: string, map: (name: string) => string[]) => {
    try {
      return readdirSync(dir).flatMap(map)
    } catch {
      return []
    }
  }
  return [
    ...under(join(home, '.local/share/claude/versions'), (v) => [join(home, '.local/share/claude/versions', v)]),
    ...under(join(home, 'Library/Application Support/Claude/claude-code'), (v) => under(join(home, 'Library/Application Support/Claude/claude-code', v), (build) => [join(home, 'Library/Application Support/Claude/claude-code', v, build, 'claude.app/Contents/MacOS/claude')])),
    ...under(join(home, '.vscode/extensions'), (x) => (x.startsWith('anthropic.claude-code-') ? [join(home, '.vscode/extensions', x, 'resources/native-binary/claude')] : []))
  ].filter((p) => existsSync(p))
}

/** Highest version first, going by where it's installed; only as many are run as it takes to find one that works. */
async function newestWorkingClaude(env: NodeJS.ProcessEnv, copies: string[]): Promise<string | null> {
  const named = copies.map((path) => {
    let real = path
    try {
      real = realpathSync(path)
    } catch {
      // a broken link just fails below
    }
    return { path, version: /(\d+\.\d+\.\d+)/.exec(real.split('/').filter((p) => /\d+\.\d+\.\d+/.test(p)).pop() ?? '')?.[1] ?? '0.0.0' }
  })
  for (const c of copiesByVersion(named)) {
    try {
      await execFileAsync(c.path, ['--version'], { env, timeout: 15000 })
      return c.path
    } catch {
      // won't run: try the next
    }
  }
  return null
}

/**
 * The login shell's environment is what agents actually get, so an API key in ~/.zshrc counts for who pays. It can be
 * slow to arrive, so this corrects the picture afterwards rather than making everything wait for it.
 */
export async function withLoginEnv(info: ClaudeInfo): Promise<ClaudeInfo> {
  if (!info.path) return info
  const login = await resolveLoginEnv()
  const account = await claudeAccount(info.path, agentEnv(login))
  return { ...info, account, billing: billingFor(account, billingVarsIn({ ...process.env, ...login }), null, ignoreApiKeys) }
}

export async function detectClaude(): Promise<ClaudeInfo> {
  // Look in the inherited PATH and well-known install locations first (instant), then the login shell's PATH.
  const find = (env: NodeJS.ProcessEnv) => (env.PATH ?? '').split(':').map((d) => join(d, 'claude')).find((c) => existsSync(c)) ?? null
  const env = withPath(process.env.PATH ?? '')
  // a heavy shell profile can take many seconds: it's started now, but only waited for if there's nowhere else to look
  void resolveLoginEnv()
  const known = [find(env), ...installedClaudes()].filter((p): p is string => !!p)
  const loginFound = known.length ? null : find(await resolveLoginEnv())
  // the newest official copy on this Mac: a stale one on PATH must never hold back the models you can use
  const path = await newestWorkingClaude(env, loginFound ? [loginFound] : [...new Set(known)])
  const restrictions = managedRestrictions()
  const allowedModels = managedModels()
  if (!path) {
    return { available: false, path: null, version: null, error: 'Claude Code CLI not found on PATH. Install it and sign in, then retry.', restrictions, allowedModels }
  }
  try {
    const { stdout } = await execFileAsync(path, ['--version'], { env, timeout: 15000 })
    const version = stdout.trim()
    supportedFlags = await cliFlags(path, env)
    const missing = REQUIRED_FLAGS.filter((f) => supportedFlags && !supportedFlags.has(f))
    if (missing.length) {
      return { available: false, path, version, error: `This Claude Code version (${version}) lacks ${missing.join(', ')}, which Autopia needs to run agents. Update Claude Code (claude update), then check again.`, restrictions, allowedModels }
    }
    const optionalMissing = OPTIONAL_FLAGS.filter((f) => supportedFlags && !supportedFlags.has(f))
    if (optionalMissing.length) restrictions.push(`This Claude Code version does not support ${optionalMissing.join(', ')}; Autopia runs without ${optionalMissing.length === 1 ? 'it' : 'them'}. Updating Claude Code restores ${optionalMissing.length === 1 ? 'it' : 'them'}.`)
    const account = await claudeAccount(path, agentEnv(env))
    const billing = billingFor(account, billingVarsIn(process.env), null, ignoreApiKeys)
    return { available: true, path, version, error: null, restrictions, allowedModels, account, billing }
  } catch (err) {
    return { available: false, path, version: null, error: `claude --version failed: ${(err as Error).message}`, restrictions, allowedModels }
  }
}

/**
 * Flags the installed CLI documents in `claude --help` (read once per detection, no session, no model
 * call). Autopia never passes an optional flag the installed version does not have, and refuses to run
 * agents when a required one is missing, instead of failing every session with an unknown option.
 */
let supportedFlags: Set<string> | null = null

/**
 * Without these Autopia cannot drive or verify an agent session. `--permission-prompt-tool` is also
 * needed but is not listed in `--help` (it is undocumented), so it cannot be checked this way.
 */
export const REQUIRED_FLAGS = ['--print', '--output-format', '--input-format', '--resume', '--session-id', '--append-system-prompt', '--json-schema', '--allowedTools', '--disallowedTools', '--permission-mode']
/** Used when present; sessions still work without them. */
export const OPTIONAL_FLAGS = ['--effort', '--plugin-dir', '--agents', '--setting-sources', '--max-budget-usd', '--no-session-persistence', '--settings', '--include-partial-messages']

export function parseHelpFlags(help: string): Set<string> {
  return new Set([...help.matchAll(/(?:^|[\s,])(--[a-z][a-z0-9-]*)/gim)].map((m) => m[1]))
}

async function cliFlags(path: string, env: NodeJS.ProcessEnv): Promise<Set<string> | null> {
  try {
    const { stdout } = await execFileAsync(path, ['--help'], { env, timeout: 15000 })
    const flags = parseHelpFlags(stdout)
    return flags.size > 10 ? flags : null // unreadable help: assume a current CLI rather than guess
  } catch {
    return null
  }
}

/** For tests and diagnostics: what the last detection found (null = not read; everything assumed). */
export function setSupportedFlags(flags: Set<string> | null): void {
  supportedFlags = flags
}

const supports = (flag: string) => !supportedFlags || supportedFlags.has(flag)

/** The Claude Code login agents will use (`claude auth status`), exactly as a terminal sees it. */
async function claudeAccount(path: string, env: NodeJS.ProcessEnv): Promise<ClaudeInfo['account']> {
  try {
    const { stdout } = await execFileAsync(path, ['auth', 'status'], { env, timeout: 15000 })
    const s = JSON.parse(stdout) as { loggedIn?: boolean; authMethod?: string; email?: string; orgName?: string; subscriptionType?: string }
    if (!s.loggedIn) return { loggedIn: false, email: null, organization: null, plan: null, method: null }
    return { loggedIn: true, email: s.email ?? null, organization: s.orgName ?? null, plan: s.subscriptionType ?? null, method: s.authMethod ?? null }
  } catch {
    return null
  }
}

const MANAGED_SETTINGS = ['/Library/Application Support/ClaudeCode/managed-settings.json', '/etc/claude-code/managed-settings.json']

export function managedSettingsFile(): string | null {
  return MANAGED_SETTINGS.find((f) => existsSync(f)) ?? null
}

/**
 * Organization-managed settings take precedence over everything Autopia passes on the command line.
 * Autopia reads them only to explain and predict; Claude Code itself enforces them.
 */
export function managedSettings(): Record<string, unknown> | null {
  const file = managedSettingsFile()
  if (!file) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/** Models the organization allows, when it enforces a list. */
export function managedModels(): string[] | null {
  const s = managedSettings()
  return s?.enforceAvailableModels && Array.isArray(s.availableModels) ? (s.availableModels as string[]) : null
}

export function bypassDisabled(): boolean {
  const p = managedSettings()?.permissions as { disableBypassPermissionsMode?: string } | undefined
  return p?.disableBypassPermissionsMode === 'disable'
}

export function managedRestrictions(): string[] {
  const s = managedSettings()
  if (!s) return []
  const out: string[] = []
  if (s.allowManagedPermissionRulesOnly) {
    out.push(
      "Your organization's Claude Code policy only honours its own permission rules. Commands outside its allow list ask for approval, which Autopia shows you while the agent waits; commands on its deny list are refused. See Settings → Claude Code & permissions."
    )
  }
  if (bypassDisabled()) out.push('Full-access mode (skipping permission checks) is disabled by your organization.')
  return out
}

// Tools an agent may use without prompting under the "standard" profile. Anything else goes through
// Claude Code's normal "ask" path, which Autopia surfaces to the founder (see onPermission). When the
// organization enforces managed-only permission rules, Claude Code ignores this list by design.
export const WORK_TOOLS = ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'NotebookEdit', 'AskUserQuestion']

export const STANDARD_ALLOWED = [
  'Read',
  'Edit',
  'Write',
  'MultiEdit',
  'Glob',
  'Grep',
  'TodoWrite',
  'NotebookEdit',
  'Bash(npm *)',
  'Bash(npx *)',
  'Bash(pnpm *)',
  'Bash(yarn *)',
  'Bash(node *)',
  'Bash(tsc *)',
  'Bash(python3 *)',
  'Bash(pytest *)',
  'Bash(cargo *)',
  'Bash(go *)',
  'Bash(make *)',
  'Bash(ls *)',
  'Bash(mkdir *)',
  'Bash(cat *)',
  'Bash(git status*)',
  'Bash(git diff*)',
  'Bash(git log*)'
]

/**
 * Tools that only make sense in an interactive Claude Code app, or that would undermine Autopia's own
 * coordination: agents run headless in an Autopia-managed git worktree and talk to the founder through
 * Autopia (questions, permissions), so they never schedule, message, switch worktrees, enter plan mode
 * or open app-only surfaces. Recorded sessions were offered all of these; denying them also keeps
 * their descriptions out of every agent's context.
 */
export const HEADLESS_DENY = [
  'Monitor',
  'CronCreate',
  'CronDelete',
  'CronList',
  'ScheduleWakeup',
  'RemoteTrigger',
  'PushNotification',
  'EnterPlanMode',
  'ExitPlanMode',
  'EnterWorktree',
  'ExitWorktree',
  'SendMessage',
  'ListAgents',
  'Artifact',
  'DesignSync',
  'Workflow',
  'ReportFindings'
]

export interface RunSpec {
  cwd: string
  prompt: string
  systemPrompt: string
  model: string
  /** New session id to assign, or an existing one to resume. */
  sessionId: string
  resume: boolean
  /** validate = Bash only, normal permission prompts (founder-requested revalidation). */
  /** chat: no tools at all. readonly: can read the project. */
  /** direct: Claude Code as it comes, in the project folder: every tool, your settings, and it asks before acting. */
  mode: 'chat' | 'readonly' | 'write' | 'validate' | 'direct'
  permissionProfile: PermissionProfile
  /**
   * Only the benchmark harness sets this (to honour spending approvals for measured runs). Autopia
   * itself never caps a session: Claude Code's own plan limits apply.
   */
  maxBudgetUsd?: number
  jsonSchema?: object
  /** Do not save the session to disk (compatibility tests). */
  ephemeral?: boolean
  /** Plugin directories for this session only (routed, approved skills). */
  pluginDirs?: string[]
  /** Subagents for this session (--agents JSON). */
  agents?: object | null
  /** Which settings sources to load; 'project,local' keeps personal skills/plugins out of agent sessions. */
  settingSources?: string
  /** Claude Code reasoning effort for this session (low … max). */
  effort?: ClaudeEffort
  /** Files that go in the message itself: images and PDFs natively, text inline. */
  attachments?: string[]
  /** The reply as it's written. Having this asks Claude Code for partial messages. */
  onPartial?: (text: string) => void
}

export type ClaudeEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

const IMAGE_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }
const MAX_IMAGE = 5 * 1024 * 1024
const MAX_PDF = 20 * 1024 * 1024
const MAX_TEXT = 100 * 1024

/** The message as Claude Code's own content blocks, so an attachment reaches it whether or not it has a Read tool. */
export function userContent(prompt: string, files: string[] = []): string | object[] {
  const blocks: object[] = []
  const notes: string[] = []
  for (const file of files) {
    const name = basename(file).replace(/^\d+-/, '')
    const size = existsSync(file) ? statSync(file).size : -1
    const type = IMAGE_TYPES[extname(file).toLowerCase()]
    if (size < 0) notes.push(`${name} couldn't be found.`)
    else if (type && size <= MAX_IMAGE) blocks.push({ type: 'image', source: { type: 'base64', media_type: type, data: readFileSync(file).toString('base64') } })
    else if (extname(file).toLowerCase() === '.pdf' && size <= MAX_PDF) blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: readFileSync(file).toString('base64') } })
    else if (!type && size <= MAX_TEXT) blocks.push({ type: 'text', text: `Attached file ${name}:\n${readFileSync(file, 'utf8')}` })
    else notes.push(`${name} is too large to include here; it is at ${file}.`)
  }
  if (!blocks.length && !notes.length) return prompt
  return [...blocks, { type: 'text', text: [prompt, ...notes].join('\n\n') }]
}

/** Scheduling needs a session that stays open; a one-shot run would accept the request and never act on it. */
export const DIRECT_DENY = ['Monitor', 'CronCreate', 'CronDelete', 'CronList', 'ScheduleWakeup']

const hasProjectSkills = (cwd: string) => ['skills', 'commands'].some((d) => existsSync(join(cwd, '.claude', d)))

export function buildArgs(spec: RunSpec): string[] {
  // Bidirectional stream-json + the stdio permission prompt tool: Claude Code sends a can_use_tool
  // control request whenever its own policy says "ask", and Autopia answers with the founder's decision.
  const args = ['-p', '--output-format', 'stream-json', '--input-format', 'stream-json', '--verbose', '--permission-prompt-tool', 'stdio']
  if (supports('--replay-user-messages')) args.push('--replay-user-messages')
  args.push(...(spec.resume ? ['--resume', spec.sessionId] : ['--session-id', spec.sessionId]))
  if (spec.model) args.push('--model', spec.model)
  if ((spec.maxBudgetUsd ?? 0) > 0 && supports('--max-budget-usd')) args.push('--max-budget-usd', String(spec.maxBudgetUsd))
  args.push('--append-system-prompt', spec.systemPrompt)
  // Agents are headless workers: no personal auto-memory, no scheduling or background monitors.
  if (spec.mode !== 'direct' && supports('--settings')) args.push('--settings', JSON.stringify({ autoMemoryEnabled: false }))
  if (spec.onPartial && supports('--include-partial-messages')) args.push('--include-partial-messages')
  if (spec.jsonSchema) args.push('--json-schema', JSON.stringify(spec.jsonSchema))
  if (spec.ephemeral && supports('--no-session-persistence')) args.push('--no-session-persistence')
  if (spec.settingSources && supports('--setting-sources')) args.push('--setting-sources', spec.settingSources)
  if (spec.effort && supports('--effort')) args.push('--effort', spec.effort)
  if (supports('--plugin-dir')) for (const d of spec.pluginDirs ?? []) args.push('--plugin-dir', d)
  if (spec.agents && supports('--agents')) args.push('--agents', JSON.stringify(spec.agents))
  // what headless workers use: Claude Code otherwise sends about 30 tool definitions on every single turn
  if (spec.mode === 'write' && supports('--tools')) args.push('--tools', [...WORK_TOOLS, ...(spec.agents ? ['Task'] : []), ...(spec.pluginDirs?.length || hasProjectSkills(spec.cwd) ? ['Skill'] : [])].join(','))
  if (spec.mode === 'write' && spec.permissionProfile === 'full') args.push('--disallowedTools', ...HEADLESS_DENY)
  if (spec.mode === 'direct') {
    // never skips a permission, whatever the profile: this one acts directly in your project folder
    args.push('--permission-mode', 'default', '--disallowedTools', ...DIRECT_DENY)
  } else if (spec.mode === 'validate') {
    args.push('--tools', 'Bash', '--permission-mode', 'default', '--disallowedTools', ...HEADLESS_DENY)
  } else if (spec.mode === 'chat') {
    args.push('--tools', '', '--permission-mode', 'default')
  } else if (spec.mode === 'readonly') {
    args.push('--tools', 'Read,Glob,Grep', '--permission-mode', 'default')
  } else if (spec.permissionProfile === 'full') {
    args.push('--dangerously-skip-permissions')
  } else {
    args.push('--permission-mode', 'acceptEdits', '--allowedTools', ...STANDARD_ALLOWED)
    args.push('--disallowedTools', 'Bash(git push*)', 'Bash(rm -rf*)', 'Bash(sudo *)', ...HEADLESS_DENY)
  }
  return args
}

export interface RunOutcome {
  ok: boolean
  cancelled: boolean
  result: Extract<ParsedEvent, { kind: 'result' }> | null
  exitCode: number | null
  stderr: string
}

export interface PermissionRequest {
  requestId: string
  toolName: string
  input: Record<string, unknown>
  /** Rules Claude Code suggests for "always allow" (e.g. Bash "npm test *"). */
  suggestions: string[]
}

export type PermissionDecision = { behavior: 'allow'; updatedInput?: Record<string, unknown> } | { behavior: 'deny'; message: string }

export interface RunHandle {
  pid: number | undefined
  cancel(): void
  /** Adds a message to the running conversation; Claude Code takes it at its next step. False once it can't. */
  send(text: string): boolean
  done: Promise<RunOutcome>
}

/** Spawns one headless Claude Code session, streams parsed events, and relays permission prompts. */
export async function startClaudeRun(
  claudePath: string,
  spec: RunSpec,
  onEvent: (e: ParsedEvent) => void,
  onStderr: (line: string) => void,
  onPermission: (req: PermissionRequest) => Promise<PermissionDecision>
): Promise<RunHandle> {
  const env = agentEnv(await resolveLoginEnv())
  // Never ask for unrestricted execution when the organization disabled it.
  if (spec.permissionProfile === 'full' && bypassDisabled()) spec = { ...spec, permissionProfile: 'standard' }
  const child: ChildProcess = spawn(claudePath, buildArgs(spec), {
    cwd: spec.cwd,
    env: { ...env, CLAUDE_CODE_ENTRYPOINT: 'autopia' },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const write = (msg: object) => {
    if (child.stdin && !child.stdin.destroyed) child.stdin.write(JSON.stringify(msg) + '\n')
  }
  // The prompt is a stream-json user message; stdin stays open so permission answers can be sent.
  write({ type: 'user', message: { role: 'user', content: userContent(spec.prompt, spec.attachments) } })

  let cancelled = false
  let result: RunOutcome['result'] = null
  const stderrBuf: string[] = []

  createInterface({ input: child.stdout! }).on('line', (line) => {
    if (line.startsWith('{"type":"control_request"')) {
      let msg: { request_id: string; request: { subtype: string; tool_name?: string; input?: Record<string, unknown>; permission_suggestions?: unknown[] } }
      try {
        msg = JSON.parse(line)
      } catch {
        return
      }
      if (msg.request.subtype !== 'can_use_tool') {
        // Unknown control requests are answered with an error so the CLI never waits forever.
        write({ type: 'control_response', response: { subtype: 'error', request_id: msg.request_id, error: `Unsupported request: ${msg.request.subtype}` } })
        onEvent({ kind: 'system', text: `Claude Code asked for something Autopia can't answer yet: ${msg.request.subtype}` })
        return
      }
      const input = msg.request.input ?? {}
      const suggestions = (msg.request.permission_suggestions ?? []).flatMap((s) => {
        const rules = (s as { rules?: { toolName: string; ruleContent?: string }[] }).rules
        return Array.isArray(s) ? (s as { toolName: string; ruleContent?: string }[]) : rules ?? []
      })
      void onPermission({
        requestId: msg.request_id,
        toolName: msg.request.tool_name ?? 'tool',
        input,
        suggestions: suggestions.map((r) => (r.ruleContent ? `${r.toolName}(${r.ruleContent})` : r.toolName))
      }).then((d) =>
        write({
          type: 'control_response',
          response: {
            subtype: 'success',
            request_id: msg.request_id,
            response: d.behavior === 'allow' ? { behavior: 'allow', updatedInput: d.updatedInput ?? input } : { behavior: 'deny', message: d.message }
          }
        })
      )
      return
    }
    for (const ev of parseStreamLine(line, spec.cwd)) {
      if (ev.kind === 'result') {
        result = ev
        child.stdin?.end()
      }
      onEvent(ev)
    }
  })
  createInterface({ input: child.stderr! }).on('line', (line) => {
    if (!line.trim()) return
    stderrBuf.push(line)
    if (stderrBuf.length > 200) stderrBuf.shift()
    onStderr(line)
  })

  const done = new Promise<RunOutcome>((resolve) => {
    let settled = false
    const finish = (exitCode: number | null) => {
      if (settled) return
      settled = true
      resolve({
        ok: !cancelled && !!result?.ok,
        cancelled,
        result,
        exitCode,
        stderr: stderrBuf.join('\n')
      })
    }
    child.on('error', (err) => {
      stderrBuf.push(err.message)
      finish(null)
    })
    // 'close' fires after stdio streams end, so every line has been delivered.
    child.on('close', (code) => finish(code))
  })

  return {
    pid: child.pid,
    cancel() {
      if (cancelled || child.exitCode !== null) return
      cancelled = true
      // Claude Code's own interrupt first, so the session stays whole and can be resumed
      write({ type: 'control_request', request_id: `stop-${randomUUID()}`, request: { subtype: 'interrupt' } })
      setTimeout(() => {
        if (child.exitCode !== null) return
        child.kill('SIGTERM')
        setTimeout(() => child.exitCode === null && child.kill('SIGKILL'), 5000).unref()
      }, 2000).unref()
    },
    send(text) {
      if (!supports('--replay-user-messages') || result || cancelled || child.exitCode !== null || !child.stdin || child.stdin.destroyed) return false
      write({ type: 'user', message: { role: 'user', content: text } })
      return true
    },
    done
  }
}

/**
 * What Claude Code offers in this folder, from its own handshake: no prompt is sent, so this uses none of your plan.
 * Anything it can't say comes back empty rather than guessed.
 */
export async function discoverCapabilities(claudePath: string, cwd: string): Promise<ClaudeCapabilities> {
  const env = agentEnv(withPath(process.env.PATH ?? ''))
  const child = spawn(claudePath, ['-p', '--output-format', 'stream-json', '--input-format', 'stream-json', '--verbose', '--tools', '', '--no-session-persistence'], { cwd, env: { ...env, CLAUDE_CODE_ENTRYPOINT: 'autopia' }, stdio: ['pipe', 'pipe', 'ignore'] })
  return new Promise((resolve) => {
    const caps: ClaudeCapabilities = { ...NO_CAPABILITIES }
    let waiting = 2
    const finish = () => {
      clearTimeout(limit)
      child.kill('SIGTERM')
      resolve(caps)
    }
    const limit = setTimeout(finish, 15_000)
    child.on('error', finish)
    createInterface({ input: child.stdout! }).on('line', (line) => {
      if (!line.startsWith('{"type":"control_response"')) return
      try {
        const { response } = JSON.parse(line) as { response: { request_id: string; response?: Record<string, unknown> } }
        const r = response.response ?? {}
        if (response.request_id === 'caps-init') {
          caps.version = (r.claude_code_version as string | undefined) ?? null
          caps.commands = ((r.commands as { name: string; description?: string; argumentHint?: string }[]) ?? []).map((c) => ({ name: c.name, description: c.description ?? '', argumentHint: c.argumentHint ?? '' }))
          caps.agents = ((r.agents as ({ name: string } | string)[]) ?? []).map((a) => (typeof a === 'string' ? a : a.name))
          caps.models = ((r.models as { value: string; displayName?: string; description?: string }[]) ?? []).map((m) => ({ value: m.value, label: m.displayName ?? m.value, about: m.description ?? '' }))
        } else if (response.request_id === 'caps-mcp') {
          caps.mcpServers = ((r.mcpServers as { name: string; status: string }[]) ?? []).map((m) => ({ name: m.name, status: m.status }))
        } else return
      } catch {
        return
      }
      if (--waiting === 0) finish()
    })
    child.stdin!.write(JSON.stringify({ type: 'control_request', request_id: 'caps-init', request: { subtype: 'initialize' } }) + '\n')
    child.stdin!.write(JSON.stringify({ type: 'control_request', request_id: 'caps-mcp', request: { subtype: 'mcp_status' } }) + '\n')
  })
}

/** The newest Claude Code published. Best effort: no answer just means no notice. */
export async function latestClaudeVersion(): Promise<string | null> {
  const env = agentEnv(await resolveLoginEnv())
  try {
    const { stdout } = await execFileAsync('npm', ['view', '@anthropic-ai/claude-code', 'version'], { env, timeout: 8000 })
    return /^\d+\.\d+\.\d+/.test(stdout.trim()) ? stdout.trim() : null
  } catch {
    return null
  }
}

/** Claude Code's own updater, only ever because you pressed the button. */
export async function updateClaudeCode(claudePath: string): Promise<string> {
  const env = agentEnv(await resolveLoginEnv())
  const { stdout, stderr } = await execFileAsync(claudePath, ['update'], { env, timeout: 180_000 })
  return `${stdout}${stderr}`.trim()
}

/** Whether a model name really works here, by asking it one short thing. Claude Code's own answer is the verdict. */
export async function tryModel(claudePath: string, cwd: string, model: string): Promise<{ ok: boolean; said: string }> {
  const env = agentEnv(await resolveLoginEnv())
  const child = spawn(claudePath, ['-p', '--output-format', 'stream-json', '--input-format', 'stream-json', '--verbose', '--tools', '', '--no-session-persistence', '--model', model], { cwd, env: { ...env, CLAUDE_CODE_ENTRYPOINT: 'autopia' }, stdio: ['pipe', 'pipe', 'ignore'] })
  child.stdin!.write(JSON.stringify({ type: 'user', message: { role: 'user', content: 'Reply with only: ok' } }) + '\n')
  return new Promise((resolve) => {
    const limit = setTimeout(() => (child.kill('SIGTERM'), resolve({ ok: false, said: 'No answer within a minute.' })), 60_000)
    child.on('error', (err) => (clearTimeout(limit), resolve({ ok: false, said: err.message })))
    let real = false
    createInterface({ input: child.stdout! }).on('line', (line) => {
      try {
        const m = JSON.parse(line) as { type: string; message?: { model?: string }; result?: string; is_error?: boolean }
        if (m.type === 'assistant' && m.message?.model && m.message.model !== '<synthetic>') real = true
        if (m.type === 'result') {
          clearTimeout(limit)
          child.kill('SIGTERM')
          // an API error can arrive as an ordinary-looking result, written by the CLI itself
          resolve(real && !m.is_error ? { ok: true, said: 'It works.' } : { ok: false, said: (m.result ?? 'It didn’t answer.').slice(0, 300) })
        }
      } catch {
        // not a line we read
      }
    })
  })
}

/** Claude Code's own sign-in, in your browser. Autopia never sees your password or token. */
export async function connectClaudeAccount(claudePath: string, signal?: AbortSignal): Promise<void> {
  const env = agentEnv(await resolveLoginEnv())
  await execFileAsync(claudePath, ['auth', 'login'], { env, timeout: 300_000, signal })
}
