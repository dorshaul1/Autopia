# Claude Code in Autopia

Autopia runs the real `claude` CLI and reads what it offers from the CLI's own handshake, so commands, skills, agents, models and MCP servers added to Claude Code appear without a change here. Checked against Claude Code 2.1.235.

Two ways in:

- **Talk to the team.** Teammates plan, build in worktrees and report back. Work runs with the tools the job needs.
- **Talk to Claude Code directly.** A message starting with `/command`, or `/claude anything`, goes as written to a real session in the project folder: every tool, your own settings, and its own permission prompts. It continues the same session each time you talk to that teammate.

| Capability | In Autopia | How |
|---|---|---|
| Images, PDFs, text files | Yes | Native content blocks; works in every chat, even with no tools |
| Tools and results | Yes | Stream-json events, shown in the readable log |
| Permission prompts | Yes | Each one reaches you; Autopia never approves for you |
| Its own questions | Yes | `AskUserQuestion` becomes a card with the choices; the session waits |
| Continuing a session | Yes | `--resume`, including after you stop it |
| Skills, slash commands | Yes | Live `/` menu in the composer |
| MCP | Yes | Your configured servers load; status from `mcp_status` |
| Subagents | Yes | `--agents` for the team; all of them in direct mode |
| Plugins | Yes | Yours in direct mode; routed ones for the team |
| Streaming | Yes | Partial messages in direct chats |
| Stop | Yes | Claude Code's own interrupt, then a signal if it doesn't respond |
| Retries, compaction | Yes | Shown in the log |
| Model, effort | Yes | Settings, including extra high and max |
| Scheduling (`CronCreate`, `Monitor`, `ScheduleWakeup`) | No | Needs a session that stays open; each Autopia run ends with its turn |
| `/doctor`, `/color` | No | The CLI lists these as terminal-only |
| CLI subcommands (`claude auth`, `mcp add`, `plugin install`, `install`) | Terminal | They manage the installation; what they set up is then available here |
| Cloud, Remote Control, IDE, Chrome flags | Not exposed | Separate surfaces, not part of a project conversation |
| "Always allow" rules from a prompt | Partly | Autopia remembers per task; it doesn't write Claude Code's rules |
