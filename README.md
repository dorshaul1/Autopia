# Autopia

A macOS desktop app that runs a small software company on your own Claude Code. You're the founder: you say what you want and make the decisions. A team of Claude Code agents plans it, builds it in isolated git worktrees, checks it by running it, and brings you the result, in a pixel-art office.

Work status in the office is real: where people go, what's on their screens and the labels over their heads come from workflow state. Idle life, rare events and Puffy the corgi are for fun, and local.

What's actually verified is in [docs/CAPABILITIES.md](docs/CAPABILITIES.md). Building, packaging and release status are in [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md). The website is in [website/](website/).

## Requirements

- macOS (developed on Apple Silicon), Node 20+
- `claude` on your PATH and signed in (`claude --version` should work in a terminal)
- `git` (used for isolated task worktrees)

## Run

```bash
npm install        # also rebuilds better-sqlite3 for Electron
npm run dev        # Electron + Vite with HMR
npm run typecheck
npm test
npm run build
npm run site:dev   # the website, on 127.0.0.1:4321 (run npm --prefix website install once)
npm run dist:mac   # local, unsigned-for-distribution installers in release/
```

Visual rules for every asset and UI surface live in [docs/ART_DIRECTION.md](docs/ART_DIRECTION.md).

Dev-only environment variables:

- `AUTOPIA_USER_DATA=/path`: use an isolated database and worktree directory
- `AUTOPIA_CAPTURE=/path/shot.png`: write a window screenshot every 4 seconds

In dev builds the main process logs every state-changing IPC call as `[ipc] …`, so every decision has an audit trail. The renderer exposes `window.__office` and `window.__store` for scripted visual checks.

## How it works

```
renderer (sandboxed)            preload            main (Node)
React UI + Phaser office  ◀──  contextBridge  ──▶  IPC handlers
        ▲ push events                                  │
        └──────────────────────────────── Orchestrator ┤── SQLite (better-sqlite3)
                                                       ├── git worktrees
                                                       └── claude -p --output-format stream-json
```

- **`src/main/orchestrator`**: the workflow engine. It enforces explicit state machines for projects (`new → planning → awaiting_plan_approval → executing → blocked/completed`) and tasks (`proposed → pending → running → merging → done/failed`). It schedules tasks by dependency and a parallelism limit, persists every change, then pushes it to the UI.
- **`src/main/claude`**: finds the CLI (including your login-shell PATH), spawns one non-interactive session per run and parses `stream-json` into typed events. Planning uses read-only tools plus `--json-schema` to get a structured plan. Coding and QA tasks return a structured outcome or verdict.
- **`src/main/git`**: each task runs in its own worktree on its own branch. When a task succeeds, Autopia commits it and merges it into the base branch one task at a time; a merge conflict aborts cleanly and raises a decision for you. Projects without git run one task at a time.
- **`src/main/db`**: stores projects, employees, tasks and their dependencies, runs, run events, approvals and settings in SQLite (`userData/autopia.db`).
- **`src/renderer/src/office`**: the Phaser 3 office. All the art is painted in code at one pixel per art-pixel. Characters derive where they go from real employee status (desk, meeting, error) and spend idle time on local routines that cost no tokens. A character reports when it's sitting at its desk, and the orchestrator waits up to 7 seconds for that before starting work.

### The project workspace

**Workspace** in the top bar is one place per project, with these sections:
- **Overview:** the objective, a single request box, the current delivery's stage and what is running right now (real tool activity, durations, cancel).
- **Review:** each delivery's request, what was implemented, its validation results and known limitations. Below that are the commits and a syntax-highlighted diff, attributed to the task and employee from Autopia's per-task merge commits. Your own uncommitted edits are listed separately and never touched.
- **Preview:** the running app.
- **Validation:** the history of check runs.
- **Tasks, Activity, Files.**
- **Knowledge:** reusable notes, marked stale when their files change.

**Delivery lifecycle.** Implementation → Validation → Review → your Acceptance → Delivered.
- "Ready for review" only means the team finished. Only you can accept, request a revision or reject; rejecting reverts nothing.
- Limitations are listed explicitly: unverified, declined or blocked checks, skipped tasks, or tasks with no checks.

**Revisions.** Describe a change in plain words, optionally on a screenshot region. Autopia then creates one scoped task without a planning meeting, for the teammate who built that area.
- The task carries the previous delivery's summary, its files, the checks that already guard them, and still-valid knowledge, so no one re-surveys the repository.
- Accepting a revision also accepts the work it revised.

