# Engineering skills: evaluation and choices

Researched 2026-11-02 from each repository's README and file tree. Nothing was installed or run
during research. The goal is the most effective engineering system, not the largest skill collection.

## Ranking

| # | Candidate | Verdict | Why |
|---|-----------|---------|-----|
| 1 | vercel-labs/agent-skills · react-best-practices | Recommended | Small index with rules loaded on demand; React-specific; MIT. Deploy skills in the same repo are excluded. |
| 2 | vercel-labs/agent-skills · web-design-guidelines | Rejected after review | At commit 1a2c79d the SKILL.md holds no rules: it tells the agent to fetch them from the repo's `main` branch on every use. The reviewed files are not what would run. |
| 3 | addyosmani/agent-skills · debugging-and-error-recovery | Recommended | Root-cause workflow; installed as one folder, without the plugin's hooks. |
| 4 | addyosmani/agent-skills · security-and-hardening | Recommended | Routed only to security-sensitive tasks. |
| 5 | addyosmani/agent-skills · spec-driven-development | Optional | Overlaps Autopia's planning step. |
| 6 | nextlevelbuilder/ui-ux-pro-max-skill | Optional | Useful for new UIs; runs a local Python script (review before enabling). |
| 7 | obra/superpowers | Reference | Mandatory workflows (including TDD that deletes code) conflict with Autopia's scheduling and worktrees. Its debugging and evidence-before-completion ideas informed the built-in methods. |
| 8 | mattpocock/skills | Reference | Several skills are interactive and need a person in the loop. |
| 9 | Graphify-Labs/graphify | Reference (idea adopted) | Hooks, a Python toolchain and optional LLM keys. Autopia instead records relative-import relationships deterministically in its own memory index. |
| 10 | thedotmack/claude-mem | Rejected | A second memory engine with hooks on every event; it duplicates Autopia memory. |
| 11 | Leonxlnx/taste-skill | Rejected | Its README estimates 30–45 minutes and hundreds of thousands of tokens per build, and it uses network fetches. |
| 12 | affaan-m/everything-claude-code | Rejected | 314 skills plus installers, which contradicts selective loading. |
| 13 | anthropics/skills | Reference | Format reference; marked as demonstration material. |

## What is built in

Built-in methods are Autopia's own short texts, about 60–100 tokens each. Two cases add more:

- **Approved third-party skills** replace the built-in method for the same route.
- **The reviewer subagent** costs nothing unless the implementer calls it.

## Download review (2026-11-03)

| Skill | Commit | Files | SKILL.md | Scanner |
|-------|--------|-------|----------|---------|
| react-best-practices | 1a2c79d | 76 (225 KB) | 7 KB | clean |
| web-design-guidelines | 1a2c79d | 1 | 1 KB | **blocked**: loads instructions from the network at run time |
| debugging-and-error-recovery | 301b02b | 1 | 11 KB | clean |
| security-and-hardening | 301b02b | 2 | 18 KB | clean |

The first scanner missed the runtime fetch, which manual review found. A rule now catches it, and approval re-scans the files on disk.

The addyosmani skills are much longer than the built-in methods: ~2.7k and ~4.4k tokens against ~100. Enabling them is only worth it if matched runs show a gain.

## Evidence so far

**Unit tests** cover:
- routing: one primary method and at most two domain guides;
- the scanner: injection, hooks, scripts and network use;
- the import graph.

**Review pipeline:**
- A clean local skill imported with no findings and was approved.
- A planted malicious skill got three blocking findings, and approving it was refused.

**Live runs on the sample project:**
- A defect task and a retry were routed to systematic debugging.
- The run records show the reasons.
- No run has been measured with versus without a method.

**What has not been shown:** that any method improves pass rate or cost. The Skills tab's "Observed" column is observational: tasks differ, so it is not a controlled comparison. Before claiming an improvement, run matched tasks with a method enabled and disabled.
