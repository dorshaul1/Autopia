import { describe, expect, it } from 'vitest'
import { cleanPaths, readableEvent } from '../src/shared/activityText'

const W = '/Users/x/Library/Application Support/Autopia/worktrees/a7b9a409-86c5-44b7-9b84-11aae81c5af0/86cd7742-3601-43a8-8c77-ada8fb50e5b9'
const ev = (kind: string, summary: string, toolName: string | null = null, isError = false) => ({ kind, summary, toolName, isError })

describe('reading a session log', () => {
  it('no temporary paths, even with spaces in them', () => {
    expect(cleanPaths(`File at ${W}/src/App.tsx (x)`)).toBe('File at src/App.tsx (x)')
    expect(cleanPaths(`cd "${W}" && npm test`)).toBe('npm test')
  })
  it('a successful write says nothing more than the line before it', () => {
    expect(readableEvent(ev('tool_result', `Write ok · File created successfully at: ${W}/src/App.tsx (file state is current in your context)`, 'Write'), W)).toBeNull()
    expect(readableEvent(ev('tool_result', 'Read ok · 1 {', 'Read'), W)).toBeNull()
  })
  it('actions read as plain sentences', () => {
    expect(readableEvent(ev('tool_use', 'Write src/App.tsx', 'Write'))).toBe('Writing src/App.tsx')
    expect(readableEvent(ev('tool_use', 'Read src/App.tsx', 'Read'))).toBe('Reading src/App.tsx')
    expect(readableEvent(ev('tool_use', `$ cd "${W}" && npm test`, 'Bash'))).toBe('Running npm test')
  })
  it('problems stay visible, in plain words', () => {
    expect(readableEvent(ev('tool_result', `Write error · cannot write ${W}/a.ts`, 'Write', true))).toBe('Didn’t work: cannot write a.ts')
    expect(readableEvent(ev('tool_result', 'Bash error · The user declined this in Autopia. Do not retry', 'Bash', true))).toMatch(/You declined/)
  })
  it('a command shows its result', () => {
    expect(readableEvent(ev('tool_result', 'Bash ok · 3 passed', 'Bash'))).toBe('Result: 3 passed')
  })
  it('the start of a session', () => {
    expect(readableEvent(ev('init', 'Session started · claude-opus-5 · acceptEdits permissions · medium effort'))).toBe('Started work on claude-opus-5, medium effort')
  })
})
