// Logs for installed copies: there's no terminal to read, so what the app says goes to a small file in its data
// folder (Help › Show Logs). Secrets are masked on the way out. In development the console stays as it was.

import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { format } from 'node:util'
import { app, dialog } from 'electron'
import { redact } from './memory/secrets'

const MAX_BYTES = 2 * 1024 * 1024

export const logFolder = () => join(app.getPath('userData'), 'logs')

export function startLogging(): void {
  process.on('uncaughtException', (err) => console.error('[uncaught]', err))
  process.on('unhandledRejection', (err) => console.error('[unhandled rejection]', err))
  if (!app.isPackaged) return
  const dir = logFolder()
  const file = join(dir, 'autopia.log')
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    return
  }
  const write = (level: string, args: unknown[]) => {
    try {
      // one old file is kept: it never grows without bound
      if ((statSync(file, { throwIfNoEntry: false })?.size ?? 0) > MAX_BYTES) renameSync(file, `${file}.1`)
      appendFileSync(file, `${new Date().toISOString()} ${level} ${redact(format(...args))}\n`)
    } catch {
      // logging must never stop the app
    }
  }
  for (const level of ['log', 'info', 'warn', 'error'] as const) {
    const original = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      write(level, args)
      original(...args)
    }
  }
  console.info(`[app] Autopia ${app.getVersion()} on ${process.platform} ${process.arch}`)
}

/** When the app can't even open its data, say so plainly rather than vanish. */
export function fatal(title: string, err: unknown): void {
  console.error(`[fatal] ${title}`, err)
  dialog.showErrorBox(title, `${err instanceof Error ? err.message : String(err)}\n\nDetails are in ${logFolder()}`)
}
