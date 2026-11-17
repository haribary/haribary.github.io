/**
 * Portfolio content as plain data, shared by every lab experiment.
 *
 * Mirrors src/data/sections.tsx (which renders the same facts as JSX for the
 * wall). Keep the two in sync when the copy changes. The only thing added here
 * is `person.ipa`, a transcription written for the lab — check it matches how
 * the name is actually said.
 */

/** A run of text, optionally a link. Paragraphs are arrays of these. */
export type Span = { text: string; href?: string; strong?: boolean }

export type LinkItem = { label: string; href: string }

export type Project = {
  id: string
  title: string
  /** Stack and occasion, in the order the wall lists them. */
  tags: string[]
  image: string
  blurb: string
  links: LinkItem[]
}

export type Paper = {
  id: string
  title: string
  venue: string
  blurb: string
  links: LinkItem[]
}

export type Photo = { src: string; alt: string }

export const person = {
  name: "Harrison Li",
  /** Broad IPA transcription of the name, matching the phones in the voice data. */
  ipa: "ˈhærəsən ˈliː",
  role: "Data Science with a Computer Science minor, UC Berkeley",
  resume: "/files/Harrison-Li-Resume.pdf",
} as const

export const about: Span[][] = [
  [
    { text: "Hi! I'm an undergraduate at " },
    { text: "UC Berkeley", strong: true },
    {
      text: " studying Data Science with a minor in Computer Science. My interests span agent evals, reinforcement learning, audio processing, and software engineering.",
    },
  ],
  [
    { text: "Currently, I'm the founder and CTO of " },
    { text: "Lyrn AI", href: "https://lyrnmusic.com" },
    {
      text: ", the first virtual learning environment for music education, where I lead a 5+ person R&D team and we've built SOTA agent harnesses for frontier audio models. I've also been leading a multi-year speech AI project at ",
    },
    { text: "BAIR", href: "https://bair.berkeley.edu" },
    { text: " in the " },
    { text: "Berkeley Speech Group", href: "https://people.eecs.berkeley.edu/~gopala/" },
    {
      text: " with UCSF Neuroscience, automating the screening process for primary progressive aphasia. Other than that, I have many projects in the broader RL, agent systems, and orchestration space, and I've also published research at NeurIPS and Interspeech.",
    },
  ],
  [{ text: "I like swimming, piano, and porter robinson!" }],
]

export const interests = [
  "Agent evals",
  "Reinforcement learning",
  "Audio processing",
  "Software engineering",
] as const

export const papers: Paper[] = [
  {
    id: "hass",
    title:
      "HASS: Hierarchical Simulation of Logopenic Aphasic Speech for Scalable PPA Detection",
    venue: "Interspeech 2026",
    blurb:
      "Proposed and led a 15+ person project with UCSF Neuroscience and licensed speech-language pathologists to build a state-of-the-art dysfluency modeling system for Primary Progressive Aphasia. HASS simulates logopenic aphasic speech across semantic, phonological, and temporal deficits at graded severity; a LoRA-adapted wav2vec2 classifier trained on its synthetic data reaches 90% AUC-ROC, outperforming real data in real-life and cross-context settings. First author, Interspeech 2026 main track.",
    links: [
      { label: "ISCA Archive", href: "https://www.isca-archive.org/interspeech_2026/li26ia_interspeech.html" },
      { label: "arXiv", href: "https://arxiv.org/abs/2603.26795" },
    ],
  },
  {
    id: "hanoi",
    title:
      "Limits of Emergent Reasoning of LLMs in Agentic Frameworks for Deterministic Games",
    venue: "FoRLM @ NeurIPS 2025",
    blurb:
      "Designed and implemented a new evaluation methodology for multi-step agentic reasoning, benchmarking 2 frontier LLMs on Tower of Hanoi across 8 complexity environments through a real environment interface. Found that LLM policies diverge further (Jensen-Shannon) from both random and optimal play than expected and reuse 40% more sub-sequences deterministically, exposing a mode-collapse failure rather than a reasoning failure in agent planning.",
    links: [{ label: "arXiv", href: "https://arxiv.org/abs/2510.15974" }],
  },
]

