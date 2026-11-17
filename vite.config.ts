import path from "node:path"
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
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
