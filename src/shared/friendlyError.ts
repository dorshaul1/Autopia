// What went wrong, in words you can act on. Anything unrecognized stays as it is: a real message beats a
// vague one. The original is kept for the details.

const RULES: [RegExp, string][] = [
  [/auth login/i, 'Sign-in didn’t finish. Try again, or run claude in a terminal and sign in there.'],
  [/Claude Code is not installed/i, 'Claude Code isn’t installed yet. Home shows how to set it up.'],
  [/Not logged in|Please run \/login|Invalid API key|authentication_error|OAuth token has expired/i, 'Claude Code isn’t signed in. Sign in on Home, or run claude in a terminal, then try again.'],
  [/Failed to start Claude Code|spawn .*claude.*ENOENT/i, 'Claude Code couldn’t start. Check that it still runs in a terminal, then try again.'],
  [/xcode-select|spawn git ENOENT|git: command not found/i, 'Your team needs Git, and this Mac doesn’t have it yet. Run xcode-select --install in a terminal, then try again.'],
  [/Unknown method/i, 'Autopia was updated while running. Restart it to finish the update.'],
  [/ENOENT.*(lstat|stat|scandir|open)\b|\b(lstat|scandir)\b.*ENOENT/i, 'That file or folder isn’t there any more.'],
  [/ENOSPC/i, 'Your disk is full. Free up some space and try again.'],
  [/EACCES|EPERM/i, 'Autopia isn’t allowed to write there. Choose another folder or check its permissions.'],
  [/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|ECONNRESET|network/i, 'That needs the network, and it couldn’t be reached. Check your connection and try again.'],
  [/detached HEAD/i, 'This repository isn’t on a branch. Check out a branch, then try again.'],
  [/not a git repository/i, 'This folder isn’t a Git repository yet.'],
  [/merge conflict|CONFLICT/, 'Git found conflicting changes. Ask the team to resolve them.'],
  [/uncommitted|local changes would be overwritten/i, 'You have uncommitted changes in this folder. Commit or stash them, then try again.'],
  [/SQLITE|NOT NULL constraint/i, 'Autopia couldn’t save that. Nothing was lost; try again, and restart Autopia if it repeats.'],
  [/^(git |fatal: )/i, 'Git couldn’t finish that. Try again, or ask the team to look into it.']
]

export function friendlyError(raw: string): { message: string; detail: string | null } {
  const text = raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, '').trim()
  const rule = RULES.find(([re]) => re.test(text))
  return rule ? { message: rule[1], detail: text } : { message: text, detail: null }
}

/** Cut to size at a word, and say it was cut. Half a word reads like a bug. */
export function clip(text: string, max: number): string {
  const t = text.trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/** "1 task", "2 tasks". */
export const plural = (n: number, thing: string) => `${n} ${thing}${n === 1 ? '' : 's'}`
