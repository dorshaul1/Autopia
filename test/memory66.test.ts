import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { KnowledgeEntry, Project } from '../src/shared/types'
import { originOf } from '../src/shared/knowledge'
import { Memory, buildContext, contradicts, decisionIn, decisionsConflict, goneFrom, replacedBy, sameQuestion, scoreEntry } from '../src/main/memory/memory'
import { redact } from '../src/main/memory/secrets'
import { openDatabase } from '../src/main/db/database'
import { Repo } from '../src/main/db/repo'

const k = (p: Partial<KnowledgeEntry>): KnowledgeEntry => ({
  id: Math.random().toString(36).slice(2),
  projectId: 'p',
  kind: 'decision',
  topic: `t${Math.random()}`,
  title: 'title',
  text: 'text',
  rationale: null,
  alternatives: null,
  files: [],
  hashes: {},
  commit: null,
  source: 's',
  confidence: 'reported',
  status: 'active',
  author: 'agent',
  uses: 0,
  lastUsedAt: null,
  createdAt: 0,
  updatedAt: 0,
  stale: false,
  statusNote: null,
  ...p
})

const ask = { purpose: 'task' as const, text: 'Add a footer link', files: ['src/Footer.tsx'], size: 's' as const }

describe('what you said', () => {
  it('keeps what is stated outright', () => {
    for (const s of ['We decided to ship without login.', 'Decision: prices are in euros.', "Let's go with Stripe.", 'Use Postgres instead of SQLite.', "We don't need a mobile app.", "We're using Tailwind for this."]) expect(decisionIn(s)).toBe(s)
  })
  it('never turns a suggestion, question or report into a decision', () => {
    for (const s of ['Maybe we should use Postgres.', 'Should we use Postgres instead of SQLite?', 'What if we go with Stripe', 'I think we could drop login.', 'The app no longer crashes on start.', 'Add a login page.', 'How about a dark theme?']) expect(decisionIn(s)).toBeNull()
  })
  it('names what a statement ends, only from your words', () => {
    expect(replacedBy('Use Postgres instead of SQLite.')).toBe('SQLite.'.replace('.', ''))
    expect(replacedBy('We no longer use the Stripe SDK')).toBe('Stripe SDK')
    expect(replacedBy("Let's go with Stripe.")).toBeNull()
    // from a live run: the old decision stayed in force because the name swallowed the rest of the sentence
    expect(replacedBy('Use pounds instead of euros on the page.')).toBe('euros')
    expect(replacedBy("We don't use Redis anymore")).toBe('Redis')
  })
  it('sees the same thing said the opposite way, and nothing else', () => {
    expect(contradicts('Always use tabs for indentation', 'Never use tabs for indentation')).toBe(true)
    expect(contradicts('Always use tabs for indentation', 'Never ship without tests')).toBe(false)
    expect(contradicts('Always use tabs', 'Always use tabs everywhere')).toBe(false)
  })
  it('knows a question asked again', () => {
    expect(sameQuestion('Should prices include tax?', 'Should the prices include tax')).toBe(true)
    expect(sameQuestion('Should prices include tax?', 'Should users have accounts?')).toBe(false)
  })
})

