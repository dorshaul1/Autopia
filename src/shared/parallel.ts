// A deterministic replay of how a plan's tasks would be scheduled: dependencies, a global session
// limit, and people who can each run one task at a time (a busy owner's ready task may go to an idle
// colleague who can do that kind of work, as the scheduler does). Used to measure parallelism on
// recorded work; it never runs anything and never estimates tokens (the same tasks cost the same).

export interface SimTask {
  id: string
  kind: string
  dependsOn: string[]
  /** Recorded working time (ms). */
  ms: number
  assigneeId: string
}

export interface SimPerson {
  id: string
  kinds: string[]
}

export interface SimResult {
  /** Wall-clock time from the first start to the last finish. */
  makespan: number
  /** Most tasks running at once. */
  peak: number
  /** Sum of task time (what a strictly sequential run would take). */
  serial: number
}

export function simulate(tasks: SimTask[], people: SimPerson[], slots: number, reassign = true): SimResult {
  const done = new Map<string, number>()
  const busyUntil = new Map(people.map((p) => [p.id, 0]))
  const running: { id: string; person: string; end: number }[] = []
  const pending = [...tasks]
  let now = 0
  let peak = 0
  const ready = (t: SimTask) => t.dependsOn.every((d) => done.has(d) || !tasks.some((x) => x.id === d))
  while (pending.length || running.length) {
    // start everything that can start now
    for (const t of [...pending]) {
      if (running.length >= slots || !ready(t)) continue
      const free = (id: string) => (busyUntil.get(id) ?? 0) <= now && !running.some((r) => r.person === id)
      let who = people.find((p) => p.id === t.assigneeId) && free(t.assigneeId) ? t.assigneeId : null
      if (!who && reassign) who = people.find((p) => p.kinds.includes(t.kind) && free(p.id))?.id ?? null
      if (!who && !people.some((p) => p.id === t.assigneeId)) who = people.find((p) => p.kinds.includes(t.kind) && free(p.id))?.id ?? null
      if (!who) continue
      running.push({ id: t.id, person: who, end: now + t.ms })
      pending.splice(pending.indexOf(t), 1)
    }
    peak = Math.max(peak, running.length)
    if (!running.length) break // nothing can ever start (a missing kind): stop rather than spin
    running.sort((a, b) => a.end - b.end)
    const next = running.shift()!
    now = next.end
    done.set(next.id, now)
    busyUntil.set(next.person, now)
  }
  return { makespan: now, peak, serial: tasks.reduce((n, t) => n + t.ms, 0) }
}
