// The day's leaderboard, drawn on a billboard: ten places, each a name and the
// valuation it finished at. The player's own row is a lane-yellow band. The
// stylesheet decides where the billboard stands and whether open places show.

import { money, valuation } from "./config.js";

const PLACES = 10;

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};

function row(entry, mine) {
  const li = el("li", mine ? "me" : "");
  li.dataset.rank = entry.rank;
  li.title = `${entry.score} of 700 points`;
  const name = el("span", "lb-name", entry.name); // textContent: a name is never markup
  if (mine) name.append(el("b", "lb-you", "You"));
  li.append(el("span", "lb-rank", entry.rank), name, el("span", "lb-val", money(valuation(entry.score))));
  return li;
}

// A place nobody has taken: decoration, so it is kept from screen readers.
function openRow(rank) {
  const li = el("li", "open");
  li.dataset.rank = rank;
  li.setAttribute("aria-hidden", "true");
  li.append(el("span", "lb-rank", rank), el("span", "lb-name"), el("span", "lb-val"));
  return li;
}

// `board` is { top, you } from the server. Without one, because the request is
// still out or because it failed, the board shows its ten places empty, the
// same as a day nobody has finished yet. It never carries a message.
export function renderBoard(root, board) {
  const rows = root.querySelector(".lb-rows");
  const top = board && Array.isArray(board.top) ? board.top : [];
  root.hidden = false;
  rows.replaceChildren();
  for (const entry of top) rows.append(row(entry, !!entry.me));
  for (let rank = top.length + 1; rank <= PLACES; rank++) rows.append(openRow(rank));
  // On the board but below the listed rows: shown after a break, with the real rank.
  if (board && board.you && !top.some((entry) => entry.me)) rows.append(el("li", "lb-gap"), row(board.you, true));
}
