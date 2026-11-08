// Where real work happens, as a small state machine. Local and deterministic: it costs no tokens, nothing waits on it,
// and people only leave their desk for a stretch of real work, so the office stays calm.

import type { RoleId } from '@shared/types'
import type { WorkDoing } from '@shared/workActivity'

export type WorkPlace = 'desk' | 'testing' | 'whiteboard'

/** Developers run tests at their desk; verifying is what QA walks over for. */
export function placeFor(role: RoleId, doing: WorkDoing | null): WorkPlace {
  if (doing === 'planning' && role === 'pm') return 'whiteboard'
  if (doing === 'testing' && role === 'qa') return 'testing'
  return 'desk'
}

/** A check that's over in a moment isn't worth the walk. */
export const SETTLE_BEFORE_LEAVING_MS = 2500
/** Once there, they stay through the gaps between commands instead of pacing back and forth. */
export const MIN_STAY_MS = 20_000

export class PlaceMachine {
  place: WorkPlace = 'desk'
  private wanted: WorkPlace = 'desk'
  private wantedSince = 0
  private arrivedAt = 0

  /** `free` is true when nothing else holds them: being idle, blocked or needed always brings them straight back. */
  next(want: WorkPlace, now: number, urgent = false): WorkPlace {
    if (want !== this.wanted) {
      this.wanted = want
      this.wantedSince = now
    }
    if (want === this.place) return this.place
    const go = () => {
      this.place = want
      this.arrivedAt = now
      return this.place
    }
    if (urgent) return go()
    if (want === 'desk') return now - this.arrivedAt >= MIN_STAY_MS ? go() : this.place
    return now - this.wantedSince >= (want === 'whiteboard' ? 0 : SETTLE_BEFORE_LEAVING_MS) ? go() : this.place
  }
}
