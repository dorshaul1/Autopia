# Transformation inventory

Every user-facing surface, what happens to it, and whether that's been checked. `test/inventory48.test.ts` fails if a component, view, section or panel exists without a row here. No feature disappears silently: a removed surface says where its function went.

**Decision:** keep, improve, merge, replace, remove. **Status:** `done` built and seen working; `moved` same content in the new structure, not redesigned; `todo` waiting for its phase.

Plain dialogs inside a surface are listed with it where they're the same workflow.

## Shell and navigation

| Surface | Where | Issues found | New experience | Decision | Phase | Status |
|---|---|---|---|---|---|---|
| App root | `App.tsx` | Everything assumed the office | Rail, header, stage, panel, status bar; shell parts have their own error boundaries | replace | 49 | done |
| Rail | `shell/Rail.tsx` | New in 48 | Every product with status; right-click menu; arrow keys | new | 49 | done |
| Header | `shell/CommandBar.tsx` | Three levels of navigation; five controls | Back and forward, product, one flat row of stages, More, ⌘K, focus, Team | replace | 49 | done |
| Stages | `shared/stages.ts` | Results, Work, Project with sub-tabs | Office, Preview, Review, Tasks, Logs, Files; More for Memory, Time and cost, Brief. Empty ones stay hidden | replace | 49 | done |
| Status bar | `shell/StatusBar.tsx` | "Needs you" shown in about five places; status only in the header | What's happening, who, next step; Tell the team; auto mode, usage, notifications | new | 49 | done |
| Contextual actions | `shared/contextActions.ts`, `shell/useContextActions.ts` | Actions scattered, some irrelevant | One list from real state, in the status bar and on top of ⌘K | new | 49 | done |
| Back and forward | `store.ts` | No way back to where you were | ⌘[ and ⌘], across products | new | 49 | done |
| Focus mode | `store.ts`, `App.tsx` | None | ⌘. keeps the stage and status bar only | new | 49 | done |
| Per-product layouts | `store.ts` | One saved place for all products | Each product reopens on its own stage and panel; old saved place migrated once | new | 49 | done |
| Notifications | `shell/SystemTray.tsx` | Third place for decisions, took header room | Moved to the status bar as an icon with a count. Merges into the Decision Center | merge | 54 | moved |
| Auto mode, usage meter | `shell/SystemTray.tsx` | Crowded the header | Status bar, popovers open upward | keep | 59 | done |
| Command | `shell/Command.tsx` | ⌘K could only navigate; five separate places accepted instructions | One surface, ⌘K or `/`: requests, questions, local actions with no AI, @ teammates, # tasks, `/` Claude Code, attachments, removable context, says what Enter does first. Drafts per product | replace | 51 | done |
| Receipt | `shell/Receipt.tsx` | Sending meant opening a chat | What became of it, without one; short answers appear right there | new | 51 | done |
| Connecting Claude | `home/ConnectClaude.tsx` | Nothing said whose Claude this was | Home says which version and account; if not connected or not installed, that comes first, using Claude Code's own browser sign-in | new | 51 | done |
| Choosing Claude Code | `main/claude/cli.ts` | Took the first copy on PATH, so an old one hid newer models | Newest working official copy on this Mac | improve | 51 | done |
| Model picker | `shell/SystemTray.tsx` | One global setting | Per product in the status bar, asked fresh from Claude Code; default Latest; another model can be tried by name; notice and Update when Claude Code is behind | new | 51 | done |
| Shortcuts dialog | `App.tsx` | Old names | Updated | improve | 49 | done |
| Toasts | `App.tsx` | Repeated what was on screen | Decision toast only for another product; result toast kept | improve | 54 | done |
| Sub-section tabs | `shell/FocusShell.tsx` | A second row of tabs everywhere | Only Studio and Settings now | improve | 59 | done |
| Delete product dialog | `ProjectActions.tsx` | Fine | Same dialog, from the rail | keep | 48 | done |
| Boot and error states | `App.tsx`, `ErrorBoundary.tsx` | A shell error blanked the window | Same, plus boundaries around each shell part | improve | 49 | done |
| **Removed:** project switcher (`TopBar.tsx`) | | Products hidden | Rail | remove | 48 | done |
| **Removed:** first-run overlay | | Over an empty office | Home | remove | 48 | done |
| **Removed:** status line (`NextUp.tsx`) | | Duplicated | Status bar, same `whatsNext` | remove | 49 | done |
| **Removed:** office dock composer | | Second composer | Tell the team in the status bar, `/`, or Team | remove | 49 | done |
| **Removed:** composer's project menu | | Duplicated the rail | Rail | remove | 49 | done |
| **Removed:** panel's Execution and Details buttons | | Clutter | Panel ⋯ menu, Show work, ⌘K | merge | 49 | done |
| **Removed:** 216 unused style rules | `styles.css` | Screens long gone | 8,171 to about 7,000 lines | remove | 49 | done |

## Home and company

