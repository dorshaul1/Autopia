# Real-world engineering benchmark (Phase 13)

This report covers how well Autopia actually does autonomous engineering work. Every number below comes
from one of three places:

- Claude Code's own result messages, as recorded in Autopia's run history;
- deterministic replays of that recorded history;
- the benchmark's own checks run against fixtures.

Nothing is estimated or modelled.

**Status (2026-11-03):**

| Part | Status |
|---|---|
| Harness and the 10 scenarios | Built and **validated deterministically**, with no AI calls |
| Audit of the execution pipeline | Done, from **66 recorded Claude Code sessions** ($20.89) |
| Improvement | One improvement made and **measured by replaying recorded evidence** |
| Live comparison (direct Claude Code vs Autopia) | **Not run yet.** It needs paid sessions, and its budget has not been approved (see [Live benchmark](#live-benchmark-not-yet-run)) |

## 1. The benchmark suite

Everything lives in [`benchmark/`](../benchmark). See the [README](../benchmark/README.md) there for how to
run it. Each scenario is a folder with:

- `scenario.json`: the request(s), acceptance criteria, verification commands and budget;
- `repo/`: the starting state;
- `verify/`: **hidden** checks. These are copied in only after the run, next to the repo rather than inside
  it, so the agent never sees them.
- `solution/`: a reference solution, used only to prove that the checks are achievable.

| # | Scenario | Category | Request | How it is verified |
|---|---|---|---|---|
| 01 | bugfix-cart | Small bug fix | The cart total ignores quantity | Hidden tests (quantity, merges, cent rounding, unchanged behaviour) plus the repo's tests |
| 02 | feature-due-dates | Multi-file feature | Due dates, `OVERDUE`, `--overdue` and date validation in a todo CLI | The CLI is run end to end in 7 hidden tests: output format, exit codes, nothing saved on invalid input |
| 03 | ui-accessible-form | UI improvement | Labels, a real button, announced inline errors, visible focus, AA contrast | Static checks on the HTML and CSS: label association, `aria-*`, focus rules, WCAG contrast computed per rule, validation rules unchanged |
| 04 | refactor-report | Safe refactor | Split a 90-line function without changing behaviour | Byte-for-byte output equality with the original on 40 generated datasets (with and without options) plus edge cases, and no function over 40 lines |
| 05 | test-coverage-slug | Test coverage | Write a real suite for an untested module | Mutation testing: the agent's suite must kill ≥ 6 of 7 non-equivalent mutants, and behaviour stays unchanged |
| 06 | build-repair | Failing build | Finish a half-done rename so `npm run build` passes | Build and tests pass, the old module is gone, the API manifest is exact, behaviour unchanged |
| 07 | new-project-csvstat | New project from natural language | A dependency-free CSV statistics CLI, with tests and a README | Exact output on hidden CSV files (quoted fields, empty cells), exit code 2 when the file is missing, project hygiene |
| 08 | followup-inventory | Follow-up using context | "Add removeStock", then "make **the function you just added** throw…" | Hidden checks after each step; step 1 must still pass after step 2 |
| 09 | multidiscipline-search | Multi-discipline | Search API, a labelled search box, backend tests and README docs | Real HTTP calls to the server, frontend wiring and label, tests and README cover search |
| 10 | recovery-interrupt | Recovery | Markdown features, **with the session killed after 40 s** | Same session resumed (direct) or the task retried (Autopia); hidden tests include link-safety and leftover-state checks |

**Validation:** `npm run bench -- validate` makes no AI calls. For every scenario it shows that:

1. the untouched starting state **fails** its checks, so the scenario measures something;
2. the reference solution **passes** every check, including the per-step checks, so the scenario can be
   achieved and the checks are not broken.

All 10 scenarios are valid. The result is recorded in
[`benchmark/results/validation.json`](../benchmark/results/validation.json).

Two scenarios were invalid on the first validation run, and the validator caught both:

- Two mutants in scenario 05 were *equivalent*: they could not change behaviour, so no test suite could
  ever have killed them. They were replaced.
- The scenario 07 reference solution failed on macOS, because `/var` is a symlink to `/private/var`.

**What a run records** (one JSON line each, in
[`benchmark/results/runs.jsonl`](../benchmark/results)):

- wall time, Claude Code sessions, cost, input/output/cache tokens, turns, and tool calls by name;
- permission requests declined, and the founder-style decisions taken;
- whether the run was interrupted;
- the result of every check (exit code and output tail), pass/fail, files and lines changed;
- whether the run went over budget, plus the Claude Code version and model.

**The two modes are compared like for like:**

- Same request text, same disposable starting state and same hidden checks.
- Same permission profile: Autopia's *standard* profile, and every permission prompt gets the **same
  founder-style answer** in every mode (`benchPermission`): routine commands such as `npm test` are allowed,
  anything destructive, privileged, networked or history-rewriting is declined. (Declining everything, as
  first designed, would have stopped agents from running their own tests under your organisation's
  policy, which asks before `npm` and `node` commands.)
- Same Claude Code CLI.
- *Direct* is one plain Claude Code session per request. Follow-ups and interruptions resume the same
  session.
- *Autopia* is the full product: the request is sent through the Composer, and the harness then approves
  plans, accepts results, and retries only after a deliberate interruption.

## 2. Execution-pipeline audit (recorded history, no new spend)

| | Sessions | Cost | Median wall time | Median turns | Succeeded |
|---|---|---|---|---|---|
| Task sessions | 56 | $19.76 | 1.2 min | 7 | 43 |
| Planning | 6 | $1.04 | 0.9 min | 5 | 6 |
| Ask | 1 | $0.05 | 0.2 min | 3 | 1 |
| Re-validation | 3 | $0.03 | 0.3 min | 2 | 3 |

**Task sessions by purpose:**

| Purpose | Sessions | Cost | Notes |
|---|---|---|---|
| work | 30 | $10.68 | |
| retry | 17 | $6.99 | 8 of these did not succeed. Those 8 cost **$1.74**, and 7 of them ran 15–21 minutes before being stopped. This matches the Mac-sleep stalls diagnosed in Phase 10/11 (sleep and network drops are now classified as interruptions, and the stall clock resets on wake). The fix can only be re-measured with live runs. |
| fix | 9 | $2.09 | Every fix session followed a session that **succeeded**. See §3. |

**What the history shows:**

- **Context reuse works:**
  - 93% of input tokens were cache reads: 21.5M cache-read against 1.52M fresh.
  - Median memory pack: 1.4k characters.
  - Median discovery calls before the first edit: 4.
  - The median "first-session input" of 340k tokens counts cache reads across all turns. It does not mean
    340k fresh tokens.
- **Parallelism and outcomes:**
  - Parallelism: 0.91.
  - First-pass task success: 79%.
  - Clean deliveries: 82%.
- **Tool use in task sessions:**
  - Bash 176, Read 142, Edit 95, Write 28, Glob 22, Grep 8.
  - Skills were invoked once.
  - The reviewer subagent was used in 2 of the 12 sessions that offered it. This is a weak signal, and
    without live A/B runs it is not grounds for a change.
- **Effort per session:**
  - medium 18, high 11, low 1;
  - 26 sessions predate per-run effort.
- **Permission prompts were present but my first audit query missed them.** That query counted
  `permission`-kind events and found none, because founder permission prompts are stored as `system`
  events. The Recipe Box backend session alone waited on several, so they cost wall time that this audit
  does not quantify.

## 3. Bottleneck found and fixed: check evidence inside `&&` chains

**Evidence.** All 9 fix sessions came straight after a *successful* session. I replayed each one's real
Bash evidence through the check matcher. In most of them, the "missing" checks had in fact run and
passed inside a chain such as `node --check a.js && node --check b.js && npm test`. The old matcher only
credited the **last** command of a chain. Every earlier check counted as "not run", which started a whole
extra Claude Code session just to re-run commands that had already passed. Two more cases were
setup commands the agent had listed as checks: `npm install` and `open index.html`.

**Change** ([`src/shared/checks.ts`](../src/shared/checks.ts)):

- A chain that exits 0 proves that every step passed.
- A *failing* chain proves nothing about its earlier steps. Those steps count as **not run**, and are never
  credited from an older pass that may be stale.
- Chains containing `;`, `||` or a background `&` are still never evidence.
- Quoted text is left alone.
- Installing dependencies and `open file` are no longer treated as required checks.

New unit tests cover each rule. 107 tests pass.

**Measured effect** on recorded runs (`npm run bench -- replay`, deterministic; output in
[`benchmark/results/replay-checks.txt`](../benchmark/results/replay-checks.txt)):

| | Before | After |
|---|---|---|
| Fix sessions after a successful session | 9 ($2.09) | 3 would remain |
| Fix sessions that only re-ran already-passed checks | 6 ($1.35, 3.6 agent-minutes) | 0 |

This is **6.8%** of all task-session spend in the recorded history.

One reminder is still justified. In that case every `npm test` was piped into `tail`, which hides the
exit code. Verification is no weaker: no check that failed or never ran is credited as passed.

## Live benchmark: not yet run

The live comparison has **not been executed**. No result in this document comes from a live benchmark
run, and `benchmark/results/runs.jsonl` does not exist yet.

The harness refuses to start paid work unless `--approve-usd` covers the worst case:

| Run | Hard cap (each run is stopped at its own cap) |
|---|---|
| All 10 scenarios, direct + Autopia, once | **$36** |
| One mode only | $18 |

What still needs to be measured live:

- the direct Claude Code vs Autopia baseline;
- whether the check-chain fix lowers sessions per task in practice;
- recovery overhead after interruption;
- the reviewer subagent's effect on quality.

Recommended order:

```bash
npm run bench -- run 01 06 --mode both --label baseline --approve-usd 4
npm run bench -- run --mode both --label baseline --approve-usd 36
npm run bench -- report
```

Autopia mode drives the running app over CDP. Start it with a separate profile so that benchmark projects
never mix with yours:

```bash
AUTOPIA_USER_DATA=/tmp/autopia-bench-profile npx electron-vite dev --remoteDebuggingPort 9333
```

## Limitations

- **Some checks are heuristics, chosen to be strict and stated plainly:**
  - the longest-function rule in 04;
  - regex-based HTML/CSS checks in 03;
  - the 03 contrast check only reads hex colours.
- **Replay approximation.** The replay uses each task's final required-check list, which is the list
  Autopia stored, as the list required at the time.
- **Fixtures are small Node projects without dependencies.** This is so runs need no network and execute
  no third-party install scripts. Larger codebases and other stacks are not covered yet.
- **No variance data yet.** Use `--repeat` once live runs are approved; the report shows medians.

## Phase 14: engine changes and how they will be measured

**Audit summary.** These parts already work and were left as they are:

| Area | What exists |
|---|---|
| Triage | Local; costs no tokens |
| Scheduling | Critical-path scheduling, with file-overlap and hot-file protection |
| Assignment | Idle-colleague reassignment |
| Git | Worktree isolation, with conflict prediction and resolution |
| Repair | Evidence-checked repair loop with failure signatures |
| Director | Diagnoses blockers and auto-resolves each one once |
| Readiness | Reported per dimension |
| Controls | Budgets and pause |

The audit found four gaps, each confirmed in the recorded runs or the benchmark requests. All four are
fixed by extending the existing code. There is no second orchestrator.

| Gap (evidence) | Change | Where |
|---|---|---|
| Every non-simple request got a PM planning session plus an approval wait. 5 of the 10 benchmark requests are single-deliverable medium work. | A new **light** strategy: one owner plans the steps in their own session and must report every requirement as a criterion. Triage picks it only for medium briefs with no architectural scope that don't span frontend *and* backend. Separate workstreams still get a team plan. | `src/shared/triage.ts`, `kickoff`, `directTask` |
| An agent could report requirements as **not met** and the task still finished. Recipe Box T2 reported 3 unmet criteria. | Unmet criteria the team owns get the same bounded repair as a failed check, using a set signature, the same budget and the same stop rule. Anything still unmet becomes an honest **"Partly done"** decision, never "done". The office shows "Finishing unmet requirements". | Task check loop; `repairStopReason`, `criteriaSignature` and `teamUnmet` in `quality/readiness.ts` |
| One failed task stopped **every** other task in the project. | A stuck task now holds only its dependents. Independent ready work keeps going, and the project shows as blocked once nothing else can run. Product milestones stay sequential. | `schedule()`, `canContinueAround` |
| A dependency's handoff reached the next task only if relevance scoring ranked it high enough. | The handoffs of a task's direct dependencies are **pinned** into its context through the existing memory retrieval, within the same budget and without duplicates. | `ContextQuery.pinned`, `scoreEntry` |

Two more changes:

- The duplicated repair stop logic is now one function.
- 12 new tests cover strategy selection, dependency handling, bounded repair, the requirement filter and
  pinned handoffs. The suite is now 119 tests.

Typecheck and the production build pass, and the app was restarted on the new engine.

**What has *not* been measured:**

- **Only one live run so far.** A single functional check (approved, capped at $1) ran the new
  **light** path end to end through the real app. It used a medium, single-deliverable brief: add
  `removeStock` with typed errors and tests, on a disposable copy of the inventory fixture.
  - **Triage:** picked **light**. There was no planning session and no approval wait.
  - **Session:** one Claude Code session at medium effort: 7 turns, 67 s, **$0.39**.
  - **Its own report:** all 5 requirements as criteria with evidence, all met. `npm test` passed (6 tests),
    and the work was merged.
  - **Independent check:** the scenario-08 hidden tests passed, 3 of 3.
  - **Untested paths:** none of the other three changes (criteria repair, failure isolation, pinned
    handoffs) was triggered.
  - **Not evidence of improvement:** this is one run, with no comparison against the old engine.
- **No improvement is claimed.**
  - The light strategy should save one planning session and an approval wait per focused request, but
    whether quality holds without a team plan is exactly what the benchmark must show.
  - The criteria repair adds a session only when work is incomplete.

To compare old and new under identical conditions, `AUTOPIA_ENGINE=legacy` restores the pre-Phase-14
behaviour of all four changes. The Phase 13 check-chain fix is not part of that switch; its effect was
measured by replay.

**Remaining limitations:**

- **Light strategy:** it is chosen from the brief's text alone, not from how big the repository is.
- **Replanning:** it is bounded to repair within a task and continuing around a failure. Splitting a task
  that turns out bigger than planned, or dropping one that's no longer needed, still goes through you.
- **Permission prompts:** these remain the largest source of friction in the history (about 80 in Recipe
  Box), because your organisation's policy sets tests and installs to "ask". That is policy, so Autopia
  doesn't route around it.

## Phase 15: project understanding and memory

**Audit.** The Second Brain already did the right things:
- deterministic indexing of stack, workflow, layout and conventions, plus an import graph;
- provenance (read from the repo / reported by the team / yours) and redaction of secrets before storage;
- hash-based staleness and budgeted, scored retrieval;
- lessons drawn from history;
- archiving, and inspection and correction in the Memory view.

It stays the only memory system: no new store, and everything uses the existing knowledge table and
meta records.

**Gaps it had:**

| Gap | Evidence |
|---|---|
| Direct and light tasks reached retrieval with no target files, so retrieval fell back to word overlap. Import relationships and related tests never appeared, and most tasks take this route. | Below |
| The import graph re-read every source file whenever the tree changed. It stopped silently at 600 files. | Below |
| Freshness only worked with git. | Below |
| Conflicting decisions could all stay active, including an agent's decision against yours. | Below |
| A corrupted stored record made retrieval throw, which stopped the task from starting. | Below |
| Marking a stale note "still true" didn't stick: it went stale again on the next refresh. | Pre-existing bug |
| Test folders were detected only from `*.test.js` file names. | Pre-existing |

**What changed** (in the existing indexer, memory, repository and orchestrator code):

- **Request targeting** (`matchTargets`). With no AI, a request is matched to files, strongest evidence first:
  1. paths it names;
  2. unambiguous file names;
  3. distinctive exported symbols (`removeStock`, `toTitleCase`);
  4. as a fallback only, file stems used as words ("the todo CLI").

  The matched files feed the existing relationship lookup, which now also lists **the tests that import
  them**. The prompt labels them "matched from its wording, not inferred by AI". This applies
  automatically whenever a task or plan has no planned files.
- **Incremental, wider scan** (`scanSources`). A file is re-read only when its size or mtime changes. It
  covers up to 5,000 sources, and records each file's exported names.
- **Freshness everywhere.** Git-compatible blob hashes are computed in-process, so freshness works without
  git and spawns no processes. Every stale entry records **why**: which file changed, or which file
  disappeared and where a file with the same name now lives. Older stale entries get their reason filled
  in. "Still true" re-confirms the entry against the current files.
- **Decision conflicts** (`decisionsConflict`). These are deliberately conservative: same `Subject:`
  prefix, or shared files with mostly the same title.
  - An agent's decision that contradicts yours is kept but **not shared**, and shows as *conflicts with
    your decision* until you decide.
  - Otherwise the newer decision wins, and the older one is archived as *Superseded by …*, so the history
    is kept.
- **Recovery.** Damaged meta records, scan caches, graphs and knowledge columns degrade to "nothing known",
  never to a crash or to trusting malformed data.
- **Continuity for planners.** A fresh planning session, after a restart or a new request, gets a short
  "Where the project stands" built from Autopia's own records: open blockers and unfinished tasks.
- **UI.** The existing memory row now shows the recorded reason. No new screens.

**Measured** with `npm run bench -- memory`. It is deterministic, makes no AI calls, and drives the real
`Memory` class on real SQLite. Each scenario repo sits inside about 240 unrelated source files plus
neighbouring files in its own folders. Both runs are in
[`benchmark/results/memory.jsonl`](../benchmark/results/memory.jsonl).

| | Before (baseline) | After (phase15) |
|---|---|---|
| Files the reference solution changes that reach the task's context | 7 / 18 | **16 / 18** |
| Existing tests that import those files, surfaced | 1 / 6 | **6 / 6** |
| Matched files the solution changes (precision) | n/a | 10 / 13 (the other 3 are named in the request: a file to keep unchanged, the module under test, a rename target) |
| Unrelated notes injected (5 per scenario) | 0 / 50 | 0 / 50 |
| Context size, 10 scenarios | 10,218 chars | 13,171 chars (+29%) |

On a generated 4,000-file repository:

| | Before (baseline) | After (phase15) |
|---|---|---|
| Files in the import graph | 600 | **4,000** |
| First index | 101 ms | 484 ms |
| Re-index after one edit | 96 ms | **56 ms** |
| Edit reflected in the graph | no | **yes** |

Lifecycle probes passed 2 of 6 before and **6 of 6** after. The two that already passed (isolation and
restart) were working already. The four that were fixed:

1. an edited file marks its note stale without git;
2. a removed file sets its note aside;
3. an agent decision never overrides yours;
4. corrupted data doesn't block work.

In the running app, a warm re-index of Recipe Box took 846 ms. The first call after launch can take much
longer, because Claude Code's login environment is resolved once per app start (about 19 s measured
here). That cost is separate from memory.

**Not measured:**

- **Task outcomes.** Whether better-targeted context changes real task quality, time or cost needs paid
  runs, and none were run for Phase 15. The retrieval gains above are about *what reaches the agent*,
  not the results it produces.
- **Larger real repositories.** The first index of a large real repository is slower now, because it
  covers 7× more files. It's still well under a second at 4,000 small files, but very large monorepos
  aren't tested.

**Limitations:**

- **Language coverage.** Symbol and import extraction is JS/TS/CSS/HTML only. Python, Go and Rust get
  stack and test facts, but no graph.
- **Conflicts phrased differently.** Conflict detection needs a shared `Subject:` or overlapping
  files-and-titles, so decisions phrased differently aren't caught. That's by design: a false alarm would
  hide a valid decision.
- **Rename detection** is by file name, and offered as a hint. The entry is never rewritten
  automatically.

## Phase 16: product quality and continuous improvement

**Audit.** The quality systems were already real:
- per-task quality plans and check evidence with bounded repair (Phases 8 and 14);
- a static audit of added lines;
- visual QA on the running app, rendered offscreen at 375 / 768 / 1280 px;
- readiness per dimension;
- product-milestone gates.

They stay the only QA system: no new agents, no new framework.

**Signal problems in your recorded reports:**

| Project | What the old QA reported | Reality |
|---|---|---|
| Weather app | 8 contrast failures at **1.03:1** | The page's background is a fixed gradient layer *behind* the content. With no opaque ancestor colour, the checker silently assumed white. |
| Weather app | "Request failed" for Google Fonts, at medium severity | The QA window doesn't contact external hosts. |
| Weather app, and readiness in general | Accessibility shown as **"verified"** while those findings were open | Only *high* findings counted. |
| All projects | A regex match (e.g. `innerHTML`) and a measured defect looked identical | Neither carried evidence, certainty, a fix or a priority. A pattern match could also start a milestone repair. |
| All projects | Defects found at review were never corrected outside product mode, and nothing said what was actually tested | — |

**What changed** (all extending the existing modules):

- **Evidence-graded findings** (`quality/findings.ts`). Every finding has:
  - a **certainty**: *verified* (measured on the page, or certain, like a secrets file in the change set), *suspected* (a pattern match or unconfirmed), or *advice*;
  - **evidence**, a **suggested fix**, and **scope** (introduced by this result, or present in the previous result's report);
  - a **priority**: impact × certainty × scope.

  Duplicates merge, and older reports are re-graded on read with the same rules.
- **Measured, not assumed** (`quality/visual.ts`):
  - **Contrast.** When text has no opaque ancestor background, its contrast is re-measured on the **captured screenshot**: the dominant colour inside its box, averaged from the real pixels. The finding is dropped if the text really passes, and kept as *measured* if it fails.
  - **Overflow.** It is reported once per root cause, with the widest offending element as evidence, not once per descendant.
  - **External resources.** Blocked external resources are a note, not a defect.
- **Certainty-aware readiness and gates.**
  - Only a *verified, in-scope, high* defect fails a result. Pre-existing problems are reported but don't fail work that didn't cause them.
  - A suspected high security pattern makes security "to confirm": never silently verified, never a hard fail.
  - Milestone gates no longer open repairs on suspicions.
- **One bounded autonomous correction at review.** QA now runs *before* "ready to review" is announced. Verified, serious (high or medium) defects that this result introduced go back to the team as **one** focused task, attached to the same result. It lists exactly those findings with their evidence and fixes, and nothing else may change. It respects pause, budget and Claude Code availability. The second review pass records what it **fixed**, what **remains**, and anything it **introduced**. There is never a second attempt.
- **Completion report** (`readiness.completion`), one status from evidence only:
  - *verified*
  - *done with limitations*
  - *partly done*
  - *blocked*
  - *failed*

  It comes with what was actually run, what failed, what was not verified and the known limitations. The result view uses it for its headline, its "Worth checking" list and the correction outcome.
- **Suggestions.** At most 3 per result: verified issues **outside** this result's scope, plus advice. They appear under "Suggestions" in the result view, are never applied automatically, and are never suspicions.
- **Learning.** A defect *measured* in two or more results becomes a lesson for agents, through the existing lessons mechanism. Only graded reports count, so old false positives never become lessons.
- **UI.** Only the existing result view and Checks list changed: "to confirm" / "advice" / "existed before" labels, the evidence and fix on each finding, and the new sections. No new screens.

**Measured** with `npm run bench -- quality`: no AI, real visual QA in the running app, and the real QualityEngine on a real database.

| Scenario | Before | After |
|---|---|---|
| q03 broken responsive layout | Found, but reported as **6 findings** for one cause | Found as **1 finding** with the offending element as evidence |
| q04 accessibility (unlabelled input and icon button, missing alt, low-contrast text) | 3/3 found | 3/3 found (plus the real, minor tap-target) |
| q06 false-positive trap (gradient background, visually-hidden text, external font, literal `innerHTML`) | 1 false positive (external font) | **0** |
| Weather app, real project, re-run | 8 contrast failures at 1.03:1 + 2 font failures | **3 measured** contrast failures at 4.21–4.37:1, plus 1 external-font note |
| q01 functional regression | — | Reported as *failed*, naming `npm test` |
| q02 failing test fixed | — | Repair allowed, then *verified* |
| q05 partly implemented requirement | — | *partial* |
| q07 no infinite correction loop | — | **1** correction across 3 review passes; the remainder reported |
| q08 out-of-scope boundary | — | A pre-existing issue is only suggested; an introduced one is corrected |
| q09 unverified deliverable | — | *limited*, listing exactly what was not checked |
| q10 quality after a correction | — | Detects the regression the correction introduced; the result fails |

Notes on the weather-app row:
- I checked those 3 contrast readings against the capture: white text on mid-green, about 4.3:1. They are genuine borderline failures.
- The clean page (q06) was changed after the baseline run to reproduce that gradient pattern. The weather app is the before/after evidence for it.

The decision scenarios have no "before" because those capabilities didn't exist. Results are in
[`benchmark/results/quality.jsonl`](../benchmark/results/quality.jsonl). Tests: 153 pass (17 new).

**Not measured, and limitations:**

- **Live runs.** No paid runs were made for Phase 16. The autonomous correction has been exercised against the
  real engine with the AI session stubbed. A real correction session hasn't run yet, so its success rate
  is unknown.
- **Pixel sampling.** It needs the element to be on the captured frame (up to 3,000 px tall). Text over
  images or video stays a suspicion when the dominant colour isn't the real background.
- **Scope of visual findings.** It is judged against the *previous result's* report. The first result of
  a project is judged by whether it touched UI files.
- **Coverage.** Static rules are still patterns, now honestly graded. There is no type-aware analysis,
  and no performance profiling beyond load time, DOM size and transfer.

## Phase 18: execution optimization

**Lifecycle traced** from recorded history, with no AI calls: request → strategy → context → plan →
staffing → sessions → integration → review QA → result. That covers every recorded result: 25 results
and 67 sessions.

**Proven bottlenecks.** Each has recorded evidence:

| Bottleneck | Evidence | Status |
|---|---|---|
| Plans that turn out to be a single task still wait for approval | 4 of 6 recorded plans produced exactly one task. For Tiny Node, wall time was 13 min against 2 min of agent work, mostly waiting for plan approval. | **Changed in Phase 18** (below) |
| Fix sessions re-running checks that had already passed | 6 of 9 fix sessions, $1.35 | Fixed in Phase 13 |
| Agents offered interactive and app-only tools | 31 tools offered, 18 needed | Fixed and verified live in Phase 17 |
| Failed retries from stalls during Mac sleep | 8 sessions, $1.74 | Addressed in Phase 10/11 |

**Hypotheses checked and not acted on**, because there's no evidence they help:

- **Dropping verification-only tasks from small plans.** The recorded "Verify …" tasks were each the
  *only* task in their plan, or part of a product plan. The rule wouldn't have changed a single recorded
  case.
- **Parallel overhead.** Recipe Box's 8-task plan ran mostly serially because of real dependencies. No
  recorded run had a merge conflict.
- **Repeated exploration between dependent tasks.** This was already addressed by pinned handoffs in
  Phase 14. A live run would be needed to measure it.

**Changes:**

1. **Single-task plans start right away.** A plan meets all of these conditions:
   - Autopia chose it on its own (you didn't ask for a plan in the Composer);
   - it isn't a product build;
   - it has no open questions;
   - it came back as one task.

   Such a plan now starts like a small request, with a line in the activity log saying so. Plans you asked
   for, revised plans and product plans always wait for your OK.
2. **Parallel safety** (`canRunBeside`). This is a deterministic safety rule, not a measured fix. A task
   with no planned files (a repair, a correction, a follow-up) never runs beside another writer in the same
   project, because the file-overlap check can't rule out a conflict.
3. **Strategy recorded on every result** (migration v13). Before this, the strategy was stored only per
   project and overwritten on every request. Older results read as "unknown", never guessed.
4. **Per-result telemetry** (`resultTelemetry`, `strategyStats`). Everything is derived from recorded
   sessions, with no new logging of prompts:
   - strategy and teammates involved;
   - sessions split into planning / work / repair;
   - turns, cost and planning cost;
   - fresh vs cached tokens;
   - agent time split the same way, plus wall time;
   - retries.

   The existing Engine tab gains one "Strategy vs outcome" table, shown once results with a recorded
   strategy exist.

`AUTOPIA_ENGINE=legacy` also turns off changes 1 and 2, for A/B runs. Tests: **167 pass**, 6 new.
Typecheck and the production build pass. The migration applied cleanly to the real app database.

**Before/after, from recorded history (deterministic replay):**

| | Before | After |
|---|---|---|
| Recorded single-task plans | 4 of 6 | Same plans |
| Of those, now starting without an approval wait | 0 | 3 (the 4th was a product build, which still waits) |
| Approval waiting removed in history | — | 34 s total |

The recorded approvals were mostly made quickly by test scripts, so a person's real wait would usually be
longer. That is an inference, not a measurement. Planning cost isn't saved: the planning session has
already run by then.

**Not measured:** whether Autopia's adaptive routing beats direct Claude Code or minimal orchestration on
quality, time or cost. The three-way benchmark is ready (`--mode all`) but hasn't run: an 18 USD hard cap
covers 3 scenarios × 3 modes, and 54 USD covers the full suite. The new telemetry will show per-strategy
outcomes as real work accumulates.

## Phase 19: runtime coordination (the director)

**Audit.** Runtime coordination already existed. It stays the only supervisor, and no AI supervisor was
added. It had:

- a deterministic director pass every 15 s (Phase 10) that diagnoses blockers and auto-resolves each one
  once;
- a silence watchdog (warn at 4 min, restart once at 10 min);
- sleep-aware clocks;
- the bounded repair loop with failure signatures;
- continuing around failed tasks (Phase 14);
- the single-task fast path and parallel guard (Phase 18);
- a duplicate-run guard (`inFlight`);
- restart recovery that resumes the task's own session.

**What the recorded history showed:**

| Signal | Evidence | Gap |
|---|---|---|
| False stalls | A recorded `npm test` ran **267 s** with no output, past the 4-min "no output" warning. The watchdog counted silence while a tool was running. Gaps of 900 s or more were Mac sleep (already handled). | The watchdog didn't know a tool was running |
| Plans miss files | **4 tasks edited files outside their planned list**: Recipe Box T4, T9, Shoplist T2, T16. | Parallel safety used planned files only |
| Repeated identical failures | At most 3 in one session (`node server.js` failing the same way). | None tracked; a stop rule must not fire on normal retrying |
| Blocked dependencies | A task behind a *failed* dependency read "Waiting on T2", like a normal queue. | Hid the blocker |
| A loop-stop message quoting "Cannot find module" | Would have matched the *missing dependency* rule, which retries automatically. | Would have restarted the loop |

**Changes**, all deterministic and event-driven (`director/supervision.ts`). They run on the session
events Autopia already records:

1. **The stall watchdog knows what is running.** A tool call in progress isn't silence. The limits are
   past the tool's own limit:
   - Bash: 12 min. Claude Code stops a command at 10.
   - Subagents: 30 min.

   Then it warns, then restarts once, 5 min later. Silence with nothing running keeps the old 4/10-min
   rules, and waiting on you never counts.
2. **Repeated identical failures.** "The same failure" means the same command and the same first error
   line, with timings ignored. A changed error is progress. At 3 it's noted in the activity log; at 6 the
   session is stopped with a clear reason, keeping the work in its worktree. The director classifies it as
   *repeated failure* (checked first) and never retries it automatically.
3. **Parallel safety uses real edits.** "May this start beside that?" now considers files running tasks
   have *actually* changed, not only their plans. When two running tasks edit the same file, the activity
   log says so as it happens. Integration still merges them one at a time and resolves conflicts as
   before.
4. **One rule, two places.** The scheduler and the "why is this waiting" text shown on the Tasks board and
   in Company now share `canRunBeside`, so the explanation always matches the decision. A failed dependency
   reads *"Blocked: T2 needs attention first"*.
5. **The office shows real waits.** A teammate whose next task waits on a dependency shows that wait in
   the office, e.g. *"T4: Waiting on T3"*. Only waits the scheduler set are replaced or cleared, and any
   real activity always wins.

**Unchanged**, already correct:
- one automatic action per distinct blocker;
- repair budgets and unchanged-failure stops;
- user-approved scope: plans you asked for and product plans wait for you, and corrections and repairs
  list exactly their findings;
- worktree isolation;
- no AI in any supervision path.

**Verification:** 176 tests pass (11 new):
- repeated failures and their thresholds;
- no false stall for long tools and subagents;
- silence still caught, and waiting on you never counted;
- blocked vs queued dependencies;
- actual-edit overlap;
- the wait explanation matching the scheduler;
- loop stops never auto-retried.

One older test was updated for the stricter parallel rule. Typecheck and the production build pass. The
running app's supervision passes ran cleanly, and teammates showed idle with nothing queued: no invented
waits.

**Limitations:**

- **No live execution was observed** with these rules. Their behaviour on real sessions follows from the
  recorded event shapes they were built from.
- **Overlapping edits are noticed, not prevented.** Each task works in its own worktree, so stopping one
  would discard progress.
- **Pre-Phase-18 tasks.** The office "waiting" state only appears for planned dependencies.

## Phase 20: change impact and regression protection

**Audit.** These were already in place and are reused:
- change targeting with the importing tests (Phase 15);
- per-result QA scope and pre-existing visual findings (Phase 16);
- the bounded repair loop and one review-time correction;
- refusal to merge over your uncommitted files;
- merge-conflict prediction and resolution;
- freshness invalidation and repair lessons in memory.

**Real gaps found:**

| Gap | Evidence |
|---|---|
| **Discarding a result reverted nothing.** Results merge before review, so discarded code stayed in the project. | The stored note said "Nothing was reverted; the changes remain …" |
| **Any failing check went straight to repair.** That included one already failing before the work started, a busy port, or a flaky test. The agent could "fix" code it never broke, beyond the request. | No baseline comparison existed |
| **Interfaces were invisible.** The index knew *which files* import each other, but not *which names*. A change could remove or rename an export that another file still imports, and nothing would notice until runtime. | No named-import record |

**Changes**, all deterministic (no AI, and no commands run by Autopia itself):

1. **Failure attribution before repair** (`quality/regression.ts`), using the recorded validation history
   and finished tasks' checks as the baseline:

   | Kind | What decides it | What happens |
   |---|---|---|
   | introduced | The check passed before this work started | Repair |
   | unknown | No baseline | Repair (as before) |
   | pre-existing | It failed the same way before this work started | No repair; you get an honest decision explaining why |
   | environment | The output names the machine: port in use, network, disk, permissions, out of memory | No repair; you get an honest decision explaining why |
   | flaky | It passed earlier in the same session, with no file edited in between | One re-run before any code change |

   Repair logs now say why a failure was attributed to the work.
2. **Interface contracts.** The incremental scanner records the names each file imports, including from
   TypeScript type exports. A module whose exports can't be known statically (`export *`,
   `module.exports =`) is skipped rather than guessed.
   - **Before a change:** the agent's context lists *"Exports other files rely on"* for the files it is
     about to touch, and who uses each one.
   - **After a change:** review QA reports, as a verified high-severity finding that the existing single
     correction can fix, any named import left pointing at an export that no longer exists, or at a file
     the change deleted.
3. **Safe undo of a discarded result.** "Undo its changes" on a discarded result reverts its merge commits
   with **new** commits: history is kept and nothing is reset. A conflict aborts cleanly. It is refused
   when:
   - you have uncommitted changes in its files;
   - a later result changed the same files;
   - the team is working;
   - you're off the main branch;
   - there's no git;
   - the result was kept, or was already undone.

   It always asks for confirmation. The discard message now says the changes stay until you undo them.
   Memory notes about the reverted files go stale through the existing freshness checks.

**Verification:**
- **Tests:** 190 pass, 14 new. They cover:
  - attribution of each failure kind;
  - baselines recorded after the task started being ignored;
  - named imports and the contracts shown to the agent;
  - removed exports and deleted files, through the real QualityEngine audit;
  - no check on unrelated edges, and no guessing on `export *`;
  - every undo refusal, including your uncommitted work and later results.
- **Typecheck and production build:** pass.
- **In the running app:** the static audit of Recipe Box's latest result (9 files) produced **no false
  broken-import findings**, and undo was correctly refused for an accepted result.

**Not verified:**

- **The undo itself.** The actual `git revert` path was not executed in this session: running git
  directly is restricted for me here. Its safety rules are unit-tested; the revert commands are three thin
  wrappers.
- **Live agent behaviour** under the new attribution. No paid runs were made.

**Limitations:**

- **Baselines are recorded check results.** Checks run in task worktrees, not on main itself. A project
  with no history gets "unknown", which is repaired as before.
- **Interface checks are static** and cover JS/TS named imports only. Default and namespace imports and
  dynamic access aren't checked.
