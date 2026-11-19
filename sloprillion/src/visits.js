// Counting visits without cookies, ids or anything about the visitor. A
// browser reports once a day for each part of the site it opens ("site" for
// the personal site, "game" for Sloprillion), with only the day, the part and
// where it came from (see source.js). The once-a-day mark is a date kept in
// this browser's own storage; it is never sent anywhere.

import { visitSource } from "./source.js";

const pad = (n) => String(n).padStart(2, "0");

// The visitor's own calendar date, YYYY-MM-DD.
export const localDate = (now = new Date()) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

export const onLocalhost = () => /^(localhost|127\.0\.0\.1)$/.test(location.hostname);

// Crawlers and scripted browsers that run the page are not visitors. (On
// localhost everything counts, so the end-to-end test can see its own visit.)
export const automated = () =>
  !onLocalhost() && (navigator.webdriver === true || /bot|crawl|spider|slurp|headless|lighthouse|preview|monitor/i.test(navigator.userAgent || ""));

// Where this browser's first visit of `date` to `where` came from, and whether
// that first visit is this one. `home` is the path that part of the site lives
// under, so moving around inside it is not a referral. A page served from
// localhost always reports "dev", which keeps testing apart from real traffic.
export function firstVisit(where, date, home) {
  const src = onLocalhost()
    ? "dev"
    : visitSource({ search: location.search, referrer: document.referrer, host: location.hostname, path: home });
  const key = `sloprillion:visit:${where}`;
  try {
    const kept = JSON.parse(localStorage.getItem(key));
    if (kept && kept.date === date && typeof kept.src === "string") return { src: kept.src, first: false };
    localStorage.setItem(key, JSON.stringify({ date, src }));
  } catch { /* storage blocked: every load counts, which is the best that can be done */ }
  return { src, first: true };
}

// For a page that has nothing else to do with the API: count today's first
// visit and forget about it. Never throws and is never waited for.
export function countVisit(api, where, home = "/") {
  try {
    if (onLocalhost() || automated()) return; // work on the site, and robots, are not traffic
    const date = localDate();
    const visit = firstVisit(where, date, home);
    if (!visit.first) return;
    fetch(`${api.replace(/\/+$/, "")}/v1/visit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ date, where, src: visit.src }),
      keepalive: true,
    }).catch(() => { /* the count is optional */ });
  } catch { /* never in the way of the page */ }
}
