// Static, deterministic audit of the lines a delivery added. Cheap enough to run on every delivery;
// it looks for concrete, well-known risk patterns, not style. Findings name the file and line so a
// person (or a focused repair) can act on them. No AI, no network, no code execution.

import type { DiffFile, QualityDimension, QualityFinding } from '@shared/types'
import { isSecretPath, redact } from '../memory/secrets'

interface Rule {
  id: string
  dimension: QualityDimension
  severity: QualityFinding['severity']
  files: RegExp
  test: RegExp
  /** Skip when the same file also matches (e.g. a cleanup for a listener). */
  unless?: RegExp
  message: string
}

const JS = /\.(m?[jt]sx?|cjs|vue|svelte|html)$/i
/** Third-party, generated and lock files are not the team's code: never audited. */
export const VENDORED = /(^|\/)(node_modules|vendor|dist|build|out|\.next|coverage|\.venv|__pycache__|bower_components)\/|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$|\.min\.(js|css)$/
const SRC = /\.(m?[jt]sx?|cjs|vue|svelte|html|py|rb|go|php|java|kt|cs)$/i
const PY = /\.py$/i

const RULES: Rule[] = [
  { id: 'eval', dimension: 'security', severity: 'high', files: JS, test: /\beval\s*\(|\bnew Function\s*\(/, message: 'Dynamic code evaluation (eval / new Function).' },
  {
    id: 'html-injection',
    dimension: 'security',
    severity: 'high',
    files: JS,
    test: /\.(innerHTML|outerHTML)\s*\+?=\s*(?!\s*['"`][^$`'"]*['"`]\s*;?\s*$)|insertAdjacentHTML\s*\([^,]+,\s*(?!['"][^'"]*['"]\s*\))|document\.write\s*\(/,
    message: 'HTML built from a non-literal value (innerHTML / insertAdjacentHTML / document.write): escape user input or use textContent.'
  },
  { id: 'react-html', dimension: 'security', severity: 'medium', files: JS, test: /dangerouslySetInnerHTML/, message: 'dangerouslySetInnerHTML: make sure the HTML is sanitised.' },
  {
    id: 'shell-injection',
    dimension: 'security',
    severity: 'high',
    files: SRC,
    test: /\b(exec|execSync|spawnSync|spawn)\s*\(\s*(`[^`]*\$\{|[^,)]*\+\s*\w)|\bos\.system\s*\(|subprocess\.\w+\([^)]*shell\s*=\s*True/,
    message: 'Shell command built from variables: pass arguments as an array, never through a shell string.'
  },
  {
    id: 'sql-concat',
    dimension: 'security',
    severity: 'high',
    files: SRC,
    test: /\b(query|execute|exec|raw|prepare)\s*\(\s*(`[^`]*\b(SELECT|INSERT|UPDATE|DELETE)\b[^`]*\$\{|['"][^'"]*\b(SELECT|INSERT|UPDATE|DELETE)\b[^'"]*['"]\s*\+)|f["'][^"']*\b(SELECT|INSERT|UPDATE|DELETE)\b[^"']*\{/i,
    message: 'SQL assembled from strings: use parameters / placeholders.'
  },
  { id: 'tls-off', dimension: 'security', severity: 'high', files: SRC, test: /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED|verify\s*=\s*False/, message: 'TLS certificate verification disabled.' },
  {
    id: 'path-traversal',
    dimension: 'security',
    severity: 'high',
    files: SRC,
    test: /\b(readFile\w*|createReadStream|sendFile|writeFile\w*|unlink\w*|open)\s*\([^)]*\breq(uest)?\.(params|query|body)/,
    message: 'File path taken from the request: normalise it and confirm it stays inside the allowed folder.'
  },
  { id: 'cors-any', dimension: 'security', severity: 'medium', files: SRC, test: /Access-Control-Allow-Origin['"]?\s*[,:]\s*['"]\*['"]|origin\s*:\s*['"]\*['"]|origin\s*:\s*true\b/, message: 'CORS allows any origin.' },
  { id: 'weak-random', dimension: 'security', severity: 'medium', files: JS, test: /(token|secret|password|nonce|salt|session|otp)\w*\s*[:=][^;\n]*Math\.random\(/i, message: 'Math.random() used for a security value: use crypto.randomUUID / getRandomValues.' },
  { id: 'insecure-http', dimension: 'security', severity: 'low', files: SRC, test: /['"`]http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|www\.w3\.org)[a-z0-9.-]+/i, message: 'Plain-HTTP URL to a remote host.' },
  { id: 'pickle', dimension: 'security', severity: 'high', files: PY, test: /\b(pickle\.loads?|yaml\.load\s*\((?![^)]*Loader=yaml\.SafeLoader))/, message: 'Unsafe deserialisation (pickle / yaml.load without SafeLoader).' },
  { id: 'empty-catch', dimension: 'review', severity: 'low', files: JS, test: /catch\s*(\([^)]*\))?\s*\{\s*\}/, message: 'Empty catch block swallows errors.' },
  { id: 'bare-except', dimension: 'review', severity: 'low', files: PY, test: /except\s*:\s*(pass)?\s*$/, message: 'Bare except swallows all errors.' },
  { id: 'interval-leak', dimension: 'performance', severity: 'medium', files: JS, test: /\bsetInterval\s*\(/, unless: /\bclearInterval\s*\(/, message: 'setInterval without a clearInterval in the same file (possible leak).' },
  {
    id: 'listener-leak',
    dimension: 'performance',
    severity: 'low',
    files: /\.(tsx|jsx|vue|svelte)$/i,
    test: /\baddEventListener\s*\(/,
    unless: /\bremoveEventListener\s*\(/,
    message: 'Component adds an event listener but never removes it.'
  },
  { id: 'deep-clone', dimension: 'performance', severity: 'info', files: JS, test: /JSON\.parse\s*\(\s*JSON\.stringify\s*\(/, message: 'JSON round-trip clone: structuredClone is faster and keeps types.' }
]

/** Audits the added lines of each changed file. `fullText` (path → contents) enables "unless" checks. */
export function auditDiff(files: DiffFile[], fullText: (path: string) => string | null): QualityFinding[] {
  const out = new Map<string, QualityFinding>()
  const add = (f: Omit<QualityFinding, 'count' | 'width'>) => {
    const key = `${f.rule}:${f.file}`
    const prev = out.get(key)
    if (prev) prev.count++
    else out.set(key, { ...f, width: null, count: 1 })
  }
  for (const file of files) {
    if (file.status === 'D' || file.binary || VENDORED.test(file.path)) continue
    if (isSecretPath(file.path)) {
      add({ dimension: 'security', severity: 'high', rule: 'secret-file', message: 'A secrets file was added to the change set. Remove it and rotate the values.', file: file.path, line: null })
      continue
    }
    const added = file.hunks.flatMap((h) => h.lines.filter((l) => l.t === '+'))
    const whole = fullText(file.path) ?? added.map((l) => l.text).join('\n')
    for (const l of added) {
      if (redact(l.text) !== l.text && !/process\.env|os\.environ|getenv|\[redacted\]|example|placeholder|your[-_ ]?(api|key|token)/i.test(l.text)) {
        add({ dimension: 'security', severity: 'high', rule: 'hardcoded-secret', message: 'Looks like a credential written into source.', file: file.path, line: l.newNo })
      }
      for (const r of RULES) {
        if (!r.files.test(file.path) || !r.test.test(l.text)) continue
        if (r.unless && r.unless.test(whole)) continue
        add({ dimension: r.dimension, severity: r.severity, rule: r.id, message: r.message, file: file.path, line: l.newNo })
      }
    }
    if (file.additions > 800 && SRC.test(file.path)) {
      add({ dimension: 'review', severity: 'info', rule: 'large-file', message: `${file.additions} lines added to one file: consider splitting it.`, file: file.path, line: null })
    }
  }
  const rank = { high: 0, medium: 1, low: 2, info: 3 }
  return [...out.values()].sort((a, b) => rank[a.severity] - rank[b.severity])
}

/** For projects without git: treat whole files as added. */
export function wholeFiles(paths: string[], read: (p: string) => string | null): DiffFile[] {
  return paths.flatMap((path) => {
    const text = read(path)
    if (text === null) return []
    const lines = text.split('\n')
    return [{ path, oldPath: null, status: 'A' as const, additions: lines.length, deletions: 0, binary: false, truncated: false, hunks: [{ header: '', lines: lines.map((t, i) => ({ t: '+' as const, text: t, oldNo: null, newNo: i + 1 })) }] }]
  })
}
