# What Autopia really does

The source of truth for anything said publicly, including `website/src/content/product.ts`. Before adding a claim to the
website, trace it through the app (UI, then IPC, then main process) and add it here. Roadmap notes, feature names and
comments don't count as evidence.

Last audited 2026-11-07, at version 0.1.0. **Traced** means the code path was followed from UI to main process.
**Ran** means it was also seen working in a real packaged or development build.

## Working

| Capability | What it does | Evidence | Limits to be honest about |
|---|---|---|---|
| Claude Code discovery | PATH, common install folders, desktop app and VS Code copies, login-shell PATH; picks the newest working copy | Ran (packaged, found; and with it hidden, correct guidance). `src/main/claude/cli.ts:48-155` | Never installs Claude Code. Relies on `--permission-prompt-tool`, which isn't documented by Claude Code |
| Readiness and sign-in | One answer: missing, outdated, won't start, signed out, couldn't confirm, ready. Sign-in runs `claude auth login`, cancellable; the page re-checks when you return | Ran against a stand-in CLI in the packaged app (`scripts/first-run-e2e.mjs`). `shared/readiness.ts`, `ConnectClaude.tsx`. **A real browser sign-in hasn't been run** | If the status call fails, it says it couldn't confirm, and doesn't block |
| First run | Welcome on an empty Home, one office card, setup in place, your words kept across restarts | Ran, same script. `home/FirstRun.tsx`, `home/Creator.tsx` | No person has tried it. Mac only: it says "this Mac" |
| Permission relay | Prompts become cards showing the exact command; the agent waits | Ran. `cli.ts:466-498`, `orchestrator.ts:2016-2055`, `test/permissions.test.ts` | Pending prompts expire on restart |
| New project from a description | Creates a real folder under `~/Autopia`, picks an office by keywords (overridable) | Ran in the packaged app. `ipc.ts:183-195`, `offices.ts:139-145` | The pick is keyword matching, not AI |
| Open an existing folder | Git optional | Traced. `ipc.ts:377-399` | A repo with no commits gets `git add -A` and a commit. Detached HEAD is refused. Without git: one step at a time, no diffs, no undo |
| Persistence and recovery | SQLite in the app's data folder; interrupted runs resume via one safe next step | Ran (packaged app quit and relaunched). `recovery.ts`, `test/recovery35.test.ts` | Replies in progress fail with "Try again" |
| Delete | Removes it from Autopia, leaves your files | Traced. `repo.ts`, `orchestrator.ts:326-350` | Can't be undone |
| Teams | 6 roles at Tech Startup, 7 at Game Studio and AI Lab, with type-specific guidance | Traced. `shared/offices.ts:46-110` | Roles can't be hired through the UI |
| Plans | Structured plan, approval card, then execution | Traced, and seen in earlier phases. `orchestrator.ts:667-840` | Very small requests go straight to work. Auto mode (off by default) skips approval |
| Parallel work | 4 tasks by default, 1 to 8; one worktree and branch per task, merged one at a time | Ran. `settings.ts:8,25`, `orchestrator.ts:1060,1231,1516` | Needs git |
| Conflicts | Predicted, a teammate resolves them, checks re-run | Traced; **a real conflict has not been run in a test**. `orchestrator.ts:1527-1552` | Prediction needs git 2.38+. Can fail after bounded attempts |
| Verification | Autopia installs, runs and opens the result itself | Ran in the packaged app. `quality/verify.ts`, `quality/engine.ts` | Only commands you OK'd and policy allows. Otherwise blocked or unverified |
| Review | Accept, ask for a change, or discard | Ran up to the review state. `ipc.ts:85-100`, `Deliveries.tsx` | **Merges happen before review. Reject reverts nothing. Undo is separate and can be refused** |
| Live preview | Static sites on 127.0.0.1, or the dev script after confirmation, in a sandboxed view | Ran in the packaged app. `preview.ts` | Web projects only. Project code still runs on your machine, unsandboxed |
| Visual feedback | Point, mark up and send to the team | Traced. `studio/Notes.tsx` | Web preview only |
| Conversation and logs | Conversation, per-employee and per-task views, logs, Time and cost with a timeline | Ran. `Sheet.tsx`, `Insights.tsx` | Raw tool output is pruned after a retention period. Costs come from Claude Code and aren't a bill |
| Memory | Per-project decisions, accepted work, lessons, code map; editable | Traced, tests. `memory/memory.ts`, `codeGraph.ts`, `test/memory66.test.ts` | Per project, per machine. Redaction is pattern-based |
| Skills | Built-in methods per task; external skills from GitHub or a folder, pinned and scanned, approval required | Traced. `skills/engine.ts` | The scan is static, not a safety guarantee |
| Permission profiles | Standard: edits and common build tools allowed. Full: skips checks, with a warning | Traced. `cli.ts:254-280,394-408` | Standard runs `npm`, `npx`, `node`, `python3`, `make` without asking. Full drops the denies |
| Org policy | Reads managed settings, disables Full if barred, predicts outcomes | Ran on this Mac. `claude/policy.ts` | Claude Code enforces it; Autopia only reads it |
| Three offices | Different layouts, art, rosters and guidance | Ran | |
| Work shown in the office | Real status drives where people go and what they show | Ran. `workPlace.ts`, `behavior.ts` | Idle life, rare events and the dog are cosmetic and local |
| Puffy | Corgi, responds to clicks and to his bed and toy | Ran | **Tech Startup only** |
| Mini-games | Ping pong, foosball, HOTFIX (plus a second cabinet, Night Shift) | Ran with scripted input. `Playground.tsx`, `test/playground70.test.ts` | No person has judged how fun they are |
| Customize office | Catalog of floor and wall pieces, sign, picture, lights, per project | Ran. `OfficeCustomize.tsx`, `test/officeDecor72.test.ts` | Cosmetic. Little free wall in Studio and Lab |
| Sound | Synthesized, off at launch | Traced. `office/sound.ts` | No audio files. Say "optional synthesized sound" |

## Partly there

- **Cost figures:** reported by Claude Code. On a subscription they are API-equivalent, not a bill. No spending cap.
- **Quality audit:** pattern matching on changed lines, with many findings marked "suspected". Not a security audit.
- **Visual QA:** conditional, web only, one automatic correction.
- **Result summaries:** the first line of a result can start with a clipped label, such as "bill am...:". Visible in the website's screenshot of the real run. Worth fixing.

## Not real: never claim these

- Windows, Linux, Intel Mac, "cross-platform" (see the platform table in `DISTRIBUTION.md`).
- Fully autonomous, or shipping without you. Plans, permission prompts and review wait for you by default.
- "Nothing touches your code until you approve." False: see Review above.
- "Asks before every action." False: see Permission profiles above.
- Guaranteed, bug-free, verified, security audited, accessibility guaranteed.
- "Sandboxed" for anything but the preview page.
- Works offline, or without Claude Code, or free of usage costs.
- Exact cost tracking.
- Memory across projects. A dog in every office. Live preview for native apps. Hiring employees from the UI.
- "Everything in the office is real." Work status is; the rest is for fun.

## Network use by the app itself

No analytics, telemetry, crash reporting or auto-update code was found (searched `src`; re-check before each release).
Autopia's own calls: GitHub, only when you install a skill; the npm registry, for the Claude Code version check in Settings;
localhost, for previews and checks; links opened in your browser. Claude Code and the agents reach the network themselves.
