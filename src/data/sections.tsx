import type { LucideIcon } from "lucide-react"
import {
  ArrowUpRight,
  FileDown,
  FlaskConical,
  FolderGit2,
  ScrollText,
  User,
} from "lucide-react"

import { Card, Kicker, Prose, Stat } from "@/components/panel-bits"
import { CoverflowCarousel } from "@/components/ui/coverflow-carousel"

function A({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-accent-soft underline-offset-4 transition-colors hover:text-accent hover:underline"
    >
      {children}
    </a>
  )
}

const aboutSlides = [
  { src: "/files/profile_pic.jpeg", alt: "Harrison Li" },
  { src: "/files/20260414_020958_104E49.jpeg", alt: "Poolside at a swim meet" },
  { src: "/files/20260505_233346_1E2296.jpeg", alt: "With a friend at a reception" },
  { src: "/files/IMG_0119.jpeg", alt: "In the crowd at a music festival" },
  { src: "/files/IMG_1565.jpeg", alt: "At Stranger Things: The First Shadow" },
  { src: "/files/IMG_5693.jpeg", alt: "Hotpot night with friends" },
  { src: "/files/IMG_6382.jpeg", alt: "Under the heart arch at the FIFA fan festival" },
]

export type Section = {
  id: string
  label: string
  /** Short line shown on the tile face. */
  tagline: string
  icon: LucideIcon
  /** Rendered inside the expanded panel body. */
  body: () => React.ReactNode
}

/* ── sections ───────────────────────────────────────────────────────────────*/

