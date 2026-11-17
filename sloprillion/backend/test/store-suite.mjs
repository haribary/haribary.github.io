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

  test(`${name}: incCount does not throw`, async () => {
    const s = await makeStore();
    await s.incCount("2030-01-01", "p", "foo", "Foo");
    await s.incCount("2030-01-01", "p", "foo", "Foo");
  });
}
