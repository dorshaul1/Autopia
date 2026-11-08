import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './design/tokens.css'
import './design/primitives.css'
import './styles.css'
import { actions, store } from './store'

// Dev-only handle for scripted UI checks.
if (import.meta.env.DEV) Object.assign(window, { __store: store, __actions: actions })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
