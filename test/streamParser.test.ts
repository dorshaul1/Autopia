import { describe, expect, it } from 'vitest'
import { describeTool, parseStreamLine } from '../src/main/claude/streamParser'

const cwd = '/repo'

describe('parseStreamLine', () => {
  it('parses init', () => {
    const [e] = parseStreamLine(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1', model: 'm', tools: ['Read'] }), cwd)
    expect(e).toMatchObject({ kind: 'init', sessionId: 's1', model: 'm', tools: ['Read'] })
  })

  it('ignores thinking_tokens noise and empty thinking', () => {
    expect(parseStreamLine(JSON.stringify({ type: 'system', subtype: 'thinking_tokens' }), cwd)).toEqual([])
    const msg = { type: 'assistant', message: { content: [{ type: 'thinking', thinking: '' }] } }
    expect(parseStreamLine(JSON.stringify(msg), cwd)).toEqual([])
  })

  it('summarises tool calls with paths relative to cwd', () => {
    const msg = { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: '/repo/src/a.ts' } }] } }
    const [e] = parseStreamLine(JSON.stringify(msg), cwd)
    expect(e).toMatchObject({ kind: 'tool_use', toolUseId: 't1', name: 'Edit', summary: 'Edit src/a.ts' })
  })

  it('parses tool results including errors', () => {
    const msg = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: [{ type: 'text', text: 'boom' }] }] } }
    expect(parseStreamLine(JSON.stringify(msg), cwd)).toEqual([{ kind: 'tool_result', toolUseId: 't1', isError: true, text: 'boom' }])
  })

  it('parses a successful result with structured output', () => {
    const line = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '{}', structured_output: { a: 1 }, total_cost_usd: 0.01, num_turns: 2, session_id: 's1' })
    expect(parseStreamLine(line, cwd)[0]).toMatchObject({ kind: 'result', ok: true, structured: { a: 1 }, costUsd: 0.01, numTurns: 2 })
  })

  it('reports permission denials and the effective permission mode', () => {
    const result = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      permission_denials: [{ tool_name: 'Bash', tool_use_id: 'x', tool_input: { command: 'git status' } }]
    })
    expect(parseStreamLine(result, cwd)[0]).toMatchObject({ denials: [{ toolName: 'Bash', command: 'git status' }] })
    const init = JSON.stringify({ type: 'system', subtype: 'init', session_id: 's', tools: [], permissionMode: 'acceptEdits', apiKeySource: 'none' })
    expect(parseStreamLine(init, cwd)[0]).toMatchObject({ kind: 'init', permissionMode: 'acceptEdits', apiKeySource: 'none' })
  })

  it('marks budget/turn-limit results as failures', () => {
    const line = JSON.stringify({ type: 'result', subtype: 'error_max_budget_usd', is_error: false })
    expect(parseStreamLine(line, cwd)[0]).toMatchObject({ kind: 'result', ok: false, subtype: 'error_max_budget_usd' })
  })

  it('surfaces non-JSON output as a system event', () => {
    expect(parseStreamLine('not json', cwd)[0]).toMatchObject({ kind: 'system' })
  })

  it('describes bash commands on one line', () => {
    expect(describeTool('Bash', { command: 'npm test\n  --silent' }, cwd)).toBe('$ npm test --silent')
  })
})
