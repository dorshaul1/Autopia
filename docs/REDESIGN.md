# Autopia redesign blueprint (Phase 12A)

**What this is:** the product and UX plan for rebuilding everything around the office. It is based on the code as it is today (`src/renderer/src`, 6.5k lines across 30 components). The office scene, characters and animations are not touched. Every working capability keeps a home.

**What it is not:** an implementation. Phase 12B builds this.

The idea in one line: **the office is the experience, the prompt is the interface, and the result is the reward.** Everything else should either serve one of those three or stay out of sight until it's asked for.

---

## 1. What exists today

### Surfaces

| Layer | Surface | What it holds |
|---|---|---|
| Chrome | `TopBar` | Logo, a 3-way view switch (Office / Workspace / Company), project switcher (rename, delete), phase pill, task-segment bar, project spend, Claude badge, inbox bell, theme toggle, settings, panel toggle |
| Office | `WorldHud` | Jump-to-room buttons (10 rooms), sound and ambience sliders |
| Office | `WorldInspector` | Room facts on hover or click |
| Office | `EmployeeCard` | Popover: status, task, Follow, Live log, Profile |
| Office | `EmployeeProfile` | Modal with the employee's history and capabilities |
| Office | `ApprovalDock` | Floating stack of approvals: plan, permission, failure, question, unverified |
| Office | `ProjectPanel` | Right panel with 5 tabs: Overview (brief composer and triage), Tasks (Kanban-like list), Activity, Insights, Files |
| Workspace | `Workspace` | Full screen with 9 sections: Product, Overview (second composer), Review, Preview, Quality, Tasks, Activity, Files, Knowledge |
| Company | `CompanyView` | 6 tabs: Decisions, Portfolio, Team (hiring), Inbox, Skills, Engine |
| Modals | `NewProjectDialog`, `SettingsDialog`, delete-project confirm, Knowledge editor, quality exception form |

### Every place you can type a request (9)

| # | Where | What sending does |
|---|---|---|
| 1 | Overview → "Founder's brief" | Edits `project.goal`; a separate button then calls `kickoff` |
| 2 | Workspace → bottom composer | `updateGoal` + `kickoff`, or `requestRevision` once something has been delivered |
| 3 | Review → "What should change?" | `requestRevision` |
| 4 | Preview → crop + "What should change here?" | `requestRevision` with a screenshot |
| 5 | Product → Feedback | `productFeedback` (replan, queue, or revise, depending on phase) |
| 6 | ApprovalDock → plan "Request changes" | Plan revision |
| 7 | ApprovalDock → question answer | Resumes the task with the answer |
| 8 | NewProjectDialog → brief | Creates the project with a goal |
| 9 | Quality → exception note | Records an exception |

There is no conversation record. Each request overwrites `project.goal`, and the history only survives indirectly as `deliveries`.

---

## 2. Major problems (ranked by user harm)

1. **No single place to talk to the company.** Nine inputs with nine behaviours. The same sentence starts a plan, overwrites the brief, queues a note, or revises a delivery depending on which box you used and the project's phase. Users can't predict what Send does. *That is the opposite of "the prompt is the interface".*
2. **Three top-level worlds that duplicate each other.** Office panel, Workspace and Company all show tasks, activity and overviews:
   - tasks in 3 places;
   - approvals in 4 (dock, Decisions, Inbox, Review badge);
   - overviews in 2;
   - metrics in 3 (Insights, Engine, Quality).

   Users must learn where each copy lives and which one is current.
3. **Results come last.** After work finishes you land on a task list. The preview is one section among nine, so seeing what was built takes 3–4 clicks. Diffs and checks get the same weight as the app itself.
4. **The office loses the screen.** Workspace and Company are full-screen replacements, so the most distinctive part of the product disappears exactly when work is happening.
5. **New projects start with a form.** Name, folder and brief all come before anything happens. A first-time user has to understand "folder", "git" and "brief" before seeing value.
6. **Inconsistent vocabulary:**
   - "Founder", "brief", "goal", "request" and "delivery" all name overlapping things;
   - "Shipped" and "Accepted" sound the same;
   - "Awaiting approval", "Needs decision" and "Waiting on you" are three names for the same state;
   - "Consulting" is used for reviewing, and "Skipped" for cancelled;
   - internal terms leak into the UI: "triage", "kickoff", "delivery", "unverified", "worktree".
7. **Information that should be ambient is in chrome.** The top bar carries spend, a task-segment bar, the CLI version and a phase pill all at once. The office already shows who's working.
8. **No global way to find or do things.** There's no search and no command palette. Earlier projects, tasks and decisions are reachable only through tabs.
9. **Notifications mix action with information.** The Inbox lists milestones next to blockers; the bell badge counts both.
10. **Advanced tools get first-class navigation.** Files, Knowledge, Skills and Engine are peers of Preview and Review, so a first-time user sees 20+ destinations.
11. **Some states give no feedback.** Sending a revision while the team is busy, a plan being revised, and an over-budget project all depend on the user finding the right tab to learn what happened.

---

## 3. Information architecture: three layers

