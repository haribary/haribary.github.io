// DynamoDB store: one table, keys pk (S) and sk (S), on-demand billing.
//
// Key layout (date is the round's date, vk is "<round id>:<prompt id>"):
//   S#<date>#<session>  P#<promptId>        attempts, judgeCalls, locked, a, pts, ttl
//   S#<date>#<session>  FIN                 score, ttl            (written once: "finish once")
//   V#<vk>              <normalised text>   verdict cache: valid, canonical, pts, why
//   C#<date>            <promptId>#<canon>  name, n               (accepted-answer counters)
//   B#<date>            JUDGE               n, ttl                (daily judge budget)
//   D#<date>            HIST                players, b0..b70      (finished-score histogram)
//
// Interface and behaviour match store-memory.mjs; test/store.test.mjs runs the
// same suite against either (STORE=dynamo TABLE_NAME=... node --test test/).

const TTL_DAYS = 14;
const BUCKETS = 71;
const ttlFrom = (nowMs) => Math.floor(nowMs / 1000) + TTL_DAYS * 86400;

export async function createDynamoStore({ tableName, client, now = Date.now }) {
  const ddb = await import("@aws-sdk/client-dynamodb");
  const { marshall, unmarshall } = await import("@aws-sdk/util-dynamodb");
  const db = client || new ddb.DynamoDBClient({});
  const M = (o) => marshall(o, { removeUndefinedValues: true });
  const TableName = tableName;
  const ttl = () => ttlFrom(now());

  const send = (cmd) => db.send(cmd);
  const isCondFail = (e) => e?.name === "ConditionalCheckFailedException";
  const sKey = (date, session, sk) => M({ pk: `S#${date}#${session}`, sk });

  async function get(key, consistent = false) {
    const r = await send(new ddb.GetItemCommand({ TableName, Key: key, ConsistentRead: consistent }));
    return r.Item ? unmarshall(r.Item) : null;
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
  };
}
