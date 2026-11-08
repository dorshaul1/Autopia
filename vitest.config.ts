import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { configDefaults, defineConfig } from 'vitest/config'

const here = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: { alias: { '@shared': resolve(here, 'src/shared') } },
  // benchmark fixtures are node:test suites run by the benchmark harness, not part of Autopia's own tests
  test: { exclude: [...configDefaults.exclude, 'benchmark/**'] }
})
