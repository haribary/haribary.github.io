# Grid nav — visual test bed

An interactive hero built on the `GridPattern` component: four of the grid's own
darkened cells are blocks that slide out of the wall in 3D when hovered, and expand
into a near-fullscreen tab when clicked.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # tsc -b && vite build
```

## Why this is a new app

The site at the repo root is a hand-written `index.html` + `style.css` — no React,
no Tailwind, no TypeScript, no `package.json`. None of the requested component
structure existed, so `test/` is a fresh Vite + React 19 + TypeScript app wired up
the way shadcn/ui expects:

| Requirement | Where it lives |
| --- | --- |
| Tailwind CSS v4 | `@tailwindcss/vite` plugin + `@import "tailwindcss"` in `src/index.css` (no `tailwind.config.js` needed in v4) |
| Design tokens | CSS variables in `src/index.css`, exposed to Tailwind via `@theme inline` |
| `@/*` path alias | `vite.config.ts` `resolve.alias` + `paths` in `tsconfig.app.json` |
| `cn()` helper | `src/lib/utils.ts` (clsx + tailwind-merge) |
| shadcn CLI config | `components.json` |

### Reproducing this setup from scratch

```bash
npm create vite@latest my-app -- --template react-ts
cd my-app
npm install
npm install tailwindcss @tailwindcss/vite clsx tailwind-merge motion lucide-react
npm install -D @types/node
# then: add the tailwind plugin + @ alias to vite.config.ts, add paths to
# tsconfig.app.json, and @import "tailwindcss" at the top of src/index.css
npx shadcn@latest init      # optional: only if you want to pull in shadcn components
```

`npx shadcn@latest init` is optional here — nothing in this app depends on a shadcn
primitive. It is worth running if you later want `npx shadcn@latest add button` etc.,
because it reads `components.json` and writes into the aliases defined there.

### Why `components/ui`

`components.json` declares `"ui": "@/components/ui"`, and the shadcn CLI writes every
generated primitive to that folder. Keeping third-party/generated components there and
app-specific components one level up (`src/components/*`) means:

- `npx shadcn@latest add <x>` never collides with your own files, and
- re-running `add` to update a primitive only ever touches `components/ui`.

`GridPattern` came from a registry, so it lives in `src/components/ui/grid-pattern.tsx`
**unmodified**, and its demo file is kept alongside as
`src/components/ui/grid-pattern-demo.tsx` for reference (unused by the app;
`"use client"` is a no-op in Vite and left in place so the file matches upstream).
Everything the wall needs is passed in as props — including `strokeWidth`, which
works because the component spreads unknown props onto its `<svg>`.

## How the interaction works

```
src/
  components/
    wall.tsx              the scene: grid, vignette, the four blocks, the name, open/close state
    nav-block.tsx         one darkened cell, extruded out of the wall in 3D
    section-panel.tsx     the expanded tab
    theme-toggle.tsx      light/dark
    panel-bits.tsx        presentational pieces used by the panel bodies
    ui/grid-pattern.tsx   upstream component, untouched
  hooks/use-wall-metrics.ts   cell size, pattern origin, and where the blocks sit
  data/sections.tsx       the four sections' content
```

**The blocks are grid cells.** Each interactive target is a single cell the same
size as the drawn grid, filled like the pattern's own darkened squares. Nothing
labels them and nothing floats above the grid. The pattern origin is set so a grid
line falls exactly on the wall's centre, so any whole-cell offset from the centre
lands on a line too — the blocks are indistinguishable from the pattern at rest.

**The 3D.** The wall is never transformed. Rotating it would make Chrome rasterize
the SVG grid once and resample it, turning the 1px strokes to mush — so instead
each block carries its own `perspective`, with `perspective-origin` aimed at a
camera shared by every block, resting at the centre of the viewport. That is the
projection a real camera produces for a flat wall seen head-on: blocks left of
centre show their right flank, blocks below centre show their top. The camera
drifts slightly toward the cursor, but only slightly — moving it *at* a block
reduces that block's viewing angle and flattens the extrusion you hovered to see.
The blocks are placed off-centre and mirrored around the name for the same reason:
a block dead centre faces the camera squarely and has no visible flanks.

Each block is a front face plus four side faces that extend **backward** from the
front face's edges, scaled by the fraction the block has travelled, so they always
span exactly from the raised face down to the wall surface — never behind it. That
sidesteps Chrome's per-element depth sorting, which would otherwise pop a whole
side face in front of or behind the wall depending on its centroid. The side faces
must not set `backface-visibility: hidden`: they are rotated so their normals point
*into* the block, so hiding backfaces culls them entirely.

**Hover pops, click expands.** Hovering slides a block out of the wall on a spring
and leaves a recess behind it; the block does not expand. Clicking a block that is
already out flies the panel from the block's front face to its resting rect, as a
plain transform off a fixed rect — no per-frame layout — with a shockwave ring left
at the block and the contents fading in just behind the flight so nothing distorts
mid-air. Escape, the × button, or a click outside collapses it back into the block.

**Adding a section.** Append to `sections` in `src/data/sections.tsx` and add a
matching cell offset to `NAV_WIDE`/`NAV_TIGHT` in `use-wall-metrics.ts`. Keep new
cells a few cells off-centre and out of the name's band. Panel bodies get `flex-1`,
so use `h-full` + `mt-auto` to fill the tab; position any `<img>` absolutely inside
a `relative` box, or its intrinsic aspect ratio will inflate the body's min-content
height and force a scrollbar.

**Responsive & motion.** Cell size comes from `cellFor()` in `use-wall-metrics.ts`
(34 px on phones → 56 px ≥1280 px), and narrow viewports switch to a tighter block
arrangement so the outer pair stays on screen. Copy adapts to touch via the
`hover-none:` variant, and `prefers-reduced-motion` drops the pop, the camera
drift, and the flight.

## Assets

`public/files/` holds copies of the root site's real assets (profile photo, resume PDF,
project covers) so the panels show actual content instead of placeholders.
