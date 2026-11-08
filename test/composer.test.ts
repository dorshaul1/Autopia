import { describe, expect, it } from 'vitest'
import { intentOptions, looksLikeQuestion } from '../src/shared/composer'
import { projectNameFrom } from '../src/main/ipc'

const base = { text: '', newProject: false, busy: false, planPending: false, delivered: false, employeeId: null }

describe('composer intent', () => {
  it('starts building on a fresh project and requests a change after delivery', () => {
    expect(intentOptions({ ...base, text: 'Add a dark mode' })[0]).toBe('build')
    expect(intentOptions({ ...base, delivered: true, text: 'Add a dark mode' })[0]).toBe('change')
  })
  it('never starts new work while the team is busy, and replies to a pending plan', () => {
    expect(intentOptions({ ...base, busy: true, text: 'Also add tags' })).toEqual(['note', 'ask'])
    expect(intentOptions({ ...base, planPending: true, text: 'Skip the README task' })[0]).toBe('reply')
  })
  it('defaults to a read-only question when the text is a question', () => {
    expect(looksLikeQuestion('Why does the list reload twice?')).toBe(true)
    expect(looksLikeQuestion('How is data stored')).toBe(true)
    expect(looksLikeQuestion('Add a button that asks why?')).toBe(false)
    expect(intentOptions({ ...base, delivered: true, text: 'Where is the search logic?' })[0]).toBe('ask')
  })
  it('creates new projects with a readable name from the idea', () => {
    expect(intentOptions({ ...base, newProject: true, text: 'A habit tracker' })).toEqual(['build'])
    expect(projectNameFrom('Build me a habit tracker with streaks. It should…')).toBe('Habit Tracker Streaks')
    expect(projectNameFrom('Recipe Box: a small web app')).toBe('Recipe Box')
  })
})

describe('settings validation', () => {
  it('explains out-of-range values in plain words and accepts the defaults', async () => {
    const { DEFAULT_SETTINGS, settingsErrors } = await import('../src/shared/settings')
    expect(settingsErrors(DEFAULT_SETTINGS)).toEqual({})
    const e = settingsErrors({ ...DEFAULT_SETTINGS, maxParallel: 9, maxFixAttempts: 1.5, memoryRetentionDays: NaN })
    expect(e).toEqual({ maxParallel: 'Use a value from 1 to 8', maxFixAttempts: 'Use a whole number', memoryRetentionDays: 'Enter a number' })
  })
})

describe('project summary honesty', () => {
  it('only says checks passed when every recorded check actually passed', async () => {
    const { projectSummary } = await import('../src/shared/summary')
    const project = { phase: 'completed', goal: 'x' } as never
    const t = (status: string) => ({ status: 'done', checks: [{ status }] }) as never
    expect(projectSummary(project, [t('passed'), t('passed')], [], [] as never)).toMatch(/all checks passed/)
    expect(projectSummary(project, [t('passed'), t('blocked')], [], [] as never)).toMatch(/some checks didn’t pass or couldn’t run/)
    expect(projectSummary(project, [{ status: 'done', checks: [] } as never], [], [] as never)).toMatch(/no automated checks ran/)
  })
})

