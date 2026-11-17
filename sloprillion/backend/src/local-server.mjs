// Local dev server: the app on node:http with the in-memory store, port 8787.
// Run: node src/local-server.mjs   (JUDGE_PROVIDER=... to enable the judge)

import http from "node:http";
import { createApp } from "./app.mjs";
import { createMemoryStore } from "./store-memory.mjs";
import { loadRounds, loadJudge, appConfig } from "./wiring.mjs";

const PORT = Number(process.env.PORT) || 8787;
const ALLOWED = new Set(["http://localhost:5199", "http://127.0.0.1:5199"]);

const app = createApp({
  store: createMemoryStore(),
  judge: await loadJudge(),
  rounds: await loadRounds(),
  config: appConfig(),
});

http
  .createServer(async (req, res) => {
    const origin = req.headers.origin;
    const cors = {
      "access-control-allow-origin": ALLOWED.has(origin) ? origin : "http://localhost:5199",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "600",
      vary: "origin",
    };
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > 16384) { res.writeHead(413, cors).end(); return; }
      chunks.push(c);
    }
    const url = new URL(req.url, "http://localhost");
    const out = await app({
      method: req.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      body: chunks.length ? Buffer.concat(chunks).toString("utf8") : undefined,
    });
    res.writeHead(out.status, { ...out.headers, ...cors });
    res.end(out.body == null ? "" : JSON.stringify(out.body));
  })
  .listen(PORT, () => console.log(`sloprillion api on http://localhost:${PORT}`));
