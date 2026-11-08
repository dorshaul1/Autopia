// The unified skills engine: one registry across built-in skills and external ones you installed; deterministic
// routing from the task itself; and per-run delivery through Claude Code's supported mechanisms (prompt text,
// --plugin-dir, --agents). Enabled doesn't mean loaded: a skill reaches a run only when that task calls for it.
//
// External code is untrusted until you approve it: Autopia fetches only from where you point it, pins a commit, scans
// it statically and never runs it. Nothing is discovered for you, and nothing is installed into ~/.claude or the project.

import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative } from 'node:path'
import { MAX_EXTERNAL_PER_RUN, SKILL_ABOUT, SKILL_MATCH_BAR, parseSkillSource, skillBlocked, skillFrontmatter, skillKeywords, skillRelevance, type SkillEntry, type SkillUse } from '@shared/skills'
import type { Run, RunSkills, SkillFinding, SkillInstall, SkillsReport } from '@shared/types'
import { managedSettings } from '../claude/cli'
import type { Repo } from '../db/repo'
import { CAPABILITIES, EXPERTISE_ON, expertisePrompt, expertiseWhy, selectExpertise } from './expertise'
import { WORKFLOWS, routeTask, type RouteContext } from './workflows'

const MAX_FILES = 80
const MAX_BYTES = 2 * 1024 * 1024
const SCRIPT_EXT = /\.(sh|bash|zsh|py|js|mjs|cjs|ts|rb|pl|ps1|bat|exe)$/i

/** Optional subagent offered only to high-risk tasks: the implementer may call it; it costs nothing otherwise. */
const REVIEWER = {
  reviewer: {
    description: 'Independent reviewer for high-risk changes. Use once before submitting, with the list of changed files.',
    prompt:
      'You review a teammate\'s change for correctness, security, error handling and missed edge cases. Read only the changed files and their direct callers. Report concrete problems with file:line and a suggested fix, most severe first. Do not edit files. If nothing is wrong, say so in one line.',
    tools: ['Read', 'Grep', 'Glob']
  }
}

