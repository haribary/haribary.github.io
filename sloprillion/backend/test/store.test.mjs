import { storeSuite } from "./store-suite.mjs";
import { createMemoryStore } from "../src/store-memory.mjs";

storeSuite("memory", async () => createMemoryStore());

// Point the same suite at a real table: STORE=dynamo TABLE_NAME=... node --test test/
if (process.env.STORE === "dynamo") {
  const { createDynamoStore } = await import("../src/store-dynamo.mjs");
  // An all-time board of the run's own: nothing here may land on the one players see.
  const allTimeBoard = "TEST-" + Date.now();
  storeSuite("dynamo", () => createDynamoStore({ tableName: process.env.TABLE_NAME, allTimeBoard }));
}
