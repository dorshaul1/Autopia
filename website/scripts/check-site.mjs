// Runs after every production build. Fails the build if the page breaks a promise: a dead link, missing metadata,
// a private path, a development endpoint, or a claim the product can't back up.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const dist = new URL('../dist/', import.meta.url).pathname
const html = readFileSync(join(dist, 'index.html'), 'utf8')
const problems = []
const need = (name, ok) => ok || problems.push(name)

need('one h1', (html.match(/<h1[\s>]/g) ?? []).length === 1)
need('lang', /<html[^>]+lang="en"/.test(html))
need('title', /<title>[^<]{10,}<\/title>/.test(html))
need('description', /<meta name="description" content="[^"]{50,}"/.test(html))
for (const p of ['og:title', 'og:description', 'og:image', 'og:type']) need(p, html.includes(`property="${p}"`))
need('favicon', html.includes('rel="icon"'))

// every image says what it is (an empty alt is a deliberate choice; no alt at all isn't)
for (const img of html.match(/<img\b[^>]*>/g) ?? []) need(`image without alt: ${img.slice(0, 90)}`, /\salt(=|\s|>|\/)/.test(img))

// every link goes somewhere real
const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))
for (const [, href] of html.matchAll(/\shref="([^"]+)"/g)) {
  if (href.startsWith('#')) need(`dead anchor ${href}`, ids.has(href.slice(1)))
  else if (href.startsWith('/')) need(`missing file ${href}`, existsSync(join(dist, decodeURI(href.split('?')[0]))))
}
for (const [, src] of html.matchAll(/\ssrc="(\/[^"]+)"/g)) need(`missing image ${src}`, existsSync(join(dist, decodeURI(src.split('?')[0]))))

// nothing private or development-only, anywhere in what ships
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]))
for (const f of walk(dist).filter((x) => /\.(html|js|css|json|txt|svg)$/.test(x))) {
  const text = readFileSync(f, 'utf8')
  for (const [needle, what] of [
    [homedir(), 'a local home folder'],
    ['/__local-downloads', 'the development download endpoint'],
    ['localhost', 'localhost'],
    ['127.0.0.1', 'a local address']
  ]) need(`${what} in ${f.replace(dist, '')}`, !text.includes(needle))
  need(`an email address in ${f.replace(dist, '')}`, !/[\w.+-]+@(gmail|icloud|outlook|yahoo)\.[a-z]+/i.test(text))
}

// a production page can only link an installer when a real public address was configured
const links = [...html.matchAll(/href="([^"]+\.(?:dmg|zip|exe|AppImage))"/g)].map((m) => m[1])
if (!process.env.AUTOPIA_RELEASE_BASE_URL) need('an installer link with no public release configured', links.length === 0)
for (const l of links) need(`installer link isn't https: ${l}`, l.startsWith('https://'))
if (links.length === 0) need('the no-download state must be stated plainly', html.includes('Not available to download yet'))

// claims the product can't back up (docs/CAPABILITIES.md)
const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
const banned = [/fully autonomous/i, /without you/i, /guarantee/i, /bug[- ]free/i, /cross-platform/i, /works on windows/i, /available for (windows|linux)/i, /one[- ]click install/i, /fully sandboxed/i, /no api costs/i, /\bfree forever\b/i, /10x/i, /trusted by/i, /testimonial/i, /nothing touches your code/i]
for (const b of banned) need(`banned claim ${b}: "${text.match(b)?.[0]}"`, !b.test(text))

const bytes = statSync(join(dist, 'index.html')).size
console.log(`index.html ${(bytes / 1024).toFixed(0)} KB; ${links.length} installer link(s)`)
if (problems.length) {
  console.error(`site check failed:\n  ${problems.join('\n  ')}`)
  process.exit(1)
}
console.log('site check passed')
