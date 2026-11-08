// What a real specialist would bring to this piece of work: professional methods, each with how you'd know it was
// done well. Knowledge only: having a skill installed is never
// taken as proof of anything. Chosen per task, smallest set that fits, so a small fix carries none of it.

import type { Task, TaskKind } from '@shared/types'
import type { OfficeType } from '@shared/offices'

export interface Capability {
  id: string
  name: string
  kinds: TaskKind[]
  offices?: OfficeType[]
  /** Words that say this work needs it. */
  when: RegExp
  /** How a specialist works: short, because it's paid for on every turn it's loaded. */
  method: string
  /** How to tell it's done well. Checked against the real result, not this text. */
  verify: string
  /** Libraries or tools it may justify; never a requirement. */
  tools?: string[]
}

export const CAPABILITIES: Capability[] = [
  { id: 'art-direction', name: 'Art direction', kinds: ['design'], when: /\b(landing|home ?page|hero|brand|marketing|visual language|look and feel|art direction|identity|redesign|polish\w*|premium|beautiful|editorial)\b/i, method: 'Start from one concrete idea drawn from this product\'s world, not from a layout template. Make a few decisions that could not belong to a competitor, and let them shape composition, not just colour. Commit to asymmetry, scale contrast or an unusual grid where it serves the idea. No centred hero with three feature cards unless you can say why it\'s right here.', verify: 'Remove the name and logo: could it be anyone\'s product? If yes, it isn\'t finished.' },
  { id: 'typography-layout', name: 'Typography and layout', kinds: ['design'], when: /\b(typograph\w*|font|layout|page|landing|hero|section|editorial|design system|tokens?|styles?)\b/i, method: 'Choose a type pairing with a reason and set a real scale with deliberate jumps, line lengths of 45 to 75 characters and tuned leading. Build hierarchy with size, weight and space before colour. Keep one spacing scale. Load fonts with font-display swap and only the weights used.', verify: 'Squint at it: the order of importance is still obvious. Headlines wrap well at every width.' },
  { id: 'product-ux', name: 'Product UX', kinds: ['design', 'code'], when: /\b(flow|journey|onboarding|form|checkout|dashboard|navigation|settings|wizard|sign ?up|ux|usab\w*)\b/i, method: 'Design from the job the person came to do: the next action is always obvious, defaults are good, input is kept on error, and destructive actions can be undone or are confirmed. Remove steps before adding features. Write interface text as plain, specific sentences.', verify: 'Walk the main journey with real data, including a mistake, and nothing is lost or confusing.' },
  { id: 'interface-states', name: 'Complete interface states', kinds: ['design', 'code'], when: /\b(list|table|dashboard|form|search|fetch|load\w*|data|feed|cards?|api)\b/i, method: 'Every data view has designed loading, empty, error and success states and real long-content behaviour. Empty states say what to do next. Errors say what happened and offer a way forward. Keep layout stable while loading.', verify: 'Force each state and it looks intentional. Very long and very short content both hold up.' },
  { id: 'motion', name: 'Motion and interaction', kinds: ['design'], when: /\b(animat\w*|motion|transition|scroll\w*|parallax|micro-?interaction|hover|interactive|storytelling)\b/i, method: 'Motion explains what changed or where things went; everything else stays still. Use transform and opacity, 120 to 300ms for interface feedback, and consistent easing. Respect prefers-reduced-motion with a real alternative. Reach for a library only for what CSS cannot do well, such as sequenced scroll storytelling.', verify: 'With reduced motion on, nothing is lost. No layout shift, and it stays smooth on a mid-range laptop.', tools: ['CSS transitions first', 'Motion or GSAP only when justified'] },
  { id: 'visual-assets', name: 'Original visual assets', kinds: ['design'], when: /\b(image\w*|photo\w*|illustrat\w*|icon\w*|logo|hero|sprite|art|visual|gallery|landing|brand)\b/i, method: 'Decide which assets the product really needs and where they sit before making any. Keep them one family: same palette, line, lighting. Make them real, sized for their place, with responsive loading and alt text. No grey boxes, no lorem ipsum, no hotlinked stock.', verify: 'Every asset has a purpose, loads fast and belongs with the others.' },
  { id: 'responsive-accessible', name: 'Responsive and accessible', kinds: ['design', 'code'], when: /\b(responsive|mobile|accessib\w*|a11y|keyboard|page|ui|interface|component|layout|form)\b/i, method: 'Compose for each width rather than shrinking one layout. Semantic elements first; everything works by keyboard with a visible focus; contrast meets WCAG AA; targets are at least 44px on touch; images have useful alt text.', verify: 'Works at 375, 768 and 1280 wide with no sideways scrolling, and fully by keyboard.' },
  { id: 'frontend-engineering', name: 'Frontend engineering', kinds: ['code', 'design'], when: /\b(react|vue|svelte|component|state|store|frontend|client|spa|bundle|render\w*)\b/i, method: 'Keep state as close to its use as possible and derive what you can. Components have one job and clear props. Split code at route boundaries, and never block first paint on data. Follow the project\'s existing patterns.', verify: 'No needless re-renders on typing. A fast first paint and a small bundle for what it does.' },
  { id: 'api-design', name: 'API design', kinds: ['code'], when: /\b(api|endpoint|route|rest|graphql|server|backend|webhook|service)\b/i, method: 'Design from the caller: consistent resource names, correct status codes, one error shape, validated and bounded input, pagination on lists, idempotent retries where money or data is at stake. Timeouts on everything external.', verify: 'Bad input gets a clear 4xx, never a 500. Tests cover the failure paths, not just the happy one.' },
  { id: 'data-modeling', name: 'Data modelling', kinds: ['code'], when: /\b(database|schema|migrat\w*|model|sql|postgres|sqlite|table|persist\w*|storage)\b/i, method: 'Model the real rules: constraints in the database, not just the app. Index for the actual queries. Migrations are forward-safe and reversible. No N+1 queries. Transactions where several writes must succeed together.', verify: 'Invalid states can\'t be stored. Migrating an existing database keeps its data.' },
  { id: 'performance', name: 'Performance', kinds: ['code', 'design'], when: /\b(performance|slow\w*|speed|fast\w*|latency|optimi[sz]\w*|bundle size|memory leak|load time|lighthouse|n\+1|profil\w*|jank|fps)\b/i, method: 'Measure before changing anything: find the real bottleneck with a profile or a timing, change that one thing, and measure again. Prefer doing less work over caching it; never trade away correctness for speed.', verify: 'A before and after measurement of the same thing shows the improvement, and behaviour is unchanged.' },
  { id: 'reliability', name: 'Reliability', kinds: ['code'], when: /\b(queue|worker|job|retry|cron|scal\w*|reliab\w*|concurren\w*|cache|deploy|production|observab\w*)\b/i, method: 'Assume every external call fails or is slow. Bound retries with backoff, make jobs safe to run twice, shut down gracefully, and log what you\'d need at 3am, with no secrets in it.', verify: 'Kill a dependency mid-request: it fails clearly and recovers on its own.' },
  { id: 'game-feel', name: 'Game feel', kinds: ['code', 'design'], offices: ['studio'], when: /\b(gameplay|controls?|movement|player|core loop|juice|combat|physics|collision|game)\b/i, method: 'Input answers on the very next frame. Add anticipation, impact and recovery: small screen shake, hit-stop, particles and sound cues, tuned from one config. Be generous with coyote time, input buffering and hitboxes in the player\'s favour. Find the fun in the core loop before adding content.', verify: 'Playing for a minute with no goal is already satisfying. A death always feels fair.' },
  { id: 'level-progression', name: 'Levels, progression and balance', kinds: ['code', 'design'], offices: ['studio'], when: /\b(level|wave|progress\w*|difficulty|balanc\w*|economy|upgrade|management|resource|spawn|tuning|sim\w*)\b/i, method: 'Teach by play, one new idea at a time, then combine them. Pace tension and release. For systems and management games, give every choice a real trade-off and keep feedback loops readable; model the economy with numbers and test it with a seeded simulation.', verify: 'A seeded run shows no dominant strategy and no dead end. A new player gets it without text.' },
  { id: 'game-art', name: 'Game art direction', kinds: ['design'], offices: ['studio'], when: /\b(sprite|art|hud|animation|tileset|screen|menu|visual|overlay)\b/i, method: 'One consistent style: palette, pixel density or line, and silhouette. Readability beats detail, so the player and hazards pop at a glance. Animate state changes. The HUD stays out of the action and matches the world.', verify: 'A paused screenshot shows what\'s dangerous and what\'s yours at a glance.' },
  { id: 'ai-evaluation', name: 'AI evaluation and experiments', kinds: ['code', 'qa'], offices: ['lab'], when: /\b(eval\w*|experiment|prompt|model|llm|benchmark|score|accuracy|agent)\b/i, method: 'Define what good means before tuning: a versioned evaluation set with hard cases, a score, and a baseline to beat. Change one thing at a time and record it. Seed everything you can.', verify: 'The same inputs reproduce the same score, and the set includes cases it should refuse or fail.' },
  { id: 'data-quality', name: 'Data quality', kinds: ['code'], offices: ['lab'], when: /\b(data|dataset|pipeline|etl|ingest|csv|clean\w*|feature|embedding|rag|index\w*)\b/i, method: 'Validate at the boundary and quarantine bad rows rather than dropping them silently. Pipelines are re-runnable with recorded lineage. Check for leakage between training and test data.', verify: 'A corrupted input is caught and reported, and a re-run changes nothing.' },
  { id: 'real-content', name: 'Real content', kinds: ['design', 'code'], when: /\b(copy|content|landing|home ?page|about|pricing|menu|catalog\w*|products?|testimonial\w*|story|brand)\b/i, method: 'Write as someone who knows this business: specifics a real visitor needs, in its own voice, with nothing that could be pasted onto a competitor. Take names, prices and facts from the shared content; each item gets its own words. Fictional reviews, numbers and logos are labelled as sample or left out. Never state real customers, press, awards or certifications nobody gave you.', verify: 'Read it aloud as a customer: every sentence tells you something, and nothing contradicts another screen.' },
  { id: 'coherent-data', name: 'Coherent sample data', kinds: ['code', 'design'], when: /\b(seed|sample|demo data|mock|dashboard|chart\w*|report\w*|analytics|metrics?|kpi|stats?)\b/i, method: 'One small world: believable people, projects and dates that refer to each other, with messy realistic variety. Figures on screen are calculated from that data, never typed in, so they change when it does. Label it as sample, and make an empty start look intentional.', verify: 'Add a record and the totals move. Totals match the rows beneath them. Clearing the data leaves a useful screen.' },
  { id: 'game-content', name: 'Game content and loop', kinds: ['code', 'design'], offices: ['studio'], when: /\b(game|loop|level|wave|stage|enemy|enemies|world|score|win|lose|upgrade|weapon\w*|boss)\b/i, method: 'Finish the loop first: title, play, win or lose, retry without reloading. Then give it variety: several enemy, item or stage types that change how you play, a difficulty that develops, and named things that fit the world. Show progress and the reason to continue.', verify: 'Lose on purpose and restart in one action. The second minute differs from the first.' },
  { id: 'ai-behaviour', name: 'Trustworthy AI behaviour', kinds: ['code', 'design'], offices: ['lab'], when: /\b(chat|assistant|prompt|generate\w*|model|llm|agent|summar\w*|answer\w*)\b/i, method: 'Make input and output obvious, with examples that really work. Handle empty input, too much input, a slow model and a failed one, each with its own message. Say what is generated and how far to trust it. With no key, say so or run a clearly labelled canned demo; never connect a paid service silently.', verify: 'Try each failure: the message says what happened and what to do. Nothing canned passes as a live result.' },
  { id: 'qa-journeys', name: 'Real user journeys', kinds: ['qa'], when: /./, method: 'Test as a person would: every promised journey end to end in the running product, then a mistake, a reload mid-way, an empty start and a very long input. Check that names, prices and numbers agree across screens. Report what you saw, with steps to reproduce. A defect is a real difference from what was asked, not a preference.', verify: 'Every defect has steps that reproduce it.' }
]

