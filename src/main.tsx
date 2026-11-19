import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { LabApp } from './lab/lab-app.tsx'
import { countVisit } from '../sloprillion/src/visits.js'

// One anonymous count per browser per day, so the owner can see how many
// people open the site and where they came from. No cookie, no id: see
// sloprillion/src/visits.js. The numbers are at /sloprillion/stats.html.
countVisit('https://7cw2o2ymfzusys5clfsg3c6u5m0ncfwu.lambda-url.us-west-2.on.aws', 'site')

// design-lab branch: the entry mounts the experiment chosen by `?lab=<id>`.
// The original site is still here, untouched, as `?lab=wall` (src/App.tsx).
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LabApp />
  </StrictMode>,
)
