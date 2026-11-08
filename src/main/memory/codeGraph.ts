// The project's code map: what's defined where and who uses it, parsed from the source with tree-sitter (the
// same grammars VS Code ships), kept per project in SQLite and updated file by file. No AI. It tells an agent
// where to look; the source stays the truth, so anything it says is confirmed by opening those lines.

import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type SymbolKind = 'function' | 'class' | 'method' | 'interface' | 'type' | 'route'
export interface CodeSymbol {
  name: string
  kind: SymbolKind
  line: number
  endLine: number
  exported: boolean
}
export interface ParsedFile {
  lang: string
  symbols: CodeSymbol[]
  /** Names this file calls or mentions as a call, once each. */
  refs: string[]
}

const JS_DEFS = `(function_declaration name:(identifier) @def.function) (class_declaration name:(_) @def.class) (method_definition name:(property_identifier) @def.method) (variable_declarator name:(identifier) @def.function value:[(arrow_function) (function_expression)])`
const JS_REFS = `(call_expression function:[(identifier) @ref (member_expression property:(property_identifier) @ref)]) (new_expression constructor:(identifier) @ref)`
const TS_TYPES = `(interface_declaration name:(type_identifier) @def.interface) (type_alias_declaration name:(type_identifier) @def.type)`
const JSX_REFS = `(jsx_opening_element name:(identifier) @ref) (jsx_self_closing_element name:(identifier) @ref)`

const LANGS: Record<string, { grammar: string; query: string; exported?: (name: string, text: string) => boolean }> = {
  js: { grammar: 'javascript', query: `${JS_DEFS} ${JS_REFS} ${JSX_REFS}` },
  ts: { grammar: 'typescript', query: `${JS_DEFS} ${TS_TYPES} ${JS_REFS}` },
  tsx: { grammar: 'tsx', query: `${JS_DEFS} ${TS_TYPES} ${JS_REFS} ${JSX_REFS}` },
  py: {
    grammar: 'python',
    query: `(function_definition name:(identifier) @def.function) (class_definition name:(identifier) @def.class) (call function:[(identifier) @ref (attribute attribute:(identifier) @ref)])`,
    exported: (name) => !name.startsWith('_')
  },
  go: {
    grammar: 'go',
    query: `(function_declaration name:(identifier) @def.function) (method_declaration name:(field_identifier) @def.method) (type_spec name:(type_identifier) @def.type) (call_expression function:[(identifier) @ref (selector_expression field:(field_identifier) @ref)])`,
    exported: (name) => /^[A-Z]/.test(name)
  },
  rs: {
    grammar: 'rust',
    query: `(function_item name:(identifier) @def.function) (struct_item name:(type_identifier) @def.class) (enum_item name:(type_identifier) @def.type) (trait_item name:(type_identifier) @def.interface) (call_expression function:[(identifier) @ref (field_expression field:(field_identifier) @ref) (scoped_identifier name:(identifier) @ref)])`,
    exported: () => true
  },
  java: {
    grammar: 'java',
    query: `(class_declaration name:(identifier) @def.class) (interface_declaration name:(identifier) @def.interface) (method_declaration name:(identifier) @def.method) (method_invocation name:(identifier) @ref) (object_creation_expression type:(type_identifier) @ref)`,
    exported: () => true
  },
  rb: {
    grammar: 'ruby',
    query: `(method name:(identifier) @def.method) (class name:(constant) @def.class) (module name:(constant) @def.class) (call method:(identifier) @ref)`,
    exported: () => true
  }
}
const EXT: Record<string, string> = { js: 'js', jsx: 'js', mjs: 'js', cjs: 'js', ts: 'ts', mts: 'ts', cts: 'ts', tsx: 'tsx', py: 'py', go: 'go', rs: 'rs', java: 'java', rb: 'rb' }
export const languageOf = (file: string): string | null => EXT[file.split('.').pop()?.toLowerCase() ?? ''] ?? null

