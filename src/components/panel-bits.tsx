import type { LucideIcon } from "lucide-react"
import { ArrowUpRight } from "lucide-react"

/* Presentational pieces shared by the panel bodies. */

export function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="label-caps mb-3 flex items-center gap-2 text-muted">
      <span className="inline-block h-px w-6 bg-line-strong" />
      {children}
    </h3>
  )
}

export function Prose({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4 font-serif text-[0.975rem]/[1.75] text-foreground/85 [&_strong]:font-semibold [&_strong]:text-foreground">
      {children}
    </div>
  )
}

export function Pill({
  href,
  children,
  icon: Icon = ArrowUpRight,
}: {
  href: string
  children: React.ReactNode
  icon?: LucideIcon
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="group inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2/60 px-3 py-1.5 font-mono text-[0.7rem] tracking-wide text-foreground/80 transition-colors duration-200 hover:border-accent-soft/60 hover:bg-surface-2 hover:text-foreground"
    >
      {children}
      <Icon className="size-3 opacity-50 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:opacity-90" />
    </a>
  )
}

export function Card({
  title,
  meta,
  children,
  links,
  image,
}: {
  title: string
  meta: string
  children: React.ReactNode
  links?: Array<{ label: string; href: string }>
  /** Optional cover; it takes the card's spare vertical space. */
  image?: string
}) {
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-md border border-line bg-surface/70 p-5 transition-all duration-300 hover:border-line-strong hover:bg-surface">
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 z-10 h-px scale-x-0 bg-linear-to-r from-transparent via-accent-soft to-transparent transition-transform duration-500 group-hover:scale-x-100"
      />
      {image && (
        // absolutely positioned so the cover's intrinsic aspect never inflates
        // the card's min-content height
        <div className="relative -mx-5 -mt-5 mb-4 min-h-24 flex-1 overflow-hidden border-b border-line bg-surface-2">
          <img
            src={image}
            alt=""
            className="absolute inset-0 size-full object-cover transition-transform duration-[900ms] ease-out group-hover:scale-[1.05]"
          />
        </div>
      )}
      <h4 className="font-serif text-lg/snug tracking-tight">{title}</h4>
      <p className="label-caps mt-1.5 text-accent-soft">{meta}</p>
      <p className="mt-3 font-serif text-sm/[1.7] text-foreground/75">{children}</p>
      {links && (
        <div className="mt-auto flex flex-wrap gap-2 pt-5">
          {links.map((l) => (
            <Pill key={l.label} href={l.href}>
              {l.label}
            </Pill>
          ))}
        </div>
      )}
    </article>
  )
}

export function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-line bg-surface-2/40 px-3 py-1 font-mono text-[0.68rem] tracking-wide text-muted transition-colors duration-200 hover:border-accent-soft/50 hover:text-foreground">
      {children}
    </span>
  )
}

export function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-md border border-line bg-surface-2/50 px-4 py-3">
      <div className="label-caps text-muted">{k}</div>
      <div className="mt-1 font-serif text-base tracking-tight">{v}</div>
    </div>
  )
}

