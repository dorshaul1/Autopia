import { afterEach, describe, expect, it } from 'vitest'
import { benchPermission } from '../benchmark/harness/results'
import { buildArgs, HEADLESS_DENY, OPTIONAL_FLAGS, parseHelpFlags, REQUIRED_FLAGS, setSupportedFlags } from '../src/main/claude/cli'
import { directTask } from '../src/main/orchestrator/prompts'
import { triageBrief } from '../src/shared/triage'

const base = { cwd: '/tmp', prompt: 'x', systemPrompt: 'y', model: '', sessionId: 's', resume: false, maxBudgetUsd: 2, effort: 'high' as const, pluginDirs: ['/p'], agents: { reviewer: {} }, settingSources: 'project,local', jsonSchema: {} }
afterEach(() => setSupportedFlags(null))

// an excerpt in the format of `claude --help` 2.1.235
const HELP = `
Options:
  --agents <json>                       JSON object defining custom agents
  --allowedTools, --allowed-tools <tools...>
  --append-system-prompt <prompt>       Append a system prompt
  --disallowedTools, --disallowed-tools <tools...>
  --input-format <format>               Input format (only works with --print)
  --json-schema <schema>                JSON Schema for structured output
  --output-format <format>              Output format
  --permission-mode <mode>              Permission mode
  -p, --print                           Print response and exit
  -r, --resume [value]                  Resume a conversation
  --session-id <uuid>                   Use a specific session ID
  --settings <file-or-json>             Settings
  --setting-sources <sources>           Sources
`

describe('installed CLI compatibility', () => {
  it('reads the flags the installed version documents', () => {
    const f = parseHelpFlags(HELP)
    expect(REQUIRED_FLAGS.every((x) => f.has(x))).toBe(true)
    expect(f.has('--effort')).toBe(false)
  })

  it('never requires an undocumented flag it cannot check', () => {
    expect(REQUIRED_FLAGS).not.toContain('--permission-prompt-tool')
    expect(OPTIONAL_FLAGS).toContain('--effort')
  })

  it('omits optional flags the installed version lacks, keeps the rest', () => {
    setSupportedFlags(parseHelpFlags(HELP))
    const args = buildArgs({ ...base, mode: 'write', permissionProfile: 'standard' })
    for (const missing of ['--effort', '--plugin-dir', '--max-budget-usd']) expect(args).not.toContain(missing)
    expect(args).toEqual(expect.arrayContaining(['--agents', '--setting-sources', '--json-schema', '--permission-prompt-tool']))
  })

  it('passes everything when the version supports it (or help could not be read)', () => {
    const args = buildArgs({ ...base, mode: 'write', permissionProfile: 'standard' })
    expect(args).toEqual(expect.arrayContaining(['--effort', 'high', '--plugin-dir', '/p', '--max-budget-usd', '2']))
  })
})

describe('headless agent tools', () => {
  it('denies interactive and app-only tools in every agent mode', () => {
    for (const mode of ['write', 'validate'] as const) {
      for (const permissionProfile of ['standard', 'full'] as const) {
        const args = buildArgs({ ...base, mode, permissionProfile })
        for (const tool of ['EnterWorktree', 'ExitWorktree', 'EnterPlanMode', 'SendMessage', 'CronCreate']) expect(args, `${mode}/${permissionProfile}`).toContain(tool)
      }
    }
  })

  it('keeps the tools real engineering work needs', () => {
    for (const t of ['Bash', 'Read', 'Edit', 'Write', 'Glob', 'Grep', 'Skill', 'Task', 'Agent', 'TaskCreate', 'TaskStop', 'TaskOutput', 'WebFetch', 'WebSearch', 'ToolSearch', 'StructuredOutput']) expect(HEADLESS_DENY).not.toContain(t)
  })

  it('the light strategy does not name a tool the installed CLI lacks', () => {
    const t = directTask({ goal: 'Add due dates.' } as never, triageBrief('Add due dates.'), true)
    expect(t.description).not.toMatch(/TodoWrite/)
  })
})

describe('benchmark permissions are identical across modes', () => {
  it('allows routine commands a founder would approve and declines risky ones', () => {
    for (const ok of ['npm test', 'node --check lib/a.js', 'cd "$(pwd)" && npm test 2>&1', 'npm run build', 'node bin/todo.js list > /dev/null']) expect(benchPermission(ok), ok).toBe('allow')
    for (const bad of ['rm -rf dist', 'git push origin main', 'curl https://x.dev', 'sudo npm i -g x', 'kill 123', 'pkill -f node', 'git reset --hard', 'echo x > /etc/hosts']) expect(benchPermission(bad), bad).toBe('deny')
  })
})
