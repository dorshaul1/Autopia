import { describe, expect, it } from 'vitest'
import { blockerKey, diagnose } from '../src/main/director/blockers'

const t = (lastError: string, status: 'failed' | 'interrupted' = 'failed', repairStop: string | null = null) => ({ status, lastError, repairStop })

describe('blocker diagnosis', () => {
  it('resolves only routine blockers automatically', () => {
    expect(diagnose(t('Interrupted: Autopia was closed while this task was running', 'interrupted'), null).autoAction).toBe('resume')
    expect(diagnose(t('API Error: Your computer went to sleep mid-response. The response above may be incomplete.'), null).autoAction).toBe('resume')
    expect(diagnose(t("Error: Cannot find module 'express'\nRequire stack:"), null)).toMatchObject({ kind: 'missing_dependency', autoAction: 'install_and_retry' })
  })

  it('never resolves permission, user-change, budget or repeated-failure blockers on its own', () => {
    const cases = [
      ['Permission to use Bash with command git push has been denied.', 'policy'],
      ['You have uncommitted changes in src/app.js. Commit or stash them, then retry. Autopia never overwrites your work.', 'user_changes'],
      ['The same failure remained after repair attempt 1; stopped instead of retrying blindly.\nnpm test\n✖ adds items\nAssertionError: expected 2 to equal 3', 'test_failure'],
      ['Merge conflicts with main in: src/a.js. The task branch autopia/T3 is preserved.', 'merge_conflict'],
      ['Stalled twice; stopped by the manager', 'stalled'],
      ['Check failed after 2 fix attempt(s): npm run build\nerror TS2322: Type string is not assignable', 'build_failure']
    ] as const
    for (const [err, kind] of cases) {
      const d = diagnose(t(err), null)
      expect(d.kind).toBe(kind)
      expect(d.autoAction).toBeNull()
      expect(d.recommendation).toBeTruthy()
    }
    expect(diagnose(t('x'), { kind: 'budget', body: 'Spent $5.00 of $5.00' }).kind).toBe('budget')
  })

  it('gives the same blocker the same key regardless of counters, so it is attempted once', () => {
    const a = diagnose(t("Cannot find module 'x' (attempt 1)"), null)
    const b = diagnose(t("Cannot find module 'x' (attempt 2)"), null)
    expect(blockerKey('t1', a)).toBe(blockerKey('t1', b))
  })
})

describe('engine metrics and effort', () => {
  it('scales effort with size, risk and purpose', async () => {
    const { pickEffort } = await import('../src/main/orchestrator/orchestrator')
    expect(pickEffort('work', 's', 'low')).toBe('medium')
    expect(pickEffort('work', 'm', 'normal')).toBe('medium')
    expect(pickEffort('work', 's', 'high')).toBe('high')
    expect(pickEffort('fix', 's', 'low')).toBe('medium')
  })
})
