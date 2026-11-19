// Where a visit came from, as a short label for the daily source counts: the
// ?ref= tag on the link when there is one, else the site that linked here,
// else "direct". Shared by the page and the server, which accepts the same
// shape: lowercase, 1 to 40 characters of a-z 0-9 . _ - starting with a
// letter or digit.

const SOURCE_RE = /^[a-z0-9][a-z0-9._-]{0,39}$/;

// Link shorteners and redirect hosts, folded into the site they belong to.
const HOSTS = {
  "t.co": "x.com",
  "twitter.com": "x.com",
  "mobile.twitter.com": "x.com",
  "l.facebook.com": "facebook.com",
  "lm.facebook.com": "facebook.com",
  "m.facebook.com": "facebook.com",
  "l.instagram.com": "instagram.com",
  "out.reddit.com": "reddit.com",
  "old.reddit.com": "reddit.com",
  "lnkd.in": "linkedin.com",
};

// A valid label, or null.
export function cleanSource(raw) {
  if (typeof raw !== "string") return null;
  const label = raw.trim().toLowerCase();
  return SOURCE_RE.test(label) ? label : null;
}

// `search` and `referrer` are the page's own; `host` and `path` say where the
// game lives, so a reload or a link inside the game is not a referral.
export function visitSource({ search = "", referrer = "", host = "", path = "/" } = {}) {
  const tag = cleanSource(new URLSearchParams(search).get("ref") ?? "");
  if (tag) return tag;
  let from;
  try { from = new URL(referrer); } catch { return "direct"; }
  const name = from.hostname.toLowerCase().replace(/^www\./, "");
  if (!name) return "direct";
  if (name === host.toLowerCase().replace(/^www\./, "") && from.pathname.startsWith(path)) return "direct";
  return cleanSource(HOSTS[name] || name) || "other";
}
