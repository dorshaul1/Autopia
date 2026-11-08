// A stand-in for the `claude` command, for first-run tests. It makes no network calls and no model calls, so it can't bill
// anyone or touch anyone's account: it only speaks Claude Code's command-line and stream format. Behaviour comes from
// files in STANDIN_DIR, so a test can change it between launches. It proves Autopia's handling, not Claude Code's.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

const dir = process.env.STANDIN_DIR
const args = process.argv.slice(2)
const flag = (name) => existsSync(join(dir, name))
const value = (name) => (flag(name) ? readFileSync(join(dir, name), 'utf8').trim() : '')
appendFileSync(join(dir, 'calls.log'), `${args.slice(0, 3).join(' ')}\n`)

const FLAGS = ['--print', '--output-format', '--input-format', '--resume', '--session-id', '--append-system-prompt', '--json-schema', '--allowedTools', '--disallowedTools', '--permission-mode', '--model', '--verbose', '--tools', '--effort', '--plugin-dir', '--agents', '--setting-sources', '--no-session-persistence', '--settings', '--include-partial-messages', '--add-dir']

if (args[0] === '--version') {
  console.log('99.0.0 (Claude Code)')
  process.exit(0)
}
if (args[0] === '--help') {
  // an old copy doesn't know half of what Autopia needs
  console.log((flag('outdated') ? FLAGS.slice(3) .filter((f) => f !== '--json-schema') : FLAGS).map((f) => `  ${f} <value>`).join('\n'))
  process.exit(0)
}
if (args[0] === 'auth' && args[1] === 'status') {
  if (flag('auth-unknown')) process.exit(1)
  console.log(JSON.stringify(flag('signed-in') ? { loggedIn: true, authMethod: 'claude.ai', email: 'someone@example.invalid', subscriptionType: 'pro' } : { loggedIn: false }))
  process.exit(0)
}
if (args[0] === 'auth' && args[1] === 'login') {
  // stands in for a person finishing in their browser; never opens one
  if (flag('login-hangs')) await new Promise(() => {})
  if (flag('login-fails')) {
    console.error('login failed')
    process.exit(1)
  }
  writeFileSync(join(dir, 'signed-in'), '1')
  process.exit(0)
}

// ── a session: read the prompt, say what happened ───────────
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sessionId = args[args.indexOf('--session-id') + 1] || 'standin-session'
const schemaArg = args.indexOf('--json-schema')
const schema = schemaArg >= 0 ? JSON.parse(args[schemaArg + 1]) : null
const lines = createInterface({ input: process.stdin })
const next = () => new Promise((resolve) => lines.once('line', resolve))
await next()

/** The smallest value a schema accepts: it stands in for real planning, and its text says it's a stand-in. */
function fill(s) {
  if (s.enum) return s.enum[0]
  if (s.type === 'string') return 'Stand-in text'
  if (s.type === 'number' || s.type === 'integer') return s.minimum ?? 1
  if (s.type === 'boolean') return true
  if (s.type === 'array') return Array.from({ length: s.minItems ?? 0 }, () => fill(s.items))
  if (s.type === 'object') return Object.fromEntries((s.required ?? []).map((k) => [k, fill(s.properties[k])]))
  return null
}

out({ type: 'system', subtype: 'init', session_id: sessionId, model: 'stand-in', tools: ['Read', 'Write', 'Bash'], permissionMode: 'default', mcp_servers: [] })
const failure = value('session-fails')
if (failure) {
  out({ type: 'result', subtype: 'error_during_execution', is_error: true, result: failure, errors: [failure], session_id: sessionId, num_turns: 0 })
  process.exit(1)
}
await sleep(Number(value('session-ms') || 1500))
const writes = args.includes('--allowedTools') && schema && !schema.properties?.complexity
if (flag('asks-permission') && writes) {
  // a real prompt, on the real control channel: the test decides what to answer, and only ever declines
  out({ type: 'control_request', request_id: 'standin-1', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'rm -rf ./build-output', description: 'Stand-in risky command' } } })
  const answer = JSON.parse(await next())
  writeFileSync(join(dir, 'permission-answer.json'), JSON.stringify(answer.response?.response ?? answer))
}
if (writes) {
  writeFileSync(join(process.cwd(), 'index.html'), '<!doctype html><title>Stand-in</title><h1>Built by the test stand-in</h1>\n')
  out({ type: 'assistant', session_id: sessionId, message: { content: [{ type: 'text', text: 'Wrote index.html.' }] } })
}
out({ type: 'result', subtype: 'success', is_error: false, result: 'Stand-in finished.', structured_output: schema ? fill(schema) : undefined, session_id: sessionId, num_turns: 1, total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0 } })
process.exit(0)