```
┌────────────────────────────────────────────────────────────────────────┐
│ ◧ Recipe Box ▾        ⌘K Search or do anything        ● 2 need you  ⚙ │  ← Command bar (44px)
├────────────────────────────────────────────────────────────┬───────────┤
│                                                            │           │
│                     OFFICE CANVAS                          │  SHEET    │  ← Contextual sheet
│            (full bleed, always rendered)                   │ (380–520, │    (optional,
│                                                            │ resizable)│    stackable)
│                                                            │           │
│      ┌──────────────────────────────────────────────┐      │           │
│      │ To Recipe Box ▾  Describe what to build…  ⤢ ↵│      │           │  ← Composer dock
│      └──────────────────────────────────────────────┘      │           │
└────────────────────────────────────────────────────────────┴───────────┘
```

1. **Office canvas.** Always rendered, never unmounted, at least 60% of the window whenever no focused view is open.
2. **Sheet.** One right-hand panel with stack navigation (back arrow, breadcrumb). It shows exactly one context:
   - Conversation (the default);
   - Employee;
   - Task;
   - Decision;
   - Project details.

   It replaces `ProjectPanel`, `EmployeeProfile`, `WorldInspector` details and the full Company view.
3. **Stage.** A focused view for the work that needs space:
   - **Result**: preview, what changed, checks, feedback;
   - **Plan**: approve or adjust a plan;
   - **Under the hood**: files, changes, sessions, checks, memory.

   The Stage covers the canvas. A live **office thumbnail** (bottom-left, clickable, with real employee status dots) keeps the company visible, and Esc returns to the office.

**Why:** users never "leave the office" for routine work. Big views exist only where space genuinely changes the outcome (reviewing an app, approving a multi-step plan, reading a diff). **Tradeoff:** the Stage hides most of the office while it's open. The thumbnail plus Esc keeps that cheap, and nothing that happens in the office needs a reaction faster than the attention badge provides.

### Where everything goes

| Today | Proposed home |
|---|---|
| Office / Workspace / Company switch | Removed. The office is home, the Stage is the focused view, and company-level things go to ⌘K, the Attention tray and Settings |
| ProjectPanel tabs (Overview, Tasks, Activity, Insights, Files) | Sheet → Conversation (overview, progress and activity merged into the thread). Files → Under the hood. Insights → Settings → Performance |
| Workspace Product | Sheet → Project details (brief, scope, milestones); its feedback box becomes the Composer |
| Workspace Overview / Tasks / Activity | Merged into the Conversation thread, with expandable task rows |
| Workspace Review + Preview + Quality | One **Result** Stage |
| Workspace Files / Knowledge | Under the hood → Files / Memory |
| Company Decisions + Inbox + ApprovalDock | One **Attention** tray (command bar) plus inline cards in the thread |
| Company Portfolio | Project switcher (statuses inline) and ⌘K |
| Company Team | Office plus the Employee sheet; hiring moves to Settings → Team |
| Company Skills / Engine | Settings → Skills / Performance |
| WorldHud room buttons and sound | A compact office control cluster (bottom-right of the canvas): zoom, rooms ▾, sound ▾ |
| SettingsDialog | Settings Stage with sections (General, AI provider & permissions, Team, Skills, Memory, Performance, Office) |

The destination count drops from 20+ to 3 kinds of place: office, sheet and stage. Every capability above still exists.

---

## 4. Navigation

**Command bar (44px, left to right):**
- **Project switcher** `◧ Recipe Box ▾`. A popover lists projects with live status ("Building", "Needs you", "Ready to review", "Idle") and the team avatars at work, plus "New project". Rename and delete sit in each row's ⋯ menu.
- **Search / command** `⌘K`. One palette for:
  - projects, tasks, results, decisions and employees;
  - commands: "Pause Recipe Box", "Open preview", "Retry T6", "Settings: permissions";
  - recent requests.

  It is local only: no AI calls.
- **Attention** `● 2 need you`, shown only when something needs you (§10).
- **Settings** ⚙.

**Removed from chrome:**
- **Spend:** moves to the project details sheet and the result footer.
- **Task-segment bar:** the conversation shows progress.
- **CLI badge:** shown in Settings, and in the command bar only when Claude Code is *unavailable* (a red "Claude Code offline" chip).
- **Theme toggle:** moves to Settings.
- **Panel toggle:** the sheet toggles with `⌘\`.

**Contextual navigation:** inside the Sheet and Stage, a breadcrumb (`Recipe Box › Result #2 › Changes`) plus Back (`⌘[`).

**Shortcuts:**