| Surface | Where | Issues found | New experience | Decision | Phase | Status |
|---|---|---|---|---|---|---|
| Hub | `home/Home.tsx` | Flat list, office art for everything | Grouped by what each product needs from you; real captures as identity; search above six; older ones folded; loading, failed and empty states | replace | 50 | done |
| Creation | `home/Creator.tsx` | Two flows; a dialog asking for name, folder and office first | One place: describe it, see who builds it, where and what happens, change anything, Start. Errors keep your words. Ideas on first launch | replace | 50 | done |
| Open a folder | `home/Creator.tsx` | Same dialog | Same place, folder named, goal optional, Git choice under Change | replace | 50 | done |
| Product menu | `shell/ProductMenu.tsx` | Different in each place, priority separate | One menu in rail and hub, right-click too: rename, pause, reveal, priority, delete | new | 50 | done |
| Product image | `home/ProductImage.tsx` | Everything looked like its office | Latest real capture, else the office. Never a mock-up | new | 50 | done |
| **Removed:** new project dialog (`NewProjectDialog.tsx`) | | Duplicate flow | Creator | remove | 50 | done |
| Portfolio | was `CompanyView.tsx` `Portfolio` | Hidden, card-heavy | The hub. Per-product cost is in Time and cost and Details; **the studio-wide total is gone and comes back in Studio (53)** | merge | 53 | todo |
| Company view | `CompanyView.tsx` | Mixed products with company | Team, Operations, History, Skills, Performance | improve | 53 | moved |
| Team | `CompanyView.tsx` `Team` (rail: Studio) | Cards with status labels | Grouped by real assignments across products; open someone for their work and a message | improve | 53 | done |
| History | `CompanyView.tsx` `Inbox` | Fine | Same | improve | 54 | moved |
| Decision Center | `decisions/DecisionCenter.tsx` (replaced `Decisions.tsx`; Studio → Decisions) | Four renderers of the same decision; questions couldn't be answered from the list | One card on Home, in the tray, in conversations and the task panel, from a board read live from the backend; what's running without you | replace | 54 | done |
| Pause a product | was in `Decisions.tsx` only | Hard to find | Also in the rail menu | improve | 48 | done |
| Skills | `Skills.tsx` | A technical table and a ranked marketplace of downloads | A plain list of what's installed, on or off, what really happened, and one way to install your own. Marketplace removed | replace | 59 | done |
| Performance | `Engine.tsx` | Technical | Same | keep | 59 | moved |
| Settings | `SettingsDialog.tsx` (Claude Code, team, memory) | Long | Same, adds effort | improve | 59 | moved |

## Product spaces

| Surface | Where | Issues found | New experience | Decision | Phase | Status |
|---|---|---|---|---|---|---|
| Stage container | `workspace/Workspace.tsx` (view `workspace`) | Sub-tabs | Draws the stage the header chose; no tabs of its own | improve | 49 | done |
| Deliveries | `deliveries/Deliveries.tsx`, `result/ResultView.tsx` (view `result`; panes preview, changes, checks, all) | Four tabs, three places results opened, a second older review page | A timeline of the product beside one result presented in full: what it is, whether it works, what's left, and asking for a change; review state apart from evidence | replace | 55 | done |
| Studio | `studio/Studio.tsx` (replaced `workspace/Preview.tsx`) | A toolbar over a preview, beside a review column | The product takes the stage; one slim line says what result it is; controls change with what it can do | replace | 52 | done |
| Notes | `studio/Notes.tsx` (replaced `workspace/VisualFeedback.tsx` and the screenshot form) | Two flows with different routes, one blocked while work was open | One list for live points and marks on pictures, one way to the team through `sendVisualFeedback` | replace | 52 | done |
| Mark up | `studio/Markup.tsx` | Crop one area of a screenshot | Spots and areas on a real picture, several per picture, kept as fractions of it | new | 52 | done |
| Compare | `studio/Compare.tsx` | Nothing | Two real captures, side by side or in place, with times and links to the result and task | new | 52 | done |
| Diagnostics | `studio/Diagnostics.tsx` | Logs covered the product | Problems, server output and checks beside the running product | replace | 52 | done |
| Outside | `studio/Outside.tsx` (replaced `NonWeb`, `NoPreview`, `Captures`) | A line of text under an empty preview | What can really be opened, run and read for games, native apps, backends and AI products | replace | 52 | done |
| Delivery detail, diff | `workspace/Review.tsx` | Dense | Timeline | improve | 55 | moved |
| Checks and evidence | `workspace/Quality.tsx`, `workspace/Validation.tsx` | Technical first | Plain first, evidence on demand | improve | 55 | moved |
| Mission Control | `mission/MissionControl.tsx` (section `tasks`; replaced `TaskBoard.tsx`) | Status columns and a technical graph, separate from Execution | One list in the order you'd ask: what needs you, what's happening, what's next, what's finished; filter by person; order on request | replace | 53 | done |
| Inspector | `inspector/Inspector.tsx` (section `activity`, panel `log`; replaced `ActivityFeed.tsx`) | A raw event feed | Each session in plain words first, then tools, problems, your decisions and the full record; files it wrote; Skills and connected tools really used; long logs page in | replace | 54 | done |
| Overview | `home/ProjectHome.tsx` (section `overview`) | Nothing answered "what is this and where does it stand?" | Purpose, latest real capture, what needs you, what stopped, now, up next, since you were here, recent results, direction. Sections appear only when true. Opens first for new products and after a day away | new | 50 | done |
| Operations | `operations/Operations.tsx` (section `operations`) | Running, checks and readiness were scattered, web-only, and old results read as current | One page: what the project is, run and stop, checks on the code as it is now, failures sent to the team once, launch readiness as evidence | replace | 58 | done |
| Direction | `home/ProjectHome.tsx` | A feedback box buried in the brief | Where it's heading, and Change the direction opens the Command, through `productFeedback` | replace | 51 | done |
| Product brief | `workspace/Product.tsx` (section `product`) | Had its own feedback box | More → Brief, read-only; launch tools in 58 | improve | 58 | moved |
| Files | `FileBrowser.tsx` (section `files`) | Fine | Files stage | keep | 57 | moved |
| Memory | `workspace/Knowledge.tsx` (section `knowledge`) | Technical | More → Memory, plainer | improve | 59 | moved |
| Time and cost | `Insights.tsx` (section `insights`) | Fine | More → Time and cost | keep | 57 | moved |
| Old Overview | section `overview` | Already retired | Redirects to tasks | remove | 49 | done |

