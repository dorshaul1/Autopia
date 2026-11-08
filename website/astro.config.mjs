import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'astro/config'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Development only: lets the download button hand out installers you built on this machine.
 * It serves exactly the files named in data/releases.json, by exact name, from ../release. Not a file server:
 * no folders, no other names. It doesn't exist in production builds (`apply: 'serve'`).
 */
function localDownloads() {
  return {
    name: 'autopia-local-downloads',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__local-downloads', (req, res) => {
        const name = decodeURIComponent((req.url ?? '').split('?')[0].replace(/^\//, ''))
        const manifestPath = join(here, 'data/releases.json')
        const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { artifacts: [] }
        const known = manifest.artifacts.find((a) => a.file === name && a.verified)
        const file = join(here, '../release', basename(name))
        if (req.method !== 'GET' || !known || basename(name) !== name || !existsSync(file)) {
          res.statusCode = 404
          return res.end('Not a verified local build.')
        }
        res.setHeader('Content-Type', 'application/octet-stream')
        res.setHeader('Content-Length', String(known.bytes))
        res.setHeader('Content-Disposition', `attachment; filename="${name}"`)
        createReadStream(file).pipe(res)
      })
    }
  }
}

export default defineConfig({
  // set when a real address exists: canonical and Open Graph links become absolute (docs/DISTRIBUTION.md)
  site: process.env.AUTOPIA_SITE_URL || undefined,
  server: { host: '127.0.0.1', port: 4321 },
  devToolbar: { enabled: false },
  build: { inlineStylesheets: 'auto' },
  vite: { plugins: [localDownloads()] }
})
