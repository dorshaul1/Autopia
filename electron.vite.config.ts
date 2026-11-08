import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Resolve everything from this file, not process.cwd(), so launchers that start
// the dev server from another directory still work.
const here = dirname(fileURLToPath(import.meta.url))
const shared = { '@shared': resolve(here, 'src/shared') }

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared },
    build: { outDir: resolve(here, 'out/main'), rollupOptions: { input: resolve(here, 'src/main/index.ts') } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared },
    build: {
      outDir: resolve(here, 'out/preload'),
      rollupOptions: { input: resolve(here, 'src/preload/index.ts'), output: { format: 'cjs', entryFileNames: '[name].cjs' } }
    }
  },
  renderer: {
    root: resolve(here, 'src/renderer'),
    resolve: { alias: shared },
    plugins: [
      react(),
      // a built app has no dev server to talk to, so its content policy doesn't mention one
      { name: 'production-csp', apply: 'build', transformIndexHtml: (html: string) => html.replace(" ws://localhost:*", '') }
    ],
    server: { port: Number(process.env.AUTOPIA_DEV_PORT) || 3000, strictPort: true },
    build: { outDir: resolve(here, 'out/renderer'), rollupOptions: { input: resolve(here, 'src/renderer/index.html') } }
  }
})
