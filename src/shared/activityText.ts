// A session's log in plain words: what the teammate is doing, without temporary folder paths or Claude Code's
// notes to itself. Only how it reads changes; the record stays complete, and a row still expands to the details.

const WORKING_COPY = /(?:"|')?\/[^\n"']*?\/worktrees\/[0-9a-f-]{8,}\/[0-9a-f-]{8,}\/?(?:"|')?/g

export function cleanPaths(text: string, cwd?: string | null): string {
  let out = text.replace(WORKING_COPY, (m) => (/["']$/.test(m) ? '.' : ''))
  if (cwd) out = out.split(`${cwd.replace(/\/$/, '')}/`).join('')
  return out.replace(/^cd "?\.?"? && /, '').replace(/^cd \. && /, '')
}

const QUIET_WHEN_OK = /^(Read|Write|Edit|MultiEdit|NotebookEdit|Glob|Grep|TodoWrite|TaskCreate|TaskUpdate)$/

/** null: nothing to add, because the line before it already said this and it went fine. */
export function readableEvent(e: { kind: string; summary: string; toolName: string | null; isError: boolean }, cwd?: string | null): string | null {
  const text = cleanPaths(e.summary, cwd)
  if (e.kind === 'tool_result') {
    if (!e.isError && QUIET_WHEN_OK.test(e.toolName ?? '')) return null
    const body = text.replace(/^\S+ (ok|error)\s*·?\s*/, '').trim()
    if (e.isError) return /declined this/.test(body) ? 'You declined that, so the work carried on without it' : `Didn’t work: ${body}`
    return body ? `Result: ${body}` : 'Finished'
  }
  if (e.kind === 'tool_use') {
    const m = text.match(/^(Read|Write|Edit|Find files|Search|Fetch|Web search|\$) (.*)$/s)
    if (!m) return text
    const rest = m[2].replace(/^cd "?\.?"? && /, '')
    return { Read: `Reading ${rest}`, Write: `Writing ${rest}`, Edit: `Editing ${rest}`, 'Find files': `Looking for ${rest}`, Search: `Searching for ${rest}`, Fetch: `Opening ${rest}`, 'Web search': `Searching the web for ${rest}`, $: `Running ${rest}` }[m[1]] ?? text
  }
  if (e.kind === 'init') {
    const m = text.match(/^Session started · (\S+).*?(?:· (\w+) effort)?$/)
    if (m) return `Started work on ${m[1]}${m[2] ? `, ${m[2]} effort` : ''}`
  }
  return text
}
