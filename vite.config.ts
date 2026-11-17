import { cpSync } from "node:fs"
import path from "node:path"
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Sloprillion (sloprillion/) is a separate static page with no build step. The
 * dev server already serves it from the repo root at /sloprillion/; this puts
 * the same page into the build. Only the page itself is copied: the folder's
 * backend and tools stay out of the site.
 */
function sloprillionPage(): Plugin {
  const page = ["index.html", "style.css", "src"]
  let outDir = "dist"
  return {
    name: "sloprillion-page",
    apply: "build",
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir)
    },
    closeBundle() {
      const from = path.resolve(import.meta.dirname, "sloprillion")
      for (const entry of page) cpSync(path.join(from, entry), path.join(outDir, "sloprillion", entry), { recursive: true })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), sloprillionPage()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  // Pre-bundle the animation and 3D libraries the lab experiments use, so the
  // dev server does not re-optimise (and reload the page) the first time each
  // experiment is opened.
  optimizeDeps: {
    include: [
      "three",
      "@react-three/fiber",
      "@react-three/drei",
      "gsap",
      "gsap/ScrollTrigger",
      "gsap/SplitText",
      "gsap/DrawSVGPlugin",
      "gsap/CustomEase",
      "@gsap/react",
      "lenis",
      "motion/react",
    ],
  },
})
