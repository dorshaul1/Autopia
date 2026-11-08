// Pure translation of Claude Code `--output-format stream-json` lines into normalized events.
// Kept free of Electron/Node side effects so it is unit-testable.

import { relative, isAbsolute } from 'node:path'

export type ParsedEvent =
  | { kind: 'init'; sessionId: string; model: string | null; tools: string[]; permissionMode: string | null; mcpServers: { name: string; status: string }[]; apiKeySource: string | null; skills: string[]; agents: string[] }
  | { kind: 'thinking'; text: string }
  /** Text as it's being written (--include-partial-messages). */
  | { kind: 'partial'; text: string }
  | { kind: 'user_echo'; text: string }
  /** Claude Code's own plan-usage signal (status, which limit, reset time, extra usage). */
  | { kind: 'rateLimit'; info: Record<string, unknown> }
  | { kind: 'text'; text: string }
  | { kind: 'tool_use'; toolUseId: string; name: string; input: Record<string, unknown>; summary: string }
  | { kind: 'tool_result'; toolUseId: string; isError: boolean; text: string }
  | {
      kind: 'result'
      ok: boolean
      subtype: string
      text: string | null
      structured: unknown
      costUsd: number | null
      numTurns: number | null
      sessionId: string | null
      errors: string[]
      usage: Usage | null
      durationMs: number | null
      apiMs: number | null
      /** Tool calls Claude Code refused (policy deny, or a denied permission request). */
      denials: { toolName: string; command: string }[]
    }
  | { kind: 'system'; text: string }

type Json = Record<string, unknown>

export interface Usage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function usageOf(u: unknown): Usage | null {
  if (!u || typeof u !== 'object') return null
  const o = u as Json
  const input = num(o.input_tokens)
  const output = num(o.output_tokens)
  if (input === null && output === null) return null
  return {
    inputTokens: input ?? 0,
    outputTokens: output ?? 0,
    cacheReadTokens: num(o.cache_read_input_tokens) ?? 0,
    cacheWriteTokens: num(o.cache_creation_input_tokens) ?? 0
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

export function rel(cwd: string, p: unknown): string {
  const s = str(p)
  if (!s || !isAbsolute(s)) return s
  const r = relative(cwd, s)
  return r.startsWith('..') ? s : r || '.'
}

export function oneLine(s: string, max = 160): string {
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat
}

/** Human summary of a tool call, derived only from its real input. */
export function describeTool(name: string, input: Json, cwd: string): string {
  switch (name) {
    case 'Read':
      return `Read ${rel(cwd, input.file_path)}`
    case 'Write':
      return `Write ${rel(cwd, input.file_path)}`
    case 'Edit':
    case 'MultiEdit':
      return `Edit ${rel(cwd, input.file_path)}`
    case 'NotebookEdit':
      return `Edit notebook ${rel(cwd, input.notebook_path)}`
    case 'Bash':
      return `$ ${oneLine(str(input.command), 120)}`
    case 'Glob':
      return `Find files ${str(input.pattern)}`
    case 'Grep':
      return `Search "${oneLine(str(input.pattern), 60)}"`
    case 'TodoWrite':
      return 'Update todo list'
    case 'WebFetch':
      return `Fetch ${str(input.url)}`
    case 'WebSearch':
      return `Web search "${oneLine(str(input.query), 60)}"`
    case 'StructuredOutput':
      return 'Submit structured result'
    case 'Task':
    case 'Agent':
      return `Delegate: ${oneLine(str(input.description), 80)}`
    default:
      return name
  }
}

/** Tool names that mutate files, mapped to the input key holding the path. */
export const FILE_WRITE_TOOLS: Record<string, string> = {
  Write: 'file_path',
  Edit: 'file_path',
  MultiEdit: 'file_path',
  NotebookEdit: 'notebook_path'
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c) => (c && typeof c === 'object' && (c as Json).type === 'text' ? str((c as Json).text) : ''))
      .join('\n')
  }
  return ''
}

