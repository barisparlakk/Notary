import './polyfills'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { NotaryProvider } from './lib/notary'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <NotaryProvider>
      <App />
    </NotaryProvider>
  </StrictMode>,
)