export const LIMIT: Record<Task['size'], number> = { s: 1, m: 3, l: 3 }

/**
 * The smallest set that fits, or none. Words in the title count most: a step about the hero needs art direction;
 * one that merely mentions a page doesn't. Repairs carry none, because they already have their failure to work from.
 */
export function selectExpertise(x: { task: Pick<Task, 'title' | 'description' | 'kind' | 'size'>; office: OfficeType; purpose: string; direction?: string; off?: Set<string> }): Capability[] {
  if (x.purpose !== 'work') return []
  const scored = CAPABILITIES.filter((c) => !x.off?.has(c.id) && c.kinds.includes(x.task.kind) && (!c.offices || c.offices.includes(x.office))).map((c) => {
    const inTitle = (x.task.title.match(new RegExp(c.when, 'gi')) ?? []).length
    const inText = (x.task.description.match(new RegExp(c.when, 'gi')) ?? []).length
    // a product with a set direction is judged on carrying it out, so its makers always bring the craft for that
    const craft = x.direction && x.task.size !== 's' ? (x.task.kind === 'design' && ['art-direction', 'typography-layout'].includes(c.id) ? 2 : c.id === 'motion' && /motion|animat|transition|scroll/i.test(x.direction) ? 1 : 0) : 0
    return { c, score: inTitle * 3 + Math.min(inText, 3) + (c.offices ? 1 : 0) + craft }
  })
  return scored
    .filter((s) => s.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, LIMIT[x.task.size])
    .map((s) => s.c)
}