export function parseStreamLine(line: string, cwd: string): ParsedEvent[] {
  const trimmed = line.trim()
  if (!trimmed) return []
  let msg: Json
  try {
    msg = JSON.parse(trimmed)
  } catch {
    return [{ kind: 'system', text: oneLine(trimmed, 300) }]
  }

  switch (msg.type) {
    case 'system': {
      if (msg.subtype === 'init') {
        return [
          {
            kind: 'init',
            sessionId: str(msg.session_id),
            model: typeof msg.model === 'string' ? msg.model : null,
            tools: Array.isArray(msg.tools) ? (msg.tools as string[]) : [],
            permissionMode: typeof msg.permissionMode === 'string' ? msg.permissionMode : null,
            mcpServers: Array.isArray(msg.mcp_servers) ? (msg.mcp_servers as { name: string; status: string }[]) : [],
            apiKeySource: typeof msg.apiKeySource === 'string' ? msg.apiKeySource : null,
            skills: Array.isArray(msg.skills) ? (msg.skills as unknown[]).filter((x): x is string => typeof x === 'string') : [],
            agents: Array.isArray(msg.agents) ? (msg.agents as unknown[]).filter((x): x is string => typeof x === 'string') : []
          }
        ]
      }
      // what Claude Code is doing that isn't a tool call: worth seeing, never worth failing over
      if (msg.subtype === 'api_retry') return [{ kind: 'system', text: `Claude Code is retrying a request${num(msg.attempt) ? ` (attempt ${msg.attempt}${num(msg.max_retries) ? ` of ${msg.max_retries}` : ''})` : ''}` }]
      if (msg.subtype === 'compact_boundary') return [{ kind: 'system', text: 'Claude Code compacted the conversation to make room' }]
      return []
    }
    case 'stream_event': {
      const ev = msg.event as Json | undefined
      const delta = ev?.delta as Json | undefined
      // only the main conversation: a subagent's words aren't the reply
      if (ev?.type === 'content_block_delta' && delta?.type === 'text_delta' && !msg.parent_tool_use_id) return [{ kind: 'partial', text: str(delta.text) }]
      return []
    }
    case 'assistant': {
      const content = ((msg.message as Json)?.content as Json[]) ?? []
      const out: ParsedEvent[] = []
      for (const c of content) {
        if (c.type === 'text' && str(c.text).trim()) out.push({ kind: 'text', text: str(c.text) })
        else if (c.type === 'thinking' && str(c.thinking).trim()) out.push({ kind: 'thinking', text: str(c.thinking) })
        else if (c.type === 'tool_use') {
          const input = (c.input as Json) ?? {}
          const name = str(c.name)
          out.push({ kind: 'tool_use', toolUseId: str(c.id), name, input, summary: describeTool(name, input, cwd) })
        }
      }
      return out
    }
    case 'user': {
      const content = (msg.message as Json)?.content
      // --replay-user-messages: proof that something written to stdin entered the conversation
      if (msg.isReplay) {
        const text = typeof content === 'string' ? content : Array.isArray(content) ? (content as Json[]).map((c) => (typeof c.text === 'string' ? c.text : '')).join('') : ''
        return [{ kind: 'user_echo', text }]
      }
      if (!Array.isArray(content)) return []
      return (content as Json[])
        .filter((c) => c.type === 'tool_result')
        .map((c) => ({
          kind: 'tool_result' as const,
          toolUseId: str(c.tool_use_id),
          isError: !!c.is_error,
          text: resultText(c.content)
        }))
    }
    case 'result': {
      const isError = !!msg.is_error || msg.subtype !== 'success'
      return [
        {
          kind: 'result',
          ok: !isError,
          subtype: str(msg.subtype),
          text: typeof msg.result === 'string' ? msg.result : null,
          structured: msg.structured_output ?? null,
          costUsd: typeof msg.total_cost_usd === 'number' ? msg.total_cost_usd : null,
          numTurns: typeof msg.num_turns === 'number' ? msg.num_turns : null,
          sessionId: typeof msg.session_id === 'string' ? msg.session_id : null,
          errors: Array.isArray(msg.errors) ? (msg.errors as unknown[]).map(String) : [],
          usage: usageOf(msg.usage),
          durationMs: num(msg.duration_ms),
          apiMs: num(msg.duration_api_ms),
          denials: Array.isArray(msg.permission_denials)
            ? (msg.permission_denials as Json[]).map((d) => ({
                toolName: str(d.tool_name),
                command: str((d.tool_input as Json | undefined)?.command) || str((d.tool_input as Json | undefined)?.file_path)
              }))
            : []
        }
      ]
    }
    case 'rate_limit_event': {
      const info = (msg.rate_limit_info as Json) ?? {}
      const out: ParsedEvent[] = [{ kind: 'rateLimit', info }]
      if (info.status && info.status !== 'allowed') out.push({ kind: 'system', text: `Usage limit: ${str(info.status)} (${str(info.rateLimitType)})` })
      return out
    }
    default:
      return []
  }
}
