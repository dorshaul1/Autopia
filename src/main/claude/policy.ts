import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CapabilityRow, CapabilityStatus, ClaudeInfo, ClaudeSession, PolicyProbe, PolicyReport } from '@shared/types'
import { bypassDisabled, managedSettings, managedSettingsFile, STANDARD_ALLOWED, startClaudeRun } from './cli'

interface Rule {
  tool: string
  pattern: string | null
}

export function parseRule(raw: string): Rule {
  const m = raw.match(/^([A-Za-z_]+)(?:\((.*)\))?$/)
  return m ? { tool: m[1], pattern: m[2] ?? null } : { tool: raw, pattern: null }
}

/** Claude Code rule semantics: `cmd:*` is a word-prefix match, `*` is a wildcard, otherwise exact. */
export function ruleMatches(raw: string, tool: string, subject: string): boolean {
  const r = parseRule(raw)
  if (r.tool !== tool) return false
  if (r.pattern === null) return true
  if (r.pattern.endsWith(':*')) {
    const prefix = r.pattern.slice(0, -2)
    return subject === prefix || subject.startsWith(`${prefix} `)
  }
  if (r.pattern.includes('*')) {
    const re = new RegExp(`^${r.pattern.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`)
    return re.test(subject)
  }
  return r.pattern === subject
}

interface Rules {
  allow: string[]
  deny: string[]
  ask: string[]
  managedOnly: boolean
}

function managedRules(): Rules {
  const s = managedSettings()
  const p = (s?.permissions ?? {}) as { allow?: string[]; deny?: string[]; ask?: string[] }
  return { allow: p.allow ?? [], deny: p.deny ?? [], ask: p.ask ?? [], managedOnly: !!s?.allowManagedPermissionRulesOnly }
}

/** Predicted outcome of one Bash command under the managed rules plus Autopia's standard profile. */
export function predictBash(command: string, rules: Rules): CapabilityStatus {
  if (rules.deny.some((r) => ruleMatches(r, 'Bash', command))) return 'blocked'
  if (rules.ask.some((r) => ruleMatches(r, 'Bash', command))) return 'approval'
  if (rules.allow.some((r) => ruleMatches(r, 'Bash', command))) return 'allowed'
  // Autopia's own --allowedTools only count when the organization lets non-managed rules apply.
  if (!rules.managedOnly && STANDARD_ALLOWED.some((r) => ruleMatches(r, 'Bash', command))) return 'allowed'
  return 'approval'
}

/** Commands the live test runs, keyed by capability id. All are read-only or confined to a temp folder. */
const PROBE_COMMANDS: Record<string, string> = {
  inspect: 'ls',
  node: 'node probe.js',
  tests: 'npm test',
  git: 'git --version',
  network: 'curl --version'
}

export function policyReport(claude: ClaudeInfo, session: ClaudeSession | null, probe: PolicyProbe | null): PolicyReport {
  const s = managedSettings()
  const rules = managedRules()
  const noBypass = bypassDisabled()
  const enforcedModels = s?.enforceAvailableModels && Array.isArray(s.availableModels) ? (s.availableModels as string[]) : null
  const askNote = 'Claude Code asks; Autopia pauses the agent and shows you the exact command to allow or decline.'
  const askFix = rules.managedOnly ? 'To run without asking, an administrator adds an allow rule to the managed policy.' : null
  const bash = (id: string, label: string, example: string, detail: { allowed?: string; blocked?: string }): CapabilityRow => {
    const status = predictBash(example, rules)
    const deny = rules.deny.find((r) => ruleMatches(r, 'Bash', example))
    return {
      id,
      label,
      example,
      status,
      source: status === 'allowed' && !rules.allow.some((r) => ruleMatches(r, 'Bash', example)) ? 'autopia' : status === 'approval' ? 'claude-code' : 'organization',
      detail:
        status === 'blocked'
          ? `Denied by managed rule ${deny}. ${detail.blocked ?? 'Agents cannot run it and Autopia does not run it for them.'}`
          : status === 'allowed'
            ? (detail.allowed ?? 'Runs without asking.')
            : askNote,
      remediation: status === 'blocked' ? 'Only an administrator can change this rule.' : status === 'approval' ? askFix : null,
      evidence: 'policy'
    }
  }
  const secretDenies = rules.deny.filter((r) => r.startsWith('Read(')).length
  const rows: CapabilityRow[] = [
    {
      id: 'read',
      label: 'Read project files',
      example: 'Read',
      status: 'allowed',
      source: 'claude-code',
      detail: secretDenies ? `Allowed in the project folder; ${secretDenies} managed rules hide secrets (.env, keys, credentials).` : 'Allowed in the project folder.',
      remediation: null,
      evidence: 'policy'
    },
    {
      id: 'edit',
      label: 'Create and edit files',
      example: 'Write',
      status: 'allowed',
      source: 'claude-code',
      detail: 'Write tasks run in acceptEdits mode inside an isolated worktree, so edits do not ask.',
      remediation: null,
      evidence: 'policy'
    },
    bash('inspect', 'Inspect (ls, cat, grep)', PROBE_COMMANDS.inspect, {}),
    bash('node', 'Run scripts', PROBE_COMMANDS.node, {}),
    bash('tests', 'Run tests and builds', PROBE_COMMANDS.tests, { allowed: 'Agents run checks with their own Bash tool; Autopia records each exit status.' }),
    bash('install', 'Install dependencies', 'npm install', {}),
    bash('git', 'Git commands by agents', PROBE_COMMANDS.git, {
      blocked: 'Autopia itself creates worktrees, commits and merges as part of its workflow (in its own process, not through the agent); agents are told not to use git.'
    }),
    bash('network', 'Network from the shell', PROBE_COMMANDS.network, {}),
    {
      id: 'full',
      label: 'Full access (skip permission checks)',
      example: '--dangerously-skip-permissions',
      status: noBypass ? 'blocked' : 'approval',
      source: 'organization',
      detail: noBypass ? 'Disabled by the managed policy (disableBypassPermissionsMode). Autopia never requests it.' : 'Available as an opt-in profile in Autopia; off by default.',
      remediation: noBypass ? 'Not needed: commands that need approval are relayed to you instead.' : null,
      evidence: 'policy'
    },
    {
      id: 'rules',
      label: 'Autopia allow list and saved "always allow" rules',
      example: '--allowedTools',
      status: rules.managedOnly ? 'unsupported' : 'allowed',
      source: 'organization',
      detail: rules.managedOnly
        ? 'Claude Code ignores non-managed rules (allowManagedPermissionRulesOnly). Autopia offers "Allow once" and "Allow for this task" (exact command, until the task ends) instead.'
        : 'Autopia passes a standard allow list for build and test tools.',
      remediation: null,
      evidence: 'policy'
    },
    {
      id: 'mcp',
      label: 'MCP servers',
      example: 'mcp',
      status: s?.allowManagedMcpServersOnly ? 'unsupported' : 'unknown',
      source: 'organization',
      detail: s?.allowManagedMcpServersOnly ? 'Only organization-approved servers can load; Autopia does not add any for agents.' : 'Autopia does not configure MCP servers for agents.',
      remediation: null,
      evidence: 'policy'
    }
  ]
  if (probe) {
    const toolFor: Record<string, string> = { ...PROBE_COMMANDS, edit: 'Write' }
    for (const row of rows) {
      const seen = probe.observed[toolFor[row.id]]
      if (!seen) continue
      if (seen !== row.status) row.detail = `Observed ${seen} in the live test (policy predicted ${row.status}). ${row.detail}`
      row.status = seen
      row.evidence = 'probe'
    }
  }
  return {
    cli: { path: claude.path, version: claude.version, available: claude.available },
    managedFile: managedSettingsFile(),
    flags: { managedRulesOnly: rules.managedOnly, bypassDisabled: noBypass, managedMcpOnly: !!s?.allowManagedMcpServersOnly, enforcedModels },
    rules: { allow: rules.allow, deny: rules.deny, ask: rules.ask },
    mode: { requested: 'acceptEdits', reported: session?.permissionMode ?? probe?.permissionMode ?? null, reportedAt: session?.at ?? probe?.at ?? null, apiKeySource: session?.apiKeySource ?? probe?.apiKeySource ?? null },
    capabilities: rows,
    probe
  }
}