export const sections: Section[] = [
  {
    id: "about",
    label: "About Me",
    tagline: "CS + Data Science @ Berkeley",
    icon: User,
    body: () => (
      <div className="flex h-full flex-col">
        <Prose>
          <div className="max-w-[62ch] space-y-4">
            <p>
              Hi! I'm an undergraduate at <strong>UC Berkeley</strong> studying
              Computer Science and Data Science. My interests span agent evals,
              reinforcement learning, audio processing, and software engineering.
            </p>
            <p>
              Currently, I'm building <A href="https://lyrnmusic.com">Lyrn AI</A>,
              the only ai-native music VLE. I also do speech AI research at{" "}
              <A href="https://bair.berkeley.edu">BAIR</A> in the{" "}
              <A href="https://people.eecs.berkeley.edu/~gopala/">
                Berkeley Speech Group
              </A>{" "}
              in collaboration with UCSF. I work primarily on evals, of which I've
              published research at NeurIPS and Interspeech.
            </p>
            <p>I like swimming, piano, and porter robinson.</p>
          </div>
        </Prose>

        <CoverflowCarousel
          className="mt-auto"
          slides={aboutSlides}
          cardWidth="clamp(110px, 14vw, 170px)"
          label="photo carousel"
        />
      </div>
    ),
  },
  {
    id: "projects",
    label: "Projects",
    tagline: "Things I've shipped",
    icon: FolderGit2,
    body: () => (
      <div className="flex h-full flex-col">
        <Kicker>Selected work</Kicker>
        <div className="grid flex-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Card
            title="Vigil AI"
            meta="V-JEPA 2 · NanoBanana · SkyDeck pitch"
            image="/files/vigil_cover.png"
            links={[
              { label: "Demo", href: "https://www.youtube.com/watch?v=sEYoF7deqz8" },
            ]}
          >
            A secure patient-monitoring platform for nurses. A world model watches for
            large state deltas and only then wakes a heavier vision model for full-context
            capture — falls and critical events surface to staff and family through
            separate interfaces.
          </Card>
          <Card
            title="Santé"
            meta="Next.js · FastAPI · openSMILE · TreeHacks"
            image="/files/sante_cover.png"
            links={[
              { label: "Devpost", href: "https://devpost.com/software/sante-o5uv9q" },
              { label: "GitHub", href: "https://github.com/AyanJhunjhunwala/sante" },
              { label: "Demo", href: "https://www.youtube.com/watch?v=Tf4Zh0f2TcI" },
            ]}
          >
            Multi-agent voice intelligence that pulls acoustic biomarkers and
            phoneme-level disfluency signals out of live patient calls, parallelizing
            transcription, acoustic analysis, and WFST phoneme extraction on serverless
            GPUs.
          </Card>
          <Card
            title="BeWear"
            meta="Elasticsearch · Agentic · CalHacks"
            image="/files/bewear_cover.jpg"
            links={[
              { label: "Devpost", href: "https://devpost.com/software/bewear" },
              { label: "GitHub", href: "https://github.com/haribary/ethical-source" },
              { label: "Demo", href: "https://www.youtube.com/watch?v=apDW__GB-SA" },
            ]}
          >
            Visual clothing-brand identification with ethical scoring across
            sustainability, labor, and transparency — plus an agentic pipeline that does
            real-time greenwashing detection over web search.
          </Card>
        </div>
        <p className="mt-6 font-mono text-[0.7rem] tracking-wide text-muted">
          + more in the pipeline — this grid grows.
        </p>
      </div>
    ),
  },
  {
    id: "research",
    label: "Research",
    tagline: "BAIR · Berkeley Speech Group",
    icon: FlaskConical,
    body: () => (
      <div className="grid h-full gap-8 lg:grid-cols-[1fr_1.5fr]">
        <div className="flex flex-col">
          <Kicker>Current work</Kicker>
          <Prose>
            <p>
              I'm a researcher at <strong>BAIR</strong> with the Berkeley Speech Group,
              advised by Prof. Gopala Anumanchipalli. My work focuses on{" "}
              <strong>dynamic agents for speech-language disorder screening</strong>, in
              partnership with UCSF.
            </p>
          </Prose>
          <div className="mt-6 space-y-3">
            <Stat k="Advisor" v="Gopala Anumanchipalli" />
            <Stat k="Partner" v="UCSF Memory & Aging Center" />
          </div>
        </div>
        <div className="flex flex-col">
          <Kicker>Publications</Kicker>
          <div className="flex flex-1 flex-col gap-4 [&>*]:flex-1">
            <Card
              title="HASS: Hierarchical Simulation of Logopenic Aphasic Speech for Scalable PPA Detection"
              meta="Preprint 2025 · Project lead"
              links={[{ label: "arXiv", href: "https://arxiv.org/abs/2603.26795" }]}
            >
              A clinically grounded simulation framework for lvPPA that systematically
              models semantic, phonological, and temporal deficits at varying severity,
              sidestepping the data scarcity that limits clinical speech models.
            </Card>
            <Card
              title="Limits of Emergent Reasoning of LLMs in Agentic Frameworks for Deterministic Games"
              meta="FoRLM @ NeurIPS 2025"
              links={[{ label: "arXiv", href: "https://arxiv.org/abs/2510.15974" }]}
            >
              Giving LLMs a real environment interface for Tower of Hanoi doesn't delay
              performance collapse. Policy analysis shows growing divergence from both
              optimal and random play — mode-like collapse rather than reasoning.
            </Card>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: "contact",
    label: "Resume",
    tagline: "Resume & contact",
    icon: ScrollText,
    body: () => (
      <div className="grid h-full gap-8 md:grid-cols-2">
        <div className="flex flex-col">
          <Kicker>Resume</Kicker>
          <Prose>
            <p>
              The one-page version, kept current. Happy to send a longer CV with full
              publication and coursework detail on request.
            </p>
          </Prose>
          <a
            href="/files/Resume.pdf"
            target="_blank"
            rel="noreferrer"
            className="group mt-5 inline-flex w-fit items-center gap-2.5 rounded-md bg-accent px-5 py-3 font-mono text-xs tracking-widest text-white uppercase transition-all duration-200 hover:brightness-115 active:scale-[0.98] dark:text-background"
          >
            <FileDown className="size-4 transition-transform duration-200 group-hover:translate-y-0.5" />
            Download PDF
          </a>
          <div className="relative mt-6 min-h-56 flex-1 overflow-hidden rounded-md border border-line bg-surface-2/40">
            <iframe
              src="/files/Resume.pdf#toolbar=0&navpanes=0&view=FitH"
              title="Resume preview"
              className="absolute inset-0 size-full opacity-95"
            />
          </div>
        </div>
        <div className="flex flex-col">
          <Kicker>Get in touch</Kicker>
          <Prose>
            <p>
              Reach out about research, collaborations, or opportunities — email is the
              fastest path to me.
            </p>
          </Prose>
          <ul className="mt-5 divide-y divide-line overflow-hidden rounded-md border border-line">
            {[
              { k: "Email", v: "liharrison@berkeley.edu", href: "mailto:liharrison@berkeley.edu" },
              { k: "GitHub", v: "github.com/haribary", href: "https://github.com/haribary" },
              { k: "LinkedIn", v: "Harrison Li", href: "https://www.linkedin.com/in/harrison-li-60b551368/" },
              { k: "Scholar", v: "Google Scholar", href: "https://scholar.google.com/citations?hl=en&user=a3g1GUwAAAAJ" },
            ].map((row) => (
              <li key={row.k}>
                <a
                  href={row.href}
                  target="_blank"
                  rel="noreferrer"
                  className="group flex items-center justify-between gap-4 px-4 py-3 transition-colors duration-200 hover:bg-surface-2"
                >
                  <span className="label-caps text-muted">{row.k}</span>
                  <span className="flex items-center gap-2 font-serif text-sm">
                    {row.v}
                    <ArrowUpRight className="size-3.5 opacity-0 transition-all duration-200 group-hover:translate-x-0.5 group-hover:opacity-50" />
                  </span>
                </a>
              </li>
            ))}
          </ul>

          <div className="mt-auto pt-8">
            <div className="rounded-md border border-line bg-surface-2/40 p-5">
              <p className="label-caps text-muted">Currently</p>
              <p className="mt-2 font-serif text-[0.975rem]/[1.7] text-foreground/85">
                Open to research collaborations and summer 2027 internships in agentic
                systems, RL, or speech.
              </p>
            </div>
          </div>
        </div>
      </div>
    ),
  },
]