describe('who gets what', () => {
  it('your decision reaches a task it shares no words with', () => {
    const mine = k({ author: 'user', confidence: 'user', title: 'No accounts', text: 'The product has no sign-in' })
    const pack = buildContext([mine], ask, null)
    expect(pack.text).toContain('No accounts')
    expect(pack.text).toContain('do not ask about them again')
    // before this phase a founder decision with no shared words scored below the cut-off
    expect(scoreEntry(mine, ask, new Set())).toBeGreaterThan(1.5)
  })
  it('a teammate decision on another subject stays out', () => {
    expect(buildContext([k({ title: 'Cache layer', text: 'Redis keeps sessions' })], ask, null).text).not.toContain('Cache layer')
  })
  it('a dependency handoff still arrives after later work changed its files, and says so', () => {
    const h = k({ kind: 'handoff', topic: 'handoff:T1', title: 'T1 data', text: 'state is plain JSON', status: 'stale', statusNote: 'src/a.js changed' })
    expect(buildContext([h], ask, null).text).toBe('')
    const text = buildContext([h], { ...ask, pinned: ['handoff:T1'] }, null).text
    expect(text).toContain('state is plain JSON')
    expect(text).toContain('its files have changed')
  })
  it('an archived handoff stays out even when pinned', () => {
    expect(buildContext([k({ kind: 'handoff', topic: 'handoff:T1', status: 'archived' })], { ...ask, pinned: ['handoff:T1'] }, null).text).toBe('')
  })
  it('says where each thing comes from, and never calls a plan a reading of the repo', () => {
    const contract = k({ topic: 'contract:State', title: 'Shared contract: State', text: 'plain JSON', author: 'system', confidence: 'verified' })
    const idea = k({ title: 'Footer links', text: 'Footer links live in one array', author: 'agent' })
    const open = k({ topic: 'assumption:tax', title: 'Tax?', text: 'prices include tax' })
    const text = buildContext([contract, idea, open], { ...ask, text: 'Add a footer links array' }, 'abc1234').text
    expect(originOf(contract)).toBe('plan')
    expect(text).not.toContain('Read from the repository')
    expect(text).toContain('Agreed in the plan')
    expect(text).toContain('Recommended by teammates')
    expect(text).toContain('Working assumptions')
  })
  it('contracts, your decisions and the rest do not crowd each other out', () => {
    const contracts = Array.from({ length: 5 }, (_, i) => k({ topic: `contract:${i}`, title: `Shared contract: c${i}`, text: 'x'.repeat(240), author: 'system', confidence: 'verified' }))
    const mine = Array.from({ length: 4 }, (_, i) => k({ author: 'user', confidence: 'user', title: `Mine ${i}`, text: 'y'.repeat(200) }))
    const stack = k({ kind: 'stack', topic: 'stack', title: 'Stack', text: 'Vite', author: 'system', confidence: 'verified' })
    const text = buildContext([...contracts, ...mine, stack], ask, null).text
    for (const i of [0, 1, 2, 3, 4]) expect(text).toContain(`c${i}`)
    for (const i of [0, 1, 2, 3]) expect(text).toContain(`Mine ${i}`)
    expect(text).toContain('Vite')
  })
})

describe('contracts are not rivals', () => {
  it('two different contracts do not conflict', () => {
    expect(decisionsConflict({ title: 'Shared contract: GameState', text: 'a', files: [] }, { title: 'Shared contract: Commands', text: 'b', files: [] })).toBe(false)
    expect(decisionsConflict({ title: 'Storage: local', text: 'a', files: [] }, { title: 'Storage: server', text: 'b', files: [] })).toBe(true)
  })
})

describe('out of date', () => {
  it('only what really left the project counts', () => {
    const e = { title: 'Payments', text: 'Stripe via src/pay.ts', files: [] }
    expect(goneFrom(e, [], [])).toBeNull()
    expect(goneFrom(e, ['src/pay.ts'], [])).toContain('no longer exists')
    expect(goneFrom({ ...e, text: 'Uses stripe for payments' }, [], ['stripe'])).toContain('no longer a dependency')
    expect(goneFrom({ ...e, text: 'pre-stripe-free checkout' }, [], ['stripe'])).toBeNull()
  })
})

describe('secrets', () => {
  it('never keeps a password in an address, a bearer token or a Stripe key', () => {
    const out = redact('db postgres://me:hunter2@db.local/app, Authorization: Bearer abcdefghijklmnop1234 and sk_live_abcdefghijklmnop1234')
    for (const s of ['hunter2', 'abcdefghijklmnop1234']) expect(out).not.toContain(s)
    expect(out).toContain('postgres://me:')
  })
})

// a small stand-in for the two tables Memory reads and writes, keyed by project exactly as the real ones are
function fakeRepo() {
  const rows: KnowledgeEntry[] = []
  const meta = new Map<string, unknown>()
  let clock = 1000
  return {
    rows,
    meta: (key: string) => meta.get(key) ?? null,
    setMeta: (key: string, v: unknown) => void meta.set(key, v),
    knowledge: (id: string) => rows.filter((r) => r.projectId === id),
    upsertKnowledge: (e: Omit<KnowledgeEntry, 'id' | 'uses' | 'lastUsedAt' | 'createdAt' | 'updatedAt' | 'stale' | 'statusNote'> & { statusNote?: string | null }) => {
      const had = rows.find((r) => r.projectId === e.projectId && r.topic === e.topic)
      const next = k({ ...had, ...e, statusNote: e.statusNote ?? null, updatedAt: ++clock })
      if (had) Object.assign(had, next)
      else rows.push(next)
      return had ?? next
    },
    setKnowledgeStatus: (id: string, status: KnowledgeEntry['status'], note: string | null = null) => {
      const r = rows.find((x) => x.id === id)!
      r.status = status
      r.statusNote = note
    },
    deliveries: () => [],
    productSpec: () => null
  }
}

const project = (id: string, path: string) => ({ id, path, gitEnabled: false, name: id }) as unknown as Project

