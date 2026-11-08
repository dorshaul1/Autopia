// The processes Autopia itself started, and the truth about them. Every one is its own process group, recorded with the
// moment the system says it started, so a number reused by something else after a crash or reboot is never touched.

import { execFile, execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'

const execText = (bin: string, args: string[]) =>
  new Promise<string>((resolve) => {
    execFile(bin, args, { timeout: 3000 }, (_err, stdout) => resolve(stdout ?? ''))
  })

const startedAt = (pid: number): string | null => {
  try {
    return execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { timeout: 2000 }).toString().trim() || null
  } catch {
    return null
  }
}

const groupOf = (pid: number): number | null => {
  try {
    return Number(execFileSync('ps', ['-o', 'pgid=', '-p', String(pid)], { timeout: 2000 }).toString().trim()) || null
  } catch {
    return null
  }
}

export function groupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Asks a whole group to stop, insists if it doesn't, and says whether it really has. Only ever given groups Autopia started. */
export async function endGroup(pid: number, graceMs = 3000): Promise<boolean> {
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    return true
  }
  for (const until = Date.now() + graceMs; Date.now() < until; await wait(80)) if (!groupAlive(pid)) return true
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    return true
  }
  for (const until = Date.now() + 1000; Date.now() < until; await wait(60)) if (!groupAlive(pid)) return true
  return false
}

/** The TCP ports a process group is really listening on, as the system reports them. Null when that can't be asked. */
export async function portsOfGroup(pid: number): Promise<number[] | null> {
  if (!existsSync('/usr/sbin/lsof')) return null
  const text = await execText('/usr/sbin/lsof', ['-nP', '-a', '-g', String(pid), '-iTCP', '-sTCP:LISTEN', '-Fn'])
  return [...new Set([...text.matchAll(/^n.*:(\d+)$/gm)].map((m) => Number(m[1])))]
}

/** Who holds a port, to name them. Read-only: Autopia never stops another program to free a port. */
export async function holderOfPort(port: number): Promise<{ pid: number; name: string } | null> {
  if (!existsSync('/usr/sbin/lsof')) return null
  const text = await execText('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpc'])
  const pid = /^p(\d+)$/m.exec(text)?.[1]
  const name = /^c(.+)$/m.exec(text)?.[1]
  return pid ? { pid: Number(pid), name: name ?? 'another program' } : null
}

export class ProcessLedger {
  constructor(private file: string) {}

  record(pid: number | undefined): void {
    if (!pid) return
    // the start time is what makes this entry mean this process and no other
    const at = startedAt(pid)
    if (at) appendFileSync(this.file, `${pid}\t${at}\n`)
  }

  drop(pid: number | undefined): void {
    if (!pid || !existsSync(this.file)) return
    const rest = readFileSync(this.file, 'utf8').split('\n').filter((l) => l && l.split('\t')[0] !== String(pid))
    writeFileSync(this.file, rest.join('\n') + (rest.length ? '\n' : ''))
  }

  /** What a crash left behind is stopped at the next launch, if it is still the same process and still leads its group. */
  cleanUp(): number {
    if (!existsSync(this.file)) return 0
    let stopped = 0
    for (const line of readFileSync(this.file, 'utf8').split('\n').filter(Boolean)) {
      const [raw, at] = line.split('\t')
      const pid = Number(raw)
      if (!pid || !at || startedAt(pid) !== at || groupOf(pid) !== pid) continue
      try {
        process.kill(-pid, 'SIGTERM')
        stopped++
        // one that ignores being asked is still ours, and nothing else would ever stop it
        setTimeout(() => {
          if (groupAlive(pid) && startedAt(pid) === at) process.kill(-pid, 'SIGKILL')
        }, 3000).unref()
      } catch {
        // already gone
      }
    }
    writeFileSync(this.file, '')
    return stopped
  }
}