/** Static review of downloaded files. danger findings block approval. */
export function scanSkill(files: { path: string; text: string | null }[], repo: string): SkillFinding[] {
  const out: SkillFinding[] = []
  const skill = files.find((f) => /(^|\/)SKILL\.md$/.test(f.path))
  if (!skill?.text) out.push({ severity: 'danger', file: '-', message: 'No SKILL.md: this is not an Agent Skill folder.' })
  else if (!/^---[\s\S]*?\bname:\s*\S[\s\S]*?\bdescription:\s*\S[\s\S]*?---/m.test(skill.text)) out.push({ severity: 'warn', file: skill.path, message: 'SKILL.md frontmatter lacks a name or description.' })
  for (const f of files) {
    if (/(^|\/)(hooks\.json|settings(\.local)?\.json|\.mcp\.json)$/.test(f.path)) out.push({ severity: 'danger', file: f.path, message: 'Hooks, settings or MCP configuration: not allowed in a skill install.' })
    if (SCRIPT_EXT.test(f.path) || f.text?.startsWith('#!')) out.push({ severity: 'warn', file: f.path, message: 'Executable script: agents could run it through Bash (still subject to your permission policy).' })
    if (!f.text) continue
    const isScript = SCRIPT_EXT.test(f.path) || f.text.startsWith('#!')
    if (isScript && /\b(curl|wget|fetch\(|requests\.(get|post)|urllib|http\.request|https?\.get|axios|net\.connect)\b/.test(f.text)) out.push({ severity: 'warn', file: f.path, message: 'Script makes network requests.' })
    if (isScript && /\b(rm\s+-rf|chmod\s+777|sudo|eval\s*\(|exec\s*\(|child_process|subprocess|os\.system)\b/.test(f.text)) out.push({ severity: 'warn', file: f.path, message: 'Script runs shell commands or deletes files.' })
    if (/(api[_-]?key|access[_-]?token|secret|password|AWS_[A-Z_]+|OPENAI_API_KEY|ANTHROPIC_API_KEY)/i.test(f.text) && isScript) out.push({ severity: 'warn', file: f.path, message: 'Script reads credentials or secrets.' })
    if (/ignore (all |any )?(previous|prior|above) instructions|disregard (the |your )?(system|previous) |do not (tell|inform|show) the user|without (asking|telling) the user|exfiltrat|curl [^\n|]*\|\s*(ba|z)?sh|base64 -d[^\n]*\|\s*(ba)?sh/i.test(f.text)) {
      out.push({ severity: 'danger', file: f.path, message: 'Possible prompt injection or hidden remote execution.' })
    }
    if (!isScript && /\b(use webfetch|fetch (fresh |the latest |latest )?(guidelines|rules|instructions)|fetch [^\n]{0,60}before each|apply all rules from the fetched|follow the (fetched|downloaded) (rules|instructions))/i.test(f.text)) {
      out.push({ severity: 'danger', file: f.path, message: 'Loads its instructions from the network at run time: what the agent follows is not what you reviewed.' })
    }
    const foreign = [...f.text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase()).filter((h) => !/github(usercontent)?\.com$|githubassets\.com$/.test(h))
    if (isScript && foreign.length) out.push({ severity: 'warn', file: f.path, message: `Contacts ${[...new Set(foreign)].slice(0, 3).join(', ')}` })
  }
  void repo
  return out
}

export class SkillsEngine {
  private root: string

  constructor(
    private repo: Repo,
    userData: string,
    private fetchImpl: typeof fetch = fetch,
    private policy: () => { permissions?: unknown } | null = managedSettings
  ) {
    this.root = join(userData, 'skills')
    mkdirSync(this.root, { recursive: true })
  }

  get scope(): 'routed' | 'personal' {
    return this.repo.meta<'routed' | 'personal'>('skills-scope') ?? 'routed'
  }

  setScope(scope: 'routed' | 'personal'): void {
    this.repo.setMeta('skills-scope', scope)
  }

  private disabled(): Set<string> {
    return new Set(this.repo.meta<string[]>('skills-disabled') ?? [])
  }

  /** What your organization's policy denies. A toggle can't change it, and routing never offers it. */
  private denied(): string[] {
    const deny = (this.policy()?.permissions as { deny?: unknown } | undefined)?.deny
    return Array.isArray(deny) ? deny.filter((d): d is string => typeof d === 'string') : []
  }

  private blocked(id: string, name: string): boolean {
    const deny = this.denied()
    return id === 'reviewer' ? deny.some((d) => ['Agent', 'Task', 'Agent(reviewer)', 'Task(reviewer)'].includes(d)) : skillBlocked(deny, name)
  }

  setEnabled(id: string, enabled: boolean): void {
    const inst = this.repo.skillInstalls().find((i) => i.id === id)
    if (enabled && inst) {
      if (inst.status === 'reviewing' || inst.status === 'rejected') throw new Error('Review this skill before turning it on')
      if (this.blocked(id, skillName(inst))) throw new Error('Your organization’s policy blocks this skill')
      // its files could have changed, and the rules could have too
      const dir = this.installDir(inst)
      if (existsSync(dir) && scanSkill(readFolder(dir), inst.repo).some((f) => f.severity === 'danger')) throw new Error('This skill now has blocking findings, so it can’t be turned on')
    }
    if (enabled && !inst && this.blocked(id, id)) throw new Error('Your organization’s policy blocks this skill')
    const set = this.disabled()
    if (enabled) set.delete(id)
    else set.add(id)
    this.repo.setMeta('skills-disabled', [...set])
    if (inst && inst.status !== 'reviewing' && inst.status !== 'rejected') this.repo.saveSkillInstall({ ...inst, status: enabled ? 'approved' : 'disabled' })
  }

  /** Your own Claude Code skills and plugins (read-only listing; nothing is opened beyond names). */
  personalSkills(): string[] {
    const out: string[] = []
    const dir = join(homedir(), '.claude', 'skills')
    if (existsSync(dir)) for (const n of readdirSync(dir)) if (existsSync(join(dir, n, 'SKILL.md'))) out.push(n)
    try {
      const installed = JSON.parse(readFileSync(join(homedir(), '.claude', 'plugins', 'installed_plugins.json'), 'utf8')) as { plugins?: Record<string, unknown> }
      out.push(...Object.keys(installed.plugins ?? {}).map((p) => `plugin ${p}`))
    } catch {
      // no plugins installed
    }
    return out
  }

  // ── routing ─────────────────────────────────────────────────

  /**
   * Chooses what one run gets, from the task itself. Built-in text goes in the prompt only when selected. External
   * skills are offered through a plugin folder, where Claude Code sees just their name and description until one is
   * really invoked.
   */
  route(ctx: RouteContext): { record: RunSkills; prompt: string; pluginDir: string | null; agents: object | null } {
    const decision = routeTask(ctx)
    const off = this.disabled()
    const why: Record<string, string> = {}
    const labels: Record<string, string> = {}
    const lines: string[] = []
    const domains: string[] = []
    let primary: string | null = null
    for (const r of [decision.primary, ...decision.domains]) {
      const w = r && WORKFLOWS.find((x) => x.route === r && !off.has(x.id))
      if (!r || !w) continue
      if (r === decision.primary) primary = r
      else domains.push(r)
      lines.push(`- ${w.name}: ${w.text}`)
      labels[r] = w.name
      why[r] = decision.why[r] ?? ''
    }
    const skills = this.relevantExternal(ctx.task, off)
    for (const { install, words } of skills) {
      const name = skillName(install)
      const shown = displayName(install)
      labels[name] = shown
      why[name] = `the task mentions ${words.map((w) => `“${w}”`).join(' and ')}`
      lines.push(`- The \`autopia-skills:${name}\` skill (${shown}) is available for this task. Use it if it applies.`)
    }
    // a second reviewer only where nobody else will look: a QA step or the review at the end already does
    const subagents = decision.risk === 'high' && !ctx.reviewedLater && !off.has('reviewer') && !this.blocked('reviewer', 'reviewer') ? ['reviewer'] : []
    if (subagents.length) {
      lines.push('- High-risk change: before submitting, have the `reviewer` subagent check your changed files, and fix what it finds.')
      labels.reviewer = 'Independent reviewer'
      why.reviewer = 'a high-risk change nobody else will review'
    }
    const expertise = EXPERTISE_ON ? selectExpertise({ task: ctx.task, office: ctx.office ?? 'startup', purpose: ctx.purpose, direction: ctx.direction, off }) : []
    for (const c of expertise) {
      labels[c.id] = c.name
      why[c.id] = expertiseWhy(c, ctx.task)
    }
    const reasons = decision.reasons.filter((r) => Object.values(why).includes(r))
    const record: RunSkills = { primary, domains, skills: skills.map((s) => skillName(s.install)), subagents, risk: decision.risk, reasons, why, labels, expertise: expertise.map((c) => c.id) }
    const prompt = [lines.length ? `Engineering methods for this task (selected by Autopia${reasons.length ? `: ${reasons.join(', ')}` : ''}):\n${lines.join('\n')}` : '', expertisePrompt(expertise, ctx.imageTools ?? [])].filter(Boolean).join('\n\n')
    return { record, prompt, pluginDir: skills.length ? this.pluginDirFor(skills.map((s) => s.install)) : null, agents: subagents.length ? REVIEWER : null }
  }

  /** The external skills this task really calls for, judged on their own name and description. */
  private relevantExternal(task: { title: string; description: string }, off: Set<string>): { install: SkillInstall; words: string[] }[] {
    return this.repo
      .skillInstalls()
      .filter((i) => i.status === 'approved' && !off.has(i.id) && !this.blocked(i.id, skillName(i)) && existsSync(this.installDir(i)))
      .map((install) => {
        const front = skillFrontmatter(install.skillMd)
        return { install, ...skillRelevance(task, skillKeywords(front.name ?? skillName(install), front.description ?? '')) }
      })
      .filter((x) => x.score >= SKILL_MATCH_BAR)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_EXTERNAL_PER_RUN)
  }

  /** A plugin directory containing only the routed, approved skills (Claude Code loads it for one session). */
  private pluginDirFor(skills: SkillInstall[]): string {
    const key = skills.map((s) => `${s.id}@${s.sha.slice(0, 7)}`).sort().join('+')
    const dir = join(this.root, 'runs', key.replace(/[^a-z0-9@+._-]/gi, '_').slice(0, 120))
    if (!existsSync(join(dir, '.claude-plugin', 'plugin.json'))) {
      mkdirSync(join(dir, '.claude-plugin'), { recursive: true })
      writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'autopia-skills', version: '1.0.0', description: 'Skills Autopia routed to this task' }))
      for (const s of skills) cpSync(this.installDir(s), join(dir, 'skills', skillName(s)), { recursive: true })
    }
    return dir
  }

  private installDir(i: Pick<SkillInstall, 'id' | 'sha'>): string {
    return join(this.root, i.id, i.sha)
  }

  // ── review & approval ───────────────────────────────────────

  /** Fetches the one skill folder you linked, pinned to its current commit, for review. Nothing is enabled or executed. */
  async installFromGitHub(link: string): Promise<SkillInstall> {
    const src = parseSkillSource(link)
    if (!src) throw new Error('Paste a github.com link to a skill folder, like https://github.com/owner/repo/tree/main/skills/name')
    const full = `${src.owner}/${src.repo}`
    const api = async (url: string) => {
      const res = await this.fetchImpl(url, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'Autopia' } })
      if (!res.ok) throw new Error(`GitHub answered ${res.status} for ${url}`)
      return res.json() as Promise<Record<string, unknown>>
    }
    const branch = src.branch ?? String((await api(`https://api.github.com/repos/${full}`)).default_branch ?? 'main')
    const sha = String((await api(`https://api.github.com/repos/${full}/commits/${encodeURIComponent(branch)}`)).sha)
    const tree = (await api(`https://api.github.com/repos/${full}/git/trees/${sha}?recursive=1`)) as { tree?: { path: string; type: string; size?: number }[]; truncated?: boolean }
    const prefix = src.path ? `${src.path}/` : ''
    const files = (tree.tree ?? []).filter((t) => t.type === 'blob' && t.path.startsWith(prefix))
    const label = src.path.split('/').pop() || src.repo
    if (tree.truncated) throw new Error(`${label} wasn’t installed: that repository is too large to read in full. Link to the skill’s own folder.`)
    if (!files.length) throw new Error(`Nothing found at ${src.path || full}`)
    if (!files.some((f) => f.path === `${prefix}SKILL.md`)) throw new Error(`${label} wasn’t installed: that folder has no SKILL.md. Link to the skill’s own folder.`)
    this.withinLimits(label, files.length, files.reduce((n, f) => n + (f.size ?? 0), 0))
    const id = slug(`gh-${src.owner}-${label}`)
    const dir = this.installDir({ id, sha })
    rmSync(join(this.root, id), { recursive: true, force: true })
    const scanned: { path: string; text: string | null }[] = []
    for (const f of files) {
      const res = await this.fetchImpl(`https://raw.githubusercontent.com/${full}/${sha}/${f.path}`)
      if (!res.ok) throw new Error(`Download failed for ${f.path} (${res.status})`)
      const buf = Buffer.from(await res.arrayBuffer())
      const rel = relative(src.path, f.path)
      if (rel.startsWith('..')) continue
      mkdirSync(join(dir, rel, '..'), { recursive: true })
      writeFileSync(join(dir, rel), buf)
      scanned.push({ path: rel, text: buf.includes(0) ? null : buf.toString('utf8') })
    }
    return this.register({ id, repo: full, path: src.path || src.repo }, sha, dir, scanned)
  }

  /** Imports a local skill folder (e.g. one you wrote) through the same review. */
  importLocal(path: string, name: string): SkillInstall {
    if (!existsSync(join(path, 'SKILL.md'))) throw new Error('That folder has no SKILL.md')
    const inside = listFiles(path)
    // a link could point anywhere on this Mac, and what it points at would reach the agent unreviewed
    if (inside.some((f) => lstatSync(f).isSymbolicLink())) throw new Error(`${name} wasn’t installed: it contains links to files elsewhere, which can’t be reviewed.`)
    this.withinLimits(name, inside.length, inside.reduce((n, f) => n + statSync(f).size, 0))
    const id = slug(`local-${name}`)
    const sha = `local-${Date.now()}`
    const dir = this.installDir({ id, sha })
    rmSync(join(this.root, id), { recursive: true, force: true })
    cpSync(path, dir, { recursive: true })
    return this.register({ id, repo: 'local', path }, sha, dir, readFolder(dir))
  }

  private withinLimits(name: string, files: number, bytes: number): void {
    if (files > MAX_FILES || bytes > MAX_BYTES) throw new Error(`${name} wasn’t installed. It has ${files} files and ${(bytes / 1024 / 1024).toFixed(1)} MB, and Autopia only safety-checks skills up to ${MAX_FILES} files and ${MAX_BYTES / 1024 / 1024} MB.`)
  }

  private register(entry: { id: string; repo: string; path: string }, sha: string, dir: string, scanned: { path: string; text: string | null }[]): SkillInstall {
    const install: SkillInstall = {
      id: entry.id,
      catalogId: entry.id,
      repo: entry.repo,
      path: entry.path,
      sha,
      status: 'reviewing',
      files: scanned.map((s) => ({ path: s.path, bytes: statSync(join(dir, s.path)).size })),
      findings: scanSkill(scanned, entry.repo),
      skillMd: (scanned.find((s) => s.path === 'SKILL.md')?.text ?? '').slice(0, 20_000),
      downloadedAt: Date.now(),
      approvedAt: null
    }
    this.repo.saveSkillInstall(install)
    return install
  }

  approve(id: string): SkillInstall {
    const i = this.repo.skillInstalls().find((x) => x.id === id)
    if (!i) throw new Error('Unknown install')
    // Re-scan the files on disk so approval always reflects the current rules and contents.
    const dir = this.installDir(i)
    const findings = existsSync(dir) ? scanSkill(readFolder(dir), i.repo) : i.findings
    if (findings.some((f) => f.severity === 'danger')) {
      this.repo.saveSkillInstall({ ...i, findings })
      throw new Error('This skill has blocking findings and cannot be enabled')
    }
    const next = { ...i, findings, status: 'approved' as const, approvedAt: Date.now() }
    this.repo.saveSkillInstall(next)
    // approving is your explicit yes, unless your organization says otherwise
    if (!this.blocked(id, skillName(i))) this.setEnabled(id, true)
    return next
  }

  remove(id: string): void {
    rmSync(join(this.root, id), { recursive: true, force: true })
    this.repo.deleteSkillInstall(id)
  }

  // ── registry ────────────────────────────────────────────────

  /** Everything installed and what really happened with it. Uses come only from what each run recorded. */
  report(): SkillsReport {
    const off = this.disabled()
    const projects = this.repo.projects()
    const runs = projects.flatMap((p) => this.repo.allRuns(p.id).map((run) => ({ run, project: p }))).filter((x) => x.run.skills)
    const titles = new Map(projects.flatMap((p) => this.repo.tasks(p.id).map((t) => [t.id, t.title] as const)))
    /** how: what this run did with the skill, or null if it had nothing to do with it. */
    const usage = (how: (s: RunSkills) => SkillUse['how'] | null, whyKeys: string[]): Pick<SkillEntry, 'usage' | 'recent'> => {
      const uses = runs
        .map(({ run, project }) => ({ run, project, how: how(run.skills!) }))
        .filter((u) => u.how)
        .sort((a, b) => b.run.startedAt - a.run.startedAt)
      const count = (...kinds: SkillUse['how'][]) => uses.filter((u) => kinds.includes(u.how!)).length
      return {
        usage: { selected: uses.length, loaded: count('loaded', 'invoked'), invoked: count('invoked'), last: uses[0]?.run.startedAt ?? null },
        recent: uses.slice(0, 5).map((u) => useOf(u.run, u.project, u.how!, titles, whyKeys))
      }
    }
    const builtIn = (id: string, name: string, how: (s: RunSkills) => SkillUse['how'] | null, whyKey: string): SkillEntry => ({
      id,
      name,
      about: SKILL_ABOUT[id]?.about ?? '',
      group: SKILL_ABOUT[id]?.group ?? 'Quality',
      origin: 'built-in',
      state: this.blocked(id, id) && id === 'reviewer' ? 'blocked' : off.has(id) ? 'off' : 'on',
      source: null,
      hasScripts: false,
      ...usage(how, [whyKey])
    })
    const skills: SkillEntry[] = [
      ...WORKFLOWS.map((w) => builtIn(w.id, w.name, (s) => (s.primary === w.route || s.domains.includes(w.route) ? 'given' : null), w.route)),
      ...CAPABILITIES.map((c) => builtIn(c.id, c.name, (s) => (s.expertise?.includes(c.id) ? 'given' : null), c.id)),
      builtIn('reviewer', 'Independent reviewer', (s) => ((s.subagentsUsed ?? []).includes('reviewer') ? 'invoked' : s.subagents.includes('reviewer') ? 'offered' : null), 'reviewer')
    ]
    const installs = this.repo.skillInstalls()
    for (const i of installs) {
      const name = skillName(i)
      const names = [i.id, i.catalogId, name]
      const matches = (x: string) => names.some((n) => x === n || x.endsWith(`:${n}`))
      skills.push({
        id: i.id,
        name: displayName(i),
        about: skillFrontmatter(i.skillMd).description ?? 'A skill you installed.',
        group: 'External',
        origin: 'external',
        state: i.status === 'reviewing' || i.status === 'rejected' ? 'review' : this.blocked(i.id, name) ? 'blocked' : i.status === 'approved' && !off.has(i.id) ? 'on' : 'off',
        source: i.repo === 'local' ? i.path : `github.com/${i.repo}${i.path && i.path !== i.repo.split('/')[1] ? `/${i.path}` : ''}`,
        hasScripts: i.findings.some((f) => /script/i.test(f.message)),
        ...usage((s) => ((s.invoked ?? []).some(matches) ? 'invoked' : (s.available ?? []).some(matches) ? 'loaded' : s.skills.some(matches) ? 'offered' : null), names)
      })
    }
    return { skills, installs, scope: this.scope, personalSkills: this.personalSkills(), orgManaged: this.denied().some((d) => /^(Skill|Agent|Task)\b/.test(d)) }
  }
}

