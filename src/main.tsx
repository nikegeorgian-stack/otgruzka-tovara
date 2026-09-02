import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/print.css'
import { installStorageQuotaGuard } from '@/lib/safeStorage'
import App from './App.tsx'

installStorageQuotaGuard()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
