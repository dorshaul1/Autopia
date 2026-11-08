# Autopia Next

The product plan from Phase 48 onward. The surface-by-surface record is [TRANSFORMATION_INVENTORY.md](TRANSFORMATION_INVENTORY.md).

## What was wrong with the old model

Autopia opened on the office, and almost everything else hung off it.

- The office was the app, so seeing anything meant leaving it: chat existed only in the office, and opening a task from anywhere pulled you back there.
- The real unit of value, a product, was a dropdown. You couldn't see what your other products were doing without opening it.
- "What needs me?" lived in four places: the tray, the conversation, the Company view and the status line.
- Results, Work and Project were split by implementation, and "Project" didn't describe files, memory and cost.
- Company was hidden behind a building icon, though it held the only view across products.

## The new model

**You own a studio. Your products are what it makes. The office is where you watch the team make them.**

| Idea | Means |
|---|---|
| Central object | The **product**, not the chat, the office or a dashboard |
| Always visible | Every product and what it's doing, in the rail |
| Start of the day | **Home**: every product grouped by what it needs from you, one place to start something new |
| A product's front page | **Overview**: what it is, the real product, where it stands, what happened while you were away, and its direction |
| Inside a product | One flat row of stages by goal: **Overview, Office, Preview, Review, Tasks, Logs, Files**, with **More** for Memory, Time and cost, Brief |
| Talking to the team | The **conversation travels with you** through every stage, along with teammate, task and log details |
| Where it stands | One **status bar**: what's happening, who, the next sensible step |
| Getting back | Back and forward (⌘[ ⌘]), and each product reopens the way you left it |
| Concentrating | Focus (⌘.) leaves only the stage and the status bar |
| Asking or doing anything | **⌘K**: one place for requests, questions and actions. It says what Enter will do first |
| Everything else | Studio and Settings: one step away, never in the way |

How things relate: a studio has products; each product has an office and a team; you ask for things in a conversation; the team turns that into tasks, each done by a teammate through Claude Code sessions; finished work becomes a delivery you review in the product.

## The experience, end to end

| Moment | Experience | State |
|---|---|---|
| First launch | Home with one question and a composer; an existing folder or a chosen office one click away | Built |
| New product | Describe it on Home, or + in the rail | Built (full creation flow: 50) |
| Starting development | The product opens in its office with the conversation beside it; plans arrive there | Built |
| Daily work | Open Autopia where you left it; the status bar says where things stand | Built |
| Watching work | Office for the feel, Work for the detail, Execution and logs beside either | Built (Mission Control: 53) |
| Talking to a teammate | Click them anywhere; their details open beside what you're doing | Built |
| Inspecting and feedback | Preview and Review stages: Point, Screenshot, changes, checks | Moved (Studio: 52) |
| Decisions | The rail marks the product, Home lists them, and the card answers in the conversation | Built (Center: 54) |
| Reviewing deliveries | Preview and Review stages, with the conversation beside it | Moved (timeline: 55) |
| Returning | View, section, panel and rail restored after restart | Built |
| Several products | Rail for switching and status, Home for the overview, each with its own team | Built |
| Settings and advanced | Settings, Studio, ⌘K | Moved (59) |

## New capabilities, by value

| # | Capability | Why it matters | Phase |
|---|---|---|---|
| 1 | Conversation in every stage | Steer while looking at the thing you're steering | Done |
| 2 | Status across products | Run several products without opening each | Done |
| 3 | Restored place | Nothing to re-find after a restart | Done |
| 4 | Context-aware ⌘K with natural requests | One place to find and do, aimed at what you're looking at | 51 |
| 5 | Point-to-build as the default way to give feedback | Claude Code can't see your screen; this is the clearest advantage | 52 |
| 6 | Delivery timeline with before and after | See how a product changed, and go back | 55 |
| 7 | One decision center with batching and consequences | Fewer interruptions, better decisions | 54 |
| 8 | Mission Control across all running work | Who is doing what, what's stuck, across products | 53 |
| 9 | Adaptive layouts per space | The window arranges itself for reviewing, watching or steering | 57 |
| 10 | Run, env and launch-readiness checks | From "it works here" to "ready to launch", without paid services | Done |

