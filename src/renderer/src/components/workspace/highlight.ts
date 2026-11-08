// Tiny line-level syntax highlighter for diffs (no dependencies). Good enough to read changes at a
// glance; it never executes or evaluates anything.

export type Token = { t: 'kw' | 'str' | 'num' | 'com' | 'tag' | 'attr' | 'fn' | 'plain'; v: string }

const KW: Record<string, Set<string>> = {
  js: new Set(
    'const let var function return if else for while do switch case break continue new class extends import from export default async await try catch finally throw typeof instanceof in of this super null undefined true false void yield interface type implements public private protected readonly static enum as satisfies'.split(
      ' '
    )
  ),
  py: new Set('def class return if elif else for while in not and or import from as try except finally raise with lambda None True False pass yield async await self'.split(' ')),
  css: new Set('@media @import @keyframes !important'.split(' ')),
  sh: new Set('if then else fi for do done case esac function export local return echo'.split(' '))
}

export function langFor(path: string): keyof typeof KW | 'html' | 'json' | 'md' | null {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  if (['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'].includes(ext)) return 'js'
  if (ext === 'py') return 'py'
  if (['css', 'scss'].includes(ext)) return 'css'
  if (['sh', 'bash', 'zsh'].includes(ext)) return 'sh'
  if (['html', 'htm', 'svg', 'xml', 'vue'].includes(ext)) return 'html'
  if (ext === 'json') return 'json'
  if (ext === 'md') return 'md'
  return null
}

export function tokenize(line: string, lang: ReturnType<typeof langFor>): Token[] {
  if (!lang) return [{ t: 'plain', v: line }]
  if (lang === 'md') return [{ t: /^\s*#/.test(line) ? 'kw' : 'plain', v: line }]
  if (lang === 'html') return html(line)
  const out: Token[] = []
  const comment = lang === 'py' || lang === 'sh' ? /^#.*/ : lang === 'css' ? /^\/\*.*?(\*\/|$)/ : /^(\/\/.*|\/\*.*?(\*\/|$))/
  let i = 0
  while (i < line.length) {
    const rest = line.slice(i)
    let m: RegExpMatchArray | null
    if ((m = rest.match(comment))) {
      out.push({ t: 'com', v: m[0] })
    } else if ((m = rest.match(/^(["'`])(?:\\.|(?!\1).)*\1?/))) {
      out.push({ t: 'str', v: m[0] })
    } else if ((m = rest.match(/^\d[\d_.]*(e[+-]?\d+)?/i))) {
      out.push({ t: 'num', v: m[0] })
    } else if ((m = rest.match(/^[A-Za-z_$@!][\w$-]*/))) {
      const w = m[0]
      const isFn = line[i + w.length] === '('
      out.push({ t: KW[lang === 'json' ? 'js' : lang]?.has(w) ? 'kw' : isFn ? 'fn' : 'plain', v: w })
    } else {
      out.push({ t: 'plain', v: rest[0] })
      m = [rest[0]]
    }
    i += m[0].length
  }
  return merge(out)
}

function html(line: string): Token[] {
  const out: Token[] = []
  const re = /(<!--.*?(-->|$))|(<\/?[\w-]+)|(\s[\w:-]+)(=)|("[^"]*"?|'[^']*'?)|(\/?>)|([^<"'\s=/>]+|\s+|.)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line))) {
    if (m[1]) out.push({ t: 'com', v: m[1] })
    else if (m[3]) out.push({ t: 'tag', v: m[3] })
    else if (m[4]) out.push({ t: 'attr', v: m[4] }, { t: 'plain', v: m[5] })
    else if (m[6]) out.push({ t: 'str', v: m[6] })
    else if (m[7]) out.push({ t: 'tag', v: m[7] })
    else out.push({ t: 'plain', v: m[0] })
  }
  return merge(out)
}

function merge(tokens: Token[]): Token[] {
  const out: Token[] = []
  for (const tk of tokens) {
    const last = out[out.length - 1]
    if (last && last.t === tk.t) last.v += tk.v
    else out.push({ ...tk })
  }
  return out
}
