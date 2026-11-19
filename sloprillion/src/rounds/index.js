// Every round the game knows about, one per day, in date order. Adding a day
// is one line here plus its file (004.js for id 4). The page loads only the
// day's round; the server and the tools load them all.

export const calendar = [
  { id: 1, date: "2026-11-17" },
  { id: 2, date: "2026-11-18" },
  { id: 3, date: "2026-11-19" },
  { id: 4, date: "2026-11-20" },
  { id: 5, date: "2026-11-21" },
  { id: 6, date: "2026-11-22" },
  { id: 7, date: "2026-11-23" },
  { id: 8, date: "2026-11-24" },
  { id: 9, date: "2026-11-25" },
];

const DAY_MS = 86400000;
const stamp = (date) => Date.parse(date + "T00:00:00Z");

// Whole days from one YYYY-MM-DD date to another.
export const daysBetween = (from, to) => Math.round((stamp(to) - stamp(from)) / DAY_MS);

// Which entry of a date-ordered list is played on `date`. Up to the last
// entry's date it is the latest one dated on or before that day (the first
// one for any earlier day). Once the list has run out the rounds come round
// again, oldest first, one a day, so the game never stops on its last round.
// The page and the server both use this, so they always agree.
export function pickByDate(list, date) {
  const last = list[list.length - 1];
  if (date > last.date) return list[(daysBetween(last.date, date) - 1) % list.length];
  let best = list[0];
  for (const entry of list) if (entry.date <= date) best = entry;
  return best;
}

// The number a day is known by ("Sloprillion #12"): the round's place in the
// list while new rounds last, then counting on, one a day.
export function dayNumber(list, date) {
  const last = list[list.length - 1];
  if (date > last.date) return list.length + daysBetween(last.date, date);
  return list.indexOf(pickByDate(list, date)) + 1;
}

// How many days of unplayed rounds are left after `date`.
export const daysLeft = (list, date) => Math.max(0, daysBetween(date, list[list.length - 1].date));

// ?day=<round id> forces that round, for testing and previews.
export const forcedEntry = (day) => (day == null ? null : calendar.find((e) => String(e.id) === String(day)) || null);

const load = async (entry) => (await import(`./${String(entry.id).padStart(3, "0")}.js`)).default;
export const loadRound = (entry) => load(entry);
export const loadAllRounds = () => Promise.all(calendar.map(load));
