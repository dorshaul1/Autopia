# Autopia engineering benchmark

Reproducible, real-world engineering scenarios. Each one is run either:

- straight through Claude Code (**direct**), or
- through the full Autopia app (**autopia**).

Either way, the result is judged by hidden, independent checks. Results and findings are in
[docs/BENCHMARK.md](../docs/BENCHMARK.md).

This is a development tool. It is not part of the app's UI or build.

## Commands

```bash
npm run bench -- list
npm run bench -- validate [scenario…]
npm run bench -- plan [scenario…] --mode direct|autopia|both [--repeat n]
npm run bench -- run [scenario…] --mode direct|autopia|both --label NAME --approve-usd N [--repeat n] [--keep]
npm run bench -- report
npm run bench -- replay
npm run bench -- memory [--legacy] [--label NAME]
npm run bench -- quality [--label NAME] [--decisions-only]
```

| Command | What it does | Cost |
|---|---|---|
| `list` | Lists the scenarios | Free |
| `validate` | Checks that every starting state fails and every reference solution passes | Free; no AI |
| `plan` | Shows the worst-case budget | Free; runs nothing |
| `run` | Runs live sessions | Paid; needs `--approve-usd` that covers the worst case |
| `report` | Summarises recorded live runs | Free |
| `replay` | Re-evaluates the check evidence in recorded app runs | Free; the app must be running |
| `quality` | Runs 7 quality decisions on the real QualityEngine, plus real visual QA in the app on 3 fixture sites (`quality/sites`). `--decisions-only` skips the visual part, which needs the app. | Free; no AI |
| `memory` | Measures project memory on real SQLite: what reaches a task's context, large-repo indexing, freshness, conflicts, isolation, restart and corruption. `--legacy` turns off request targeting. | Free; no AI |

Scenarios can be picked by id prefix (`01`), full id, or category (`refactor`).

## Safety

- **Disposable copies only.** Every run works on a fresh copy under `$TMPDIR/autopia-bench/`, and that copy
  is removed afterwards unless you pass `--keep`. The harness never removes anything outside that folder.
  It never touches your projects and never runs git in them.
- **Hidden checks stay hidden.** They are copied in only after the agent has finished, and are placed
  outside the working copy.
- **Same permissions in every mode.** All modes use Autopia's *standard* permission profile, and every
  permission prompt gets the same founder-style answer (`benchPermission` in `harness/results.ts`):
  routine commands are allowed, destructive, privileged, networked or history-rewriting ones are declined.
  Organization-managed policy still applies on top and is enforced by Claude Code itself.
- **Spending is capped:**
  - each run has its own cost and time cap;
  - `run` refuses to start unless `--approve-usd` covers the worst case;
  - `run` stops before any run that could exceed the approved amount.
- **No dependency installs.** Fixtures have no dependencies, so nothing is downloaded and no third-party
  install scripts run.
- **Agent code runs only inside the copy.** Verification runs code the agent wrote, such as its tests,
  inside the disposable copy. This is the same trust level as Autopia's own task checks.
- **Use a separate app profile.** For Autopia mode, start the app with a separate profile so that
  benchmark projects stay out of your own:

  ```bash
  AUTOPIA_USER_DATA=/tmp/autopia-bench-profile npx electron-vite dev --remoteDebuggingPort 9333
  ```

## Comparing engine versions

`AUTOPIA_ENGINE=legacy` makes the app use the engine as it was before Phase 14, so both versions can be
measured on the same scenarios. Run each against its own app profile and label:

```bash
AUTOPIA_ENGINE=legacy AUTOPIA_USER_DATA=/tmp/bench-legacy npx electron-vite dev --remoteDebuggingPort 9333
```

```bash
npm run bench -- run --mode autopia --label legacy --approve-usd 18
```

Then restart the app without the variable, and with `AUTOPIA_USER_DATA=/tmp/bench-current`, and run:

```bash
npm run bench -- run --mode autopia --label current --approve-usd 18
```

## Adding a scenario

Create `scenarios/NN-name/` containing:

- `scenario.json`: see `harness/scenarios.ts` for the fields;
- `repo/`: the starting state;
- `verify/`: the hidden checks. They run with `BENCH_REPO` and `BENCH_VERIFY` set.
- `solution/`: a reference solution, plus an optional `.delete` file listing paths to remove.

Then run `npm run bench -- validate NN`. A scenario counts only when its starting state fails and its
solution passes.
