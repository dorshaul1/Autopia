// Who gets the first-run touches, decided once at launch. Kept apart from the components so the store can call it.

import { FIRST_RUN_KEY, firstRunOnLaunch, type FirstRunStage } from '@shared/readiness'

const read = (): string | null => {
  try {
    return localStorage.getItem(FIRST_RUN_KEY)
  } catch {
    return null
  }
}
let stage: FirstRunStage = null
const listeners = new Set<() => void>()

function writeStage(next: Exclude<FirstRunStage, null>): void {
  stage = next
  try {
    localStorage.setItem(FIRST_RUN_KEY, next)
  } catch {
    // storage unavailable: the tips just come back next time
  }
  listeners.forEach((l) => l())
}

/** Called once the projects are known. Existing users get nothing stored and nothing shown. */
export function settleFirstRun(projectCount: number): void {
  stage = firstRunOnLaunch(read(), projectCount)
  if (stage) writeStage(stage)
}

export const firstRunStage = () => stage
export const finishFirstRun = () => writeStage('done')
/** From Settings: see the office tips again. */
export const replayFirstRun = () => writeStage('new')
export function onFirstRunChange(l: () => void): () => void {
  listeners.add(l)
  return () => void listeners.delete(l)
}