**Live preview.** The page renders in an isolated, sandboxed view: no Node, an in-memory session per project, navigation pinned to the preview, and permission requests denied.
- Static sites are served read-only by Autopia on 127.0.0.1, so no project code runs.
- A project's own dev script (e.g. `npm run dev`) runs only after you confirm the exact command. It never runs if your organization's managed policy denies it. It binds to 127.0.0.1 on a free port.
- Crashes, port conflicts and start timeouts are reported with the logs.
- Servers stop on Stop, project switch and quit; leftovers from a crash are killed at the next launch.
- Projects without a web entry point show their build outputs and README launch notes instead of a fake preview.
- Screenshots capture what is actually rendered into `.autopia/screenshots` (added to `.git/info/exclude`). A marked region can be sent with a change request; the agent receives the image in its worktree.

**Validation.** Task checks are recorded per attempt.
- **Run validation** has your QA engineer run the project's declared lint, typecheck, test and build scripts with Claude Code's Bash tool (Bash only, small model).
- Your permission policy applies, and blocked or declined commands are reported as such.

### Company memory

Each project has a compact, local memory that agents reuse instead of re-surveying the repository. It lives in the same SQLite database, scoped per project, and is maintained without any AI calls.

- **Repository facts:** stack, layout and entry points, build/test/dev scripts, dependencies and conventions. Autopia reads them deterministically from manifests and the git file list.
  - Re-indexing is incremental: it only happens when HEAD or the working tree changes.
  - Secret files (`.env*`, keys, credentials…) are never opened or listed, and anything that looks like a credential is redacted before storage.
- **From work:**
  - Handoffs for teammates, plus significant technical decisions with their reasons and alternatives. Both come from the agents' existing structured results, so they cost no extra calls.
  - Accepted work and known limitations.
  - Consultation answers, recorded as decisions.
- **Lessons:** computed from real history, and only when something happened at least twice: repeated check failures, files that cause merge conflicts (which the scheduler then never edits in parallel), recurring blockers, and permission prompts that keep pausing agents (shown only to you). Duration, token and cost medians reach the planner only when n ≥ 3.
- **Every entry records:**
  - where it came from: read from the repo, reported by the team, or written by you;
  - the commit;
  - the git blob hashes of its files.
- **Staleness:** an entry is marked stale, and no longer sent to agents, as soon as any of those files change. Prompts say plainly that the repository is the source of truth and that the repository's CLAUDE.md takes precedence. Autopia never copies CLAUDE.md into prompts.
- **Retrieval** is deterministic: file overlap, shared words and a small prior per kind, within a size budget (about 1–2.4k characters). Every run records which notes it was given, its size, and how much it explored, so you can see exactly what context each task used.
- **Lifecycle:**
  - Facts are keyed by topic, so the same fact updates in place instead of being duplicated.
  - Agent notes unused for the retention period (default 60 days), and old stale ones, are archived. Duplicates are merged.
  - Raw tool output older than 30 days is dropped from activity logs; summaries stay.
  - Your notes are never overwritten by agents and never cleaned up automatically. Deleting one requires confirmation.
  - Reset clears a project's memory but keeps your notes.

### The director and the CEO's desk

Day-to-day coordination is deterministic and costs no tokens: the scheduler hands free capacity to
the highest-priority project's critical-path work, product milestones run one at a time, and a
director pass every 15 seconds checks for stalls and blockers. It resolves only routine
blockers by itself, once per distinct blocker: it resumes an interrupted session in place, or retries
after a missing dependency with an instruction to install it. Failing checks after bounded repair,
permission denials, your own uncommitted changes, and merge conflicts it could not resolve
always come to you with a diagnosis and a recommendation (turn this off in Settings).

**Company → Decisions** lists every decision waiting across projects (plans, permissions, blocked or
unverified work, questions, budgets) with inline actions, and shows what the director is doing in
each project: running tasks, what runs next and why, the current milestone, and spend against an
optional per-project budget. Pausing a project or reaching its budget stops new work; running work
finishes.

### Product mode

Describe a new product idea on an empty folder and Autopia plans it as a product in the same single
planning session: vision, users, core journeys, MVP features (marked *you asked* or *assumed*), the
defaults it chose, architecture, design direction and 1–4 milestones with testable acceptance
criteria. Decisions that materially change the result (paid services, credentials, major scope forks)
are grouped into the plan approval, each with a default; everything minor is decided and shown.

