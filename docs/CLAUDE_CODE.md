# Claude Code integration (Phase 17)

Autopia runs every piece of engineering work as a real Claude Code CLI session. Claude Code does the
work; Autopia decides how the work is organised, what each session knows, and whether the result is
really done.

This document records:
- what the installed CLI can actually do, verified from evidence;
- how responsibilities are split;
- what changed in Phase 17;
- what is still unverified.

## Verified capability matrix

**Installed:** Claude Code **2.1.235**.

**Sources of evidence:**
- **Help text:** `claude --help`, now also read by Autopia at start-up.
- **Recorded sessions:** 67 sessions in this machine's Autopia history, $21.28 reported cost. The counts
  come from their init messages, tool events and results.
- **Filesystem:** session storage under `~/.claude/projects`.
- **One prompt-less start:** no model call was made. It showed that no init message arrives before a prompt.

**Status values:**
- *Supported (used)*: verified working inside Autopia.
- *Supported (not used)*: present in this CLI; Autopia does not use it.
- *Partial*: works with limits.
- *Unavailable here*: blocked in this environment.
- *Unverified*: not proven either way.

| Capability | Status | Evidence |
|---|---|---|
| Non-interactive sessions (`-p`, stream-json in and out) | Supported (used) | 67 recorded sessions |
| Interactive TUI sessions | Supported (not used) | By design: agents run headless, and Autopia is the interface |
| Session identity (`--session-id`) and resume (`--resume`) | Supported (used) | 26 resumed sessions (9 fixes, 17 retries) |
| Continuing a session from another task | Unavailable | Sessions are stored per working directory, and each task has its own worktree (51 per-worktree session folders found). Autopia carries knowledge across tasks through handoffs and memory instead. |
| `--continue`, `--fork-session` | Supported (not used) | `--help`. Forking across worktree paths is unverified. |
| Streaming tool events | Supported (used) | 516 tool calls recorded (Bash 180, Read 155, Edit 97, …) |
| Partial message streaming | Supported (not used) | `--help` |
| Tool permissions, relayed to you | Supported (used) | 114 "ask" decisions relayed through `--permission-prompt-tool stdio`. This flag is undocumented and **not** in `--help`, so it is proven by use only. |
| Permission modes | Supported (used) | acceptEdits 58, default 10. Bypass mode is disabled by your organisation. |
| Organisation-managed policy | Enforced by Claude Code | Managed rules only; Autopia only reads them to explain |
| Structured output (`--json-schema`) | Supported (used) | 53 StructuredOutput calls |
| Files as input | Supported (used) | Every session works in a real worktree |
| Images as input | Partial | Attachments are copied into the worktree and read with `Read` (1 image read recorded). The `--file` API file IDs are not used. |
| Skills and slash commands | Supported (used) | 19 skills reported at init (organisation plus routed). The `Skill` tool was invoked 2×. Per-session `--plugin-dir` is used. |
| Native subagents (`--agents`, `Agent` tool) | Supported (used) | Offered as "reviewer"; used 2× |
| MCP servers | Unavailable here | Enterprise policy blocks the claude.ai MCP servers, and no other servers are configured. 0 MCP tools in 67 init messages. Project `.mcp.json` would load through `--setting-sources project,local`; that is unverified. |
| Project instructions (CLAUDE.md) | Supported (used, indirectly verified) | Loaded by Claude Code from project settings sources. Autopia's indexer detects the file and its memory defers to it. |
| Model selection, `--effort` | Supported (used) | Models claude-sonnet-5 (65) and haiku-4.5 (3). Effort low/medium/high recorded per run. |
| `--fallback-model`, `--autocompact` | Supported (not used) | `--help` |
| Spend cap per session (`--max-budget-usd`) | Supported (used) | Passed on every session |
| Cancellation | Supported (used) | 6 sessions cancelled |
| Recovery after interruption | Supported (used) | 4 interrupted sessions; interrupted tasks resume their own session |
| Usage and cost reporting | Supported (used) | 63 of 67 sessions reported cost and tokens. The other 4 ended before a result. |
| Background agents, cloud sessions, `--worktree`, Chrome, hooks stream | Supported (not used) | `--help`. Autopia owns isolation and scheduling. |
| Removing tools with `--disallowedTools` | Supported (used) | Live check: the tools offered went from 31 to 18, and every denied tool disappeared |
| Init message before the first prompt | Not available | The probe got no init until a message was sent. Checking a session's tool list therefore needs a real (paid) prompt. |

## Who does what

