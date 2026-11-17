# Sloprillion backend

Plain Node 22 ES modules, no runtime dependencies. `src/app.mjs` is the whole API as a pure function (`createApp({ store, judge, rounds, now, config })` returns `async (request) => response`); `handler.mjs` runs it in Lambda, `local-server.mjs` on node:http.

## Commands (run in `backend/`)

    npm test            # node:test, memory store, fake judges, no AWS
    npm run dev         # http://localhost:8787, memory store, CORS for http://localhost:5199
    npm run build       # node scripts/build.mjs, then python scripts/package.py -> dist/function.zip

`STORE=dynamo TABLE_NAME=... npm test` runs the same store behaviour suite against a real table (needs AWS credentials and the SDK).
`JUDGE_PROVIDER=openai JUDGE_MODEL=... OPENAI_API_KEY=... npm run dev` turns the judge on locally; with it unset or `off`, or without `src/judge.mjs`, every unknown answer is rejected ("judge unavailable").

Deploy (not done yet): create the stack from `template.yaml` (us-west-2, stack `sloprillion`), then upload `dist/function.zip` to the function. The template's inline placeholder returns 503 until then.

## How an answer is checked

1. bank: `match()` against the round's answers (exact, alias, typo). No cache or judge involved.
   Then `matchWrong()` against the prompt's `wrong` list: a hit answers `{ valid: false, attemptsLeft, why }`, counts as an attempt and never reaches the cache or judge.
2. verdict cache, keyed by round + prompt + normalised text (lowercase, accents stripped, non-alphanumerics removed).
3. judge, only if the day's budget (`JUDGE_DAILY_CAP`, default 2000 per round date) and the session's allowance (6 calls per prompt) remain. Judge errors, timeouts (6 s) and malformed verdicts answer `attemptsLeft` and cache nothing.

Every judge verdict is cached, valid or not. A valid verdict whose `canonical` matches a bank answer scores as that bank answer; otherwise `pts = clamp(round(rarity), 20, 95)`. Other spellings of one new answer share its points through the cache entry for its canonical name.

Cost of the bank-hit path: 1 consistent read (session/prompt state), 1 conditional write (the lock) and 1 counter write (accepted-answer count). A cache hit adds 1 eventually consistent read. A miss adds 1 attempt write. A judge call adds a budget write, the judge itself, and 1 to 3 cache writes. `finish` is 1 query, 1 transaction and 1 read.

## API (JSON, prefix `/v1`)

Errors are `{ "error": "..." }` with 400 (bad input, or the prompt is already answered), 404 (unknown route or prompt) or 500. 429 is reserved; nothing returns it yet.

- `GET /v1/round?date=YYYY-MM-DD` returns `{ id, date, prompts: [{ id, category, q, note }] }`. No answers. Uses the latest round on or before the date, else the earliest. Defaults to today (UTC).
- `POST /v1/answer` takes `{ date, promptId, session, text }` or `{ date, promptId, session, timeout: true }`. `session` is 8-64 chars of `A-Za-z0-9_-`; `text` is trimmed, 1-60 chars.
  - accepted: `{ valid: true, answer: { a, pts, fact? }, how: "bank"|"cache"|"judge", stats }`
  - not accepted: `{ valid: false, attemptsLeft, why? }` (round stays open; 12 attempts per prompt; `why` only for a known wrong answer)
  - timeout or 12th failure: `{ valid: false, locked: true, stats }`
  - `stats` is `{ most: { a, pts }, rarest: { a, pts }, count }`, returned only with a locked prompt.
  - answering a prompt already locked for that session is a 400.
- `POST /v1/finish` takes `{ date, session }` and returns `{ score, results: [{ promptId, a, pts }], dist, ahead }`. The score is summed on the server from locked prompts (unanswered count 0). Finishing twice counts once and returns the first score. `ahead` is in 0..1, computed per 10-point bucket: sessions in lower buckets plus half of those in the same bucket (the caller included).
- `GET /v1/dist?date=` returns `{ counts: number[71], players }`; `counts[i]` is finished sessions with `floor(score / 10) = i`.
- `OPTIONS *` returns 204.

Keys use the resolved round's date, not the date in the request.

## Judge contract

`src/judge.mjs` exports `makeJudge({ provider, model, apiKey })` returning `async ({ prompt: { id, q, note, examples: [{ a, pts }] }, text }) => ({ valid, canonical, rarity, why })`. `wiring.mjs` imports it dynamically. For `openai` the key comes from `OPENAI_API_KEY`, else from SSM (`OPENAI_KEY_PARAM`, decrypted) at cold start only.