/** The words that really made this one fit, for showing later. A direction-only pick says so. */
export function expertiseWhy(c: Capability, task: { title: string; description: string }): string {
  const hits = [...new Set(`${task.title}\n${task.description}`.match(new RegExp(c.when, 'gi'))?.map((w) => w.toLowerCase()) ?? [])].filter((w) => w.trim()).slice(0, 2)
  return hits.length ? `the task mentions ${hits.map((w) => `“${w}”`).join(' and ')}` : 'the product’s direction calls for it'
}

/** Image generation is only ever used if one's really connected, and the agent says what it did either way. */
export function expertisePrompt(list: Capability[], imageTools: string[]): string {
  if (!list.length) return ''
  const lines = list.map((c) => `- ${c.name}: ${c.method} Done well means: ${c.verify}${c.tools ? ` (${c.tools.join('; ')})` : ''}`)
  if (list.some((c) => c.id === 'visual-assets' || c.id === 'game-art')) {
    lines.push(imageTools.length ? `- Image generation is available through ${imageTools.join(', ')}. Use it only for assets the direction calls for, and say which you generated.` : '- No image generation is available here. Draw what you can in code (SVG, CSS, canvas) to a high standard, use type and colour for the rest, and say plainly in your summary which images a real photo or illustration should replace. Never call anything generated or photographed if it wasn\'t.')
  }
  return `How a specialist approaches this (selected for this step):\n${lines.join('\n')}`
}