function useOf(run: Run, project: { id: string; name: string }, how: SkillUse['how'], titles: Map<string, string>, whyKeys: string[]): SkillUse {
  const key = whyKeys.find((k) => run.skills?.why?.[k])
  return { runId: run.id, projectId: project.id, projectName: project.name, taskId: run.taskId, taskTitle: run.taskId ? (titles.get(run.taskId) ?? null) : null, at: run.startedAt, how, why: key ? run.skills!.why![key] : null }
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

const displayName = (i: Pick<SkillInstall, 'skillMd' | 'path' | 'catalogId'>) => (skillFrontmatter(i.skillMd).name ?? skillName(i)).replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase())

function skillName(i: Pick<SkillInstall, 'path' | 'catalogId'>): string {
  return (i.path.split('/').filter(Boolean).pop() ?? i.catalogId).replace(/[^a-z0-9-]/gi, '-')
}

/** Every file in a folder. A link is listed as itself, never followed. */
function listFiles(dir: string): string[] {
  const out: string[] = []
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (lstatSync(p).isDirectory()) out.push(...listFiles(p))
    else out.push(p)
  }
  return out
}

function readFolder(dir: string): { path: string; text: string | null }[] {
  return listFiles(dir).map((p) => ({ path: relative(dir, p), text: readFileSync(p).includes(0) ? null : readFileSync(p, 'utf8') }))
}
