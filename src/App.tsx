import { ThemeToggle } from "@/components/theme-toggle"
import { Wall } from "@/components/wall"

export default function App() {
  return (
    <main className="relative min-h-svh">
      <Wall />
      <ThemeToggle className="fixed top-5 right-5 z-30 sm:top-7 sm:right-7" />
    </main>
  )
}