export const EXPERTISE_ON = process.env.AUTOPIA_EXPERTISE !== 'off'

export interface DesignGap {
  severity: 'high' | 'medium'
  message: string
  fix: string
}

export const DESIGN_REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['distinctive', 'generic', 'gaps'],
  properties: {
    distinctive: { type: 'boolean', description: 'Would this be recognisable as this product with its name removed?' },
    generic: { type: 'array', maxItems: 5, items: { type: 'string' }, description: 'Specific things on screen that read as template or AI defaults.' },
    gaps: {
      type: 'array',
      maxItems: 6,
      items: { type: 'object', additionalProperties: false, required: ['severity', 'message', 'fix'], properties: { severity: { type: 'string', enum: ['high', 'medium'] }, message: { type: 'string' }, fix: { type: 'string' } } }
    }
  }
}

/** Reviewing what's really on screen against what was promised. Actionable, not taste: new features aren't findings. */
const LOOK_FOR: Record<string, string> = {
  game: 'This is a game. From these stills judge what a player can see: is it clear what to do, is the state readable, is there visible feedback? You can\'t judge feel or balance from a picture, so don\'t claim to.',
  desktop: 'This is a desktop app. Judge navigation, layout, density and whether it feels made for a desktop window rather than a web page.',
  default: 'Judge hierarchy, type, spacing, alignment, colour and contrast, whether the primary action is obvious, and empty or error states if they show.'
}

/** Words that make a request about the product's appearance. */
export const ABOUT_LOOKS = /\b(look\w*|design\w*|professional|polish\w*|ugly|rough|style\w*|restyl\w*|beautiful|pretty|ui|ux|visual\w*|redesign\w*)\b/i

/** Two honest modes: a new product against the direction it promised, or a change to a product that already exists, where the job is not to redesign it. */
export function designReviewPrompt(x: { direction: string | null; asked: string; type: string }): string {
  return [
    'You are the creative director looking at what this product really looks like. The attached images are real screenshots of it, at different widths.',
    '',
    x.direction ? `The direction it promised:\n${x.direction}` : `This is an existing product and the team was asked:\n${x.asked.slice(0, 600)}`,
    '',
    LOOK_FOR[x.type] ?? LOOK_FOR.default,
    '',
    'Judge the screenshots, not the code. Every gap names what you can see and where, in concrete terms; "could be more polished" is not a gap. A strong result gets no gaps: don\'t invent any, and don\'t propose redesigning something that works.',
    x.direction
      ? 'High means it visibly breaks the direction or looks unfinished: a broken layout, placeholder content, unreadable text, a generic template where the direction promised something specific, a promised essential plainly missing, or facts that contradict each other between screens. Medium is a real improvement worth making.'
      : ABOUT_LOOKS.test(x.asked)
        ? 'The request was about how it looks, so the result has to look finished. High means a visible breakage or something that still reads as unfinished: an unlabelled input with nothing saying what goes in it, a blank empty state, no clear hierarchy, default-looking controls. Medium is a further improvement. Judge the result, not how much it improved.'
        : 'High is only for a visible breakage in what was asked for: a broken layout, unreadable text, a control that can\'t be reached. Weaknesses elsewhere are medium, and they are notes for the founder, not work.',
    'Give a concrete fix for each. If an image didn\'t arrive or can\'t be read, return no gaps and say so in generic.'
  ].join('\n')
}
