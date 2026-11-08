// Where you can be inside a product: four places, and a few tools you reach for now and then. The stored place stays view,
// section and pane, so what a window remembers keeps working; this is the one map between the two.

export type Stage = 'overview' | 'office' | 'preview' | 'review' | 'logs' | 'files' | 'operations' | 'memory' | 'cost' | 'brief'
export type StageView = 'office' | 'workspace' | 'result'
export type StageSection = 'product' | 'overview' | 'activity' | 'files' | 'operations' | 'knowledge' | 'insights'
export type StagePane = 'preview' | 'changes' | 'checks' | 'all'

export interface StagePlace {
  view: StageView
  section?: StageSection
  resultPane?: StagePane
}

export const STAGE_LABEL: Record<Stage, string> = {
  overview: 'Overview',
  office: 'Office',
  preview: 'Preview',
  review: 'Results',
  logs: 'Logs',
  files: 'Files',
  operations: 'Checks',
  memory: 'Memory',
  cost: 'Time and cost',
  brief: 'Brief'
}

export const STAGE_TIP: Record<Stage, string> = {
  overview: 'What this is, what the team is doing, and what needs you',
  office: 'Watch the team at work',
  preview: 'The running product',
  review: 'What the team has delivered, and what\u2019s ready for you',
  logs: 'What each Claude Code session did, tool by tool',
  files: 'The project folder',
  operations: 'Run the project\u2019s checks and see whether it\u2019s ready to launch',
  memory: 'What the team knows about this product',
  cost: 'Where the time, money and sessions went, and who was working when',
  brief: 'What is being built and why'
}

/** In keyboard order: \u23181 to \u23184. */
export const PRIMARY_STAGES: Stage[] = ['overview', 'office', 'preview', 'review']
/** Tools, not places: useful now and then, out of the way the rest of the time. The brief opens from the Overview. */
export const MORE_STAGES: Stage[] = ['cost', 'files', 'operations', 'memory', 'logs']

export function stageOf(p: { view: string; section: string; resultPane: string }): Stage | null {
  if (p.view === 'office') return 'office'
  if (p.view === 'result') return p.resultPane === 'preview' ? 'preview' : 'review'
  if (p.view !== 'workspace') return null
  switch (p.section) {
    case 'activity':
      return 'logs'
    case 'files':
      return 'files'
    case 'operations':
      return 'operations'
    case 'knowledge':
      return 'memory'
    case 'insights':
      return 'cost'
    case 'product':
      return 'brief'
    default:
      return 'overview'
  }
}

export function placeOf(stage: Stage, reviewPane: StagePane = 'all'): StagePlace {
  switch (stage) {
    case 'overview':
      return { view: 'workspace', section: 'overview' }
    case 'office':
      return { view: 'office' }
    case 'preview':
      return { view: 'result', resultPane: 'preview' }
    case 'review':
      return { view: 'result', resultPane: reviewPane === 'preview' ? 'all' : reviewPane }
    case 'logs':
      return { view: 'workspace', section: 'activity' }
    case 'files':
      return { view: 'workspace', section: 'files' }
    case 'operations':
      return { view: 'workspace', section: 'operations' }
    case 'memory':
      return { view: 'workspace', section: 'knowledge' }
    case 'cost':
      return { view: 'workspace', section: 'insights' }
    case 'brief':
      return { view: 'workspace', section: 'product' }
  }
}
