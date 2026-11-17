// Game rules and the naming system. Everything a designer would want to rename
// lives here so the theme can change without touching game logic.

export const ROUND_SECONDS = 25;
export const MAX_PER_ROUND = 100;

// One funding round per prompt. The seventh is the exit.
export const STAGES = ["Pre-seed", "Seed", "Series A", "Series B", "Series C", "Series D", "IPO"];

// Rarity tiers, most common first. Index 0 is "no accepted answer".
export const TIERS = [
  { key: "miss", name: "Out of runway", color: "#b3b7c4", emoji: "⬛" },
  { key: "slop", name: "Slop", range: "10 to 24", blurb: "What everyone says", color: "#a9ad92", emoji: "🟫" },
  { key: "boilerplate", name: "Boilerplate", range: "25 to 44", blurb: "Safe and common", color: "#e2bb78", emoji: "🟧" },
  { key: "signal", name: "Signal", range: "45 to 64", blurb: "Known in the field", color: "#56c8ec", emoji: "🟦" },
  { key: "deepcut", name: "Deep cut", range: "65 to 84", blurb: "Few would think of it", color: "#a493ff", emoji: "🟪" },
  { key: "ood", name: "Out of distribution", range: "85 to 99", blurb: "Almost nobody", color: "#ff86cf", emoji: "🟥" },
  { key: "tenx", name: "10x", range: "100", blurb: "The rarest answer on the list", color: "#ffc93c", emoji: "🟨" },
];

// Lower bound of each scoring tier, aligned with TIERS[1..6].
const FLOORS = [10, 25, 45, 65, 85, 100];

export function tierIndex(pts) {
  if (!pts) return 0;
  let t = 1;
  for (let k = 0; k < FLOORS.length; k++) if (pts >= FLOORS[k]) t = k + 1;
  return t;
}

// Where a score sits on the reveal scale, 0..1. Band widths are the point
// spans of each tier, with a little room for the single 100-point band.
const BAND_UNITS = [15, 20, 20, 20, 15, 6];
const TOTAL_UNITS = BAND_UNITS.reduce((a, b) => a + b, 0);
export const BAND_FLEX = BAND_UNITS;
export function scalePosition(pts) {
  if (pts >= 100) return (90 + BAND_UNITS[5] / 2) / TOTAL_UNITS;
  return (Math.max(10, pts) - 10 + 0.5) / TOTAL_UNITS;
}

// Score to company valuation: every 100 points is a 10x, so a perfect seven
// rounds takes a $100K garage project to $1T.
export const valuation = (score) => 1e5 * Math.pow(10, score / 100);
export const multiple = (pts) => Math.pow(10, pts / 100);

export function money(v) {
  const r = Number(v.toPrecision(3));
  for (const [unit, suffix] of [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]]) {
    if (r >= unit) {
      const n = r / unit;
      return "$" + (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)) + suffix;
    }
  }
  return "$" + Math.round(r);
}

export function companyClass(score) {
  if (score >= 700) return "Sloprillionaire";
  if (score >= 600) return "Hyperscaler";
  if (score >= 500) return "Decacorn";
  if (score >= 400) return "Unicorn";
  if (score >= 300) return "Soonicorn";
  if (score >= 200) return "Demo day darling";
  if (score >= 100) return "Garage startup";
  return "Side project";
}