| Key | Action |
|---|---|
| `⌘K` | Palette |
| `/` | Focus composer |
| `⌘⇧E` | Expand composer |
| `⌘↵` | Send |
| `⌘\` | Toggle sheet |
| `⌘1` | Office |
| `⌘2` | Result |
| `Esc` | Close the topmost layer |

**State preservation:**
- The last sheet and stage per project are restored on switch.
- The canvas camera persists.
- Composer drafts persist per target (§5).

---

## 5. The Composer

### One component, three presentations

The same `Composer` instance state (target, draft, attachments, intent) drives all three.

- **Dock:** floating at the bottom-centre of the canvas, 640px wide. Single line, grows to 6 lines, never covers the office HUD. Placeholder changes with context:
  - nothing yet: *"Describe what you want to build"*;
  - project built: *"Ask for a change, a fix, or a question about Recipe Box"*;
  - team working: *"Add a note for the team — or ask a question"*.
- **Expanded (`⌘⇧E` / ⤢):** a centred editor at 720×60vh for long specs. It has markdown preview, attachments and the target picker, and keeps the office visible behind a light scrim.
- **Thread:** the composer pinned at the bottom of the Conversation sheet. Typing in the Dock opens the thread on send, so you can see what happened to your message.

### Targeting (always visible, never guessed silently)

A chip on the left reads *"To: Recipe Box ▾"*. The options:
- **A project:** the default is the active project.
- **New project:** shown when no projects exist, or when chosen.
- **An employee** (`@Kenji` typed or picked).
- **A task** (`#T6`, or when composing from a task/result/decision context).

A secondary chip to the right of the target shows what will happen, decided **locally and deterministically**:

| Intent chip | When | Backend (existing unless marked) |
|---|---|---|
| **Start building** | Project has nothing delivered, nothing in flight | `updateGoal` + `kickoff('auto')`, with planning if triage says so |
| **Request a change** | Something has been delivered, nothing in flight | `requestRevision` (scoped, keeps what works) |
| **Plan a new feature** | User flips the chip from "Request a change" | `updateGoal` + `kickoff('plan')` |
| **Add a note for the team** | Team is working | `productFeedback` → queued for unstarted tasks (generalised from product mode to all projects) |
| **Ask a question** | Text reads as a question (`?`, "why/how/what/where…"), or user picks it | **New:** a read-only Claude Code session (`mode: 'readonly'`, no tasks, no commits) answering in the thread |
| **Message Kenji** | `@employee` | **New:** a task assigned to that employee (`insertTask` with an assignee); questions about their current task go to the read-only ask session with that task's context |
| **Reply** | Composing on a question or plan card | Existing answer and plan-revise paths |
| **New project** | Target is "New project" | `createProject` (folder defaults to `~/Autopia/<slug>`, changeable; git on) + kickoff |

**Why the intent chip:** it removes the "which box do I use" problem without an AI call, makes the consequence visible *before* sending, and is one click to override. **Tradeoff:** heuristic intent will sometimes guess wrong. That's acceptable because it's shown before sending and is reversible, and the safe defaults (asking never modifies code) protect against harm.

**Operational commands never go to the AI.** A leading `/` (`/pause`, `/retry T6`, `/preview`) runs the palette action. Plain-language commands ("pause the project") are offered as a palette suggestion under the composer, not sent as a prompt.

### Attachments and context
- **Paste, drop or ＋** images, screenshots and files. Images are saved to `<project>/.autopia/attachments/` (already git-excluded via `info/exclude`) and passed to the agent as paths, extending today's revision-screenshot mechanism. Files inside the repo become `@path` references, with no copying.
- **"Capture from preview"** opens the existing crop tool and attaches the crop.
- **Context chips** (removable) show what's attached: `📎 header.png`, `@public/styles.css`, `#T6`, `Result #2`.
- **`@`** completes employees and files (from the existing file index). **`#`** completes tasks and results.

### States (inline, under the message in the thread; the Dock shows a compact echo)

`Sending… → Received` → one of:
- *Planning (Maya)*, *Plan ready — needs your OK*;
- *Building · Theo, Inés*;
- *Answering…*, *Queued — starts after current work*;
- *Ready to review*;
- *Couldn't start: Claude Code is offline — Retry*.

Failures keep the text: nothing typed is ever lost.

### Drafts
Drafts are kept per target (`project`, `project+task`, `employee`, `new`) in a renderer store persisted to `localStorage`, debounced at 300ms. They are restored on switch, with a "Draft" dot on the project switcher row.

### Optional refinement
"Improve" (✦) is shown only when the draft is at least 12 words. One explicit, user-triggered small-model call returns a suggested rewrite as a diff; you Accept or Keep mine. It is never automatic.

### Not shown by default
Model, effort, skills, agent choice and permission profile stay hidden. They are reachable via the Expanded composer's "Options" disclosure (only what the provider supports, §15) and in Settings.

---

## 6. The vibe-coding loop

```
Idea ──► Composer ──► (plan card, only if triage says plan) ──► Office shows real work
  ▲                                                                │
  │                                                                ▼
Revision ◄── Feedback in Result Stage ◄── "Ready to review" ◄── Verified result
```

1. **First idea, with zero projects.** The canvas shows the idle office. The Dock says *"Describe what you want to build"* and the target chip says *New project*. On send:
   - the project is created with a name derived from the idea (editable later) in `~/Autopia/`;
   - planning starts;
   - Maya walks to the meeting room;
   - the thread opens.

   There is **no form**. "Use an existing folder" is a secondary link on the chip menu.
