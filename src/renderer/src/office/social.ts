// The office's social memory: one shared instance of the relationships (familiarity between
// colleagues, and with the dog), read by the scene and by the employee profile. Kept in this
// browser's storage so friendships carry over between sessions; small and bounded.

import { Relationships } from './personality'

const SOCIAL_KEY = 'autopia:office-social:v1'

export const relationships: Relationships = (() => {
  try {
    return Relationships.fromJSON(JSON.parse(localStorage.getItem(SOCIAL_KEY) ?? 'null'))
  } catch {
    return new Relationships()
  }
})()

export function saveRelationships(): void {
  try {
    localStorage.setItem(SOCIAL_KEY, JSON.stringify(relationships))
  } catch {
    // storage unavailable: friendships last for this session only
  }
}
