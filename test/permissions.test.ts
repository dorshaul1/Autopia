import { describe, expect, it } from 'vitest'
import { checkMatch, evaluateChecks, normalizeClaims, refusedChecks, runsCheck, type BashEvidence } from '../src/shared/checks'
import { predictBash, ruleMatches } from '../src/main/claude/policy'
import { buildArgs } from '../src/main/claude/cli'

const ev = (command: string, p: Partial<BashEvidence> = {}): BashEvidence => ({
  command,
  isError: false,
  output: '',
  ms: 10,
  at: 1000,
  founderDenied: false,
  policyDenied: false,
  ...p
})

describe('check evidence', () => {
  it('only counts commands whose exit status is the check status', () => {
    expect(runsCheck('npm test', 'npm test')).toBe(true)
    expect(runsCheck('npm test', 'cd app && npm test 2>&1')).toBe(true)
    expect(runsCheck('npm test 2>&1', 'npm test 2>&1')).toBe(true)
    expect(runsCheck('npm test', 'npm test | tail -5')).toBe(false)
    expect(runsCheck('npm test', 'npm test || true')).toBe(false)
    expect(runsCheck('npm test', 'npm test; echo done')).toBe(false)
    expect(runsCheck('npm test', 'npm testing')).toBe(false)
  })

  it('classifies passed, failed, blocked, declined and missing checks', () => {
    const results = evaluateChecks(
      ['npm test', 'npm run build', 'git status', 'node app.js', 'npm run lint'],
      [
        ev('npm test', { isError: true, output: '1 failing' }),
        ev('npm test'),
        ev('npm run build', { isError: true, output: 'error TS2304' }),
        ev('git status', { isError: true, output: 'Permission to use Bash with command git status has been denied.' }),
        ev('node app.js', { isError: true, founderDenied: true, output: 'The founder declined this' })
      ]
    )
    expect(results.map((r) => r.status)).toEqual(['passed', 'failed', 'blocked', 'denied', 'missing'])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
  })

  // recorded runs: agents often run `node --check a && node --check b && npm test`; each step passed
  it('credits every step of an && chain that exited 0', () => {
    expect(checkMatch('node --check a.js', 'node --check a.js && npm test')).toBe('passOnly')
    expect(checkMatch('npm test', 'node --check a.js && npm test')).toBe('status')
    expect(checkMatch('npm test', 'cd "$(pwd)" && npm test 2>&1')).toBe('status')
    expect(checkMatch('node --check a.js', 'node -e "x && node --check a.js"')).toBe(null)
    for (const loose of ['node --check a.js && npm test || true', 'node --check a.js && npm test; echo $?', 'node --check a.js & npm test'])
      expect(checkMatch('node --check a.js', loose)).toBe(null)
    const chain = ['node --check a.js', 'node --check b.js', 'npm test']
    expect(evaluateChecks(chain, [ev('node --check a.js && node --check b.js && npm test 2>&1')]).map((r) => r.status)).toEqual(['passed', 'passed', 'passed'])
  })

  it('never credits an earlier step of a failed chain, even from an older pass', () => {
    const results = evaluateChecks(['node --check a.js', 'npm test'], [ev('node --check a.js'), ev('node --check a.js && npm test', { isError: true, output: '1 failing' })])
    expect(results.map((r) => r.status)).toEqual(['missing', 'failed'])
    // the latest attempt still decides: a later passing chain wins over an older failure
    expect(evaluateChecks(['npm test'], [ev('npm test', { isError: true }), ev('npm test && npm run build')])[0].status).toBe('passed')
  })

  it('does not require setup commands an agent listed as checks', () => {
    expect(normalizeClaims(['npm install', 'npm ci', 'open index.html', 'pip install -r requirements.txt', 'npm test'])).toEqual(['npm test'])
    expect(normalizeClaims(['npm run open-report'])).toEqual(['npm run open-report'])
  })
})

describe('refused verification', () => {
  it('turns declined or blocked verification attempts into required checks', () => {
    const denied = 'The founder declined this in Autopia.'
    expect(refusedChecks([ev('npm test 2>&1', { isError: true, founderDenied: true, output: denied })])).toEqual(['npm test'])
    expect(refusedChecks([ev('git log', { isError: true, output: 'Permission to use Bash with command git log has been denied.' })])).toEqual([])
    expect(refusedChecks([ev('npm test', { isError: true, founderDenied: true }), ev('npm test')])).toEqual([])
    expect(evaluateChecks(refusedChecks([ev('npm test', { isError: true, founderDenied: true })]), [ev('npm test', { isError: true, founderDenied: true })])[0].status).toBe('denied')
  })
})