2. **Plan.** Shown as a card in the thread: summary, steps grouped by milestone, who will work, decisions with defaults. Buttons: **Start building**, **Change the plan** (focuses the composer in Reply mode), **Open full plan** (Plan Stage). Simple requests skip this step: the card reads *"Small change — Theo is on it"*.
3. **Building.** The office shows who is working (§7). The thread shows a **live progress block**, one row per task (who, what, state), each expandable to its real log. Milestone verification appears as a row. No percentages.
4. **Needs you.** Permission, question, blocked work and budget decisions appear as cards in the thread *and* in the Attention tray, never only in one place.
5. **Ready to review.** A result card in the thread (preview thumbnail, a one-line summary, readiness line, **Review result**) and a toast. Opening it goes to the Result Stage (§8).
6. **Feedback.** The Result Stage's feedback field *is* the Composer in "Request a change" mode, targeting this result, with the screenshot crop available. Sending returns to the office, and the loop restarts.

**Avoiding unintended code changes:**
- "Ask a question" never writes.
- Notes during a build never start new tasks.
- "Request a change" always shows its target result.
- Nothing is deployed or published (unchanged rule).

---

## 7. Office integration

Today the office reflects real `EmployeeStatus` via speech bubbles and walking; keep all of it. Add a **DOM overlay layer** above the canvas. It is not a change to the scene: it reads positions through the existing camera API (`officeCamera`) and draws:

- **Status tags**, shown on hover or for working employees only:
  - Planning;
  - Building;
  - Testing;
  - Reviewing;
  - Waiting for you (amber);
  - Blocked (red);
  - Done ✓ (fades after 8s);
  - nothing when idle.

  These map 1:1 from `EmployeeStatus.activity`, plus the task state.
- **Click an employee** for an anchored popover (the existing `EmployeeCard`, reworked):
  - Name, role, a status sentence: *"Building the delete UI for Recipe Box (T6) · 4 min"*.
  - The latest real tool line: *"Editing public/js/list.js"*.
  - Actions: **Message** (composer targeted `@Inés`), **Open task** (Task sheet), **Watch live** (session log in the sheet), **Follow** (camera).
  - Idle employees show *"Available"* and their last finished task.
- **Waiting / Blocked employees** pulse their tag. Clicking opens the related decision card directly.

The ambient simulation stays local and token-free. Tags never appear for ambient behaviour (idle chats, coffee) because they come only from real statuses.

---

## 8. Result Stage (visual first)

```
┌ Recipe Box › Result #2 — Favourites ───────────────────── Accept ▾ ┐
│ ┌──────────────── Live preview (or captures) ───────────────────┐ │
│ │                                                               │ │
│ │                [ the running app, interactive ]               │ │
│ │                                                               │ │
│ └── 375 · 768 · 1280 │ ⟳ │ Capture ─────────────────────────────┘ │
│ What changed                         Checks                        │
│  • Star a recipe on its page          ✓ Verified — tests, security,│
│  • "Favourites only" filter           visual, accessibility        │
│  • Saved on the backend               1 suggestion: small tap target│
│ ┌ Request a change ─────────────────────────────── 📎 Capture ↵ ┐ │
│ └───────────────────────────────────────────────────────────────┘ │
│ ▸ Changes · 6 files   ▸ Check details   ▸ Sessions & cost          │
└────────────────────────────────────────────────────────────────────┘
```

- **The preview comes first.** For web apps, the live preview starts with one click. A script preview shows the exact command and an "Allow and start" confirmation, which is the existing consent. When it isn't running, the latest **real** visual QA captures fill the frame, labelled *"Captured 3 min ago"*. If neither exists, show *"No preview for this project"* plus the artifacts list from `PreviewInfo.artifacts`. Never a placeholder image.
- **What changed** is plain language from the delivery summary, as bullets. Task keys are hidden unless expanded.
- **The checks line** uses the readiness verdict in human words:
  - **Verified**;
  - **Verified with exceptions**;
  - **Needs fixes**;
  - **Not fully checked**, with which part and why ("Visual check needs the preview running — Start preview").

  Suggestions (low or medium findings) are listed separately from blockers.
- **Request a change** is the Composer, as described in §5.
- **Accept** is a split button: *Accept*, *Accept with notes* (exceptions), *Discard result* (the existing reject).
- **Progressive detail:**
  - *Changes* opens the existing `Review` diff viewer inline;
  - *Check details* opens today's `Quality` content;
  - *Sessions & cost* lists real runs, tokens and duration.
- **Non-web projects:** the frame shows test and build results and artifacts (CLI output, build files) from `PreviewInfo.artifacts`, with "Run" instructions from `ProductDeliverable.run`.
- **Comparison:** the result header has a version picker (`Result #1 ▸ #2`). The preview captures of two results can be shown side by side (captures only; it never fakes a past live state).

---

## 9. Projects, work and conversation

- **Project = one continuous Conversation.** Today's records are rendered as one thread; no duplicate storage is needed:
  - your requests: `deliveries.request`, plus `productSpec.changes`, plus the new `messages` (questions and notes);
  - plans: plan approvals;
  - progress: tasks and runs, collapsed into progress blocks;
  - decisions: approvals;
  - results: deliveries in review or accepted;
  - errors: failed tasks, with diagnosis.

  One new table is needed, `messages` (id, project_id, role, text, attachments, intent, target, created_at, links to delivery/task/approval). It stores what isn't already recorded (questions, answers, notes, the literal prompt text).
