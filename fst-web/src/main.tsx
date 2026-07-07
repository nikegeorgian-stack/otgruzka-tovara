import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/index.css'
import '@/styles/print.css'
import { FstWebRoot } from './FstWebRoot'
import { FstWebErrorBoundary } from './FstWebErrorBoundary'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FstWebErrorBoundary>
      <FstWebRoot />
    </FstWebErrorBoundary>
  </StrictMode>,
)
