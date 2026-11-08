import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { commandMatches, directCommand, NO_CAPABILITIES, questionBody, questionChoices } from '../src/shared/claudeCode'
import { buildArgs, DIRECT_DENY, userContent, WORK_TOOLS, type RunSpec } from '../src/main/claude/cli'
import { parseStreamLine } from '../src/main/claude/streamParser'

const base: RunSpec = { cwd: '/tmp/none', prompt: 'p', systemPrompt: 's', model: '', sessionId: 'x', resume: false, mode: 'write', permissionProfile: 'standard' }
const after = (args: string[], flag: string) => args[args.indexOf(flag) + 1]
const dir = () => mkdtempSync(join(tmpdir(), 'autopia-46-'))

describe('messages for Claude Code itself', () => {
  it('its own commands go as written, with arguments', () => {
    expect(directCommand('/context', ['context'])).toEqual({ prompt: '/context' })
    expect(directCommand('/code-review src/a.ts', ['code-review'])).toEqual({ prompt: '/code-review src/a.ts' })
    expect(directCommand('/figma:figma-use a b', ['figma:figma-use'])).toEqual({ prompt: '/figma:figma-use a b' })
  })
  it('/claude sends anything, with nothing added', () => {
    expect(directCommand('/claude list my mcp tools', [])).toEqual({ prompt: 'list my mcp tools' })
    expect(directCommand('/claude', [])).toBeNull()
  })
  it('anything else stays with the team', () => {
    expect(directCommand('/etc/hosts looks wrong', ['context'])).toBeNull()
    expect(directCommand('/nosuch thing', ['context'])).toBeNull()
    expect(directCommand('please run /context', ['context'])).toBeNull()
  })
  it('the menu comes from what Claude Code reports', () => {
    const caps = { ...NO_CAPABILITIES, commands: [{ name: 'review', description: '', argumentHint: '' }, { name: 'code-review', description: '', argumentHint: '' }] }
    expect(commandMatches('/', caps)?.map((c) => c.name)).toEqual(['claude', 'review', 'code-review'])
    expect(commandMatches('/rev', caps)?.map((c) => c.name)).toEqual(['review', 'code-review'])
    expect(commandMatches('/review now', caps)).toBeNull()
    expect(commandMatches('hello', caps)).toBeNull()
  })
})

describe('direct mode', () => {
  const args = buildArgs({ ...base, mode: 'direct' })
  it('has every tool and your own settings', () => {
    expect(args).not.toContain('--tools')
    expect(args).not.toContain('--setting-sources')
    expect(args).not.toContain('--settings')
  })
  it('always asks, even under the full profile', () => {
    const full = buildArgs({ ...base, mode: 'direct', permissionProfile: 'full' })
    expect(after(full, '--permission-mode')).toBe('default')
    expect(full).not.toContain('--dangerously-skip-permissions')
    expect(full).not.toContain('--allowedTools')
  })
  it('only refuses what a one-shot session could never carry out', () => {
    for (const t of DIRECT_DENY) expect(args).toContain(t)
    expect(args).not.toContain('AskUserQuestion')
    expect(args).not.toContain('SendMessage')
  })
  it('streams only when someone is reading', () => {
    expect(args).not.toContain('--include-partial-messages')
    expect(buildArgs({ ...base, mode: 'direct', onPartial: () => undefined })).toContain('--include-partial-messages')
  })
})

describe('workers', () => {
  it('can ask you with the real tool, and it is not denied', () => {
    expect(WORK_TOOLS).toContain('AskUserQuestion')
    const args = buildArgs(base)
    expect(after(args, '--tools')).toContain('AskUserQuestion')
    expect(args.slice(args.indexOf('--disallowedTools'))).not.toContain('AskUserQuestion')
  })
  it('get the Skill tool only where the project has skills or commands', () => {
    expect(after(buildArgs(base), '--tools')).not.toContain('Skill')
    const d = dir()
    mkdirSync(join(d, '.claude', 'skills'), { recursive: true })
    expect(after(buildArgs({ ...base, cwd: d }), '--tools')).toContain('Skill')
  })
})

describe('attachments in the message', () => {
  it('no files: the message stays plain', () => expect(userContent('hello')).toBe('hello'))
  it('images and PDFs go natively, text inline, and the words last', () => {
    const d = dir()
    writeFileSync(join(d, '1-a.png'), Buffer.from([1, 2, 3]))
    writeFileSync(join(d, '2-b.PDF'), Buffer.from([4]))
    writeFileSync(join(d, '3-c.md'), '# notes')
    const c = userContent('look', [join(d, '1-a.png'), join(d, '2-b.PDF'), join(d, '3-c.md')]) as Record<string, any>[]
    expect(c[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AQID' } })
    expect(c[1].type).toBe('document')
    expect(c[2].text).toBe('Attached file c.md:\n# notes')
    expect(c[3]).toEqual({ type: 'text', text: 'look' })
  })
  it('says so when one is missing or too big instead of dropping it', () => {
    const d = dir()
    writeFileSync(join(d, 'big.txt'), 'x'.repeat(200 * 1024))
    const c = userContent('look', [join(d, 'gone.png'), join(d, 'big.txt')]) as { text: string }[]
    expect(c).toHaveLength(1)
    expect(c[0].text).toMatch(/gone\.png couldn't be found/)
    expect(c[0].text).toMatch(/big\.txt is too large/)
  })
})

describe('its own questions', () => {
  const q = { question: 'Tea or coffee?', header: 'Drink', options: [{ label: 'Tea', description: 'Hot — and calm' }, { label: 'Coffee' }], multiSelect: true }
  it('read as plain text and give the choices back', () => {
    const body = questionBody(q)
    expect(body.split('\n')[0]).toBe('Tea or coffee?')
    const c = questionChoices(body)
    expect(c.question).toBe('Tea or coffee?')
    expect(c.options).toEqual([{ label: 'Tea', description: 'Hot — and calm' }, { label: 'Coffee', description: '' }])
    expect(c.multiSelect).toBe(true)
  })
  it('an ordinary question has no choices', () => {
    expect(questionChoices('Which database?\nIt matters for hosting.')).toEqual({ question: 'Which database?\nIt matters for hosting.', options: [], multiSelect: false })
  })
})

describe('reading its stream', () => {
  const one = (o: object) => parseStreamLine(JSON.stringify(o), '/tmp')
  it('words as they come, without a subagent’s', () => {
    expect(one({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } } })).toEqual([{ kind: 'partial', text: 'Hi' }])
    expect(one({ type: 'stream_event', parent_tool_use_id: 'x', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } } })).toEqual([])
    expect(one({ type: 'stream_event', event: { type: 'message_start' } })).toEqual([])
  })
  it('shows retries and compaction, and ignores what it doesn’t know', () => {
    expect(one({ type: 'system', subtype: 'api_retry', attempt: 2, max_retries: 5 })[0]).toMatchObject({ kind: 'system', text: expect.stringMatching(/attempt 2 of 5/) })
    expect(one({ type: 'system', subtype: 'compact_boundary' })[0]).toMatchObject({ kind: 'system' })
    expect(one({ type: 'system', subtype: 'something_new_in_a_later_version' })).toEqual([])
    expect(one({ type: 'a_brand_new_message' })).toEqual([])
  })
})