export const projects: Project[] = [
  {
    id: "vigil",
    title: "Vigil AI",
    tags: ["V-JEPA 2", "NanoBanana", "SkyDeck pitch"],
    image: "/files/vigil_cover.png",
    blurb:
      "Built and pitched a secure elderly-monitoring platform to Berkeley SkyDeck: a V-JEPA world model running on-edge for private, context-aware, live fall detection, fused with Apple Watch vitals streamed over HealthKit, and an agentic layer that triages alerts and briefs nurses.",
    links: [{ label: "Demo", href: "https://www.youtube.com/watch?v=sEYoF7deqz8" }],
  },
  {
    id: "sante",
    title: "Santé",
    tags: ["Next.js", "FastAPI", "openSMILE", "TreeHacks"],
    image: "/files/sante_cover.png",
    blurb:
      "Built a multi-agent voice platform that turns patient phone calls into clinician reports: 8 acoustic biomarkers (openSMILE), 3 classes of phoneme-level disfluency (DysfluentWFST), and safety-aware triage. Designed the real-time pipeline running 4 streams concurrently (conversation, transcription, acoustic, disfluency) on Next.js, FastAPI, OpenAI Realtime, Twilio, and RunPod serverless GPUs.",
    links: [
      { label: "Devpost", href: "https://devpost.com/software/sante-o5uv9q" },
      { label: "GitHub", href: "https://github.com/AyanJhunjhunwala/sante" },
      { label: "Demo", href: "https://www.youtube.com/watch?v=Tf4Zh0f2TcI" },
    ],
  },
  {
    id: "bewear",
    title: "BeWear",
    tags: ["Elasticsearch", "Agentic", "CalHacks"],
    image: "/files/bewear_cover.jpg",
    blurb:
      "Built a photo-to-ethical-score app: Google Lens brand ID, LLM extraction, and an Elasticsearch index of 6,000+ scraped brands scored on 5 factors with fuzzy matching. Engineered a LangGraph + Tavily agent that investigates live greenwashing events and streams its findings to the UI over SSE.",
    links: [
      { label: "Devpost", href: "https://devpost.com/software/bewear" },
      { label: "GitHub", href: "https://github.com/haribary/ethical-source" },
      { label: "Demo", href: "https://www.youtube.com/watch?v=apDW__GB-SA" },
    ],
  },
]

export const photos: Photo[] = [
  { src: "/files/profile_pic.jpeg", alt: "Harrison Li" },
  { src: "/files/20260414_020958_104E49.jpeg", alt: "Poolside at a swim meet" },
  { src: "/files/20260505_233346_1E2296.jpeg", alt: "With a friend at a reception" },
  { src: "/files/IMG_0119.jpeg", alt: "In the crowd at a music festival" },
  { src: "/files/IMG_1565.jpeg", alt: "At Stranger Things: The First Shadow" },
  { src: "/files/IMG_5693.jpeg", alt: "Hotpot night with friends" },
  { src: "/files/IMG_6382.jpeg", alt: "Under the heart arch at the FIFA fan festival" },
]

export const contacts: (LinkItem & { value: string })[] = [
  { label: "Email", value: "liharrison@berkeley.edu", href: "mailto:liharrison@berkeley.edu" },
  { label: "GitHub", value: "github.com/haribary", href: "https://github.com/haribary" },
  {
    label: "LinkedIn",
    value: "Harrison Li",
    href: "https://www.linkedin.com/in/harrison-li-60b551368/",
  },
  {
    label: "Scholar",
    value: "Google Scholar",
    href: "https://scholar.google.com/citations?hl=en&user=a3g1GUwAAAAJ",
  },
]
