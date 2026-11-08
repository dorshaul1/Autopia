import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildCodeMap, changedSource, parseSource } from '../src/main/memory/codeGraph'

describe('parsing real source', () => {
  it('TypeScript: definitions, export state, line ranges, calls and routes', async () => {
    const p = await parseSource('a.ts', `export function formatPrice(c: number) {\n  return round(c)\n}\nfunction hidden() {}\nexport const add = (a: number) => a\nexport interface Cart { n: number }\nclass Box { open() { this.close() } }\napp.get('/users', list)\n`)
    const by = (n: string) => p!.symbols.find((s) => s.name === n)
    expect(by('formatPrice')).toMatchObject({ kind: 'function', line: 1, endLine: 3, exported: true })
    expect(by('hidden')?.exported).toBe(false)
    expect(by('add')).toMatchObject({ kind: 'function', exported: true })
    expect(by('Cart')).toMatchObject({ kind: 'interface', exported: true })
    expect(by('open')?.kind).toBe('method')
    expect(by('GET /users')?.kind).toBe('route')
    expect(p!.refs).toEqual(expect.arrayContaining(['round', 'close', 'get']))
  })
  it.each([
    ['a.jsx', 'export function Card() { return <Badge /> }', 'Card', 'Badge'],
    ['a.tsx', 'export const Card = () => <Badge />', 'Card', 'Badge'],
    ['a.py', 'def total(x):\n    return add(x)\nclass Cart:\n    pass\n', 'total', 'add'],
    ['a.go', 'package a\nfunc Total() { add() }\ntype Cart struct{}\n', 'Total', 'add'],
    ['a.rs', 'pub fn total() { add(); }\nstruct Cart;\n', 'total', 'add'],
    ['A.java', 'class A { int total() { return add(); } }', 'total', 'add'],
    ['a.rb', 'class A\n  def total\n    add(1)\n  end\nend\n', 'total', 'add']
  ])('%s', async (file, text, def, ref) => {
    const p = await parseSource(file, text)
    expect(p?.symbols.map((s) => s.name)).toContain(def)
    expect(p?.refs).toContain(ref)
  })
  it('an unknown language has no map, and nothing breaks', async () => {
    expect(await parseSource('a.zig', 'pub fn x() void {}')).toBeNull()
  })
  it('broken code still gives what it can', async () => {
    const p = await parseSource('a.ts', 'export function ok() {}\nfunction broken( {{{')
    expect(p?.symbols.map((s) => s.name)).toContain('ok')
  })
})

describe('staying current cheaply', () => {
  it('reads a file only when it moved, and reparses only when its content changed', () => {
    const root = mkdtempSync(join(tmpdir(), 'graph-'))
    writeFileSync(join(root, 'a.ts'), 'x')
    const first = changedSource(root, 'a.ts', undefined)!
    expect(first.text).toBe('x')
    expect(changedSource(root, 'a.ts', first)).toMatchObject({ same: true, text: null })
    expect(changedSource(root, 'a.ts', { ...first, mtime: 1 })).toMatchObject({ same: true, text: 'x' })
    writeFileSync(join(root, 'a.ts'), 'yy')
    expect(changedSource(root, 'a.ts', first)).toMatchObject({ same: false, text: 'yy' })
    expect(changedSource(root, 'gone.ts', first)).toBeNull()
  })
})

describe('the lines an agent starts from', () => {
  const row = (name: string) => ({ file: 'src/money.ts', name, kind: 'function' as const, line: 3, endLine: 9 })
  const isTest = (f: string) => f.startsWith('test/')
  it('says where, who uses it and which tests touch it', () => {
    expect(buildCodeMap([row('formatPrice')], () => ['src/money.ts', 'src/cart.ts', 'test/money.test.ts'], isTest)).toEqual(['- src/money.ts:3-9 formatPrice (function): used by src/cart.ts; tests: test/money.test.ts'])
  })
  it('stays within its size', () => {
    const lines = buildCodeMap(Array.from({ length: 50 }, (_, i) => row(`name${i}`)), () => [], isTest, 200)
    expect(lines.join('\n').length).toBeLessThanOrEqual(200 + lines.length)
    expect(lines.length).toBeLessThan(50)
  })
})