## Conversation and side panel

The panel follows you through every stage. Its head names where Back goes; ⋯ holds Execution, Details and conversation-only.

| Surface | Where | Issues found | New experience | Decision | Phase | Status |
|---|---|---|---|---|---|---|
| Panel | `sheet/Sheet.tsx` | Office only | Every space | improve | 48 | done |
| Conversation (`conversation`) | `sheet/Sheet.tsx` | Single thread | Follows you; threads later | improve | 51 | done |
| Composer | `composer/Composer.tsx` | Three variants | Only the conversation's own box | improve | 51 | done |
| Request state | `shared/requestLifecycle.ts`, `sheet/Sheet.tsx` | Only some messages said anything | Submitted, accepted, queued, running, waiting, completed, failed, cancelled, from recorded state; work links to Execution | new | 51 | done |
| Teammate threads | `sheet/Sheet.tsx` | One mixed thread | One teammate or everyone, with the way back | new | 51 | done |
| What it did | `sheet/Sheet.tsx` | Only in the log | Under each reply, on demand, in plain words | new | 51 | done |
| **Removed:** expanded composer and ⌘⇧E | | Duplicate editor | Command grows with your text | remove | 51 | done |
| **Removed:** Result's own composer, Direction box | | Competing inputs | Buttons that open the Command, aimed correctly | merge | 51 | done |
| Plan review | `ApprovalDock.tsx` (now the plan review only) | One of four decision renderers | Plans keep their full review; every other decision uses the Decision Center card | merge | 54 | done |
| Teammate (`employee`) | `sheet/Sheet.tsx` | Fine | Opens beside any space, what they're doing, what needs you | improve | 56 | done |
| Task (`task`) | `sheet/Sheet.tsx` | Fine | Opens beside any space | improve | 53 | done |
| Details (`project`) | `sheet/Sheet.tsx` | Fine | Same | improve | 58 | moved |
| Log (`log`) | `sheet/Sheet.tsx` | Fine | Readable by default | keep | 54 | moved |
| **Removed:** Execution panel | was `sheet/Sheet.tsx` (`execution`) | A second view of the same steps | Mission Control | remove | 53 | done |

## Office

| Surface | Where | Issues found | New experience | Decision | Phase | Status |
|---|---|---|---|---|---|---|
| Office scene | `office/OfficeView.tsx`, `office/OfficeScene.ts` (view `office`) | Was the whole app | One space; follows real work (Phase 47) | keep | 56 | done |
| Team dock, camera, sound, arrange | `WorldHud.tsx` | Dock covered the office | Fit keeps clear of the dock; audit in `docs/OFFICE_QUALITY.md` | improve | 56 | done |
| Object and desk cards | `WorldInspector.tsx` | Fine | Same | improve | 56 | moved |

## Shared pieces

| Surface | Where | Issues found | New experience | Decision | Phase | Status |
|---|---|---|---|---|---|---|
| Design tokens | `design/tokens.css` | Violet tint, cyan | Night shift | replace | 48 | done |
| Primitives | `design/primitives.css`, `ui/index.tsx`, `common.tsx` | Fine | Adds `.pulse-dot` | improve | 60 | done |
| Feature styles | `styles.css` | About 7k lines; many surfaces still old-style cards | Shrink, restyle | improve | 60 | todo |
| Tooltips | `Tooltip.tsx` | Fine | Same | keep | 60 | moved |
| Markdown | `Markdown.tsx` | Fine | Same | keep | 60 | moved |

## Checked in Phase 57

On a copy with 6,000 messages and 1,000 tasks: opening the product 75 ms, stages 11 to 80 ms, a search 3 to 12 ms, typing in the command box under 40 ms a key, heap steady across 40 product switches. Measured first, so no virtualization was added: only "Show earlier" and the finished list now load in pages. Keyboard checks used dispatched key events, because the hidden test window takes no real keys. **Real keys, and the window's size restoring on a real display, were not tried.**

| Item | Before | Now | Checked |
|---|---|---|---|
| Search (`repo.search`, `shell/Command.tsx`) | Open product's tasks and people, plus product names | Also deliveries, messages and files, in every product, in the same box | Found and opened a task and a message from another product |
| Going back to a product | Panel and chosen result reset | Panel, result and thread come back if they still exist | Restart, and deleted references |
| Window size | Reset on every launch | Saved, unless that spot is off every screen | State file written; **restoring not seen on a real display** |
| Shortcut help | Old stage names | Current names, list keys, Preview keys | Rendered |

## Checked in Phase 54

See `test/decisions54.test.ts` for what's enforced. Real sessions were declined, never approved, by the test scripts: **approving a real prompt is left for a person to try.**

## Checked in Phase 52

Run on disposable test projects with real Claude Code sessions. The test window is hidden, so real mouse input never reaches the page inside the preview. Those simulated events hid a real bug: pointing picked nothing with a real mouse. It was reproduced and fixed using real input in a separate off-screen window (click, drag, and the app untouched). **Point inside the app's own window still needs a try with your mouse.**

