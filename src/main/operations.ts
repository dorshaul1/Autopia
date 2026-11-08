// Running a project's own checks in its own folder, by itself: no AI, no tokens. Only commands the project's files show
// (or you set yourself) can run, only after you've seen the exact command, never one your organization denies. Each result
// is kept with exactly which code it ran against, so an old pass can't pass for a new one.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { commandProblem, type OpsConfig } from '@shared/environment'
import { failureLines, fixBrief, opSignature, type OpsState } from '@shared/operations'
import { dependencyProblem } from '@shared/runtime'
import type { CheckResult, Project, Task, ValidationRun } from '@shared/types'
import type { PushEvent } from '@shared/ipc'
import { resolveLoginEnv } from './claude/cli'
import { dependencyState } from './deps'
import { environmentOf, envFileNames, opsConfig, saveOpsConfig, sourceState, toolVersion } from './environment'
import { artifacts, deniedByPolicy, excludeAutopiaDir, type PreviewManager } from './preview'
import { endGroup } from './processes'
import { envVars } from './product/product'
import type { QualityEngine } from './quality/engine'
import { run } from './quality/verify'
import type { Repo } from './db/repo'
import type { Orchestrator } from './orchestrator/orchestrator'

const TIMEOUT_MS = 15 * 60_000
const KEPT_OUTPUT = 24_000
const LIVE_EVERY_MS = 300
const TOOL_KEPT_MS = 60_000
const LOGIN_WAIT_MS = 600

interface Running {
  projectId: string
  command: string
  pid: number | null
  cancelled: boolean
}

export class Operations {
  private running = new Map<string, Running>()
  private closing = false
  private tools = new Map<string, { at: number; answer: Promise<{ found: boolean; version: string | null }> }>()

  constructor(
    private repo: Repo,
    private preview: PreviewManager,
    private quality: QualityEngine,
    private orchestrator: Orchestrator,
    private emit: (e: PushEvent) => void
  ) {
    // before anything can start one: whatever says it's running now was running when Autopia closed
    repo.interruptValidations()
  }

  async state(project: Project): Promise<OpsState> {
    const env = environmentOf(project.path)
    // a login shell can take many seconds the first time: the page doesn't wait for it, and says nothing about programs until then
    const login = resolveLoginEnv()
    const shell = await Promise.race([login, new Promise<null>((r) => setTimeout(() => r(null), LOGIN_WAIT_MS))])
    const source = await sourceState(project)
    const programs = [...new Set([...env.run, ...env.checks, ...(env.install ? [env.install] : [])].map((c) => c.command.split(' ')[0]).filter((b) => !b.startsWith('./')))]
    const unknown = { found: true, version: null }
    const tools = new Map(await Promise.all(programs.map(async (t) => [t, shell ? await this.tool(t, shell) : unknown] as const)))
    const runtimes = await Promise.all(env.runtimes.map(async (r) => ({ ...r, ...(shell ? await this.tool(r.tool, shell) : unknown) })))
    const deps = dependencyState(project.path)
    const names = envVars(project.path)
    const set = new Set(envFileNames(project.path))
    const latest = this.repo.deliveries(project.id)[0] ?? null
    const allCommands = [...env.run.map((r) => r.command), ...env.checks.map((c) => c.command), ...(env.install ? [env.install.command] : [])]
    let pkg: OpsState['package'] = null
    if (env.type === 'library' && existsSync(join(project.path, 'package.json'))) {
      try {
        const m = JSON.parse(readFileSync(join(project.path, 'package.json'), 'utf8')) as Record<string, unknown>
        pkg = { name: (m.name as string) ?? null, version: (m.version as string) ?? null, exportsSomething: !!(m.main || m.module || m.exports || m.bin), isPrivate: !!m.private }
      } catch {
        // env.problems says so
      }
    }
    let openQuality: string[] = []
    if (latest && latest.status !== 'implementing' && latest.status !== 'validating') {
      openQuality = this.quality
        .readiness(project.id, latest.id)
        .dimensions.filter((d) => d.applies && !d.exception && d.status !== 'verified' && ['security', 'accessibility', 'visual', 'performance', 'review'].includes(d.dimension))
        .map((d) => `${d.label}: ${d.status === 'not_checked' ? 'not checked yet' : d.status === 'blocked' ? 'couldn’t be checked' : 'failed'}`)
    }
    return {
      environment: env,
      runtimes,
      missing: programs.filter((p) => tools.get(p)?.found === false),
      denied: allCommands.filter((c) => deniedByPolicy(c)),
      allowed: allCommands.filter((c) => this.quality.commandAllowed(project.id, c)),
      stamp: source.stamp,
      uncommitted: source.uncommitted,
      hasGit: project.gitEnabled,
      dependencyProblem: dependencyProblem(deps),
      depsDeclared: deps?.declared ?? 0,
      envNames: names,
      missingEnv: names.filter((n) => !set.has(n)),
      artifacts: artifacts(project).filter((a) => !/^readme/i.test(a.path)).map((a) => a.path),
      openQuality,
      package: pkg,
      fixes: this.orchestrator.operationFixes(project.id),
      verified: latest?.verification?.state === 'verified' && latest.verification.commit && latest.verification.commit === source.commit && !source.uncommitted ? latest.verification.steps.flatMap((s) => (s.status === 'passed' && s.command ? [{ command: s.command, number: latest.number }] : [])) : [],
      config: opsConfig(project.path)
    }
  }

