// Describes what's in release/ for the website: names, sizes and checksums only, never a path on this machine.
// An installer is marked verified only if the packaged-app smoke test passed for this version, and its signature holds.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const release = join(root, 'release')
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const smokePath = join(release, 'smoke.json')
const smoke = existsSync(smokePath) ? JSON.parse(readFileSync(smokePath, 'utf8')) : null
const smoked = smoke?.passed === true && smoke.version === version

let signatureHolds = false
let publiclySigned = false
const app = join(release, 'mac-arm64/Autopia.app')
if (process.platform === 'darwin' && existsSync(app)) {
  try {
    execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'ignore' })
    signatureHolds = true
  } catch {
    signatureHolds = false
  }
  try {
    // spctl accepts only Developer ID and notarized apps: an ad-hoc signature never passes here
    execFileSync('spctl', ['-a', '-t', 'exec', app], { stdio: 'ignore' })
    publiclySigned = true
  } catch {
    publiclySigned = false
  }
}

const PATTERN = new RegExp(`^Autopia-${version.replace(/\./g, '\\.')}-(mac)-(arm64)\\.(dmg|zip)$`)
const artifacts = (existsSync(release) ? readdirSync(release) : []).flatMap((file) => {
  const m = PATTERN.exec(file)
  if (!m) return []
  const path = join(release, file)
  return [
    {
      file,
      platform: `${m[1]}-${m[2]}`,
      format: m[3],
      version,
      bytes: statSync(path).size,
      sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
      verified: smoked && signatureHolds,
      publiclySigned
    }
  ]
})

mkdirSync(join(root, 'website/data'), { recursive: true })
writeFileSync(join(root, 'website/data/releases.json'), `${JSON.stringify({ version, builtAt: new Date().toISOString(), artifacts }, null, 2)}\n`)
console.log(`${artifacts.length} installer(s) for ${version}; smoke test ${smoked ? 'passed' : 'NOT passed'}; signature ${signatureHolds ? 'valid' : 'NOT valid'}; publicly signed: ${publiclySigned}`)
for (const a of artifacts) console.log(`  ${a.file}  ${(a.bytes / 1e6).toFixed(0)} MB  ${a.verified ? 'verified' : 'not verified'}`)
