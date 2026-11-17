import { Suspense, useEffect, useState } from "react"

import { currentExperiment, defaultExperiment } from "./experiments"

/**
 * Root of the site: mounts the page chosen by `?lab=<id>`, or the default one.
 * There is no on-page switcher; the other pages are reached by their URLs.
 */
export function LabApp() {
  const [experiment] = useState(currentExperiment)

  useEffect(() => {
    document.documentElement.dataset.lab = experiment.id
    if (experiment.id !== "wall") {
      // The wall's light/dark tokens are its own; experiments set their palette.
      document.documentElement.classList.remove("dark")
      // The default page is titled with the name alone; the others add their own.
      document.title = experiment === defaultExperiment ? "Harrison Li" : `Harrison Li — ${experiment.title}`
    }
  }, [experiment])

  return (
    <Suspense fallback={null}>
      <experiment.Component />
    </Suspense>
  )
}