| Workflow | What happened |
|---|---|
| 1 Running web preview | Started, page answered, `page`, back and forward reported by the page. The page's picture came back from a capture |
| 2 No preview | A Python tool shows what it does, its readme and check state. No empty browser |
| 3 Start and stop | Asks before running a project's own script; idle shows the last real picture marked as not live; stop and restart work |
| 4 Select without triggering | Buy button pointed at: its count stayed 0, hover handlers didn't run, and after pointing ended the same button worked |
| 5 Annotate | A drag and a click on a real capture, a note on each, one removed. Stored as fractions of the picture |
| 6 Submit | Two notes became two tasks through `sendVisualFeedback`, joined to one delivery, shown in the conversation, and the page's before and after were captured |
| 7 Context reaches execution | The real sessions opened the marked crop and the whole-screen picture, and the requested changes landed in the project's own `index.html` |
| 8 Runtime error | A thrown error in the page shows in Problems with Ask to fix; a crashing dev script shows its error and output |
| 9 Compare | Two real captures side by side and in place, with their times. **Links to a result and a task were not clicked** |
| 10 Game | A Godot project offers Open in Godot behind a confirmation, and says it can't be seen from Autopia. **Godot itself was not opened** |
| 11 Switching | Another product shows nothing of the first: no notes, no state. Coming back finds them |
| 12 Resize and restart | Phone size and the open drawer came back after really restarting the app, with the notes |

## Checked in Phase 51

In a test copy with real Claude Code sessions; no build was started.

| Workflow | Result |
|---|---|
| 1 Development request | Identified as a request before sending. **Not submitted, to avoid starting a build** |
| 2 Status question | Answered through a receipt, with no chat opened. **Reading a named file: the fix is unit-level, not seen answering correctly** |
| 3 Teammate conversation | `@ine` finds Inés; answered; thread shows only them, with the way back |
| 4 Target a task | Unit tested and `#` is wired. **Not exercised on a real task** |
| 5 Image | Answered "Red" with a real image, through the send path. **The paste and drop handlers themselves weren't exercised** |
| 6 Native question | Sent from the Command, answered on the card, session continued |
| 7 Permission | Denied, and no file was created |
| 8 Local action | `open preview` went there: no message, no session |
| 9 No leakage | Ember's draft and chip stayed in Ember; Night started clean |
| 10 Interrupted conversation | After a real restart, both the message and the reply show as failed, with Retry |
| 11 Stop and retry | Stopped, marked as such, Retry shown |
| 12 Keyboard | ⌘K, arrows, Enter, Esc with draft kept, Tab. **Dispatched key events** |

Also checked: Claude Code discovery picks the newest copy (2.1.318 here); the picker lists Claude Code's real models; Latest ran on claude-opus-5-5, including resuming a conversation begun on Haiku. **The Update and Use another account buttons were not pressed**, since they change your installation and sign-in.

## Checked in Phase 50

In a test copy, plus a sweep on a throwaway copy of the real database.

| Workflow | Result |
|---|---|
| 1 No projects | Home asks one question, offers three ideas; rail says where products will appear |
| 2 Natural idea | Game idea recommended Game Studio, website Tech Startup; name, folder and what happens shown before Start |
| 3 Start development | Real: planned in about 2m 45s, plan approved, foundation task started. **Stopped there, not built to the end** |
| 4 Active project | Overview showed the real task, who, and what they were doing |
| 5 No preview | A folder with one Python script opened with an honest "nothing built yet". **No product that has work but no web preview was seen** |
| 6 Long absence | Opened on Overview with "Since you were here 5 days ago" (the date was backdated) |
| 7 Switching | Rail and hub stayed correct with one product running. **Two products running real builds at once wasn't tested in this phase** |
| 8 Goals | Sent from Direction, confirmed in plain words: "Noted. Work that hasn't started yet will follow it" |
| 9 Init failure | Inline error, your words kept, nothing created, Try again |
| 10 Restart | Real full restart restored product, stage and interrupted tasks |

Sweep: every stage of every real product plus Home, Settings and Studio's sections: 48 screens, no crashes, no sideways overflow.

Reported by the user and fixed: More → Time and cost crashed on a teammate not in the product's roster, and the error hid behind the office and stayed stuck on every other stage. Errors now cover the page and clear when you go elsewhere.

## Checked in Phase 49

The ten workflows, in a test copy with three disposable products and real Claude Code sessions. Clicks were DOM clicks in a hidden window; no build was started.

| Workflow | Result |
|---|---|
| 1 Launch and understand products | Home names all three and says "All quiet" |
| 2 Open a product and see its state | Stages, status line and rail agree |
| 3 Continue a request | Typed in the panel's composer, sent, answered |
| 4 Teammate conversation | Panel opens beside the stage; Message aims the composer at them |
| 5 Inspect active work | Status bar names who's working; clicking their avatar opens details, stage unchanged |
| 6 Preview and return | Back and Forward restore the exact stage. **The page inside the preview can't be seen in this test window** |
| 7 Find and answer a decision | Status bar, rail, tray and Home show it; Show me reveals the card from another stage; answering continued the session |
| 8 Switch products while working | Rail status stayed correct; a second product answered while the first worked |
| 9 Mouse and keyboard | ⌘0, ⌘1, ⌘2, ⌘6, ⌘[, ⌘], ⌘., Esc, ⌘K, F6, / all worked. **Dispatched key events, not a physical keyboard** |
| 10 Restart | A real full restart restored the last product's stage, and another product kept its own stage and closed panel |

Also checked: 1100px window on five stages with no sideways overflow; old saved place migrating.

Found and fixed by these checks: a crash that blanked the window (a React effect returning a value), the status line saying "Ready" during a direct session, the migration overwriting itself, and a too-tall composer.