describe('memory over time', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mem66-'))
  mkdirSync(join(dir, 'a'), { recursive: true })
  writeFileSync(join(dir, 'a', 'x.ts'), 'x')
  const fresh = () => {
    const repo = fakeRepo()
    return { repo, m: new Memory(repo as never), A: project('A', dir), B: project('B', dir) }
  }

  it('a newer statement replaces the older, which stays as history', async () => {
    const { repo, m, A } = fresh()
    await m.rememberSaid(A, 'Always use tabs for indentation.')
    const r = await m.rememberSaid(A, 'Never use tabs for indentation.')
    expect(r?.replaced).toHaveLength(1)
    const old = repo.rows.find((x) => x.text.startsWith('Always'))!
    expect(old.status).toBe('archived')
    expect(old.statusNote).toContain('Superseded')
    expect(buildContext(repo.rows, ask, null).text).not.toContain('Always use tabs')
  })

  it('"instead of" stops the team sharing what it replaces, and leaves unrelated notes alone', async () => {
    const { repo, m, A } = fresh()
    await m.remember(A, { kind: 'decision', title: 'Data store', text: 'Keep everything in SQLite', files: [], source: 'planning' })
    await m.remember(A, { kind: 'decision', title: 'Pricing', text: 'Prices in euros', files: [], source: 'planning' })
    const r = await m.rememberSaid(A, 'Use Postgres instead of SQLite.')
    expect(r?.replaced).toEqual(['Data store'])
    expect(repo.rows.find((x) => x.title === 'Data store')!.status).toBe('stale')
    expect(repo.rows.find((x) => x.title === 'Pricing')!.status).toBe('active')
  })

  it('an agent cannot overturn your decision, and an answer is reused rather than asked again', async () => {
    const { repo, m, A } = fresh()
    await m.rememberAnswer(A, 'Storage: where does data live?', 'In the browser', 'Your answer')
    expect(m.answeredBefore('A', 'Storage: where does data live')).toBe('In the browser')
    const agent = await m.remember(A, { kind: 'decision', title: 'Storage: where does data live?', text: 'On a server', files: [], source: 'T3' })
    expect(agent?.status).toBe('stale')
    expect(agent?.statusNote).toContain('Conflicts with your decision')
    expect(repo.rows.find((x) => x.text === 'In the browser')!.status).toBe('active')
    expect(buildContext(repo.rows, ask, null).text).not.toContain('On a server')
  })

  it('changing an answer keeps the earlier one as history, and answering closes the assumption', async () => {
    const { repo, m, A } = fresh()
    await m.rememberAssumption(A, 'Include tax?', 'Yes', 'The plan')
    await m.rememberAnswer(A, 'Include tax?', 'No', 'Your answer')
    expect(repo.rows.find((x) => x.topic.startsWith('assumption:'))!.status).toBe('archived')
    await m.rememberAnswer(A, 'Include tax?', 'Yes after all', 'Your answer')
    const answers = repo.rows.filter((x) => x.topic.startsWith('decision:answer:'))
    expect(answers.map((x) => [x.text, x.status]).sort()).toEqual([['No', 'archived'], ['Yes after all', 'active']])
    await m.rememberAssumption(A, 'Include tax?', 'Guess', 'The plan')
    expect(repo.rows.filter((x) => x.topic.startsWith('assumption:') && x.status === 'active')).toHaveLength(0)
  })

  it('the product purpose is the first request and later requests do not change it', async () => {
    const { repo, m, A } = fresh()
    await m.rememberPurpose(A, 'A park game')
    await m.rememberPurpose(A, 'Make the button blue')
    expect(repo.rows.filter((x) => x.topic === 'purpose:project').map((x) => x.text)).toEqual(['A park game'])
    expect(buildContext(repo.rows, ask, null).text).toContain('A park game')
  })

  it('one project never sees another project’s knowledge', async () => {
    const { repo, m, A, B } = fresh()
    await m.rememberSaid(A, 'We decided to ship without login.')
    await m.rememberAnswer(A, 'Include tax?', 'Yes', 'Your answer')
    expect(repo.knowledge('B')).toHaveLength(0)
    expect(m.answeredBefore('B', 'Include tax?')).toBeNull()
    expect(m.decidedSince('B', 0)).toBe('')
    expect(m.decidedSince('A', 0)).toContain('without login')
    expect(buildContext(repo.knowledge(B.id), ask, null).text).toBe('')
  })

  it('a resumed session is told only what you settled after it started', async () => {
    const { repo, m, A } = fresh()
    await m.rememberSaid(A, 'We decided to ship without login.')
    const since = repo.rows[0].updatedAt
    expect(m.decidedSince('A', since)).toBe('')
    await m.rememberSaid(A, "Let's go with Stripe.")
    const told = m.decidedSince('A', since)
    expect(told).toContain('Stripe')
    expect(told).not.toContain('login')
  })

  it('puts back contracts that newer ones wrongly archived, once, and leaves real history alone', async () => {
    const { repo, m, A } = fresh()
    const add = (topic: string, note: string) => repo.rows.push(k({ projectId: 'A', topic, title: topic, status: 'archived', statusNote: note, author: 'system', confidence: 'verified' }))
    add('contract:GameState', 'Superseded by "Shared contract: Commands" (Foundation in the plan)')
    add('decision:storage', 'Superseded by "Storage: server" (T3)')
    const repaired = await (m as unknown as { repair(p: Project): Promise<void> }).repair(A)
    expect(repaired).toBeUndefined()
    expect(repo.rows.find((x) => x.topic === 'contract:GameState')!.status).toBe('active')
    expect(repo.rows.find((x) => x.topic === 'decision:storage')!.status).toBe('archived')
    repo.rows.find((x) => x.topic === 'contract:GameState')!.status = 'archived'
    await (m as unknown as { repair(p: Project): Promise<void> }).repair(A)
    expect(repo.rows.find((x) => x.topic === 'contract:GameState')!.status).toBe('archived')
  })

  it('every contract in a plan survives being recorded', async () => {
    const { repo, m, A } = fresh()
    for (const name of ['GameState', 'Commands', 'Tuning']) await m.remember(A, { kind: 'decision', topic: `contract:${name}`, title: `Shared contract: ${name}`, text: `${name} shape`, files: [], source: 'Foundation in the plan' }, 'system')
    expect(repo.rows.map((x) => x.status)).toEqual(['active', 'active', 'active'])
  })

  it('secrets in what you say never reach memory', async () => {
    const { repo, m, A } = fresh()
    await m.rememberSaid(A, 'We decided to use postgres://me:hunter2@db.local.')
    await m.rememberSaid(A, 'Always connect with postgres://me:hunter3@db.local.')
    await m.rememberAnswer(A, 'Which address, postgres://me:hunter4@db.local?', 'That one', 'Your answer')
    expect(repo.rows).toHaveLength(3)
    expect(JSON.stringify(repo.rows)).not.toMatch(/hunter\d/)
  })

  it('cleans up', () => rmSync(dir, { recursive: true, force: true }))
})

