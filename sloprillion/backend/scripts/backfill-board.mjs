// Copies every day's leaderboard entries onto the all-time board
// (L#<date> -> L#ALL), for the days played before the all-time board existed.
// A day's own entries expire after two weeks, so a day older than that has
// nothing left to copy. Safe to run again: a copy keeps its key.
//
//   AWS_PROFILE=... AWS_REGION=us-west-2 TABLE_NAME=... node scripts/backfill-board.mjs [--dry]

import { calendar } from "../../src/rounds/index.js";
import { ALL_TIME } from "../src/store-memory.mjs";

const DAY_MS = 86400000;

// Every date from the first round's day to tomorrow (UTC), which covers a
// player whose own calendar is a day ahead.
export function playedDates(now = Date.now()) {
  const out = [];
  for (let t = Date.parse(calendar[0].date + "T00:00:00Z"); t <= now + DAY_MS; t += DAY_MS) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

export async function backfill({ db, ddb, marshall, unmarshall, tableName, dates, dry = false, log = console.log }) {
  let copied = 0;
  for (const date of dates) {
    let from, rows = 0;
    do {
      const r = await db.send(new ddb.QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: marshall({ ":pk": `L#${date}` }),
        ConsistentRead: true,
        ExclusiveStartKey: from,
      }));
      for (const it of (r.Items || []).map((x) => unmarshall(x))) {
        rows += 1;
        if (!dry) {
          await db.send(new ddb.PutItemCommand({
            TableName: tableName,
            Item: marshall({ pk: `L#${ALL_TIME}`, sk: it.sk, name: it.name, score: it.score, date }),
          }));
        }
      }
      from = r.LastEvaluatedKey;
    } while (from);
    if (rows) log(`${date}: ${rows} ${dry ? "to copy" : "copied"}`);
    copied += rows;
  }
  return copied;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) { console.error("TABLE_NAME is not set"); process.exit(1); }
  const ddb = await import("@aws-sdk/client-dynamodb");
  const { marshall, unmarshall } = await import("@aws-sdk/util-dynamodb");
  const dry = process.argv.includes("--dry");
  const n = await backfill({ db: new ddb.DynamoDBClient({}), ddb, marshall, unmarshall, tableName, dates: playedDates(), dry });
  console.log(`${n} ${n === 1 ? "entry" : "entries"} ${dry ? "would be" : "now"} on the all-time board`);
}