  /** Asking a program its version starts it, so the answer is kept a while. */
  private tool(name: string, shell: NodeJS.ProcessEnv): Promise<{ found: boolean; version: string | null }> {
    const known = this.tools.get(name)
    if (known && Date.now() - known.at < TOOL_KEPT_MS) return known.answer
    const answer = toolVersion(name, shell)
    this.tools.set(name, { at: Date.now(), answer })
    return answer
  }

  /** Only what the project's own files list can run, by its id: nothing from outside can name a command. */
  async run(project: Project, commandId: string, confirmed: boolean): Promise<ValidationRun> {
    const env = environmentOf(project.path)
    const entry = commandId === 'install' ? env.install : env.checks.find((c) => c.id === commandId)
    if (!entry) throw new Error('This project doesn’t have that command')
    const command = entry.command
    const problem = commandProblem(command)
    if (problem) throw new Error(problem)
    if (deniedByPolicy(command)) throw new Error(`Your organization’s policy denies \`${command}\`, so Autopia won’t run it.`)
    for (const r of this.running.values()) if (r.projectId === project.id && r.command === command) throw new Error(`\`${command}\` is already running`)
    if (!this.quality.commandAllowed(project.id, command)) {
      if (!confirmed) throw new Error('Confirm the command before Autopia runs it')
      this.quality.allowCommand(project.id, command)
    }
    const source = await sourceState(project)
    const v = this.repo.createValidation({ projectId: project.id, deliveryId: null, runId: null, trigger: 'ops', status: 'running', checks: [], command, stamp: source.stamp })
    const running: Running = { projectId: project.id, command, pid: null, cancelled: false }
    this.running.set(v.id, running)
    this.emit({ type: 'validation', validation: v })
    void this.execute(project, v, entry.label, running)
    return v
  }

  private async execute(project: Project, v: ValidationRun, label: string, running: Running): Promise<void> {
    const shell = await resolveLoginEnv()
    let last = 0
    const result = await run(running.command, project.path, shell, TIMEOUT_MS, {
      tail: KEPT_OUTPUT,
      onSpawn: (pid) => {
        running.pid = pid ?? null
        this.preview.processes().record(pid)
      },
      onOutput: (tail) => {
        if (Date.now() - last < LIVE_EVERY_MS) return
        last = Date.now()
        this.emit({ type: 'validation', validation: { ...v, live: tail.slice(-4000) } })
      }
    })
    // Autopia is closing: this reads as interrupted at the next launch
    if (this.closing) return
    this.preview.processes().drop(running.pid ?? undefined)
    this.running.delete(v.id)
    const check: CheckResult = { command: running.command, status: result.ok ? 'passed' : 'failed', ok: result.ok, ms: result.ms, output: result.output, at: Date.now() }
    const missing = !result.ok && /ENOENT/.test(result.output)
    if (running.cancelled) {
      this.emit({ type: 'validation', validation: this.repo.finishValidation(v.id, { status: 'cancelled', checks: [], error: 'Cancelled' }) })
      return
    }
    const done = this.repo.finishValidation(v.id, { status: result.ok ? 'passed' : 'failed', checks: [check], error: result.timedOut ? `Stopped after ${TIMEOUT_MS / 60_000} minutes without finishing.` : missing ? `${running.command.split(' ')[0]} isn’t installed on this Mac, or Autopia can’t find it.` : null })
    this.emit({ type: 'validation', validation: done })
    this.orchestrator.operationResult(project.id, label, running.command, result.ok ? null : (failureLines(result.output)[0] ?? 'It exited with an error.'))
  }

  /** Says it's cancelled only once the command has really gone. */
  async cancel(validationId: string): Promise<void> {
    const r = this.running.get(validationId)
    if (!r) return
    r.cancelled = true
    if (r.pid) await endGroup(r.pid)
  }

  /** Autopia is quitting. What ignores this is stopped at the next launch, from the ledger; its run reads as interrupted. */
  stopAll(): void {
    this.closing = true
    for (const r of this.running.values()) {
      try {
        if (r.pid) process.kill(-r.pid, 'SIGTERM')
      } catch {
        // already gone
      }
    }
  }

  /** The measured failure, in its own words, to the team. The same failure doesn't get a second task. */
  async fix(project: Project, input: { source: 'process' } | { source: 'check'; validationId: string }): Promise<Task> {
    if (input.source === 'process') {
      const p = this.preview.info(project)
      if (p.status !== 'crashed') throw new Error('It isn’t crashed any more')
      const output = p.logs.slice(-40).join('\n')
      const what = 'The app stopped by itself'
      return this.orchestrator.fixOperation(project.id, { signature: opSignature(p.command ?? 'run', output), title: 'Fix why the app stops when it runs', brief: fixBrief({ what, command: p.command, said: p.error ?? '' }, output) })
    }
    const v = this.repo.validation(input.validationId)
    if (v.projectId !== project.id) throw new Error('That result belongs to another product')
    const check = v.checks.find((c) => c.status === 'failed')
    if (!check) throw new Error('That run didn’t fail')
    const title = `Fix the failing \`${check.command}\``
    return this.orchestrator.fixOperation(project.id, { signature: opSignature(check.command, check.output), title, brief: fixBrief({ what: `${check.command} failed`, command: check.command, said: failureLines(check.output)[0] ?? '' }, check.output) })
  }

  async saveConfig(project: Project, config: OpsConfig): Promise<OpsState> {
    saveOpsConfig(project, config, excludeAutopiaDir)
    this.emit({ type: 'preview', preview: this.preview.info(project) })
    return this.state(project)
  }
}
