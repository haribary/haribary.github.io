// Rules for the name a player puts on the leaderboard. Shared by the page,
// which uses them for instant feedback, and the server, which has the last word.

export const NAME_MAX = 16;

const ALLOWED = /^[\p{L}\p{N} ._'-]+$/u;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

// Trim, collapse runs of spaces, and compose accents so "é" counts as one character.
export const tidyName = (raw) => String(raw ?? "").normalize("NFC").replace(/\s+/g, " ").trim();

// null when a tidied name is fine, otherwise what is wrong with it:
// "empty", "long" (over NAME_MAX characters) or "invalid" (a character that is
// not a letter, digit, space, dot, dash, underscore or apostrophe).
export function nameProblem(name) {
  if (!name) return "empty";
  if ([...name].length > NAME_MAX) return "long";
  if (!ALLOWED.test(name) || !LETTER_OR_DIGIT.test(name)) return "invalid";
  return null;
}