**Gaps:** no screen reader pass. Not measured with several long builds running at once. A real multi-task build through the new shell hasn't run. Most stage contents are still their old designs, assigned below.

## Checked in Phase 48

Run in a test copy with three disposable products. No build was started.

| Scenario | Result |
|---|---|
| First launch | Home with one question |
| Create and start a product | Created through the backend, opened in its office. **The composer's own create-and-start was not run**, to avoid starting a build |
| Open an existing product | Yes |
| Send a request | Yes, with a real Claude Code session (`/claude`) |
| Inspect active work | Work space, logs and teammate panel, beside the conversation |
| Interact with a teammate | Panel opens without leaving the space |
| Product preview | Starts, status running. **The page inside it could not be seen**, because the test window can't capture that native view |
| Approval or blocker | A real question: rail, Home, header and card all showed it, and answering continued the session |
| Switch between products | Six switches: name and team correct each time |
| Restore after restart | View, section and panel restored after a page reload. **A full app restart was not tested** |
| Accessibility | Keyboard shortcuts, `aria-current`, labelled controls. **No screen reader pass** |
| Performance | Office pauses when hidden. **No measurement with several projects working** |

## Checked in Phase 58

Run in a test copy with disposable projects: a web app, a library, a worker, a one-shot tool, Unity, Python, an empty folder, and two made to misbehave over a port.

Audit findings fixed: two quick Starts could start two servers; Stop said "stopped" before it was; cleanup after a crash trusted old process numbers, so it could signal something unrelated; a port conflict blamed the wrong port; a page answering on the port counted as yours even if it was someone else's server; only JavaScript and static sites could run; running checks by hand spent tokens through a Claude session; old results read as current; run instructions always said npm.

Also found by these runs: quitting with a live session could hang forever behind an error box; a check started just after launch was marked interrupted by the start-up recovery; a server that ignored being stopped survived the crash cleanup.