- **Project details** (sheet, from the project name):
  - the brief and product spec (vision, scope, milestones — today's `Product` view);
  - budget and pause;
  - spend;
  - repo path and branch;
  - memory summary;
  - danger zone (delete).
- **Tasks are not a destination.** They appear as rows in progress blocks and in the Task sheet (what, who, state, checks, log, Retry/Skip). The Kanban-style `TaskBoard` goes away; reassign and priority move to the Task sheet's ⋯ menu.
- **Continuing work:**
  - the project switcher remembers each project's thread position;
  - ⌘K finds any request, result or task;
  - opening an old result offers *"Continue from here"*, which targets the composer at it.

---

## 10. Attention, notifications and activity

**One rule:** only things that need you count.

**The Attention tray** (command bar `● N need you`) lists, across projects:
- plan ready;
- permission request (live, timed by the CLI session);
- question;
- blocked work (with the director's diagnosis and a recommendation);
- unverified work;
- budget reached;
- result ready to review.

Each item can be acted on inline: Allow / Deny, Start building, Retry / Skip, Raise budget, Review. This replaces the Decisions tab, the Inbox and the floating `ApprovalDock`. The same cards also render in the relevant thread.

**Permission request template** (rewrite of today's):

> **Theo wants to run a command** · Recipe Box · T6
> `npm install express-rate-limit`
> Installs a package from the npm registry into this project. Your organization's policy asks before installs.
> **Allow once** · Allow for this task · Deny
> *If you deny, Theo continues without it and reports what couldn't be done.*

**Informational events** have no badge:
- milestones;
- the director auto-resuming a session;
- a merge completing.

They go into the project thread as quiet system rows and into the Activity filter (thread filter: *Everything / Requests & results / Decisions*).

**OS notifications:** only for attention items, and only when the window is unfocused (today's rule, kept).

**Decision history:** resolved cards stay in the thread, collapsed, with who decided and when ("You allowed this · 2:14 PM").

**Recovery:** every error row has a primary action (Retry / Continue / Open settings) and a plain cause (§11 copy). It never says just "Failed".

---

## 11. UX writing

### Voice
Clear, calm and specific. Write the way a great engineering lead talks to a founder: short sentences, outcomes first, then consequences. No exclamation marks, no cute filler, no internal jargon.

### Vocabulary (use everywhere; the code may keep its internal names)

| Concept | Say | Don't say |
|---|---|---|
| The user | **you** | founder, CEO, operator |
| What the user asks for | **request** | brief, goal, kickoff, prompt (in UI copy) |
| The project's description | **project brief** (details sheet only) | goal |
| A unit of work | **task** (in detail views only; elsewhere describe the work) | job, ticket |
| What the team hands back | **result** (*Result #2*) | delivery, deliverable, iteration |
| Follow-up on a result | **change** / *Request a change* | revision |
| Pre-build proposal | **plan** / *Start building* | plan approval, kickoff |
| Something needing the user | **Needs you** | awaiting approval, needs decision, waiting on you |
| Checks status | **Verified / Needs fixes / Not fully checked** | passed readiness, unverified, gate |
| Skipped task | **Skipped** (by you) / **Stopped** (by the system) | cancelled |
| Re-run | **Try again** / **Continue** | retry (fine in ⌘K), resume agent execution |
| The AI backend | **Claude Code** | CLI, provider, model (outside Settings) |

### Statuses

| Thing | Values |
|---|---|
| Project | Idle · Planning · Plan ready · Building · Needs you · Ready to review · Done · Paused |
| Task | Waiting · In progress · Checking · Done · Needs you · Skipped |
| Employee | Available · Planning · Building · Testing · Reviewing · Waiting for you · Blocked |

### Patterns
- **Buttons** are verbs plus objects: *Start building*, *Review result*, *Allow once*, *Request a change*. Never *OK*, *Submit* or *Proceed*.
- **Errors** follow *what happened + why (if known) + what to do*:
  - *"Couldn't start the preview. Port 5173 is in use. Close the other server or try again."*
  - *"Claude Code is signed out. Sign in from a terminal (`claude`), then try again."*
- **Empty states** give one sentence of value and one action:
  - *"No results yet. Results appear here when the team finishes a request."*
  - Thread with no history: *"Tell the team what to build. They'll plan it, build it, test it and show you the result."*
- **Confirmations** name the consequence, and the destructive verb is the button:
  - *"Delete Recipe Box from Autopia? Files on disk and branches stay where they are."* → **Delete project**.
- **Helper text** appears only where a decision has a consequence. Remove explanatory paragraphs that restate the heading (e.g. today's long Validation and Quality intros become one line or a ⓘ).
- **Tooltips** are for icon-only buttons, never for essential information.
- **Numbers:** show cost only where it informs a decision (project details, result footer, budget). Show tokens only in *Sessions & cost* and Settings → Performance.

### Rewrite examples

| Today | New |
|---|---|
| "Founder's brief" | "What should we build?" (composer) / "Project brief" (details) |
| "Approve & build" | "Start building" |
| "Request changes" (plan) | "Change the plan" |
| "Send back to planning" | "Update plan" |
| "Plan ready for review" | "Plan ready — needs your OK" |
| "Delivery #2 is ready for your review" | "Result #2 is ready to review" |
| "Accept without full verification" | "Accept anyway" + "Not fully checked: visual" |
| "Local triage, no tokens: …" | removed (the intent chip says what will happen) |
| "Maya plans first, you approve, then only the needed specialists run" | "Maya will plan this first" |
| "Your QA engineer runs the project's declared checks once (small model, Bash only)" | "Run checks" (ⓘ: "Runs this project's test and build scripts") |
| "Interrupted: Autopia was closed while this task was running" | "Paused when Autopia closed — Continue" |

---

## 12. Design system

**Character:** quiet, precise chrome around a vivid pixel office. The office is the only saturated thing on screen most of the time.

### Tokens (CSS custom properties; light and dark)

| Group | Value |
|---|---|
| Neutrals | 11-step warm grey `--gray-1…11`; surfaces `--bg` (canvas surround), `--surface-1` (sheet), `--surface-2` (raised rows), `--surface-3` (inputs) |
| Text | `--text`, `--text-2` (secondary), `--text-3` (tertiary/meta); AA contrast minimum on every surface in both themes |
| Accent | One brand accent (the existing amber of the logo) for primary actions, focus and the active composer only |
| Semantic | `--ok` green, `--warn` amber-orange (distinct from the brand amber), `--danger` red, `--info` blue. Used only for status, never decoration |
| Type | System UI stack (SF Pro on macOS) for UI; JetBrains Mono / SF Mono for code. Scale 11 / 12 / 13 (base) / 15 / 18 / 22; weights 450 / 550 / 650; line height 1.45 (text) / 1.25 (headings) |
| Space | 4pt grid: 4, 8, 12, 16, 20, 24, 32, 40 |
| Radius | 6 (inputs, chips) / 8 (rows, buttons) / 12 (sheet, stage, popovers) |
| Lines | 1px hairlines at 8% (dark) / 10% (light) alpha. Use spacing before borders: lists separate by space and a hairline, not boxes |
| Elevation | Only floating layers (popover, composer dock, sheet edge, stage) get `--shadow-float` (one soft shadow). Nothing else has shadows |
| Motion | 120ms (hover/press), 180ms (popover), 220ms (sheet slide), 280ms (stage). Ease-out `cubic-bezier(.2,.8,.2,1)`. All motion respects `prefers-reduced-motion` |
| Icons | One set (the existing stroke icons in `common.tsx`, unified at 1.5px stroke, 16/20 sizes) |

### Components (the full set; anything else is composed from these)
- **Inputs and actions:**
  - Button (primary / secondary / ghost / danger; sm / md);
  - IconButton;
  - Input;
  - Textarea / Composer;
  - Select;
  - Checkbox;
  - Switch.
- **Small labels:**
  - Chip (target, intent, context, removable);
  - StatusDot plus label (replaces most pills).
- **Floating layers:**
  - Popover;
  - Menu;
  - Tooltip;
  - Toast.
- **Structure:**
  - Sheet (with stack header);
  - Stage (with breadcrumb and office thumbnail);
  - Row (title / meta / trailing actions);
  - Section (title plus optional action, no box);
  - Disclosure;
  - EmptyState;
  - Skeleton;
  - ErrorState.
- **Domain components:**
  - DiffView (existing);
  - LogView (existing ActivityFeed, virtualised);
  - Thread items: Request, PlanCard, ProgressBlock, DecisionCard, ResultCard, SystemRow.

### Rules
- **Cards** only for things you act on as a unit (decisions, results, plans). Everything else is a row in a section.
- **Badges:** at most one number badge on screen (Attention). Statuses use a dot plus a word.
- **No gradients, glass blur or HUD frames** in the chrome. The office keeps its pixel style; the chrome never imitates it.
- **Density:** 32px rows, 13px text. Sheets show 12–16 rows without scrolling at 900px height.
- **Accessibility:**
  - every action is keyboard reachable;
  - focus rings use the accent;
  - the sheet and stage trap focus;
  - live regions announce new attention items and status changes.

---

## 13. Remove, merge, redesign

| Component | Decision | Reason |
|---|---|---|
| `TopBar` view switch | **Remove** | Three worlds become one office plus layers |
| `CompanyView` (6 tabs) | **Remove** | Content redistributed (§3) |
| `Workspace` (9-section nav) | **Remove** as a destination | Sections become Sheet (Conversation, Project details), Result Stage and Under the hood |
| `ProjectPanel` tabs | **Replace** with the Conversation sheet | One thread instead of 5 partial views |
| `Overview` (brief textarea, triage block, stats) | **Remove** | The composer replaces the brief; stats move to project details |
| `TaskBoard` | **Replace** with ProgressBlock rows plus the Task sheet | No manual board management |
| `ApprovalDock` | **Merge** into DecisionCard (thread) plus the Attention tray | One decision UI everywhere |
| `Decisions` + Inbox | **Merge** into the Attention tray | Actionable-only attention |
| `Review` + `Preview` + `Quality` + `Validation` | **Merge** into the Result Stage | Visual-first review in one place |
| `Product` | **Split** into the Project details sheet plus PlanCard and milestone rows | The brief belongs with the project; progress belongs in the thread |
| `Insights` + `Engine` | **Merge** into Settings → Performance | Advanced, rarely needed |
| `Skills` | **Move** to Settings → Skills | Advanced |
| `Knowledge` | **Move** to Under the hood → Memory (per project) | Advanced |
| `FileBrowser` | **Move** to Under the hood → Files | Advanced |
| `ActivityFeed` | **Reuse** as LogView (sessions) plus thread system rows | Real logs stay; noise leaves the main view |
| `EmployeeCard` | **Redesign** as an anchored popover with real work and actions | Office as the work visualisation |
| `EmployeeProfile` | **Move** to the Employee sheet | Consistent layer |
| `WorldHud` | **Shrink** to a bottom-right office control cluster | Minimal chrome |
| `WorldInspector` | **Keep** as a hover popover | Already contextual |
| `NewProjectDialog` | **Replace** with Composer "New project" (+ "Use existing folder" link) | No form before value |
| `SettingsDialog` | **Replace** with the Settings Stage | Room for permissions, team, skills and performance |
| Composers 1–8 (§1) | **Replace** with one Composer | The central fix |

---

## 14. Component and state architecture

```
App
├─ CommandBar (ProjectSwitcher, CommandPalette trigger, AttentionTray, SettingsButton)
├─ OfficeLayer
│   ├─ OfficeCanvas (existing Phaser game — unchanged)
│   ├─ OfficeOverlay (status tags, EmployeePopover; reads officeCamera positions)
│   ├─ OfficeControls (zoom, rooms, sound)
│   └─ ComposerDock
├─ Sheet (stack: Conversation | Employee | Task | Decision | ProjectDetails)
├─ Stage (Result | Plan | UnderTheHood | Settings) + OfficeThumbnail
└─ Overlays (CommandPalette, ExpandedComposer, Toasts, Confirm)
```

### Store (zustand, split into slices to stop whole-app re-renders)
- **`entities`** (existing data): projects, tasks, runs, approvals, deliveries, validations, qualityReports, product.
- **`nav`** (persisted per project): `sheetStack[]`, `stage | null`, `stageParams`, `lastThreadScroll`.
- **`composer`** (persisted): `drafts{targetKey: {text, attachments, intent}}`, `target`, `expanded`.
- **`attention`** (derived selector): pending approvals and results in review across projects, sorted by urgency.
- **`thread(projectId)`** (memoised selector): merges messages, deliveries, approvals, tasks and system events into ordered thread items. Built incrementally from push events; never re-sorts on every `runEvent`.

### Performance rules
- **`runEvent` streams** are batched per animation frame and only update the LogView currently open. Office statuses update at most every 250ms.
- **The thread and logs** are virtualised (rows over 200).
- **The office canvas** never re-renders from React; the overlay subscribes only to the `statuses` slice.
- **Stage contents** are lazy-loaded (code-split Result, UnderTheHood, Settings).

### New IPC (the only backend additions; all use existing infrastructure)
1. `ask(projectId, text, context)` → a read-only Claude Code session; streams an answer into a message. Respects permissions, budget and capacity; never modifies files.
2. `messages(projectId)` / push `message`: the new `messages` table (migration v11).
3. `saveAttachment(projectId, dataUrl | path)` → `.autopia/attachments/…`, generalising the screenshot path rules.
4. `messageEmployee(projectId, employeeId, text)` → `insertTask` with an assignee (a scoped task), or `ask` when the text is a question.
5. `productFeedback` generalised: available for every project, not just product mode (queues notes for unstarted tasks).
6. `refinePrompt(text)` (optional, user-triggered) → one small-model call, returns a suggestion only.

Everything else maps onto today's API (§5 table).

---

## 15. Provider extensibility

The UI must never assume Claude Code's exact feature set. Introduce a **provider capability descriptor** returned by `bootstrap` (real values for Claude Code; no other provider is implemented):

```ts
interface ProviderCapabilities {
  id: 'claude-code'; name: string; version: string | null; account: { label: string } | null
  sessions: { resumable: boolean; persistent: boolean }
  permissions: { interactivePrompts: boolean; orgPolicy: boolean }
  streaming: 'tool-events' | 'text-only' | 'none'
  models: { selectable: boolean; allowed: string[] | null }
  effort: string[] | null              // e.g. ['low','medium','high'] or null
  usage: { tokens: boolean; costUsd: boolean }
  structuredOutput: boolean
  skills: boolean; subagents: boolean; mcp: 'none' | 'org-managed' | 'user'
}
```

**UI rules:**
- Cost and tokens are shown only if `usage.*`.
- "Watch live" appears only with `streaming === 'tool-events'`.
- "Continue in the same session" appears only if `sessions.resumable`.
- Options in the Expanded composer list only supported controls.
- Permission cards only exist if `interactivePrompts`.

**Where the boundary sits:** in code, everything Claude-specific stays behind `main/claude/*` and the orchestrator's `execute()`. Settings → "AI provider" shows the active provider, its account and its policy restrictions. It does **not** show a fake list of other providers.

---

## 16. Implementation phases (12B onward), each shippable on its own

1. **Foundation (no behaviour change):**
   - design tokens;
   - primitives (Button, Row, Sheet, Stage, Popover, Chip, StatusDot, EmptyState);
   - the CommandBar replacing TopBar;
   - Sheet and Stage hosts;
   - store slices.

   Existing components move into the Sheet and Stage temporarily, and the Workspace and Company views stay reachable through ⌘K until replaced.
2. **The Composer and Conversation:**
   - the Composer (Dock, Expanded, Thread);
   - target and intent chips;
   - drafts and attachments;
   - the thread selector;
   - backend: `messages`, `ask`, attachments, generalised notes.

   This retires composers 1, 2, 5 and 8.
3. **Attention:** the Attention tray plus DecisionCard (thread and tray), retiring `ApprovalDock`, Decisions and Inbox. Includes the new permission copy.
4. **Result Stage:** merges Review, Preview, Quality and Validation; result cards in the thread; Accept split button. Retires composers 3, 4 and 9 into the Composer.
5. **The office overlay:** status tags plus EmployeePopover, Employee sheet, Office controls; WorldHud shrinks.
6. **Settings and Under the hood:**
   - the Settings Stage (provider and permissions, Team and hiring, Skills, Memory, Performance, Office);
   - Under the hood (Files, Changes, Sessions, Checks, Memory);
   - removal of the Workspace and Company views.
7. **Copy pass and polish:**
   - apply §11 to every string;
   - light theme parity;
   - motion;
   - empty, loading and error states;
   - accessibility audit.
8. **Validation:** run the 15 journeys (§17) with real projects and fix anything that fails the criteria.

---

## 17. Journeys and acceptance criteria

### Journeys, today vs target (interactions counted from the most likely starting point)

| # | Journey | Today | Target |
|---|---|---|---|
| 1 | First open | Empty office plus "New project" dialog form (name, folder, git, brief) | Office plus Dock: "Describe what you want to build" — **0 clicks to start typing** |
| 2 | Know how to begin | Must read the dialog | Placeholder plus target chip explain it; no tutorial |
| 3 | Create a project from an idea | 4 fields + Create, then Start | Type + ⌘↵ (**1 action**) |
| 4 | Submit a development request | Find the right box (Overview / Workspace / Product) | Dock, type, ⌘↵ |
| 5 | Know which project receives it | Implicit (active project) | Target chip shows it before send |
| 6 | Observe real work | Office (good) + panel Tasks tab | Office + status tags + thread progress block |
| 7 | Inspect an employee's work | Click → card → Live log (switches panel tab) | Click → popover with current work → Watch live (**2 clicks**) |
| 8 | Know when approval is needed | Dock + bell + Decisions + phase pill | One Attention count + card in the thread + office tag |
| 9 | Review a result | Workspace → Review → Preview → Quality (3–4 views) | Result card → Review result (**1 click**, preview first) |
| 10 | Open the preview | Workspace → Preview → Start | Inside the Result Stage; one confirm for script previews |
| 11 | Request a revision | Pick one of 4 boxes | Composer in the Result Stage (or Dock, auto "Request a change") |
| 12 | Continue a conversation | No conversation exists | Thread per project, restored on switch |
| 13 | Find an old project or task | Switcher; tasks only via tabs | ⌘K: projects, results, tasks, requests |
| 14 | Recover from an error | Find the card in the dock or Decisions; generic Retry | Card with cause + recommendation + one primary action (in thread and Attention) |
| 15 | Advanced details | Workspace sections and Company tabs | Result → Changes / Checks / Sessions, or Under the hood (⌘K) |

### Acceptance criteria (for 12B)

**Usability:**
- A first-time user can turn an idea into a running build with **no dialog and no more than 1 click after typing**.
- Every request shows its **target and intended action before sending**. No message ever changes code when the intent chip says "Ask a question".
- There is **one** composer component; no other free-text request input remains, except inline replies, which use the same component.
- Anything needing the user appears in **both** the Attention tray and the project thread within 1s of the event. Informational events never increment the Attention count.
- From a "Ready to review" toast, the live preview or real captures are visible in **one click**.
- Every error state names a cause (when known) and offers a primary recovery action.
- Every capability listed in §13 is still reachable in **at most 2 steps** from the office via ⌘K.
- The office canvas is visible (full, or as the live thumbnail) in every state of the app.
- No UI string uses the "Don't say" terms in §11.

**Integrity:**
- No placeholder previews, fabricated statuses or simulated progress. Every status tag, progress row and checks line comes from recorded runs, tasks, approvals or quality reports.
- **No new AI calls** except: user-sent requests, user-sent questions (`ask`), and user-triggered prompt refinement. Typing, intent detection, search and navigation are local.
- All existing capabilities keep working:
  - planning, product mode and milestones;
  - quality gates and visual QA;
  - the director, budgets and pause;
  - skills review;
  - memory;
  - git review, deliveries accept and reject;
  - previews (with the existing consent);
  - permissions relayed with org policy respected;
  - recovery after restart.
- Drafts survive switching projects and restarting Autopia.
- Office frame rate is unchanged while a session streams (no React re-render of the canvas; overlay updates at most 4×/s).
- Light and dark themes both meet WCAG AA for text and controls; all actions are keyboard reachable.
- Provider-specific UI is driven by `ProviderCapabilities`, and Claude Code reports its real values.
