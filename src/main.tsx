import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { LabApp } from './lab/lab-app.tsx'

// design-lab branch: the entry mounts the experiment chosen by `?lab=<id>`.
// The original site is still here, untouched, as `?lab=wall` (src/App.tsx).
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LabApp />
  </StrictMode>,
)
