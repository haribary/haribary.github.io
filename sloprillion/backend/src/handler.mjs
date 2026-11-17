// Lambda entry for a Function URL (payload format 2.0). The store, judge and
// rounds are built once per cold start. CORS is added by the Function URL.

import { createApp } from "./app.mjs";
import { createMemoryStore } from "./store-memory.mjs";
import { loadRounds, loadJudge, appConfig } from "./wiring.mjs";

let booting = null;

function boot() {
  return (async () => {
    const env = process.env;
    let store;
    if (env.TABLE_NAME) {
      const { createDynamoStore } = await import("./store-dynamo.mjs");
      store = await createDynamoStore({ tableName: env.TABLE_NAME });
    } else {
      console.warn("sloprillion: TABLE_NAME unset, using the in-memory store");
      store = createMemoryStore();
    }
    return createApp({ store, judge: await loadJudge(env), rounds: await loadRounds(), config: appConfig(env) });
  })();
}

export async function handler(event) {
  try {
    booting ||= boot().catch((e) => { booting = null; throw e; });
    const app = await booting;
    const http = event.requestContext?.http || {};
    let body = event.body;
    if (body && event.isBase64Encoded) body = Buffer.from(body, "base64").toString("utf8");
    const res = await app({
      method: http.method || "GET",
      path: event.rawPath || "/",
      query: event.queryStringParameters || {},
      body,
    });
    return {
      statusCode: res.status,
      headers: res.headers,
      body: res.body == null ? "" : JSON.stringify(res.body),
    };
  } catch (e) {
    console.error("sloprillion handler error:", e?.message || e);
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: "internal error" }),
    };
  }
}