// the real database, because a stand-in once hid that it threw away the reason on an active note
describe('with the real database', () => {
  const setup = () => {
    const dir = mkdtempSync(join(tmpdir(), 'mem66db-'))
    const file = join(dir, 'a.db')
    const makeRepo = () => new Repo(openDatabase(file))
    const repo = makeRepo()
    const folder = (name: string) => {
      const d = join(dir, name)
      mkdirSync(d)
      writeFileSync(join(d, 'package.json'), JSON.stringify({ name, dependencies: { lodash: '4.0.0' } }))
      return repo.createProject({ name, path: d, goal: '', gitEnabled: false, baseBranch: null })
    }
    return { dir, repo, makeRepo, folder, m: new Memory(repo) }
  }

  it('your decision stays in force but flagged when what it names leaves, and the team note stops being shared', async () => {
    const { dir, repo, folder, m } = setup()
    try {
      const A = folder('a')
      await m.refresh(A, true)
      await m.remember(A, { kind: 'decision', title: 'Helpers', text: 'We chose lodash', files: [], source: 'you' }, 'user')
      await m.remember(A, { kind: 'decision', title: 'Utils', text: 'Agent picked lodash', files: [], source: 'T1' })
      writeFileSync(join(A.path, 'package.json'), JSON.stringify({ name: 'a', dependencies: {} }))
      await m.refresh(A, true)
      const mine = repo.knowledge(A.id).find((e) => e.title === 'Helpers')!
      expect([mine.status, mine.statusNote]).toEqual(['active', 'lodash is no longer a dependency'])
      expect(repo.knowledge(A.id).find((e) => e.title === 'Utils')!.status).toBe('stale')
      expect(buildContext(repo.knowledge(A.id), ask, null).text).toContain('may be out of date')
      // you looked and it holds: the flag clears
      m.setStatus(A, mine, 'active')
      expect(repo.knowledge(A.id).find((e) => e.title === 'Helpers')!.statusNote).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('decisions survive a restart, superseded ones stay as history, and projects stay apart', async () => {
    const { dir, makeRepo, folder, m } = setup()
    try {
      const A = folder('a')
      const B = folder('b')
      await m.rememberSaid(A, 'We decided to show euros.')
      await m.rememberSaid(A, 'Use pounds instead of euros on the page.')
      const after = makeRepo()
      const rows = after.knowledge(A.id)
      expect(rows.find((e) => e.text.includes('show euros'))!.status).toBe('archived')
      expect(rows.find((e) => e.text.includes('pounds'))!.status).toBe('active')
      expect(after.knowledge(B.id).filter((e) => /euro|pound/i.test(e.text))).toHaveLength(0)
      expect(new Memory(after).decidedSince(B.id, 0)).toBe('')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