describe('managed policy rules', () => {
  const rules = { allow: ['Bash(ls:*)', 'Bash(cat:*)'], deny: ['Bash(git:*)', 'Bash(curl:*)', 'Bash(rm -rf:*)'], ask: [], managedOnly: true }

  it('matches Claude Code rule syntax', () => {
    expect(ruleMatches('Bash(git:*)', 'Bash', 'git status')).toBe(true)
    expect(ruleMatches('Bash(git:*)', 'Bash', 'git')).toBe(true)
    expect(ruleMatches('Bash(git:*)', 'Bash', 'github-cli x')).toBe(false)
    expect(ruleMatches('Bash(npm *)', 'Bash', 'npm test')).toBe(true)
    expect(ruleMatches('Read(**/.env)', 'Bash', '.env')).toBe(false)
  })

  it('predicts allow / ask / deny without assuming everything outside the allow list is blocked', () => {
    expect(predictBash('ls -la', rules)).toBe('allowed')
    expect(predictBash('git status', rules)).toBe('blocked')
    expect(predictBash('npm test', rules)).toBe('approval')
    expect(predictBash('node --version', rules)).toBe('approval')
  })

  it("honours Autopia's allow list only when non-managed rules apply", () => {
    expect(predictBash('npm test', { ...rules, managedOnly: false })).toBe('allowed')
  })
})

describe('runner arguments', () => {
  const base = { cwd: '/tmp', prompt: 'x', systemPrompt: 'y', model: '', sessionId: 's', resume: false, maxBudgetUsd: 0 }
  it('uses the stdio permission prompt so "ask" decisions reach the founder', () => {
    const args = buildArgs({ ...base, mode: 'write', permissionProfile: 'standard' })
    expect(args).toEqual(expect.arrayContaining(['--input-format', 'stream-json', '--permission-prompt-tool', 'stdio', 'acceptEdits']))
    expect(args).not.toContain('--dangerously-skip-permissions')
  })
})

describe('host session isolation', () => {
  it('drops inherited Claude host-session identity but keeps user configuration', async () => {
    const { cleanEnv } = await import('../src/main/claude/cli')
    const env = cleanEnv({ PATH: '/bin', HOME: '/h', CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 's', CLAUDE_CODE_ACCOUNT_UUID: 'a', CLAUDE_CODE_ORGANIZATION_UUID: 'o', CLAUDE_CODE_MESSAGING_SOCKET: '/x', CLAUDE_CODE_USE_BEDROCK: '1', ANTHROPIC_API_KEY: 'k', USE_STAGING_OAUTH: '1' })
    expect(Object.keys(env).sort()).toEqual(['ANTHROPIC_API_KEY', 'CLAUDE_CODE_USE_BEDROCK', 'HOME', 'PATH'])
    expect(cleanEnv({ PATH: '/bin', CLAUDE_CODE_USE_VERTEX: '1', CLAUDE_CODE_MAX_OUTPUT_TOKENS: '9' })).toEqual({ PATH: '/bin', CLAUDE_CODE_USE_VERTEX: '1', CLAUDE_CODE_MAX_OUTPUT_TOKENS: '9' })
  })
})

describe('long-running commands', () => {
  it('never treats servers or watchers as checks', async () => {
    const { isLongRunning } = await import('../src/shared/checks')
    for (const c of ['npm start', 'npm run dev', 'cd app && npm start', 'node server.js', 'npx vite', 'jest --watch']) expect(isLongRunning(c)).toBe(true)
    for (const c of ['npm test', 'npm run build', 'node --check public/js/list.js', 'node --test']) expect(isLongRunning(c)).toBe(false)
  })
})

describe('claimed checks', () => {
  it('splits compound claims and drops notes and servers', async () => {
    const { normalizeClaims } = await import('../src/shared/checks')
    expect(
      normalizeClaims([
        'npm test',
        'node --check a.js && node --check b.js',
        "PORT=3917 npm start (background; confirmed clean boot via task output, then stopped)",
        'cd app && npm test',
        'npm run build — passed locally',
        'node bin/wc.js nope.txt 2>&1; echo exit:$?',
        'npm test || true',
        "node -e \"console.log('a;b')\""
      ])
    ).toEqual(['npm test', 'node --check a.js', 'node --check b.js', 'cd app && npm test', "node -e \"console.log('a;b')\""])
  })
})