Milestones run one at a time as working vertical slices. When a milestone's tasks finish, Autopia
verifies it from evidence (the tasks' real checks, a static audit of the files they changed, and
visual QA for user-facing slices) before the next one starts; a failure gets one focused repair task.
The final milestone is verified by delivery review. **Workspace → Product** shows the brief, real
milestone progress, decisions, the deliverable (run commands, configuration the code reads, latest
check results, limitations, decisions, measured tokens, cost and time) and a feedback box: before
approval feedback revises the plan, during the build unstarted tasks apply it, and after delivery it
becomes a scoped revision. Nothing is deployed or published.

### Quality

Before a task starts, Autopia decides deterministically how it will be verified: small changes get
focused checks; high-risk or large work gets explicit acceptance criteria, lint/type/build gates and
the reviewer subagent. When a delivery reaches review, Autopia runs a static audit of the added lines
(injection, shell/SQL building, disabled TLS, secrets, leaks; no AI) and, for user-facing work with a
running or static preview, real visual QA: sandboxed captures at 375/768/1280 px with overflow,
clipping, contrast, accessible-name, alt-text, console-error and load measurements.

**Workspace → Quality** shows readiness per dimension as *verified, failed, not checked, blocked* or
*not applicable*, with no score. Work is "Ready" only when every applicable dimension has passing
evidence; you can accept the rest with a recorded note, and accepting a delivery with open items
records them in the decision. Failed checks are repaired in the same session within a risk-based
budget (one attempt for low-risk work), and repair stops early when a fix leaves the failure
unchanged. Verified repairs become project lessons. From the dashboard you can rerun checks, run the
audits again, or request a focused repair of selected findings.

### Engineering skills

Each task is routed deterministically (no extra Claude call) to at most **one working method**
(systematic debugging for defects and retries, spec first for large/complex tasks, test first for
logic changes in projects with tests) plus **up to two domain guides** (security, structural change,
React, interface quality). High-risk tasks (security-sensitive, structural, or large) also get a
read-only **reviewer subagent** via `--agents`, and must pass the project's lint/typecheck/test
scripts before review. Each run records what it was given and why; the task card shows it.

Agents run with `--setting-sources project,local` by default, so personal `~/.claude` skills and
plugins are not loaded into every session (organization-managed policy still applies). You can opt
back in under **Company → Skills**.

Third-party skills are never bundled. Under **Company → Skills** you can download a researched
candidate for review: files are fetched at a pinned commit (≤80 files, 2 MB), statically scanned
(scripts, network use, foreign hosts, credentials, prompt injection, hooks/settings/MCP config), and
stay disabled until you approve them. Skills with blocking findings cannot be enabled. Approved
skills are loaded per run through `--plugin-dir`, only for the route they serve, replacing the
built-in method for that route. See `docs/SKILLS_EVALUATION.md` for the ranking and rationale.

### The office

The office is a living startup floor (56 × 36 tiles) whose activity is tied to real work:

- **Real activity.**
  - People with real work go to their desks, and their monitors show the actual tool in use.
  - The boardroom fills only during a planning session.
  - The focus room hosts a real consultation: the teammate answering and the one who asked.
  - The kanban and milestone boards show real project phases and task progress.
- **Idle time.** It runs on a local simulation, using no tokens. Needs, persona, time of day, cooldowns and distance decide between options such as coffee, lunch, the sofa, the arcade, a phone booth or a chat with a teammate.
- **Click anything.**
  - Rooms show their purpose and who's in them.
  - Desks show who sits there and what they're working on.
  - The coffee bar brews a cup.
  - The focus-room screen shows the current consultation.
- **Arrange the office** (the move button in the camera dock).
  - Drag plants, lamps and bins. A move is rejected if it would block a doorway, a seat or any route.
  - Pick fabric accents and wall artwork.
  - Seating is automatic: founders keep their own desks and hires take the next desk in order. There are never empty desks; a desk is furnished only for someone who sits at it.
  - Layout and style are saved; nothing here affects work.
- **Optional office sound** (off at launch). It is synthesized locally with WebAudio: room tone, keyboards for people who are really working, coffee, doors and ping-pong.

### How work is executed

Autopia uses the smallest team and the lightest process that will do the job well.

1. **Local triage** (no tokens) reads the brief and suggests a strategy. You can always override it.
   - **Simple** requests become one task for one agent: no planning session, no meeting.
   - Anything larger goes to **planning**: Maya (PM) alone reads the repo read-only and proposes a plan. The plan includes complexity, a reusable repo summary, and for each task the role and why, its size, the files it owns, and the checks that prove it.
