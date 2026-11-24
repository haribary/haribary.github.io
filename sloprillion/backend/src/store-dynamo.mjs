// DynamoDB store: one table, keys pk (S) and sk (S), on-demand billing.
//
// Key layout (date is the round's date, vk is "<round id>:<prompt id>"):
//   S#<date>#<session>  P#<promptId>        attempts, judgeCalls, locked, a, pts, ttl
//   S#<date>#<session>  FIN                 score, ttl            (written once: "finish once")
//                                           + name, bkey once the session is on the leaderboard
//   L#<date>            <board key>         name, score, ttl      (the day's leaderboard, best first; see boardKey)
//   L#ALL               <board key>         name, score, date     (every day's entries: the board players see; kept for good)
//   V#<vk>              <normalised text>   verdict cache: valid, canonical, pts, why, text, at
//   C#<date>            <promptId>#<canon>  name, n               (accepted-answer counters)
//   B#<date>            JUDGE               n, ttl                (daily judge budget)
//   D#<date>            HIST                players, b0..b70      (finished-score histogram)
//   R#<date>            SRC                 s:<source>, v:<source>, f:<source>
//                                           (site visits, game visits and finished games per source)
//
// Interface and behaviour match store-memory.mjs; test/store.test.mjs runs the
// same suite against either (STORE=dynamo TABLE_NAME=... node --test test/).

import { boardKey, ALL_TIME } from "./store-memory.mjs";

const TTL_DAYS = 14;
const SOURCE_KINDS = { site: "s", game: "v", finished: "f" }; // attribute prefix for each kind of count
const BUCKETS = 71;
const ttlFrom = (nowMs) => Math.floor(nowMs / 1000) + TTL_DAYS * 86400;

