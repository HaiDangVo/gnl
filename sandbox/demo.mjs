/**
 * Two sandbox games, A (alice) and B (bob), and a crossover between them: once honest, then once for each lie the
 * protocol must catch. Fails (exit 1) if the honest run finds anything or a lie goes uncaught.
 *
 *   npm run sandbox
 */
import assert from "node:assert/strict";
import { audit } from "./auditor.mjs";
import { hashOf, newKey, seal } from "../ref/gnl.js";
import { startNode, TOY } from "./node.mjs";
import { contractMonths, links, publicOf } from "./rules.mjs";

const SCENARIOS = [
  { name: "honest", expect: null },
  { name: "inflate", cheatA: "inflate", qty: 9000, expect: ["A", "R2"] },
  { name: "keep", cheatA: "keep", expect: ["A", "R4"] },
  { name: "pace", expect: ["A", "R3"] },
  { name: "fork", fork: true, expect: ["A", "R7", "forked"] },
  { name: "nogrant", cheatB: "nogrant", expect: ["B", "R7", "no grant"] },
  // Contracts (SPEC §5.1): B lets November's run out — in its last week nothing crosses; both renew — into December,
  // the line doubled
  { name: "lapse", days: 24, renewB: false, refused: /isn't signed by both/ },
  { name: "renewed", days: 33, months: 2 },
  // R9: what bob received from A can't leave B again — not back to A, not on to anyone (no laundering through B)
  { name: "relay", relay: true },
  // R10: bob takes from alice's account at A only; a second account of A sending him more is refused, and so is alice
  // sending to a second account at B
  { name: "sources", sources: true },
  // §8.1: A finds alice cheated what she carried and voids it: bob's unvested part taken back, both owe the crossover's
  // effort again; bob's next arrival pays his debt first, alice must pay hers before carrying anything out
  { name: "void", void: true },
  // §14: B's council, mia (master) and ned. Mia alone can't seat a friend or unseat ned; with ned she can. A price
  // mistake of B's is cut by the council, no one owes. Every act an `order` with its members' ballots, in B's log
  { name: "council", council: true },
  // §5.2: B is still a sandbox, A live. Alice can't take toy things into A, A's test account can; B starts over (a
  // new log) and that's no fork — a live game can't
  { name: "stage", stageB: "sandbox" },
];

/** A council member of the game at `origin`: their own key, their consent; `vote(order)` signs their yes. */
const member = (origin, account, master) => {
  const k = newKey(`council-${account}`);
  const m = { name: account, account, profile: `https://example.com/${account}`, kid: k.kid, x: k.jwk.x };
  return { account, seat: { member: m, consent: seal({ type: "consent", iss: origin, member: account, iat: "2026-10-01T00:00:00.000Z" }, k), ...(master ? { master } : {}) }, vote: (o) => seal({ type: "ballot", iss: origin, member: account, proposal: hashOf(o), choice: "yes" }, k) };
};

let port = 4100;
let failed = 0;
for (const s of SCENARIOS) {
  const A = await startNode({ name: "a", port: ++port, cheat: s.cheatA, config: { ...TOY, stage: "live" } });
  const bOrigin = `http://localhost:${++port}`;
  const crew = s.council && [member(bOrigin, "mia", true), member(bOrigin, "ned")];
  const B = await startNode({ name: "b", port, cheat: s.cheatB, config: { ...TOY, stage: s.stageB ?? "live", ...(crew ? { council: crew.map((c) => c.seat) } : {}) } });
  A.earn("alice", { gold: 2000, level: 1 }, true);
  B.earn("bob", { level: 1 }, true);
  let n = 0;
  const day = async () => {
    await A.newDay();
    await B.newDay();
    A.contracts([B.origin]);
    B.contracts([A.origin], { renew: s.renewB ?? true });
    // A day's play, scripted (`true`: past the online pace check) — the pace cheat fakes 100 000 gold on the third day
    A.earn("alice", { gold: 2000 + (s.name === "pace" && ++n === 3 ? 100_000 : 0), level: 1, gems: 5 }, true);
    B.earn("bob", { gold: 500 }, true);
    await A.witness([B.origin]);
    await B.witness([A.origin]);
    await B.runAudits();
  };
  try {
    for (let i = 0; i < (s.days ?? 5); i++) await day(); // Five days of alice's progress committed
    const before = { alice: A.player("alice"), bob: B.player("bob") };
    const tk = B.ticket("bob", A.origin);
    if (s.refused) {
      await assert.rejects(A.cross("alice", B.origin, [{ id: "gold", qty: 3000 }], tk), s.refused);
      console.log(`ok    ${s.name.padEnd(8)} refused: no contract for next month in this one's last week`);
      continue;
    }
    if (s.stageB) {
      await assert.rejects(A.cross("alice", B.origin, [{ id: "gold", qty: 3000 }], tk), /sandbox/, "alice, a real account at a live game, and a sandbox");
      A.earn("tester", { gold: 2000 }, true);
      await day();
      const ok = await A.cross("tester", B.origin, [{ id: "gold", qty: 500 }], B.ticket("bob", A.origin));
      assert.ok(ok.grant, "A's test account crosses");
      assert.equal(ok.offer.payload.test, true, "and its offer says test");
      B.rewrite(); // B starts over
      await day();
      assert.deepEqual(await audit([A.origin, B.origin]), [], "a sandbox starting over is no fork");
      console.log(`ok    ${s.name.padEnd(8)} refused: alice (live A) → sandbox B; A's test account crossed, marked test; B's new history no fork`);
      continue;
    }
    const r = await A.cross("alice", B.origin, [{ id: "gold", qty: s.qty ?? 3000 }], tk);
    if (s.sources) {
      assert.ok(r.grant, "granted");
      A.earn("carol", { gold: 2000 }, true);
      await A.newDay();
      await B.newDay();
      const second = await A.cross("carol", B.origin, [{ id: "gold", qty: 100 }], B.ticket("bob", A.origin));
      assert.match(second.refused ?? "", /SOURCE/, "a second account of A to bob");
      B.earn("dave", { level: 1 }, true);
      const third = await A.cross("alice", B.origin, [{ id: "gold", qty: 100 }], B.ticket("dave", A.origin));
      assert.match(third.refused ?? "", /SOURCE/, "alice to a second account at B");
      const again = await A.cross("alice", B.origin, [{ id: "gold", qty: 100 }], B.ticket("bob", A.origin));
      assert.ok(again.grant, "alice to bob again is fine");
      B.unlink("bob", A.origin); // bob undoes alice: a week before carol, and before alice can feed dave
      for (const [who, to] of [["carol", "bob"], ["alice", "dave"]]) {
        const r = await A.cross(who, B.origin, [{ id: "gold", qty: 100 }], B.ticket(to, A.origin));
        assert.match(r.refused ?? "", /waits 7 days/, `${who} → ${to} within the week`);
      }
      for (let i = 0; i < 7; i++) await day();
      const later = await A.cross("carol", B.origin, [{ id: "gold", qty: 100 }], B.ticket("bob", A.origin));
      assert.ok(later.grant, "a week later, carol may be bob's source");
      console.log(`ok    ${s.name.padEnd(8)} refused: carol (A) → bob, alice → dave (B); bob undid alice: a week later carol is his source`);
      continue;
    }
    if (s.council) {
      assert.ok(r.grant, "granted");
      const [mia, ned] = crew;
      const order = (op, fields, ...by) => {
        const o = { type: "order", iss: B.origin, op, ...fields, why: "demo", made: B.state.log.at(-1).payload.iat };
        return B.onOrder({ ...o, ballots: by.map((c) => c.vote(o)) });
      };
      const zoe = member(B.origin, "zoe");
      const seat = { member: zoe.seat.member, consent: zoe.seat.consent };
      await assert.rejects(order("seat", seat, mia), /1 of 2 seats/, "mia, master, is half the council: not enough to seat anyone");
      await order("seat", seat, mia, ned);
      await assert.rejects(order("unseat", { account: "ned" }, mia), /seats said yes/, "mia can't unseat ned alone");
      await order("unseat", { account: "zoe" }, mia, ned);
      await order("resign", { account: "ned" }, ned);
      const vesting = B.player("bob").vesting;
      await order("cut", { id: r.offer.payload.id }, mia);
      assert.equal(B.player("bob").vesting, 0, `${vesting} gold still vesting, cut`);
      assert.equal(B.player("bob").owes, 0, "a game's own mistake: nobody owes");
      const pub = await publicOf(B.origin);
      assert.deepEqual(pub.card.payload.council.map((m) => m.account), ["mia"]);
      assert.equal(links(pub.entries).breaches.length, 0, "R10 holds in B's log");
      console.log(`ok    ${s.name.padEnd(8)} mia alone refused; with ned zoe seated, then unseated; ned resigned; ${vesting} gold vesting cut, nobody owes`);
      continue;
    }
    if (s.void) {
      assert.ok(r.grant, "granted");
      await A.voidCrossover(r.offer.payload.id, "alice's gold came from a duplication bug she used");
      const [alice, bob] = [A.player("alice"), B.player("bob")];
      assert.equal(bob.vesting, 0, "what hadn't vested, taken back");
      assert.equal(alice.owes, 6000);
      assert.equal(bob.owes, 6000);
      await assert.rejects(A.cross("alice", B.origin, [{ id: "gold", qty: 3001 }], B.ticket("bob", A.origin)), /owed/);
      const paid = await A.cross("alice", B.origin, [{ id: "gold", qty: 1000 }], B.ticket("bob", A.origin));
      assert.equal(paid.owed, 4000, "1000 gold burnt toward alice's debt, nothing sent");
      assert.equal((await A.cross("alice", B.origin, [{ id: "gold", qty: 2000 }], B.ticket("bob", A.origin))).owed, 0, "alice's debt paid");
      const bobGold = B.player("bob").gold;
      const next = await A.cross("alice", B.origin, [{ id: "gold", qty: 1000 }], B.ticket("bob", A.origin));
      assert.ok(next.grant, "alice carries again");
      assert.equal(B.player("bob").owes, 4000, "bob's arrival went to his debt first");
      assert.equal(B.player("bob").gold, bobGold, "so nothing reached him");
      console.log(`ok    ${s.name.padEnd(8)} voided: bob's vesting gone, both owe 6000 cgnl; alice paid hers before carrying, bob's next 2000 went to his`);
      continue;
    }
    if (s.relay) {
      assert.ok(r.grant, "granted");
      const gold = B.player("bob").gold;
      await assert.rejects(B.cross("bob", A.origin, [{ id: "gold", qty: gold }], A.ticket("alice", B.origin)), /came from other games/);
      const own = await B.cross("bob", A.origin, [{ id: "gold", qty: 100 }], A.ticket("alice", B.origin));
      assert.ok(own.grant, "what bob earned at B still leaves");
      console.log(`ok    ${s.name.padEnd(8)} refused: bob's ${gold} gold would carry on what came from A (R9); 100 of his own went`);
      continue;
    }
    if (s.months) {
      assert.ok(r.grant, "granted");
      const n = contractMonths(await publicOf(B.origin), await publicOf(A.origin), A.state.log.at(-1).payload.iat);
      assert.equal(n, s.months, "two months running");
      console.log(`ok    ${s.name.padEnd(8)} crossed in December, the contract ${n} months running (line ×2)`);
      continue;
    }
    await day(); // A commits the day after the burn; B audits
    await day();
    if (s.fork) A.rewrite();
    const found = await audit([A.origin, B.origin]);
    const who = (o) => (o === A.origin ? "A" : "B");
    const after = { alice: A.player("alice"), bob: B.player("bob") };

    if (!s.expect) {
      assert.deepEqual(found, [], JSON.stringify(found, null, 1));
      assert.ok(r.grant, "granted");
      assert.equal(after.bob.gold - before.bob.gold - 1000, 400, "bob got 20% of 2000 gold up front (and grew 500 a day)");
      assert.equal(after.bob.vesting, 1600, "the rest vests");
      assert.equal(after.alice.gold, before.alice.gold - 3000 + 4000, "alice's 3000 gold gone (and grew 2000 a day)");
    } else {
      const [against, rule, why = ""] = s.expect;
      const hit = found.find((f) => who(f.against) === against && f.rule === rule && f.why.includes(why));
      assert.ok(hit, `expected ${rule} against ${against}, found ${JSON.stringify(found.map((f) => [who(f.against), f.rule, f.why]))}`);
      if (s.name === "inflate") assert.match(r.refused, /R2/, "B refused the offer itself");
      if (s.name === "keep" || s.name === "pace") {
        assert.ok(B.suspended.includes(A.origin), "B cut A off");
        assert.equal(after.bob.vesting, 0, "and took back what was still vesting");
      }
    }
    const lines = found.map((f) => `${f.rule} against ${who(f.against)}: ${f.why}`);
    console.log(`ok    ${s.name.padEnd(8)} ${lines.length ? lines[0] : "clean, 3000 gold → bob +400 now, 1600 vesting"}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${s.name.padEnd(8)} ${e.message}`);
  } finally {
    await A.close();
    await B.close();
  }
}
process.exit(failed ? 1 : 0);
