// Behaviour suite shared by every store implementation.
import test from "node:test";
import assert from "node:assert/strict";

export function storeSuite(name, makeStore) {
  const uniq = () => Math.random().toString(36).slice(2, 10);

  test(`${name}: attempts count and judge calls accumulate`, async () => {
    const s = await makeStore(), d = "2030-01-01", sess = "sess" + uniq();
    assert.equal(await s.getState(d, "p", sess), null);
    assert.deepEqual(await s.addAttempt(d, "p", sess, { judge: true }), { attempts: 1, judgeCalls: 1 });
    assert.deepEqual(await s.addAttempt(d, "p", sess), { attempts: 2, judgeCalls: 1 });
    const st = await s.getState(d, "p", sess);
    assert.equal(st.attempts, 2);
    assert.equal(st.locked, false);
  });

  test(`${name}: first lock wins, later locks refused`, async () => {
    const s = await makeStore(), d = "2030-01-01", sess = "sess" + uniq();
    await s.addAttempt(d, "p", sess);
    assert.equal(await s.lock(d, "p", sess, { a: "Foo", pts: 40 }), true);
    assert.equal(await s.lock(d, "p", sess, { a: "Bar", pts: 90 }), false);
    const st = await s.getState(d, "p", sess);
    assert.equal(st.locked, true);
    assert.equal(st.a, "Foo");
    assert.equal(st.pts, 40);
  });

  test(`${name}: a miss lock stores null and lists with 0 points`, async () => {
    const s = await makeStore(), d = "2030-01-01", sess = "sess" + uniq();
    assert.equal(await s.lock(d, "p1", sess, { a: null, pts: 0 }), true);
    await s.lock(d, "p2", sess, { a: "Yes", pts: 30 });
    const l = (await s.listLocked(d, sess)).sort((a, b) => (a.pid < b.pid ? -1 : 1));
    assert.deepEqual(l, [{ pid: "p1", a: null, pts: 0 }, { pid: "p2", a: "Yes", pts: 30 }]);
  });

  test(`${name}: verdict cache round trip`, async () => {
    const s = await makeStore(), vk = "t" + uniq() + ":p";
    assert.equal(await s.getVerdict(vk, "abc"), null);
    await s.putVerdict(vk, "abc", { valid: true, canonical: "Abc", pts: 55, why: "ok" });
    const v = await s.getVerdict(vk, "abc");
    assert.equal(v.valid, true);
    assert.equal(v.canonical, "Abc");
    assert.equal(v.pts, 55);
  });

  test(`${name}: judge budget is capped`, async () => {
    const s = await makeStore(), d = "2031-" + uniq();
    assert.equal(await s.takeJudgeBudget(d, 2), true);
    assert.equal(await s.takeJudgeBudget(d, 2), true);
    assert.equal(await s.takeJudgeBudget(d, 2), false);
  });

  test(`${name}: finish is idempotent and feeds the histogram`, async () => {
    const s = await makeStore(), d = "2032-" + uniq();
    const a = "sess" + uniq(), b = "sess" + uniq();
    assert.deepEqual(await s.finishSession(d, a, 255), { first: true, score: 255 });
    assert.deepEqual(await s.finishSession(d, a, 999), { first: false, score: 255 });
    await s.finishSession(d, b, 700);
    const dist = await s.getDist(d);
    assert.equal(dist.players, 2);
    assert.equal(dist.counts.length, 71);
    assert.equal(dist.counts[25], 1);
    assert.equal(dist.counts[70], 1);
    assert.equal(dist.counts.reduce((x, y) => x + y, 0), 2);
  });

  test(`${name}: an empty day has a zero histogram`, async () => {
    const s = await makeStore();
    const dist = await s.getDist("2033-" + uniq());
    assert.equal(dist.players, 0);
    assert.equal(dist.counts.length, 71);
  });

  test(`${name}: only a finished session can go on the board, and only once`, async () => {
    const s = await makeStore(), d = "2034-" + uniq(), sess = "sess" + uniq();
    assert.equal(await s.postBoard(d, sess, "Ada", 1000), null);
    assert.equal(await s.getBoardEntry(d, sess), null);
    await s.finishSession(d, sess, 320);
    const first = await s.postBoard(d, sess, "Ada", 1000);
    assert.equal(first.first, true);
    assert.equal(first.entry.name, "Ada");
    assert.equal(first.entry.score, 320);
    const again = await s.postBoard(d, sess, "Grace", 2000);
    assert.equal(again.first, false);
    assert.equal(again.entry.name, "Ada");
    assert.deepEqual(await s.getBoardEntry(d, sess), first.entry);
    assert.equal((await s.getBoardTop(d, 10)).length, 1);
  });

  test(`${name}: the board is best score first, earlier finisher first on a tie`, async () => {
    const s = await makeStore(), d = "2035-" + uniq();
    const post = async (label, score, at) => {
      const sess = "sess" + uniq();
      await s.finishSession(d, sess, score);
      return (await s.postBoard(d, sess, label, at)).entry;
    };
    const low = await post("Low", 90, 1000);
    const lateTie = await post("LateTie", 400, 3000);
    const top = await post("Top", 700, 5000);
    const earlyTie = await post("EarlyTie", 400, 2000);
    const zero = await post("Zero", 0, 4000);
    assert.deepEqual((await s.getBoardTop(d, 10)).map((e) => e.name), ["Top", "EarlyTie", "LateTie", "Low", "Zero"]);
    assert.deepEqual((await s.getBoardTop(d, 2)).map((e) => [e.name, e.score]), [["Top", 700], ["EarlyTie", 400]]);
    assert.equal(await s.getBoardRank(d, top.key), 1);
    assert.equal(await s.getBoardRank(d, earlyTie.key), 2);
    assert.equal(await s.getBoardRank(d, lateTie.key), 3);
    assert.equal(await s.getBoardRank(d, low.key), 4);
    assert.equal(await s.getBoardRank(d, zero.key), 5);
  });

  test(`${name}: an empty day has an empty board`, async () => {
    const s = await makeStore();
    assert.deepEqual(await s.getBoardTop("2036-" + uniq(), 10), []);
  });

  test(`${name}: sources count site visits, game visits and finished games per label, per day`, async () => {
    const s = await makeStore(), d = "2036-" + uniq(), tag = "t" + uniq();
    assert.deepEqual(await s.getSources(d), {});
    await s.addSource(d, "game", "direct");
    await s.addSource(d, "game", "direct");
    await s.addSource(d, "site", "direct");
    await s.addSource(d, "finished", "direct");
    await s.addSource(d, "site", tag);
    await s.addSource(d, "finished", "x.com");
    assert.deepEqual(await s.getSources(d), {
      direct: { site: 1, game: 2, finished: 1 },
      [tag]: { site: 1, game: 0, finished: 0 },
      "x.com": { site: 0, game: 0, finished: 1 },
    });
    assert.deepEqual(await s.getSources("2036-" + uniq()), {});
  });

  test(`${name}: the owner's lists: judge calls used, a day's answer counts, a prompt's verdicts`, async () => {
    const s = await makeStore(), d = "2036-" + uniq(), vk = "t" + uniq() + ":p", other = "t" + uniq() + ":p";
    assert.equal(await s.getJudgeUsed(d), 0);
    await s.takeJudgeBudget(d, 5);
    await s.takeJudgeBudget(d, 5);
    assert.equal(await s.getJudgeUsed(d), 2);

    assert.deepEqual(await s.listCounts(d), []);
    await s.incCount(d, "p-one", "foo", "Foo");
    await s.incCount(d, "p-one", "foo", "Foo");
    await s.incCount(d, "p-two", "bar", "Bar");
    const counts = (await s.listCounts(d)).sort((x, y) => (x.pid < y.pid ? -1 : 1));
    assert.deepEqual(counts, [{ pid: "p-one", name: "Foo", n: 2 }, { pid: "p-two", name: "Bar", n: 1 }]);

    assert.deepEqual(await s.listVerdicts(vk), []);
    await s.putVerdict(vk, "abc", { valid: true, canonical: "Abc", pts: 55, why: "ok", text: "A b c", at: 5 });
    await s.putVerdict(vk, "nope", { valid: false, canonical: null, pts: 0, why: "no" });
    await s.putVerdict(other, "elsewhere", { valid: false, canonical: null, pts: 0, why: "no" });
    const list = (await s.listVerdicts(vk)).sort((x, y) => (x.key < y.key ? -1 : 1));
    assert.deepEqual(list, [
      { key: "abc", valid: true, canonical: "Abc", pts: 55, why: "ok", text: "A b c", at: 5 },
      { key: "nope", valid: false, canonical: null, pts: 0, why: "no" },
    ]);
  });

  test(`${name}: incCount does not throw`, async () => {
    const s = await makeStore();
    await s.incCount("2030-01-01", "p", "foo", "Foo");
    await s.incCount("2030-01-01", "p", "foo", "Foo");
  });
}