/**
 * Founder-initiated compatibility test: one short Claude Code session in a throwaway folder runs
 * harmless commands. Every permission prompt is declined (and recorded as "approval"), so nothing that
 * needs approval actually runs.
 */
export async function runPolicyProbe(claudePath: string, model: string): Promise<PolicyProbe> {
  const dir = mkdtempSync(join(tmpdir(), 'autopia-probe-'))
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'autopia-probe', private: true, scripts: { test: 'node probe.js' } }, null, 2))
  writeFileSync(join(dir, 'probe.js'), "console.log('ok')\n")
  const commands = Object.values(PROBE_COMMANDS)
  const observed: Record<string, CapabilityStatus> = {}
  const asked = new Set<string>()
  const calls = new Map<string, string>()
  let permissionMode: string | null = null
  let apiKeySource: string | null = null
  try {
    const handle = await startClaudeRun(
      claudePath,
      {
        cwd: dir,
        prompt: [
          'Compatibility test. Make exactly these tool calls, one at a time, and do not try alternatives if one is refused:',
          ...commands.map((c, i) => `${i + 1}. Bash: ${c}`),
          `${commands.length + 1}. Write the file probe.txt containing "ok".`,
          'Then reply with the single word: done.'
        ].join('\n'),
        systemPrompt: 'You are running a permission compatibility test for Autopia. Follow the instructions literally.',
        model,
        sessionId: randomUUID(),
        resume: false,
        mode: 'write',
        permissionProfile: 'standard',
        ephemeral: true
      },
      (ev) => {
        if (ev.kind === 'init') {
          permissionMode = ev.permissionMode
          apiKeySource = ev.apiKeySource
        } else if (ev.kind === 'tool_use') {
          const subject = ev.name === 'Bash' ? String(ev.input.command ?? '') : ev.name
          calls.set(ev.toolUseId, subject)
        } else if (ev.kind === 'tool_result') {
          const subject = calls.get(ev.toolUseId)
          if (!subject || observed[subject]) return
          if (asked.has(subject)) observed[subject] = 'approval'
          else if (ev.isError && /has been denied|blocked/i.test(ev.text)) observed[subject] = 'blocked'
          else observed[subject] = 'allowed' // it ran (a non-zero exit still means the policy let it run)
        }
      },
      () => undefined,
      async (req) => {
        asked.add(req.toolName === 'Bash' ? String(req.input.command ?? '') : req.toolName)
        return { behavior: 'deny', message: 'Compatibility test: recorded that this needs approval; not running it.' }
      }
    )
    const outcome = await handle.done
    const r = outcome.result
    return {
      at: Date.now(),
      model: model || null,
      costUsd: r?.costUsd ?? null,
      permissionMode,
      apiKeySource,
      observed,
      error: r ? (r.ok ? null : r.errors.join('; ') || r.subtype) : `Claude Code exited (code ${outcome.exitCode}) without a result`
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