Left out on purpose: a built-in terminal or editor (Claude Code and your editor do those), task-board tooling beyond what the team needs, and anything that spends tokens on interface behaviour.

## Visual language: "Night shift"

An office after dark, lit by lamps. The pixel art stays the brand; the interface around it steps back.

| Part | Decision |
|---|---|
| Neutrals | Warm ink (`--n-*`), replacing the violet tint, so the office's colours are the only colourful thing on screen |
| Accent | Lamp gold (`--accent`), only for the next step, focus and selection. Warm amber moved to tangerine, so "needs you" can't be mistaken for "do this" |
| Type | System sans for work; `--font-display` (New York) only for product names and page titles, which gives the app one recognisable voice |
| Structure | Lines and space before cards: Home's products are rows, the rail has no boxes |
| Status | One mark, `.pulse-dot`, and one set of tones (`attention`, `danger`, `ready`, `live`, `done`, `quiet`) from `shared/productPulse.ts` |
| Motion | Token durations, removed under reduced motion; the rail moves, status doesn't pulse without cause |
| Keyboard | ⌘0 Home, ⌘1–8 stages, ⌘[ ⌘] back and forward, ⌘. focus, ⌘\ conversation, ⌘B rail, F6 regions, ⌘K everything, ? the list |

## Roadmap

Each phase ends by updating the inventory. Scope was adapted to what Phase 48 already did.

| Phase | Scope | Starting point |
|---|---|---|
| 49 The New Experience | Done: flat stages, status bar, contextual actions, back and forward, focus, per-product layouts, legacy removal | See the inventory |
| 50 Project Experience | Done: hub, one creation flow, Overview, direction, returning summary, one product menu | See the inventory |
| 51 Universal Command | Done: one Command, receipts, request state, teammate threads, what it did, per-product model | See the inventory |
| 52 Product Studio & Visual Development | Done: the product takes the stage; Point and Mark up in one list of notes; real capture comparison; diagnostics beside the product; games, native apps and backends get what they can really do | See the inventory |
| 53 Mission Control & Team | Done: one list of the work, task detail with real steering, team by real assignments. Operations stays for Phase 54 | See the inventory |
| 54 Decision Center & Transparency | Done: one decision card everywhere, a board from live records, an Inspector for every session | See the inventory |
| 55 Deliveries & Timeline | Done: one Deliveries stage with the product's history and each result presented in full; review state apart from evidence; change requests that link back | See the inventory |
| 56 Living Office & Employees | Done: framing, office materials, signs, distinct teams, truthful waiting states; audit in `OFFICE_QUALITY.md` | See the audit |
| 57 Adaptive Workspace | Done: search across every product inside Command; open panel, result and thread restored per product; window size remembered; long lists paged. No split views, on purpose | See the inventory |
| 58 Project Operations & Launch Readiness | Done: an Operations stage; environment read from each project's files, any language; run and stop you can trust; checks that know which code they ran on, with no AI; failures routed to the team once; readiness as evidence | See the inventory |
| 59 Settings, Onboarding, Coverage | Done: settings by what you came to change; saves that are confirmed or say they failed; Claude Code and MCP shown as reported; install help on first run; secondary screens reviewed | See the inventory |
| 60 Visual & UX Excellence | Done: every main screen rendered and reviewed at two sizes; top bar, preview, results, logs, right click, selection, targets; measured speed needed no change | See the inventory |
| 61 Validation, 62 Real-World Trial | Real lifecycle and scenarios run; findings fixed and rerun; what remains unverified is listed, so this is not zero-gap | See the inventory |
