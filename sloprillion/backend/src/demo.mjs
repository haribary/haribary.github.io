// Made-up visitors and play for the local server (DEMO=1), so the owner's page
// has something on it before there is real traffic. Dev only: the build leaves
// this file out of the Lambda bundle.

import { pickByDate } from "../../src/rounds/index.js";

const DAY_MS = 86400000;
const NAMES = ["Ada", "Grace", "Linus", "Margaret", "Dennis", "Barbara", "Ken", "Radia", "Guido", "Frances", "Edsger", "Joan"];
// Per day, newest first: [source, site visits, game visits], and games played.
const DAYS = [
  { players: 14, visits: [["direct", 9, 6], ["x", 0, 14], ["haribary.github.io", 0, 5], ["linkedin.com", 4, 0], ["news.ycombinator.com", 2, 1]] },
  { players: 17, visits: [["direct", 6, 4], ["discord", 0, 12], ["x", 0, 9], ["google.com", 3, 0]] },
  { players: 8, visits: [["direct", 4, 5], ["x", 0, 6]] },
];

// The demo's judge knows only the answers the seeding below asks it about.
const rulings = new Map();
export const demoJudge = async ({ text }) =>
  rulings.get(text) || { valid: false, canonical: null, rarity: 0, why: "Demo: the local judge only knows its made-up rulings." };

export async function seedDemo(app, rounds, now = Date.now()) {
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pad = (n) => String(n).padStart(2, "0");
  const localDay = (back) => { const d = new Date(now - back * DAY_MS); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const post = (path, body) => app({ method: "POST", path, body });
  // Common answers are picked far more often than rare ones, as real players do.
  const pick = (answers) => {
    const weights = answers.map((x) => (105 - x.pts) ** 2);
    let at = rand() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < answers.length; i++) if ((at -= weights[i]) <= 0) return answers[i];
    return answers[answers.length - 1];
  };

  let n = 0;
  for (const [back, day] of DAYS.entries()) {
    const date = localDay(back), round = pickByDate(rounds, date);
    const arrivals = [];
    for (const [src, site, game] of day.visits) {
      for (let i = 0; i < site; i++) await post("/v1/visit", { date, where: "site", src });
      for (let i = 0; i < game; i++) { await post("/v1/visit", { date, where: "game", src }); arrivals.push(src); }
    }
    for (let i = 0; i < day.players; i++) {
      const session = "demosession" + String(++n).padStart(6, "0");
      const answer = (promptId, text) => post("/v1/answer", { date, promptId, session, text });
      for (const p of round.prompts) {
        const roll = rand();
        if (roll < 0.07) { // an answer the bank lacks
          const text = `Made-up answer ${1 + Math.floor(rand() * 2)}`;
          rulings.set(text, { valid: true, canonical: text, rarity: 70, why: "Demo ruling." });
          await answer(p.id, text);
        } else if (roll < 0.12) { // a spelling the bank lacks
          const known = pick(p.answers.filter((x) => x.a.length <= 30));
          const text = `demo spelling of ${known.a}`;
          rulings.set(text, { valid: true, canonical: known.a, rarity: known.pts, why: "Demo ruling." });
          await answer(p.id, text);
        } else {
          if (roll < 0.2) { // a wrong guess first
            const text = `made-up wrong answer ${1 + Math.floor(rand() * 3)}`;
            rulings.set(text, { valid: false, canonical: null, rarity: 0, why: "Demo ruling: the judge's reason is shown here." });
            await answer(p.id, text);
          }
          await answer(p.id, pick(p.answers).a);
        }
      }
      const src = arrivals[Math.floor(rand() * arrivals.length)];
      await post("/v1/finish", { date, session, src, ...(rand() < 0.65 ? { name: NAMES[i % NAMES.length] } : {}) });
    }
  }
}