| Layer | Owns |
|---|---|
| **Claude Code** (execution) | Reading, editing and running code; tool execution; permission enforcement, including your organisation's policy; session persistence and resume; skills and plugins; native subagents; MCP; structured output; usage and cost reporting; context compaction inside a session |
| **Autopia** (intelligence) | The strategy for each request (direct / light / plan); planning, decomposition and employee choice; worktrees and safe parallelism; what each session is told (memory, matched files, handoffs, routed skills, the quality plan); relaying your permission and question decisions; verifying evidence from what a session actually ran; review QA and bounded repair; budgets, pause, the director; lessons; the office and the conversation |
| **You** (experience) | What to build, approvals, accepting results. Ambient office behaviour never starts a session. |

Autopia doesn't re-implement anything in the Claude Code row. It passes those through, and only shapes
them per session: tool allow and deny lists, effort, model, plugins and agents.

## What changed in Phase 17

1. **Headless tool hygiene.** Every recorded agent session had been offered all 31 built-in tools. Some
   are only meaningful in the interactive app, or would undermine Autopia's coordination:
   - `EnterWorktree` / `ExitWorktree` could step outside Autopia's git isolation;
   - `AskUserQuestion` can't be answered headless, and Autopia has its own question path;
   - plan mode;
   - `SendMessage`, `ListAgents`;
   - app-only surfaces: `Artifact`, `DesignSync`, `Workflow`, `ReportFindings`, `CronList`.

   These are now denied in every agent mode, which also keeps their descriptions out of every agent's
   context.

   **Verified live** (2026-11-03): one approved $1 check, which cost $0.03. It was a real session started
   with Autopia's own agent arguments: write mode, standard profile, haiku, one turn.
   - Claude Code reported **18 tools instead of 31**.
   - Every denied tool that had been offered is gone, and none of the deny list remains.
   - All engineering tools are still offered.
   - `StructuredOutput` is absent only because this check passed no `--json-schema`, which agent sessions
     always pass. Everything engineering needs stays available, including `Skill`, `Agent`/`Task`, the task-list
   tools, `WebFetch`/`WebSearch`, `ToolSearch` and `StructuredOutput`.
2. **Version-aware arguments.** At detection, Autopia reads the installed CLI's `--help` once. Missing
   *optional* flags (`--effort`, `--plugin-dir`, `--agents`, `--setting-sources`, `--max-budget-usd`, …)
   are omitted, and Settings says so. A missing *required* flag gives a clear "update Claude Code"
   message, instead of every session failing with an unknown option.

   The check caught its own mistake. `--permission-prompt-tool` isn't in `--help`, so listing it as
   required would have wrongly blocked this working CLI. It is documented as unverifiable.
3. **Stale tool name.** The Phase 14 *light* strategy told agents to use `TodoWrite`, which doesn't exist
   in 2.1.235 (the task-list tools are `TaskCreate`/`TaskUpdate`). It now says "a short task list".
4. **Three-way benchmark.** `npm run bench -- run --mode all` compares:
   - **direct** Claude Code;
   - **autopia-minimal**: through Autopia, forced to one direct task, so with Autopia's memory, checks and
     QA but no triage, planning or delegation;
   - **autopia**: the adaptive strategy.

   Conditions are equivalent: same scenario, repository state, permission profile and CLI.
5. **Equal permissions in the benchmark.** The harness had declined *every* permission prompt. Under your
   organisation's policy, which asks before `npm`/`node`, that would have stopped agents in every mode from
   running their own tests. All modes now give the same founder-style answer: routine commands allowed;
   destructive, privileged, networked or history-rewriting ones declined.

Tests: **161 pass**; 8 are new, covering flag parsing and omission, the required list, the denied and
kept tools, the light prompt, and benchmark permissions. Typecheck and production build pass. The
running app detects 2.1.235 with no false restrictions.

## Efficiency: measured vs estimated

**Measured,** from recorded sessions:
- 93% of input tokens are cache reads.
- Fix sessions that only re-ran already-passed checks were 6 of 9 ($1.35). Removed in Phase 13.
- Failed retry sessions cost $1.74. Most were Mac-sleep stalls, addressed in Phase 10/11.

**Estimated, not measured:**
- The 18 denied tools no longer occupy context in each session.
- The real token saving depends on their description sizes, which can only be read from a live session.

## Not verified yet (needs paid runs)

- **Whether orchestration pays off.** Direct vs autopia-minimal vs autopia on real tasks: completion,
  hidden-check pass rate, time, tokens, sessions. No live benchmark has run. A 3-scenario × 3-mode slice
  has an $18 hard cap; the full suite is $54.
- **Project MCP servers.** Whether project-scoped `.mcp.json` servers load under Autopia's settings
  sources, and whether forking a session across worktrees works.
