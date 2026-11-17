// Every round the page knows about. Adding a day is one import and one entry.
// Keep this list in date order.

import r001 from "./001.js";
import r002 from "./002.js";

export const rounds = [r001, r002];

// The latest round dated on or before `today` (YYYY-MM-DD), else the first one.
// `day` is a round id that overrides the date, for testing (?day=2).
export function pickRound(today, day) {
  const forced = day != null && rounds.find((r) => String(r.id) === String(day));
  if (forced) return forced;
  let best = rounds[0];
  for (const r of rounds) if (r.date <= today) best = r;
  return best;
}
