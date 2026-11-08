// Mutation testing: each mutant must make the project's own test suite fail. Every mutant changes
// observable behaviour (none is equivalent), so a thorough suite can kill all of them.
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const repo = process.env.BENCH_REPO
const MUTANTS = [
  ['strip diacritics', ".replace(/[\\u0300-\\u036f]/g, '')", ''],
  ['lowercase', '.toLowerCase()', ''],
  ['ampersand', ".replace(/&/g, ' and ')", ''],
  ['separator option', "separator = '-'", "separator = '_'"],
  ['cut length', 'trimmed.slice(0, maxLength)', 'trimmed.slice(0, maxLength - 1)'],
  ['trim after cut', 'return trimSeparator(trimmed.slice(0, maxLength), separator)', 'return trimmed.slice(0, maxLength)'],
  ['type check', "throw new TypeError('slugify expects a string')", "return ''"]
]
const MIN = 6
let killed = 0
for (const [name, from, to] of MUTANTS) {
  const dir = mkdtempSync(join(tmpdir(), 'mutant-'))
  cpSync(repo, dir, { recursive: true, filter: (p) => !p.includes('node_modules') && !p.includes('/.git') })
  const file = join(dir, 'lib/slug.js')
  const src = readFileSync(file, 'utf8')
  if (!src.includes(from)) { console.log(`?  ${name}: code changed, mutant not applicable (counts as survived)`); rmSync(dir, { recursive: true, force: true }); continue }
  writeFileSync(file, src.replace(from, to))
  const r = spawnSync('npm', ['test'], { cwd: dir, encoding: 'utf8', timeout: 60000 })
  const dead = r.status !== 0
  killed += dead ? 1 : 0
  console.log(`${dead ? 'killed  ' : 'SURVIVED'} ${name}`)
  rmSync(dir, { recursive: true, force: true })
}
console.log(`mutation score ${killed}/${MUTANTS.length} (need ${MIN})`)
process.exit(killed >= MIN ? 0 : 1)
