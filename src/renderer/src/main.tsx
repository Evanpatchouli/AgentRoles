import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

try {
  const stored = window.localStorage.getItem('agentroles.theme')
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const initial =
    stored === 'light' || stored === 'dark' ? stored : prefersDark ? 'dark' : 'light'
  document.documentElement.dataset.theme = initial
  document.documentElement.style.colorScheme = initial
} catch {
  /* localStorage can be unavailable in restricted contexts */
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
