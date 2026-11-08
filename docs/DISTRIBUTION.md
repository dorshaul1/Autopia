# Building, testing and eventually releasing Autopia

Nothing here publishes anything. There's no remote, host, certificate or release, and none is needed to work locally.

## Commands

| What | Command | Notes |
|---|---|---|
| Run the app in development | `npm run dev` | Port 3000 (`AUTOPIA_DEV_PORT` to change it) |
| Run the website | `npm run site:dev` | http://127.0.0.1:4321, separate dependencies in `website/` (`npm --prefix website install` once) |
| Build the website | `npm run site:build` | Type-checks, builds to `website/dist`, then runs `website/scripts/check-site.mjs` |
| Preview the built website | `npm run site:preview` | http://127.0.0.1:4322 |
| Build the app folder | `npm run dist:dir` | `release/mac-arm64/Autopia.app`, quickest for testing |
| Build installers | `npm run dist:mac` | `release/Autopia-<version>-mac-arm64.dmg` and `.zip` |
| Inspect the package | `npm run dist:check` | Nothing private or development-only shipped |
| Test the packaged app | `npm run dist:smoke` | Launches it with an empty data folder, starts no Claude session |
| Test first run | `npm run test:first-run` | The whole first-run journey in the packaged app, with throwaway data and home folder, and a stand-in for Claude Code. Can't bill anyone: it refuses to send a request unless the CLI it found is the stand-in |
| Offer it on the local website | `npm run release:manifest` | Writes `website/data/releases.json` (names, sizes, checksums; no paths) |
| Regenerate the icon | `npm run icons` | From `scripts/make-icon.mjs` |

Typical local release: `npm run dist:mac && npm run dist:check && npm run dist:smoke && npm run release:manifest`.

## Platforms

| Platform | Built | Launched and tested | Notes |
|---|---|---|---|
| macOS, Apple Silicon | Yes | Yes: DMG contents launched, project created, real build run, restart survived, missing-Claude path | Ad-hoc signed only |
| macOS, Intel | No | No | Probably a config change (`arch: [x64]`), then needs testing on an Intel Mac |
| Windows | No | No | **Real code work needed:** PATH splitting on `:`, no `claude.exe` lookup, `pgrep`/`lsof`, negative-PID process groups, `-ilc` shell env |
| Linux | No | No | Fewer blockers, untested. UI copy says "this Mac" throughout |

## How downloads stay truthful

`website/src/content/releases.ts` decides, and `DownloadButton.astro` is the only place that draws the action.

| Situation | What the page shows |
|---|---|
| Built site, no public address configured | "Not available to download yet". No link. `check-site.mjs` fails the build if an installer link appears |
| Dev server, verified local build present | A real download from this machine, labelled as a local build |
| Built with `AUTOPIA_RELEASE_BASE_URL=https://…` | Real links to that address, and "Not notarized" unless the build passed Gatekeeper |

An artifact counts as verified only if `release/smoke.json` passed for that exact version and `codesign --verify` passes.

The dev endpoint `/__local-downloads/<name>` serves only files named in the manifest, by exact name, GET only, from
`release/`, and exists only on the dev server (`apply: 'serve'`), bound to 127.0.0.1. It isn't a file server. (Vite's dev
server itself serves files in `website/`, such as `/package.json`, on 127.0.0.1. That's development only and contains nothing private.)

## Switching on public distribution

Nothing below is active. Each item needs an account or a decision that's yours.

**Repository:** create the remote, then add `repository` to `package.json`.

**macOS signing and notarization** (needs an Apple Developer Program membership, about $99 a year):
1. Create a Developer ID Application certificate.
2. In `electron-builder.yml`: remove `identity: '-'`, set `hardenedRuntime: true` and `notarize: true`. `build/entitlements.mac.plist` is ready, but its `disable-library-validation` should be re-checked against a real signed build.
3. Provide `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` as CI secrets, never in the repository.
4. Test on a Mac that has never run a dev build. `spctl -a -t exec` must pass; `release-manifest.mjs` then reports `publiclySigned: true`.

An ad-hoc signed build is **not** equivalent. It runs here because it was built here. Downloaded on another Mac, Gatekeeper warns or refuses, and users must allow it by hand.

