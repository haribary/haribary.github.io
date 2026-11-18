// The server's check on a leaderboard name: the shared rules in src/name.js,
// then a short list of words that do not go on a public board.
//
// The list is a first line of defence, not moderation. It is stored in ROT13
// so the words are not sitting in the source in plain sight. To take a name
// off the board, delete its L#<date> item from the table (see store-dynamo.mjs).

import { tidyName, nameProblem } from "../../src/name.js";

const rot13 = (s) => s.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));
// Each letter may be repeated ("fuuuck"); a doubled letter must stay doubled,
// so a blocked word with "gg" does not catch a place name with one "g".
const stretchy = (word) => word.split("").map((c) => c + "+").join("");

// Refused wherever they appear in the name, spaces and punctuation removed.
const ANYWHERE = ["shpx", "avttre", "avttn", "snttbg", "phag", "ovgpu", "juber", "fyhg", "uvgyre", "ergneq", "chffl", "cravf", "intvan", "cbea", "encvfg", "genaal", "nffubyr", "onfgneq", "jnaxre", "wvmm", "qvyqb"]
  .map((w) => new RegExp(stretchy(rot13(w))));
// Refused only as a whole word, because they sit inside ordinary names.
const WHOLE_WORD = ["fuvg", "pbpx", "nff", "snt", "anmv", "encr", "xvxr", "puvax", "fcvp", "phz", "frk", "gvgf", "nany", "xxx", "avt", "cvff", "gjng", "cnxv"]
  .map((w) => new RegExp(`^${stretchy(rot13(w))}$`));

const LEET = { 0: "o", 1: "i", 3: "e", 4: "a", 5: "s", 7: "t", 8: "b" };
// Lower case, accents off, digits read as the letters they stand in for.
const fold = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[0134578]/g, (d) => LEET[d]);

function blocked(name) {
  const folded = fold(name);
  const run = folded.replace(/[^a-z]/g, "");
  if (ANYWHERE.some((re) => re.test(run))) return true;
  return folded.split(/[^a-z]+/).some((word) => word && WHOLE_WORD.some((re) => re.test(word)));
}

// { ok: true, name } with the name as it will be shown, or { ok: false, reason }
// where reason is "empty", "long", "invalid" or "blocked".
export function cleanName(raw) {
  if (typeof raw !== "string") return { ok: false, reason: raw == null ? "empty" : "invalid" };
  const name = tidyName(raw);
  const problem = nameProblem(name);
  if (problem) return { ok: false, reason: problem };
  if (blocked(name)) return { ok: false, reason: "blocked" };
  return { ok: true, name };
}