**Gaps:** a team fix was started and watched, but never completed end to end: the test projects had no commit, so the team's copy was empty, and I couldn't commit because git is denied to me here. Python, Go and Rust detection were tested from files, and one Python start ran to its real failure (Flask isn't installed); none ran successfully. Real mouse and keys weren't used. The preview's page was fetched, not seen, because this test window can't capture that view. No hosted environment, signing or store submission is checked, and none is claimed.

## Checked in Phase 59

| Surface | Where | Found | Now | Checked |
|---|---|---|---|---|
| Settings layout | `SettingsDialog.tsx` | Three tabs; "How the team works" mixed billing, notifications and security | Claude Code, Permissions, How the team works, Notifications, Memory and history; models and effort fold away | Inspected, every page |
| Effort | `main/ipc.ts` | **Said Saved and never stored it** | Stored, and survives a restart | Test window, restart |
| Saving | `useSettings` | Whole page sent each time; a change made just before leaving was lost; a failure left only a passing toast | Only what changed; leaving still saves; "Saved" only after confirmation; failure stays on the page with Try again | Real refusal from the main process |
| Restore defaults | `settings.ts` | Said "this page", reset everything including permissions | That page only, and off when already at defaults | Test window, unit test |
| Stored settings | `readableSettings` | A damaged value could crash reading settings | That value reads as its default; every good one stays; nothing is rewritten | Real database test |
| Full access | Permissions | One click, no question | Asks first; off when your organization forbids it, and refused by the main process too | Real refusal |
| Claude Code | Settings, Home | Paths and modes first | Status, models, commands, MCP as Claude Code reports them; details under Troubleshooting | Signed in, plus simulated missing and signed out |
| MCP | Settings | Not shown anywhere | Listed with each server's reported state. **This Mac reports none, so server rows were only unit tested** | Partly |
| First run | `ConnectClaude`, `Creator` | No way forward without Claude Code; Start could create a product whose request then failed | How to install it, Check again that says if it's still missing; Start waits and your words stay | Simulated missing Claude Code |
| Open a folder | `Creator` | Worked | Unchanged | Through the page, opened and detected |
| Skills | `Skills.tsx` | Good since the Skills work | Unchanged, linked from Claude Code | Disable built-in and external, install local, restart: all kept |
| Delete, Rename | `ProjectActions`, `ProductMenu` | "Project", "validation runs" | Plain words | Inspected Delete; Rename by reading the code |
| History, Decision cards | `orchestrator.ts`, `SystemTray.tsx` | Text cut mid-word; two links run together | Cut at a word, in notifications and decision cards; links spaced | Partly |
| Time and cost | `Insights.tsx` | Listed teammates who never worked, from every team | Only who worked | Inspected |
| Performance | `Engine.tsx` | "Execution engine" | Renamed. Still tables and stat cards by design: it's the one technical page | Inspected |
| Memory | `Knowledge.tsx` | Stat cards above notes | Renamed only. **Could be calmer; not redesigned** | Inspected |
| Office preferences | `saveOfficeConfig` | Kept from the office, not Settings | Unchanged | Not retested |

**Gaps:** physical keyboard and screen reader not used; Dialog focus trap and menu arrows read or driven by synthetic events. Claude Code missing and signed out were simulated in the window, not real. The real upgrade is your own next restart; the migration was tested on a database wound back to the old version, not on your data.

## Checked in Phase 60

Rendered and inspected at 1440×900 and at the 1100×700 minimum, on a test copy with 6,000 messages and 1,000 tasks, and on a brand new product. Measured in the page: unnamed controls, contrast, sideways overflow, type sizes.

| Surface | Found | Now |
|---|---|---|
| Top bar | Stages scrolled sideways at the smallest window | The last stages step into More; nothing scrolls |
| Right click | No menu at all | Cut, Copy, Paste and Select All where they apply |
| Selecting text | Most reading text couldn't be selected | Selectable in pages, panels and dialogs; controls stay controls |
| Small targets | Links 17px tall, switches 17px | A larger invisible target; the look is unchanged |
| Preview, not running | Old capture cropped and stretched into a fragment | Whole capture, dimmed and fitted, behind the Start card |
| Result strip | Three competing columns; the status said its label twice | Title, then one status line, then actions |
| Deliveries | Discard wrapped alone on a line | Mark and Discard stay together at the end |
| Logs | Column divider stopped mid-page; Technical details floated | Full height, details at the bottom |
| Overview, new product | The first action fell below the fold at the smallest window | Picture sized to the window |
| Performance | A table scrolled sideways at the smallest window | Headers wrap; no sideways scroll |
| Memory | Fifth stat alone on its own row | The row fits them all |
| Skills | Switches had no name for a screen reader | Named by the skill |
| Words | "task(s)", "1 known limitation(s)" across results | Real plurals |
| Launch | Window opened on a purple tint before the page drew | Matches the app |

Reviewed with no change needed: Home, first run, Office, Mission Control, Decisions, Team, Operations, Command, dialogs. Contrast measured no failures; a reduced-motion rule exists.

Measured: stage changes 14–72 ms, opening a product 76 ms, heap flat after forced garbage collection (51, 53, 52 MB over 150 stage changes), Office stops rendering off its stage. No speed fix was justified.

**Gaps:** physical keyboard, mouse drag, resizing by hand and a screen reader not used. The native right-click menu can't be seen in a hidden test window, so it's unverified. The preview page itself can't be captured here. Journeys C and G with a real session weren't rerun this phase. Memory and Performance remain denser than the rest; they got layout fixes only.

## Checked in Phases 61 and 62

Real Claude Code sessions on the Max plan (no API key reported), in disposable projects. Every Claude Code permission prompt was declined, never approved; only Autopia's own "run the checks" question, plans and questions were answered. A real user who allows commands will see different session behaviour.

| Scenario | Result (real) | Time | Sessions | Prompts declined | Other stops | Checked by hand |
|---|---|---|---:|---:|---:|---|
| A: reading list, before fixes | Works; marked "Partly done" wrongly | over 20 min | 17 | 12 | 4 stuck cards, 1 question | 101 tests pass |
| A3: stopwatch, before the last fix | Works; unverified wrongly | 255 s | 3 | 4 | 1 | 19 tests pass |
| A4: unit converter, after fixes | Ready, verified | 266 s | 3 | 4 | 0 | 18 tests pass, page served |
| B: pagination on an existing API | Followed conventions | 74 s | 1 | 1 | 0 | 4 tests pass |
| B2: follow-up, DELETE route | Ready, verified, same owner | 87 s | 2 | 0 | 0 | 10 tests pass |
| C: planted bug, before fixes | Right cause, wrongly limited on rerun | 51–105 s | 2–3 | 1–2 | 0–1 | 4 tests pass, total stable |
| C5: planted bug, after fixes | Ready, verified, cause explained | 66 s | 2 | 0 | 0 | 4 tests pass, total stable |

A and A4 are different apps of different sizes, so their times are not a before and after.

Fixed: a declined command stopped finished work; parallel teammates treated each other's files as blockers; a good fix was sent for repair over "report the test output"; checks Autopia ran weren't counted by Operations, readiness or limitations; server starts counted as required checks; a review that couldn't open its screenshots created a repair task; an "author" field read as a credential; every-step-skipped was announced as ready; Autopia's own folder counted as uncommitted, marking results stale; a missing folder read as "empty"; five unused endpoints removed; Copied shown before copying; Settings said a lighter model does most work when the strongest does.

**Gaps:** nothing has run with permissions allowed. A real build failure repaired automatically was not seen: the deliberately failing request was rightly questioned instead. A parallel build, after the fix, was not rerun: later plans chose one task. MCP tools in a session, skill use in a session and Claude Code really missing were not exercised. Desktop, game and library projects were checked by detection and Operations only. Scenario A at full size was not repeated. Agents still try commands before Autopia can run them, so prompts remain on a brand-new product.

## Checked in Phase 65

Real runs through the normal request path, on the Max plan, in disposable projects; permission prompts declined.

| Project | What happened |
|---|---|
| Visually weak app, asked to look professional | Before the gate fix nobody looked at it. After: restyled, review saw 3 screenshots, 2 defects sent back once, then it ended |
| Polished bakery site, small text change | One line changed. Review found 3 specific notes (heading wrap, price alignment), kept as notes. No redesign |
| Real dead Save button, unrelated request | Caught by really clicking it, reported, not fixed uninvited |
| Canvas game, small change | Reviewed with game criteria. Feel and balance not claimed. Phone overflow reported, no longer a failure |
| JSON API | No visual checks at all, verified by tests and server |

Changed: screenshots go in the message, so looking never stops for a permission; the review runs on any product with a page, proportionately for existing ones; visual review follows what really changed; layout, real use and design review are separate evidence; an API isn't judged as a page; repairs still one round.

A dev-script expenses app with a planted dead Export button, on the final fixes: total added, no redesign, no permission prompts, dead button caught by clicking it, one real injection risk flagged. A request about how something looks now holds it to a finished standard; on its rerun the first pass needed no repair, so that stricter repair path hasn't fired yet.

**Gaps:** a review is one session's judgement of stills. Journeys beyond clicking each control, animation and feel, keyboard behaviour in desktop apps and native apps aren't judged. A dev-script app needs your check OK before it can be inspected, otherwise layout and design stay "not checked yet".

## Checked in Phase 66

Audited against the real database first. Found and fixed, all inside the existing memory:

- Every plan's shared contracts archived each other, because they share a title prefix: only the last survived in all three real projects. Fixed, and put back once per project on the next launch.
- A founder decision that shared no words with a task never reached it. Now it always does, with its own room in the prompt.
- Answers to plan questions and teammates' questions were not kept anywhere the team could read. Now they are the founder's decisions; auto mode's choices are not, and stay assumptions.
- Nothing but "always/never" was captured from messages. Stated decisions now are, conservatively; suggestions and questions are not. The founder is told each time.
- A dependency's handoff was dropped once later work touched its files (17 of 25 real handoffs were stale). It now arrives, labelled.
- Plan-agreed contracts read as "from the repository". Origins are now separate: yours, repository, plan, teammate recommendation, assumption, history.
- Decisions and architecture notes never went stale. They do now when a file or dependency they name really leaves the project.
- A follow-up replaced the goal, so the product's purpose was lost. The first request on a new project is kept.
- A secret could enter a note's key through its title. Passwords in addresses, bearer tokens and Stripe keys are now redacted too.

**Live (real Claude Code, disposable project):** a stated decision reached the next session; a mid-run decision reached the resumed session after a hard kill; one retry, no duplicate task; the older decision became history and the page changed to the newer one. The live run also caught a phrase-parsing bug that unit tests had missed.

**Real project, not by a test:** T11 and T12 in a real project resumed themselves after a restart and finished.

**Also live:** a second project's teammate, asked what currency was decided, knew nothing of the first project's decision. Removing a dependency flagged the decision naming it (no AI needed). That check first failed live: the database dropped the reason on an active note while a stand-in store in the tests kept it. Fixed, and now tested on the real database. The Memory block was checked in screenshots.

**Tests only, not seen live:** contract repair, handoffs reaching a dependent task, not asking twice, plan answers reaching the team. The live multi-task run was stopped early at the user's request. Its last state: T1 had stopped because the test script declines every permission prompt, so `npm install` could not run. The repair reaches real projects at their next restart.

**Gaps:** English only for stated decisions. File reads across sessions were measured (430 reads of 143 files) but not reduced: re-reading what a task works on is usually right.

## Checked in Phase 67

Audited against the real database. The scheduler, worktrees, serial merging and recovery held up, and no second scheduler was added. Parallel work ran in one real project (18 overlapping pairs of runs, 1 merge conflict in 24 tasks). Fixed:

- A repair was told only the end of a failed check. Test runners print failures first and a summary last, so in 4 of the 5 repair runs on the current model the agent re-ran or tried to re-run the tests just to read the error; two of those stopped for an OK. Capture now keeps the opening, and the failures are what gets passed on.
- A resolved merge conflict was merged without running the checks. It now has to pass first, with one repair; otherwise nothing merges and the branch is kept.
- A task whose dependency was skipped wasn't told, and could assume the work was there. It is told now.
- A reassignment was logged under the new owner's name ("Reassigned Ezra's … to Ezra"). It now names the previous owner.

**Measured live, disposable project:** two independent tasks ran at once, 24 s after the request. The app was hard-killed with both running; 15 s after relaunch both had resumed by themselves, with one retry run each, no duplicate tasks, 5 sessions in all including the plan, the right files, and 10 of 10 tests passing. A simple change took one work session (128 s).

**Tests only, not seen live:** the output fix in a real repair (the capture and prompt are tested on a realistic run, but no live repair has happened since), the recheck after a conflict (no test reaches this path, which only runs when a real conflict occurs), shared files waiting, dependency order, and a skipped dependency.

**Not changed, on purpose:** planned files badly under-predict what tasks touch (real tasks planned 1 to 6 files and changed 13 to 25), but conflicts stayed rare, so nothing was serialized further. Tasks that only use each other's code still run side by side: no real failure was traced to it, and holding them back would slow the parallel work that does succeed. Delegation was left alone for the same reason.

**No before/after on a whole project:** the improvements above are root-cause fixes from recorded behaviour, not a measured saving in time or tokens.

## Checked in Phase 68

Simplified, with the reasoning in `docs/SIMPLIFICATION_AUDIT.md`. Header: Overview, Office, Preview, Results, and More for Time and cost, Files, Checks, Memory and Logs. Studio, the Decision Center page, Engine, the per-product model picker and priority controls are gone; `MissionControl.tsx` now renders inside the Overview and `DecisionCenter.tsx` holds only the cards the conversation and tray use. Time and cost (`Insights.tsx`) was removed and then restored at the user's request.

A click-through of every page confirmed each can be left using what's on screen, after the user found Settings had become a dead end.

## Checked in Phase 69

Walked real projects by clicks only, counting each step. Found and fixed:

- Pressing Start with a description that had no command verb got "thanks for the summary" and built nothing. Start now decides, and so does describing what an empty project should be. Questions and greetings still get a reply.
- A reused name stopped at "already exists", with a Try again that could never work. It now takes the next free folder and leaves the old one alone.
- Every launch briefly said Claude Code couldn't be found. Nothing is reported until the check has answered.
- A page still being built read "This one doesn't run in a window". It now says the first result will appear.
- Try it needed a second press, then could ask again about a command already approved for the checks. It's one press; a command you haven't approved still asks.
- Of 121 real permission prompts, 109 were answered "Allow for this step" while "Allow once" was highlighted. The highlight now matches. Decline and the prompt itself are unchanged.
- At least 62 of those 121 began with `cd` to the folder the agent was already in, and agents were opening the organization's rules file. They are now told not to. Nothing is auto-approved.
- Permission cards say "wants to read a file" rather than "use Read".
- Results had a second box for asking for changes. It now brings up the one composer, aimed at that result.

**Measured live, disposable projects:** Try it to running took 4 s and one press. A description reached a verified result with 3 decisions: an organization rules read during planning (the planner instruction came after this run), one command, and the one-time OK to run checks. Ask for a change takes one click with the composer aimed at the result.

**Tests only, not seen live:** the planner instruction, and whether `cd` prompts drop over many tasks: the one command prompted in the walk had no `cd`, but one run isn't a rate. Not walked: a failed verification, or a real blocker, in the new interface.

## Checked in Phase 70

The office is playable. `Playground.tsx` hosts three games over the office from `office/games/`: ping pong (the existing table), foosball (a new table in all three offices, since none had one) and Hotfix, an original game in the arcade cabinets. Rules are pure and were balanced by simulating matches. `office/games/playful.ts` holds what props do when clicked. Puffy now fetches his ball when it's thrown, and gets zoomies from too many pats. Secrets: a long rally, a typed word, a cabinet code, things that run out of patience, and a rare paper plane.

**Live, through the real interface in all three offices:** each table and cabinet opens from a real click, each game ran and scored, R and Esc work, zoom keys stay with the game, switching project closes it, and every session count stayed at 0. Input was simulated pointer and key events; **no person has played these yet, so how they feel isn't verified**.

**Limits:** only the Tech Startup has Puffy, so fetch and zoomies are there alone. Teammates who play are chosen only from those not on real work, and a game hands over to Autopilot if they're called away; the live run never had one called away mid-match. No sound, on purpose.

## Checked in Phase 71

Audited first: the office already had 30+ break activities, trait-based personalities, habits, relationships, stories, reactions to real events, and daylight in the windows and lighting. A live three-minute watch showed routines already differ by person, so none of that was rebuilt. Added in `office/life.ts` and the scene: foosball in routines, replies when you click someone on a break, a teammate and sometimes Puffy watching your match, weather in the windows, six rare events, and more secrets (the clock, the record player and Puffy, the fifth fish feed, the flowering plant, a night-shift cabinet).

**Live, all three offices:** every rare event fired when forced, except Puffy's in the offices without him and the nap when nobody was resting. A teammate given work went to work, got no joke when clicked, and was left out of events. Idle CPU for the page was about 11%, 12.5% in rain, 0% with the office hidden. Session counts stayed at 0.

**Not verified:** how often events feel right over a long session, since they were forced rather than waited for; a real Claude session interrupting a break (the check used a simulated status); and restarting the app mid-event. CPU was read on a hidden test window, and the GPU process read 0, so the real total may be higher.

## Phase 72: Office customization and personal touches

| What | Where | Notes |
|---|---|---|
| Catalog and rules for what may be saved | `src/shared/officeDecor.ts` | 22 floor pieces, 10 wall pieces, 4 light colours, 4 beds, 4 toys. `sanitizeOffice` drops anything unknown or damaged. Pictures are stored as palette numbers; signs only as pixel-font letters and digits. No files, markup or code are kept. |
| Where things may stand | `src/renderer/src/office/decor.ts` | `spotProblem`, `tileProblem`, `wallProblem`, `resolveDecor`. Doors, seats, every workstation (even empty), props and routes stay clear. A saved piece that no longer fits falls back quietly. |
| Customizing | `OfficeCustomize.tsx` (`CustomizePanel`, `CustomizeStatus`), the toolbar's Customize button (the only way in) | Takes the side column. Catalog tabs: Furniture, Decor, Walls, Floors, Lighting. Pick a piece and click to place it, click a piece to change it, drag to move. Reset with undo. Esc cancels placing, then the selection, then exits. |
| Live changes | `OfficeScene.syncDecor`, `syncWall`, `syncCorner` | No rebuild: people, camera and work carry on. Anyone routed through a new piece finds another way. |
| One office per project | `officeConfig(projectId)`, `saveOfficeConfig(projectId, …)` | Saved as `office:<project>`; a project with none of its own keeps the look the app already had. Deleted with the project. |
| Puffy's corner | `Corgi.bedMoved`, `setToy`, `noticeNew`, rugs as nap spots | Tech Startup only: Studio and Lab have no dog. |
| Art | `art/decor.ts`, `art/furniture.ts` (cactus, palm), `art/corgi.ts` (toys, bed colours) | Drawn in the office's ramps; Studio and Lab recolour them through their packs. |

Also fixed: a moved beanbag used to leave people sitting on air, so seats now stay with their spot.

## Phase 75: First run

| What | Where | Notes |
|---|---|---|
| One answer to "is this Mac ready?" | `src/shared/readiness.ts` | checking, missing, outdated, broken, signed out, unconfirmed, ready. Finding Claude Code never counts as being signed in |
| Setup, in place on Home | `home/ConnectClaude.tsx` | Copyable command, re-checks when you come back to the window, cancellable sign-in, technical details folded away |
| First-run touches | `home/FirstRun.tsx`, `home/firstRunStage.ts` | Welcome on an empty Home, one office card, one link on the first Overview. Decided at launch from whether any products exist; existing users are never included |
| Interrupted start | `home/Creator.tsx` | What you wrote survives a restart, and a first request that fails to send waits in the message box |
