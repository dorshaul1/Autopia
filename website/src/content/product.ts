// Every claim on the site lives here, so it can be checked in one place against docs/CAPABILITIES.md.
// Add a claim only after tracing it through the running app. If it's only in a roadmap, it doesn't go here.

export const site = {
  credit: 'Made by Dor Shaul',
  title: 'Autopia: a software company that lives on your Mac',
  description: 'Describe what you want. A team of Claude Code agents plans it, builds it, runs it to check it and brings you the result, in a pixel-art office you can watch. A macOS app that uses your own Claude Code.',
  shortPitch: 'Describe what you want. A team of Claude Code agents plans it, builds it, runs it to check it, and brings you the result, in a pixel-art office you can look around.'
}

export const story = [
  { key: 'ask', eyebrow: 'You', title: 'Say what you want, in your own words.', body: 'A sentence is enough. Autopia picks a team that suits it and starts a real project in a folder on your Mac. Bigger requests come back first as a plan for you to approve.', shot: 'flow-asked', alt: 'Autopia with a project called Tip Splitter. The request is in the conversation and Inés is shown working on it.' },
  { key: 'work', eyebrow: 'The team', title: 'Someone gets to work. You can watch, or not.', body: 'Each step runs in real Claude Code, on its own git branch. Message the team while they work and it reaches them without a restart. A prompt that needs your permission waits for you.', shot: 'flow-working-1', alt: 'The Overview page while work is under way, showing one step in progress and how long it has been running.' },
  { key: 'check', eyebrow: 'The check', title: 'They run it before they call it done.', body: 'Autopia installs, runs and opens what was built itself, because a teammate saying it works doesn’t count. Then it tells you what it could confirm, and what you should look at yourself.', shot: 'flow-overview', alt: 'A result ready to review. It reads one thing to check before accepting, with buttons to try it, review it or request a change.' },
  { key: 'try', eyebrow: 'You again', title: 'Try it right there, and ask for changes.', body: 'Web projects open in a live preview inside Autopia. Point at what’s wrong, mark it up, and send it straight back to the team. When you’re happy, accept it. It’s your code, in your folder.', shot: 'flow-preview', alt: 'The tip calculator the team built, running in Autopia’s preview next to the conversation.' }
] as const

export const capabilities = [
  { title: 'Your permission stays yours.', body: 'When Claude Code asks permission, you see a card with the exact command, and the work waits. Your organization’s Claude Code policy still applies, because Claude Code is what enforces it.' },
  { title: 'Parallel work that doesn’t collide.', body: 'Up to eight steps at once, four by default, each in its own git worktree. Work merges one step at a time, predicted conflicts get resolved by a teammate, and checks run again afterwards.' },
  { title: 'A team shaped to the job.', body: 'Six or seven specialists, depending on the company: tech leads and QA engineers, game directors and level designers, ML engineers. Their guidance changes with the kind of product you’re building.' },
  { title: 'It remembers the project.', body: 'Your decisions, accepted work, lessons from earlier runs, and a map of the code carry over from session to session, per project. You can read and edit what it knows. Interrupted work picks up after a restart.' },
  { title: 'You can see where it all went.', body: 'A conversation, every step and log, and a timeline of each teammate’s time and cost, using the figures Claude Code reports.' }
] as const

export const smallPrint = [
  'Finished work is merged into your project’s branch before you review it. Rejecting a result doesn’t revert it. Undo is a separate step, and it can be refused if later work depends on it.',
  'By default the team edits files and runs common build tools without asking. Everything else asks. You can loosen this in Settings, with a clear warning.',
  'Agents and your project’s dev servers run on your Mac, with your user’s permissions. Only the preview page is sandboxed.',
  'Checks can fail, be blocked, or not apply. When they do, the result says “unverified” rather than pretending. Live preview and visual checks are for web projects.',
  'Usage counts against your own Claude plan, or your API account if you use a key. Autopia has no spending cap. Its cost figures come from Claude Code and aren’t a bill.',
  'Autopia builds real software, but it can’t promise it will be right. You’re the founder: read what comes back.'
] as const

export const offices = [
  { id: 'startup', name: 'Tech Startup', line: 'A warm, bright software company, for web apps, services and tools.', dog: true },
  { id: 'studio', name: 'Game Studio', line: 'An indie game company, with its own roles and game-minded guidance.', dog: false },
  { id: 'lab', name: 'AI Lab', line: 'A research and engineering company, for AI and data projects.', dog: false }
] as const

export const games = [
  { id: 'pong', name: 'Ping pong', note: 'Against whoever’s free.' },
  { id: 'foosball', name: 'Foosball', note: 'The table is usually occupied.' },
  { id: 'hotfix', name: 'HOTFIX', note: 'The arcade cabinet. There’s a second one.' }
] as const

export const requirements = [
  { title: 'A Mac with Apple Silicon', body: 'The only platform built and tested so far.' },
  { title: 'Claude Code, signed in', body: 'Install Anthropic’s official CLI and sign in once. Autopia finds it and walks you through it if it’s missing. It never installs it for you.' },
  { title: 'A Claude plan or API account', body: 'Autopia uses your own. It has no account of its own, and usage limits and costs are Anthropic’s.' },
  { title: 'Git', body: 'New projects use it for branches, diffs and undo. An existing folder can skip it, but work then runs one step at a time with no line-by-line diffs or undo.' }
] as const