2. **You approve** the plan, or request changes. Only the employees with assigned tasks are activated; everyone else idles in the office at zero token cost.
3. **The scheduler** starts ready tasks highest-critical-path first, up to the parallel limit. A ready task waits only when its owner is busy or it would touch the same files as running work. Each task runs in its own git worktree. The UI shows why a task is waiting.
4. **Checks with real evidence.** Agents run each task's checks themselves with Claude Code's Bash tool, under the same permission policy as everything else. Autopia never runs commands for them. Autopia reads the exit status of those Bash calls; pipes, `;` and `|| true` don't count, because they hide failures. A failed check goes back to the same session with its output, up to the auto-fix limit. If a check never ran, Autopia sends one reminder. A check that was declined, blocked by policy or never run is never treated as a pass: you get an **unverified** decision (accept, retry or skip) naming the exact reason. QA failures become a fix task for the owning developer, then QA re-runs.
5. **Integration.** Autopia predicts merge conflicts before merging (`git merge-tree`). The agent resolves them inside its worktree, and merges happen one at a time. Autopia never overwrites your uncommitted files.
6. **Models are chosen to fit the work** (adaptive mode): Sonnet for simple/medium planning and S/M tasks, Opus for complex planning and L tasks. It never uses a model your organization disallows.
7. **Insights** shows only measured data:
   - wall, executing and waiting time
   - parallelism (agent time ÷ executing time)
   - sessions, retries, failures and conflicts
   - CLI-reported tokens and cost, with how many sessions were metered
   - a timeline per employee, and utilization

If the app closes mid-run, those tasks are marked interrupted, orphaned `claude` processes are killed on the next launch, and **Retry** resumes the same session in the kept worktree.

### Running the company

Autopia's management layer is deterministic: monitoring, staffing, priorities and notifications never call Claude.

- **Capability-based staffing.** Every employee has a specialization, capabilities (backend, UI design, QA, …) and the task kinds they can own. Each task is matched to the best-fitting person. Independent work is spread across equally qualified people. The PM never takes build work.
- **Runtime reassignment.** If a ready task's owner is busy and an idle colleague covers at least 60% of the skills it needs, the manager reassigns it and logs why.
- **Supervision.**
  - A session that produces no output for 4 minutes is flagged.
  - After 10 minutes it is restarted once, resuming the same session.
  - QA defects are routed back to the owning developer as a fix task.
- **Bounded collaboration.** An agent may ask *once* for design or architecture input from a teammate (a short read-only consult whose answer resumes the task), or ask you a product question, which arrives as a decision card.
- **Founder controls.**
  - Project and task priority (high/normal/low) feed the scheduler.
  - You can reassign any task that hasn't started, with options sorted by capability fit.
  - **Hire** a Backend, Front-end or Platform engineer. Autopia suggests a hire only after real tasks waited for a busy person. New hires get the next free workstation, and you can swap desks in a person's profile.
- **Company view.**
  - A portfolio of every project with a status summary built from real data, progress, spend, active people and decisions waiting.
  - Team cards and full profiles: capabilities, current assignment and why, history across projects, check pass rate and spend.
  - An inbox.
- **Notifications** only for things that matter: plans to review, questions, failures that need a decision, delivered projects, halfway milestones, and security-relevant events (full-access mode turned on, uncommitted work protected). Decisions and failures also raise a native macOS notification when Autopia isn't focused.

### Permissions

Autopia runs Claude Code with `--permission-prompt-tool stdio`. When Claude Code's own policy says a tool call needs confirmation, the agent pauses and an approval card shows you the exact command or file.
- **Allow once** lets that one call run.
- **Allow for this task** lets that exact call run again without asking until the task ends.
- **Decline** refuses it. The agent is told not to work around a declined call.

While an agent waits for you, it is not treated as stalled. Prompts expire if the session ends.

Precedence is Claude Code's, not Autopia's:
1. The organization's managed policy (`managed-settings.json`).
2. Claude Code's mode. Write tasks use `acceptEdits` inside an isolated worktree.
3. Autopia's standard allow list (build and test tools), which only applies when the org lets non-managed rules count.

Commands on a managed deny list are refused by Claude Code and are never re-run through another path. **Full access** (skip permissions) is disabled, and is never requested, when the org sets `disableBypassPermissionsMode`.

**Settings → Claude Code & permissions** shows:
- the CLI version, sign-in, and the permission mode Claude Code actually reported;
- the managed flags and rules;
- a capability table (allowed / asks you / blocked / not available), with the source of each status and how to change it.

**Run live test** confirms the table on this machine. It runs one short session in a temporary folder that tries `ls`, `node probe.js`, `npm test`, `git --version`, `curl --version` and one file write. Anything that asks is declined and recorded, not run.

Git is the one deliberate split. Agents may not use git under many org policies, and are told not to. Autopia itself creates worktrees, commits and merges as its core workflow, in its own process.
