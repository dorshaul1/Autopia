import { useState, type ReactNode } from 'react'
import { Icon } from './common'

/**
 * The subset of Markdown teammates write: paragraphs, headings, lists, **bold**, *italic*, `code`,
 * fenced code blocks (with copy) and file references like src/app.ts:12. Rendered as React nodes
 * (never HTML), so a message can't inject markup.
 */
export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  let i = 0
  let key = 0
  while (i < lines.length) {
    const line = lines[i]
    const fence = /^```(\w*)\s*$/.exec(line)
    if (fence) {
      const body: string[] = []
      i++
      while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++])
      i++
      blocks.push(<CodeBlock key={key++} lang={fence[1]} code={body.join('\n')} />)
      continue
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line)
    if (h) {
      blocks.push(
        <div key={key++} className={`md-h md-h${h[1].length}`}>
          {inline(h[2])}
        </div>
      )
      i++
      continue
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]/.test(line)
      const items: string[] = []
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*•]|\d+[.)])\s+/, ''))
      const List = ordered ? 'ol' : 'ul'
      blocks.push(
        <List key={key++} className="md-list">
          {items.map((it, k) => (
            <li key={k}>{inline(it)}</li>
          ))}
        </List>
      )
      continue
    }
    if (!line.trim()) {
      i++
      continue
    }
    const para: string[] = []
    while (i < lines.length && lines[i].trim() && !/^```/.test(lines[i]) && !/^#{1,4}\s/.test(lines[i]) && !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) para.push(lines[i++])
    blocks.push(
      <p key={key++} className="md-p">
        {para.map((p, k) => (
          <span key={k}>
            {k > 0 && <br />}
            {inline(p)}
          </span>
        ))}
      </p>
    )
  }
  return <div className="md">{blocks}</div>
}

const FILE = /^[\w./-]+\.(ts|tsx|js|jsx|mjs|cjs|json|css|scss|html|md|py|go|rs|java|kt|swift|yml|yaml|toml|sql|sh)(:\d+(-\d+)?)?$/

/** Bold, italic, inline code and file references within one line. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g
  let last = 0
  let k = 0
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(text.slice(last, m.index))
    const t = m[0]
    if (t.startsWith('`')) {
      const code = t.slice(1, -1)
      out.push(
        <code key={k++} className={FILE.test(code) ? 'md-file' : undefined}>
          {code}
        </code>
      )
    } else if (t.startsWith('**')) out.push(<strong key={k++}>{t.slice(2, -2)}</strong>)
    else out.push(<em key={k++}>{t.slice(1, -1)}</em>)
    last = m.index! + t.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="md-code">
      <div className="md-code-head">
        <span>{lang || 'code'}</span>
        <button
          className="link small"
          onClick={() => {
            void navigator.clipboard.writeText(code)
            setCopied(true)
            setTimeout(() => setCopied(false), 1400)
          }}
        >
          <Icon name={copied ? 'check' : 'copy'} size={11} /> {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  )
}