const ROUTES = /(?:\b(?:app|router|server|fastify|api)\.(get|post|put|patch|delete)\(\s*['"`]([^'"`\n]+)['"`])|(?:@(?:app|router|api)\.(get|post|put|patch|delete)\(\s*['"]([^'"\n]+)['"])/gi

type TS = typeof import('@vscode/tree-sitter-wasm')
type Loaded = { parser: InstanceType<TS['Parser']>; query: InstanceType<TS['Query']> }
const require_ = createRequire(import.meta.url)
let runtime: Promise<{ ts: TS; dir: string }> | null = null
const loaded = new Map<string, Promise<Loaded | null>>()

function load(lang: string): Promise<Loaded | null> {
  let p = loaded.get(lang)
  if (!p) {
    p = (async () => {
      runtime ??= (async () => {
        const entry = require_.resolve('@vscode/tree-sitter-wasm')
        const ts = require_('@vscode/tree-sitter-wasm') as TS
        const dir = dirname(entry)
        await ts.Parser.init({ locateFile: (f: string) => join(dir, f) })
        return { ts, dir }
      })()
      const { ts, dir } = await runtime
      const def = LANGS[lang]
      const language = await ts.Language.load(join(dir, `tree-sitter-${def.grammar}.wasm`))
      const parser = new ts.Parser()
      parser.setLanguage(language)
      return { parser, query: new ts.Query(language, def.query) }
    })().catch((err) => {
      // one grammar not loading costs that language its map; everything else carries on
      console.warn(`[code map] no ${lang} grammar:`, (err as Error).message)
      return null
    })
    loaded.set(lang, p)
  }
  return p
}

/** null: a language without a grammar here, which simply has no symbols (agents fall back to searching). */
export async function parseSource(file: string, text: string): Promise<ParsedFile | null> {
  const lang = languageOf(file)
  const l = lang ? await load(lang) : null
  if (!lang || !l) return null
  const tree = l.parser.parse(text)
  if (!tree) return null
  try {
    const symbols: CodeSymbol[] = []
    const refs = new Set<string>()
    const isExported = LANGS[lang].exported
    for (const { name, node } of l.query.captures(tree.rootNode)) {
      if (name === 'ref') {
        refs.add(node.text)
        continue
      }
      const owner = node.parent!
      const decl = owner.type === 'variable_declarator' ? owner.parent! : owner
      const wrapped = decl.parent
      symbols.push({
        name: node.text,
        kind: name.slice(4) as SymbolKind,
        line: decl.startPosition.row + 1,
        endLine: decl.endPosition.row + 1,
        exported: isExported ? isExported(node.text, text) : wrapped?.type === 'export_statement' || (wrapped?.parent?.type === 'export_statement' && decl.type !== 'method_definition')
      })
    }
    for (const m of text.matchAll(ROUTES)) {
      const line = text.slice(0, m.index).split('\n').length
      symbols.push({ name: `${(m[1] ?? m[3]).toUpperCase()} ${m[2] ?? m[4]}`, kind: 'route', line, endLine: line, exported: true })
    }
    return { lang, symbols: symbols.slice(0, 2000), refs: [...refs].slice(0, 2000) }
  } finally {
    tree.delete()
  }
}

/** Read and fingerprint a file only if its size or time moved. null: unchanged, or unreadable. */
export function changedSource(root: string, file: string, was: { mtime: number; size: number; hash: string } | undefined, maxBytes = 400_000): { mtime: number; size: number; hash: string; text: string | null; same: boolean } | null {
  let st: { mtimeMs: number; size: number }
  try {
    st = statSync(join(root, file))
  } catch {
    return null
  }
  if (was && was.mtime === st.mtimeMs && was.size === st.size) return { ...was, text: null, same: true }
  if (st.size > maxBytes) return { mtime: st.mtimeMs, size: st.size, hash: 'too-large', text: null, same: false }
  try {
    const text = readFileSync(join(root, file), 'utf8')
    const hash = createHash('sha1').update(text).digest('hex')
    return { mtime: st.mtimeMs, size: st.size, hash, text, same: hash === was?.hash }
  } catch {
    return null
  }
}

export interface MapRow {
  file: string
  name: string
  kind: SymbolKind
  line: number
  endLine: number
}

/**
 * The lines an agent starts from: where each symbol is, who uses it and which tests touch it. `refsOf` is the
 * files that use a name. Smallest useful set: stops at `budget` characters.
 */
export function buildCodeMap(rows: MapRow[], refsOf: (name: string) => string[], isTest: (file: string) => boolean, budget = 1400): string[] {
  const out: string[] = []
  let used = 0
  for (const r of rows) {
    const who = refsOf(r.name).filter((f) => f !== r.file)
    const tests = who.filter(isTest)
    const users = who.filter((f) => !isTest(f))
    const tail = [users.length ? `used by ${users.slice(0, 3).join(', ')}${users.length > 3 ? ` and ${users.length - 3} more` : ''}` : '', tests.length ? `tests: ${tests.slice(0, 2).join(', ')}` : ''].filter(Boolean).join('; ')
    const line = `- ${r.file}:${r.line}-${r.endLine} ${r.name} (${r.kind})${tail ? `: ${tail}` : ''}`
    if (used + line.length > budget) break
    out.push(line)
    used += line.length + 1
  }
  return out
}
