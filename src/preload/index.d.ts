import type { AutopiaApi } from '../shared/ipc'

declare global {
  interface Window {
    autopia: AutopiaApi
  }
}

export {}