describe('small talk never puts anyone to work', () => {
  const ctx = { newProject: false, busy: false, planPending: false, delivered: true, employeeId: null }
  it('greetings, thanks and stray words are answered, in any state', async () => {
    const { isSmallTalk, resolveIntent } = await import('../src/shared/composer')
    for (const text of ['hi', 'Hi!', 'hello', 'thanks', 'thank you', 'ok', 'good morning', 'how are you', 'שלום', 'תודה', 'דקק', 'ppp', 'asdf', 'hi theo', 'Hello team!', 'thanks maya', 'hey there', 'שלום תיאו']) {
      expect(isSmallTalk(text), text).toBe(true)
      for (const state of [{}, { busy: true }, { planPending: true }, { delivered: false }]) expect(resolveIntent({ ...ctx, ...state, text }), text).toBe('ask')
    }
  })
  it('real requests still become work, and a word with a screenshot still can', async () => {
    const { resolveIntent } = await import('../src/shared/composer')
    expect(resolveIntent({ ...ctx, text: 'Add a dark mode' })).toBe('change')
    expect(resolveIntent({ ...ctx, text: 'fix the login page' })).toBe('change')
    expect(resolveIntent({ ...ctx, text: 'ok please add tags' })).toBe('change')
    expect(resolveIntent({ ...ctx, text: 'hi add a dark mode' })).toBe('change')
    expect(resolveIntent({ ...ctx, text: 'hello, the button is broken on mobile' })).toBe('change')
    expect(resolveIntent({ ...ctx, text: 'this', hasFiles: true })).toBe('change')
    expect(resolveIntent({ ...ctx, newProject: true, text: 'hi' })).toBe('build')
  })
  it('the instant reply says where things stand and starts nothing', async () => {
    const { quickReply } = await import('../src/main/orchestrator/statusReply')
    const employees = [{ id: 'e', name: 'Theo Lindqvist' }]
    expect(quickReply('hi', { tasks: [], employees, review: null })).toMatch(/^Hi! Nobody is working/)
    expect(quickReply('thanks', { tasks: [], employees, review: 6 })).toMatch(/^You’re welcome\. Result #6 is waiting/)
    expect(quickReply('hi', { tasks: [{ title: 'Add tags', status: 'running', assigneeId: 'e' }], employees, review: null })).toMatch(/Theo is working on “Add tags”/)
    expect(quickReply('how are you?', { tasks: [], employees, review: null })).toMatch(/^Doing well, thanks!/)
    expect(quickReply('bug', { tasks: [], employees, review: null })).toMatch(/^What went wrong\?/)
    expect(quickReply('whats up?', { tasks: [], employees, review: 4 })).toBe('Doing well, thanks! Result #4 is waiting for your review.')
    expect(quickReply('דקק', { tasks: [], employees, review: null })).toMatch(/didn’t start anything/)
  })
})

describe('what happens next is always said', () => {
  const base = { project: { phase: 'completed', paused: false, lastError: null }, approvals: [], deliveries: [], tasks: [], nameOf: (id: string) => ({ e: 'Theo Lindqvist', f: 'Inés Navarro' })[id] } as never as Parameters<typeof import('../src/shared/whatsNext').whatsNext>[0]
  const next = async (o: object) => (await import('../src/shared/whatsNext')).whatsNext({ ...base, ...o } as never)
  const run = (assigneeId: string, title = 'Add tags') => ({ id: title, title, status: 'running', assigneeId, lastError: null })
  it('says nothing when nothing is going on', async () => expect(await next({})).toBeNull())
  it('what only you can do comes first, even while others work', async () => {
    const n = await next({ approvals: [{ status: 'pending', kind: 'permission', title: 'x' }], tasks: [run('e')] })
    expect(n?.text).toMatch(/needs your permission/)
    expect(n?.detail).toMatch(/Theo keeps working/)
    expect(n?.action?.kind).toBe('decide')
  })
  it('paused never looks like idle', async () => {
    const n = await next({ project: { phase: 'executing', paused: true, lastError: null } })
    expect(n?.text).toBe('Paused')
    expect(n?.action?.kind).toBe('resume')
  })
  it('stuck work offers the way out, with the real reason', async () => {
    const n = await next({ tasks: [{ id: 't', title: 'Add tags', status: 'failed', assigneeId: 'e', lastError: 'npm test failed\nstack' }] })
    expect(n?.tone).toBe('danger')
    expect(n?.detail).toBe('npm test failed')
    expect(n?.action).toMatchObject({ kind: 'retry', taskId: 't' })
  })
  it('names who is working, and lets you stop', async () => {
    const n = await next({ tasks: [run('e'), run('f', 'B')] })
    expect(n?.text).toBe('Theo and Inés are working')
    expect(n?.action?.kind).toBe('stop')
  })
  it('never calls a failed or unverified result ready', async () => {
    const v = (state: string) => ({ state, reason: 'why', steps: [] })
    expect((await next({ deliveries: [{ id: 'd', number: 4, status: 'review', verification: v('failed') }] }))?.text).toBe('Result #4 needs fixes')
    expect((await next({ deliveries: [{ id: 'd', number: 4, status: 'review', verification: v('blocked') }] }))?.text).toBe('Result #4 is blocked')
    expect((await next({ deliveries: [{ id: 'd', number: 4, status: 'review', verification: v('verified') }] }))?.text).toBe('Result #4 is ready for you')
    const gaps = await next({ deliveries: [{ id: 'd', number: 4, status: 'review', verification: v('verified'), limitations: ['a', 'b'] }] })
    expect(gaps?.text).toBe('Result #4 is ready, with 2 things to check')
    expect(gaps?.tone).toBe('warn')
  })
  it('verifying and fixing say so', async () => {
    expect((await next({ deliveries: [{ id: 'd', number: 4, status: 'validating', verification: null }] }))?.text).toBe('Verifying it for real')
    expect((await next({ deliveries: [{ id: 'd', number: 4, status: 'implementing', verification: { state: 'fixing' } }], tasks: [run('e')] }))?.text).toBe('Theo is fixing what failed')
  })
  it('a stopped project says what stopped it', async () => {
    const n = await next({ project: { phase: 'failed', paused: false, lastError: 'Stopped by founder' } })
    expect(n?.text).toBe('Work stopped')
    expect(n?.detail).toBe('Stopped by founder')
  })
})

describe('errors you can act on', () => {
  it('translates what it recognizes, keeps the original, and leaves real messages alone', async () => {
    const { friendlyError } = await import('../src/shared/friendlyError')
    expect(friendlyError('ENOSPC: no space left on device').message).toMatch(/disk is full/)
    expect(friendlyError('git merge failed: fatal: something').detail).toMatch(/git merge failed/)
    expect(friendlyError("Error invoking remote method 'autopia:invoke': Error: Unknown method x").message).toMatch(/Restart/)
    expect(friendlyError('Choose an existing folder')).toEqual({ message: 'Choose an existing folder', detail: null })
  })
})

describe('evidence that only looks at a file', () => {
  it('is not a test', async () => {
    const { isFileProbe } = await import('../src/main/quality/readiness')
    expect(isFileProbe("grep -c -- '--space-1' styles.css")).toBe(true)
    expect(isFileProbe('cd app && cat index.html')).toBe(true)
    expect(isFileProbe('npm test')).toBe(false)
    expect(isFileProbe('python3 -m pytest')).toBe(false)
  })
})

describe('checks a plan may require', () => {
  it('drops throwaway one-liners, keeps what the project declares', async () => {
    const { isThrowawayCheck } = await import('../src/shared/checks')
    for (const c of ['ls -la && node -e "x"', "node --check <(sed -n '/a/p' index.html)", "python3 - <<'EOF'", 'cd "/tmp/a b" && grep -c foo styles.css', 'tidy -q index.html', 'cd "$(pwd)" && for f in a b; do grep x $f; done']) expect(isThrowawayCheck(c)).toBe(true)
    for (const c of ['npm test', 'npm run build', 'pnpm run typecheck', 'pytest', 'cd app && npm test']) expect(isThrowawayCheck(c)).toBe(false)
  })
})