**Windows signing:** a code-signing certificate (EV or Azure Trusted Signing), after the Windows work above.

**Hosting installers:** set `publish` in `electron-builder.yml` (for GitHub: `provider: github`), then build the website with `AUTOPIA_RELEASE_BASE_URL`. For GitHub Releases that's `https://github.com/<owner>/<repo>/releases/download/v<version>`. Any host with stable https URLs works; no page code changes. A starting point for CI is in `docs/examples/release.github-workflow.yml` (inactive).

**Automatic updates:** not installed. Needs `electron-updater`, a `publish` target, and signing (macOS requires it for updates). The `.zip` and `.blockmap` files are already produced for it.

**Website:** a static folder (`website/dist`), so any static host. Set `AUTOPIA_SITE_URL` at build time for canonical and absolute Open Graph links. Without it, `og:image` is relative and sharing previews won't show the image.

**Legal, your decisions:** a license, privacy statement, terms, a support contact, and a check that the wording around "Claude" and "Claude Code" fits Anthropic's brand and usage terms. An unaffiliated-with-Anthropic line is in the footer. Also confirm the app identifier `dev.autopia.desktop`, which is a placeholder for a domain you don't necessarily own.

## Launch checklist

- [x] Installer builds and launches on Apple Silicon
- [x] Package contains no source, secrets, dev paths or dev handles (`dist:check`)
- [x] Smoke test, and a real project in the packaged app
- [x] Website builds and states availability truthfully
- [ ] A person installs the DMG on a second Mac
- [ ] A real sign-out and browser sign-in with real Claude Code (tests use a stand-in)
- [ ] A person reads the website and tries the app end to end
- [ ] `test/preview42.test.ts`: decide what to do (see below)
- [ ] A real merge conflict run through the app
- [ ] Apple Developer enrolment, signing and notarization
- [ ] Repository, license, privacy statement, terms, support contact
- [ ] Anthropic brand and terms check, including the undocumented `--permission-prompt-tool` flag this depends on
- [ ] Installer hosting and `AUTOPIA_RELEASE_BASE_URL`
- [ ] Website address and `AUTOPIA_SITE_URL`
- [ ] Decide on updates (shipping without them means every fix is a manual download)
- [ ] Re-audit `docs/CAPABILITIES.md`, including the no-telemetry statement

## Security review (Phase 74)

| Area | State |
|---|---|
| Window | `contextIsolation`, `sandbox`, `webSecurity` on, `nodeIntegration` off |
| IPC | Allow-listed methods. **Changed:** installed copies now trust only their own page; `localhost` senders are only trusted in development |
| Content policy | **Changed:** built pages no longer mention a dev server, and allow embedded fonts (a real bug: the pixel font was blocked in production) |
| Navigation | New windows open only http(s) in the browser; in-app navigation is blocked. Preview views deny new windows and off-origin navigation |
| Fuses | `runAsNode`, `NODE_OPTIONS` and CLI inspect off; app loads only from its archive |
| Menu | **Changed:** installed copies have no developer tools or reload menu |
| Package | `dist:check` fails on source, tests, docs, `.env`, keys, databases, maps, machine paths, known secret shapes or dev handles |
| Credentials | None held. Claude Code keeps its own sign-in |
| Logs | **New:** `<userData>/logs/autopia.log` in installed copies (Help › Show Logs), secrets masked, size capped. Stays on your Mac |
| Instance | **New:** installed copies run one instance, so they don't share a database by accident |
| Website | Static. No backend, trackers or cookies. Build fails on local paths, dev endpoints, email addresses or banned claims |

**Remaining risks, by design:** agents and dev servers run with the user's rights; Standard allows common build tools without asking; Full skips checks; `AUTOPIA_USER_DATA` and `AUTOPIA_TEST_WINDOW` are still honoured in installed copies, because the smoke test needs them (they require local access, and grant nothing beyond it). `--remote-debugging-port` also still works on installed copies, for the same reason: anyone able to pass it can already run code as you, but consider disabling it for public builds once a signed test path exists.

**Known issue:** `test/preview42.test.ts` has an intermittent hang, so runs exclude it. It passed in one full run and timed out in others, and the cause is unknown. It covers the crash-and-restart part of live preview.
