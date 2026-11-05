// The reference pieces' own check: `npm run check`. Fails loudly if any of them breaks.
import assert from "node:assert/strict";
import { arbitrage, canonical, contractWindow, hashOf, inclusionProof, merkleRoot, monthAdd, newKey, opens, paceBreaks, seal, tally, tallyProtocol, timeBound, verifyInclusion } from "./gnl.js";

// JCS: key order and whitespace never change the bytes signed
assert.equal(canonical({ b: 1, a: [true, null, "x"], c: { z: 1.5, y: "é" } }), '{"a":[true,null,"x"],"b":1,"c":{"y":"é","z":1.5}}');
assert.equal(hashOf({ a: 1, b: 2 }), hashOf({ b: 2, a: 1 }));
assert.throws(() => canonical({ x: NaN }));

// Envelopes: a game's signature opens with its card's keys, and with nothing else; any edit breaks it
const a = newKey("a-2026-11"), other = newKey("x-1");
const offer = { type: "offer", id: "o1", iss: "https://a.example", aud: "https://b.example", cgnl: 1250 };
const env = seal(offer, a);
assert.ok(opens(env, [a.jwk]));
assert.ok(!opens(env, [other.jwk]));
assert.ok(!opens({ ...env, sig: { ...env.sig, kid: "x-1" } }, [other.jwk]));
assert.ok(!opens({ ...env, payload: { ...offer, cgnl: 99_999 } }, [a.jwk]));

// The log's tree: every entry's path proves it under the root, at every size, and nothing else does
for (let n = 1; n <= 17; n++) {
  const entries = Array.from({ length: n }, (_, i) => ({ n: i }));
  const root = merkleRoot(entries);
  for (let i = 0; i < n; i++) assert.ok(verifyInclusion(entries[i], i, n, inclusionProof(entries, i), root), `${i}/${n}`);
  if (n > 1) assert.ok(!verifyInclusion({ n: 999 }, 0, n, inclusionProof(entries, 0), root));
}

// R8 no arbitrage, R2 time bound
assert.deepEqual(arbitrage({ exports: [{ id: "sword", cgnlPer: 500 }, { id: "gold", cgnlPer: 1 }], imports: [{ id: "sword", cgnlPer: 400 }, { id: "gold", cgnlPer: 2 }] }), ["sword"]);
const day = 86_400_000, t0 = Date.UTC(2026, 10, 1);
assert.equal(timeBound({ firstDay: t0, now: t0 + 3 * day, hoursPerDay: 1, exported: 0 }), 300); // A minor in Vietnam: 3 days, 3 hours
assert.equal(timeBound({ firstDay: t0, now: t0 + 3 * day, hoursPerDay: 1, exported: 500 }), 0);

// R3 pace: an hour allows burst + perHour, not a coin more
const pace = { gold: { burst: 100, perHour: 1000 }, level: { burst: 1, perHour: 0 } };
assert.deepEqual(paceBreaks(pace, { gold: 0, level: 3 }, { gold: 1100, level: 4 }, 3600), []);
assert.deepEqual(paceBreaks(pace, { gold: 0, level: 3 }, { gold: 1101, level: 5 }, 3600), ["gold", "level"]);

// Contracts: December's renews in November's last 7 days; a new start may be signed inside its own month
assert.equal(monthAdd("2026-12", 1), "2027-01");
assert.equal(monthAdd("2027-01", -1), "2026-12");
assert.deepEqual(contractWindow("2026-12"), { opens: "2026-11-24T00:00:00.000Z", starts: "2026-12-01T00:00:00.000Z", ends: "2027-01-01T00:00:00.000Z" });
assert.equal(contractWindow("2027-03").opens, "2027-02-22T00:00:00.000Z", "February's last 7 days");

// Decisions: 55 of 100 — the host alone (50) can't, the whole community alone (50) can't; the host and 10% of the
// eligible players can
assert.equal(tally({ host: "yes", yes: 0, eligible: 100 }).pass, false);
assert.equal(tally({ host: "no", yes: 100, eligible: 100 }).pass, false);
assert.equal(tally({ host: "yes", yes: 9, eligible: 100 }).pass, false);
assert.equal(tally({ host: "yes", yes: 10, eligible: 100 }).pass, true);
assert.equal(tally({ host: "yes", yes: 0, eligible: 3 }).pass, true, "a small game: its host decides, and the tally shows eligible 3");
const games = [{ host: "yes", yes: 50, eligible: 100 }, { host: "no", yes: 100, eligible: 100 }, { host: "yes", yes: 0, eligible: 100 }];
assert.equal(tallyProtocol(games).pass, true, "(75 + 50 + 50) / 3 ≈ 58");
assert.equal(tallyProtocol(games.slice(1)).pass, false, "(50 + 50) / 2 = 50");

console.log("ok  gio-no-luc reference");
