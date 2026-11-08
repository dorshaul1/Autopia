// Did the code really follow the direction the team set? Measured from the source, with no AI: the promised palette
// in use, real typography, real content, motion that respects people who turn it off, and none of the giveaways of
// default AI output. Findings point at a file; taste stays with the creative review, which looks at the real screen.

import type { ProductSpec, QualityFinding } from '@shared/types'

const GENERIC_FONTS = new Set(['inter', 'arial', 'helvetica', 'helvetica neue', 'roboto', 'system-ui', '-apple-system', 'blinkmacsystemfont', 'segoe ui', 'sans-serif', 'serif', 'monospace', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'inherit', 'initial', 'var', 'times new roman', 'open sans', 'courier new', 'menlo', 'consolas', 'georgia'])
const PLACEHOLDER_HOST = /\b(placehold\.co|placeholder\.com|via\.placeholder|placekitten|picsum\.photos|dummyimage\.com|source\.unsplash\.com)\b/i
const CLICHE_GRADIENT = /#667eea|#764ba2|from-(purple|indigo|violet)-\d+\s+(via-\S+\s+)?to-(pink|purple|blue)-\d+/i

const finding = (rule: string, severity: 'high' | 'medium', message: string, fix: string, file: string | null, line: number | null, evidence: string): QualityFinding => ({ dimension: 'visual', severity, rule, message, fix, file, line, width: null, count: 1, certainty: 'verified', inScope: true, evidence })
const lineOf = (text: string, index: number) => text.slice(0, index).split('\n').length

export function directionFindings(spec: Pick<ProductSpec, 'direction' | 'design'>, files: { path: string; text: string }[]): QualityFinding[] {
  if (!spec.direction) return []
  const code = files.filter((f) => /\.(html?|css|scss|vue|svelte|m?[jt]sx?)$/.test(f.path) && !/(^|\/)(test|tests|__tests__)\/|\.(test|spec)\./.test(f.path))
  if (!code.length) return []
  const out: QualityFinding[] = []
  const said = `${spec.direction.personality} ${spec.direction.concept} ${spec.direction.standards.join(' ')} ${spec.design?.direction ?? ''} ${spec.design?.typography ?? ''}`.toLowerCase()
  for (const f of code) {
    const lorem = f.text.search(/lorem ipsum|dolor sit amet/i)
    if (lorem >= 0) out.push(finding('direction-placeholder-text', 'high', `${f.path} still has placeholder text.`, 'Write real copy in this product’s voice.', f.path, lineOf(f.text, lorem), 'lorem ipsum'))
    const host = f.text.match(PLACEHOLDER_HOST)
    if (host) out.push(finding('direction-placeholder-image', 'high', `${f.path} uses a stand-in image from ${host[0]}.`, 'Draw it in code to match the direction, or say plainly which image is still needed.', f.path, lineOf(f.text, host.index!), host[0]))
    const cliche = f.text.match(CLICHE_GRADIENT)
    if (cliche && !/purple|violet|indigo/.test(said)) out.push(finding('direction-generic-gradient', 'medium', `${f.path} uses the default purple gradient, which the direction doesn’t call for.`, 'Use the palette the direction set.', f.path, lineOf(f.text, cliche.index!), cliche[0]))
  }
  const all = code.map((f) => f.text).join('\n').toLowerCase()
  const colors = (spec.design?.colors ?? []).map((c) => c.value.toLowerCase()).filter((v) => /^#|^rgb|^hsl|^oklch/.test(v))
  const used = colors.filter((c) => all.includes(c))
  if (colors.length >= 2 && used.length === 0) out.push(finding('direction-palette-unused', 'high', 'None of the colours the direction chose appear in the code.', `Build from the chosen palette: ${colors.slice(0, 5).join(', ')}.`, null, null, `0 of ${colors.length} colours found`))
  const fonts = [...all.matchAll(/font-family\s*:\s*([^;}\n]+)/g)].flatMap((m) => m[1].split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '')))
  const real = fonts.filter((x) => x && !x.startsWith('var(') && !GENERIC_FONTS.has(x))
  const declaresVar = fonts.some((x) => x.startsWith('var('))
  if (fonts.length && !real.length && !declaresVar && !/\b(inter|arial|helvetica|roboto|system)\b/.test(said)) out.push(finding('direction-default-type', 'medium', 'The page only uses default fonts, though the direction asks for its own typography.', spec.design?.typography ? `Apply the typography chosen: ${spec.design.typography.slice(0, 120)}` : 'Apply the typography the direction chose.', null, null, [...new Set(fonts)].slice(0, 4).join(', ')))
  if (/@keyframes|\btransition\s*:|\banimation\s*:|framer-motion|\bgsap\b/.test(all) && !/prefers-reduced-motion|usereducedmotion/.test(all)) out.push(finding('direction-reduced-motion', 'medium', 'It animates, but ignores people who ask for reduced motion.', 'Add a prefers-reduced-motion alternative.', null, null, 'animation without prefers-reduced-motion'))
  const seen = new Set<string>()
  return out.filter((f) => !seen.has(f.rule + f.file) && !!seen.add(f.rule + f.file)).slice(0, 6)
}