// `allTimeBoard` names the partition the all-time board lives in. Only a test
// run sets it, so that its entries stay off the board players see.
export async function createDynamoStore({ tableName, client, now = Date.now, allTimeBoard = ALL_TIME }) {
  const ddb = await import("@aws-sdk/client-dynamodb");
  const { marshall, unmarshall } = await import("@aws-sdk/util-dynamodb");
  const db = client || new ddb.DynamoDBClient({});
  const M = (o) => marshall(o, { removeUndefinedValues: true });
  const TableName = tableName;
  const ttl = () => ttlFrom(now());

  const send = (cmd) => db.send(cmd);
  const isCondFail = (e) => e?.name === "ConditionalCheckFailedException";
  const sKey = (date, session, sk) => M({ pk: `S#${date}#${session}`, sk });
  const boardPk = (board) => `L#${board === ALL_TIME ? allTimeBoard : board}`; // a date, or ALL_TIME

  async function get(key, consistent = false) {
    const r = await send(new ddb.GetItemCommand({ TableName, Key: key, ConsistentRead: consistent }));
    return r.Item ? unmarshall(r.Item) : null;
  }

  // Every item under one partition key, up to `max`.
  async function queryAll(pk, max = 2000) {
    const out = [];
    let from;
    do {
      const r = await send(new ddb.QueryCommand({
        TableName,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: M({ ":pk": pk }),
        ExclusiveStartKey: from,
      }));
      for (const it of r.Items || []) out.push(unmarshall(it));
      from = r.LastEvaluatedKey;
    } while (from && out.length < max);
    return out.slice(0, max);
  }

  return {
    async getState(date, pid, session) {
      const it = await get(sKey(date, session, `P#${pid}`), true);
      if (!it) return null;
      return { attempts: it.attempts || 0, judgeCalls: it.judgeCalls || 0, locked: !!it.locked, a: it.a ?? null, pts: it.pts || 0 };
    },

    async addAttempt(date, pid, session, { judge = false } = {}) {
      const r = await send(new ddb.UpdateItemCommand({
        TableName,
        Key: sKey(date, session, `P#${pid}`),
        UpdateExpression: "ADD attempts :one, judgeCalls :j SET #t = :ttl",
        ExpressionAttributeNames: { "#t": "ttl" },
        ExpressionAttributeValues: M({ ":one": 1, ":j": judge ? 1 : 0, ":ttl": ttl() }),
        ReturnValues: "ALL_NEW",
      }));
      const it = unmarshall(r.Attributes);
      return { attempts: it.attempts, judgeCalls: it.judgeCalls };
    },

    async lock(date, pid, session, { a, pts }) {
      try {
        await send(new ddb.UpdateItemCommand({
          TableName,
          Key: sKey(date, session, `P#${pid}`),
          UpdateExpression: "SET locked = :t, a = :a, pts = :p, #t = :ttl",
          ConditionExpression: "attribute_not_exists(locked)",
          ExpressionAttributeNames: { "#t": "ttl" },
          ExpressionAttributeValues: M({ ":t": true, ":a": a, ":p": pts, ":ttl": ttl() }),
        }));
        return true;
      } catch (e) {
        if (isCondFail(e)) return false;
        throw e;
      }
    },

    async listLocked(date, session) {
      const r = await send(new ddb.QueryCommand({
        TableName,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :p)",
        ExpressionAttributeValues: M({ ":pk": `S#${date}#${session}`, ":p": "P#" }),
        ConsistentRead: true,
      }));
      return (r.Items || []).map(unmarshall).filter((x) => x.locked)
        .map((x) => ({ pid: x.sk.slice(2), a: x.a ?? null, pts: x.pts || 0 }));
    },

    async getVerdict(vk, key) {
      const it = await get(M({ pk: `V#${vk}`, sk: key }));
      if (!it) return null;
      const { pk, sk, ...v } = it;
      return v;
    },
    async putVerdict(vk, key, verdict) {
      await send(new ddb.PutItemCommand({ TableName, Item: M({ pk: `V#${vk}`, sk: key, ...verdict }) }));
    },

    async takeJudgeBudget(date, cap) {
      try {
        await send(new ddb.UpdateItemCommand({
          TableName,
          Key: M({ pk: `B#${date}`, sk: "JUDGE" }),
          UpdateExpression: "ADD n :one SET #t = :ttl",
          ConditionExpression: "attribute_not_exists(n) OR n < :cap",
          ExpressionAttributeNames: { "#t": "ttl" },
          ExpressionAttributeValues: M({ ":one": 1, ":cap": cap, ":ttl": ttl() }),
        }));
        return true;
      } catch (e) {
        if (isCondFail(e)) return false;
        throw e;
      }
    },

    async incCount(date, pid, canonKey, name) {
      await send(new ddb.UpdateItemCommand({
        TableName,
        Key: M({ pk: `C#${date}`, sk: `${pid}#${canonKey}` }),
        UpdateExpression: "ADD n :one SET #nm = :name",
        ExpressionAttributeNames: { "#nm": "name" },
        ExpressionAttributeValues: M({ ":one": 1, ":name": name }),
      }));
    },

    // Put FIN (only if absent) and bump the histogram in one transaction.
    async finishSession(date, session, score) {
      const bucket = Math.min(BUCKETS - 1, Math.max(0, Math.floor(score / 10)));
      try {
        await send(new ddb.TransactWriteItemsCommand({
          TransactItems: [
            { Put: { TableName, Item: M({ pk: `S#${date}#${session}`, sk: "FIN", score, ttl: ttl() }), ConditionExpression: "attribute_not_exists(pk)" } },
            { Update: {
              TableName,
              Key: M({ pk: `D#${date}`, sk: "HIST" }),
              UpdateExpression: `ADD players :one, b${bucket} :one`,
              ExpressionAttributeValues: M({ ":one": 1 }),
            } },
          ],
        }));
        return { first: true, score };
      } catch (e) {
        if (e?.name !== "TransactionCanceledException") throw e;
        const fin = await get(sKey(date, session, "FIN"), true);
        if (!fin) throw e;
        return { first: false, score: fin.score };
      }
    },

    async getDist(date) {
      const it = await get(M({ pk: `D#${date}`, sk: "HIST" }), true);
      const counts = Array.from({ length: BUCKETS }, (_, i) => (it && it[`b${i}`]) || 0);
      return { counts, players: (it && it.players) || 0 };
    },

    // Name the FIN item (only if it has no name yet) and add the leaderboard
    // items, the day's and the all-time one, in one transaction, so a day's
    // game is on each board at most once. The all-time item carries no ttl.
    async postBoard(date, session, name, at) {
      const fin = await get(sKey(date, session, "FIN"), true);
      if (!fin) return null;
      if (fin.bkey) return { first: false, entry: { name: fin.name, score: fin.score, key: fin.bkey } };
      const key = boardKey(fin.score, at, session);
      try {
        await send(new ddb.TransactWriteItemsCommand({
          TransactItems: [
            { Update: {
              TableName,
              Key: sKey(date, session, "FIN"),
              UpdateExpression: "SET #name = :name, bkey = :key",
              ConditionExpression: "attribute_exists(pk) AND attribute_not_exists(bkey)",
              ExpressionAttributeNames: { "#name": "name" },
              ExpressionAttributeValues: M({ ":name": name, ":key": key }),
            } },
            { Put: { TableName, Item: M({ pk: boardPk(date), sk: key, name, score: fin.score, ttl: ttl() }) } },
            { Put: { TableName, Item: M({ pk: boardPk(ALL_TIME), sk: key, name, score: fin.score, date }) } },
          ],
        }));
        return { first: true, entry: { name, score: fin.score, key } };
      } catch (e) {
        if (e?.name !== "TransactionCanceledException") throw e;
        const again = await get(sKey(date, session, "FIN"), true);
        if (!again?.bkey) throw e;
        return { first: false, entry: { name: again.name, score: again.score, key: again.bkey } };
      }
    },

    async getBoardEntry(date, session) {
      const fin = await get(sKey(date, session, "FIN"), true);
      return fin?.bkey ? { name: fin.name, score: fin.score, key: fin.bkey } : null;
    },

    // `board` is a date, or ALL_TIME.
    async getBoardTop(board, limit) {
      const r = await send(new ddb.QueryCommand({
        TableName,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: M({ ":pk": boardPk(board) }),
        Limit: limit,
        ConsistentRead: true,
      }));
      return (r.Items || []).map((it) => unmarshall(it)).map((it) => ({ name: it.name, score: it.score, key: it.sk }));
    },

    // Counts the entries that sort ahead of this one.
    async getBoardRank(board, key) {
      let ahead = 0, from;
      do {
        const r = await send(new ddb.QueryCommand({
          TableName,
          KeyConditionExpression: "pk = :pk AND sk < :key",
          ExpressionAttributeValues: M({ ":pk": boardPk(board), ":key": key }),
          Select: "COUNT",
          ConsistentRead: true,
          ExclusiveStartKey: from,
        }));
        ahead += r.Count || 0;
        from = r.LastEvaluatedKey;
      } while (from);
      return ahead + 1;
    },

    // One item per day holds every source as a pair of top-level counters, so
    // a visit is one write, the day reads back in one get, and the item size
    // limit caps how many made-up labels a day can collect. No ttl: the
    // history is the point.
    async addSource(date, kind, src) {
      await send(new ddb.UpdateItemCommand({
        TableName,
        Key: M({ pk: `R#${date}`, sk: "SRC" }),
        UpdateExpression: "ADD #n :one",
        ExpressionAttributeNames: { "#n": `${SOURCE_KINDS[kind]}:${src}` },
        ExpressionAttributeValues: M({ ":one": 1 }),
      }));
    },

    async getSources(date) {
      const it = (await get(M({ pk: `R#${date}`, sk: "SRC" }), true)) || {};
      const out = {};
      for (const [attr, n] of Object.entries(it)) {
        const kind = Object.keys(SOURCE_KINDS).find((k) => attr.startsWith(SOURCE_KINDS[k] + ":"));
        if (!kind) continue;
        (out[attr.slice(2)] ||= { site: 0, game: 0, finished: 0 })[kind] = n;
      }
      return out;
    },

    // ---- the owner's views: read-only, never reached by a player ----

    async getJudgeUsed(date) {
      const it = await get(M({ pk: `B#${date}`, sk: "JUDGE" }));
      return (it && it.n) || 0;
    },

    async listCounts(date) {
      return (await queryAll(`C#${date}`)).map((it) => {
        const cut = it.sk.indexOf("#"); // prompt ids hold no "#"
        return { pid: it.sk.slice(0, cut), name: it.name, n: it.n || 0 };
      });
    },

    async listVerdicts(vk) {
      return (await queryAll(`V#${vk}`)).map(({ pk, sk, ...v }) => ({ key: sk, ...v }));
    },
  };
}
