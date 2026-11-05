/**
 * The conformance test: point it at a game's origin and it checks what that game shows the world against SPEC.md —
 * its card, its log, its checkpoint, its daily commitment, the rules anyone can check, and that its game-to-game doors
 * refuse what they must. Read-only apart from requests that must be refused; it never needs the game's cooperation.
 *
 *   npm run conform -- https://your-game.example
 */
import { randomBytes } from "node:crypto";
import { arbitrage, contractWindow, hashOf, merkleRoot, newKey, seal } from "../ref/gnl.js";
import { consentOk, links, orderOk, publicOf, r2, roster, signedBy, stageOf, testers } from "./rules.mjs";

export async function conform(origin) {
  const out = [];
  const check = (name, ok, why = "") => out.push({ name, ok: !!ok, why: ok ? "" : why });
  let pub;
  try {
    pub = await publicOf(origin);
    check("card: served, signed by its own key, iss is the origin", true);
  } catch (e) {
    check("card, log and checkpoint served", false, e.message);
    return out;
  }
  const c = pub.card.payload;
  check("card: protocol gnl/0", c.protocol === "gnl/0", c.protocol);
  check("card: hoursPerDay within 0–16, minor ≤ adult", c.hoursPerDay?.minor >= 0 && c.hoursPerDay.adult <= 16 && c.hoursPerDay.minor <= c.hoursPerDay.adult, JSON.stringify(c.hoursPerDay));
  check("card: pace is data — {burst, perHour} per field, nothing to run", Object.values(c.pace ?? {}).every((g) => Number.isFinite(g.burst) && Number.isFinite(g.perHour) && Object.keys(g).length === 2), "pace");
  const rateOk = (r) => /^[a-z0-9][a-z0-9._-]{0,63}$/.test(r.id) && Number.isInteger(r.cgnlPer) && r.cgnlPer >= 1 && String(r.name).length <= 64 && !/[<>]/.test(r.name);
  check("card: exports and imports well formed (ids, integer cgnlPer ≥ 1, plain names ≤ 64)", [...c.exports, ...c.imports].every(rateOk), "rates");
  const arb = arbitrage(c);
  check("R8: no arbitrage (import ≥ export for every thing)", !arb.length, arb.join(", "));
  const unsigned = pub.entries.filter((e) => !signedBy(e, pub));
  check("R1: every log entry signed by the game", !unsigned.length, `${unsigned.length} not`);
  const cp = pub.checkpoint;
  check("checkpoint: signed by the game", signedBy(cp, pub), "signature");
  check("checkpoint: matches the served entries", cp.payload.size === pub.entries.length && merkleRoot(pub.entries) === cp.payload.root, `size ${cp.payload.size} vs ${pub.entries.length}`);
  const age = Date.now() - Date.parse(cp.payload.t);
  check("checkpoint: from the last 26 hours", age < 26 * 3_600_000, `${Math.round(age / 3_600_000)} h old`);
  const commit = pub.entries.findLast((e) => e.payload.type === "commit");
  check("daily commitment: one in the last 26 hours", commit && Date.now() - Date.parse(commit.payload.iat) < 26 * 3_600_000, commit ? commit.payload.day : "none");
  check("card: the card served is in the log, dated (§4)", pub.entries.some((e) => e.payload.type === "card" && hashOf(e.payload) === hashOf(c)), "not logged");
  const contracts = pub.entries.filter((e) => e.payload.type === "contract");
  const outside = contracts.filter((e) => !/^\d{4}-\d{2}$/.test(e.payload.month) || !(e.payload.iat >= contractWindow(e.payload.month).opens && e.payload.iat < contractWindow(e.payload.month).ends) || !/^https:\/\//.test(e.payload.aud));
  check("contracts: each signed for a month, within its window (§5.1)", !outside.length, `${outside.length} not`);
  const joins = pub.entries.filter((e) => e.payload.type === "council" && e.payload.op === "join");
  const forged = joins.filter((e) => !consentOk(origin, e.payload.member, e.payload.consent));
  check("council: every member seated with their own signed consent (§14)", !forged.length, forged.map((e) => e.payload.member.account).join(", "));
  const r = roster(pub.entries);
  check("council: the card's council is the log's, with one master among them", JSON.stringify(c.council ?? []) === JSON.stringify(r.members) && (!r.members.length || r.members.some((m) => m.account === c.master)), "card ≠ log");
  // §14: after the first council, every change and every act of the game's own is an order its council signed
  const orders = new Map();
  const unbacked = [];
  const first = pub.entries.findIndex((e) => e.payload.type === "council");
  let seeded = first; // The first council: the run of joins the log starts it with
  while (seeded >= 0 && pub.entries[seeded]?.payload.type === "council" && pub.entries[seeded].payload.op === "join") seeded++;
  pub.entries.forEach((e, i) => {
    const p = e.payload;
    if (p.type === "order") {
      const why = orderOk(pub.entries.slice(0, i), p, p.iat);
      if (why) unbacked.push(`order ${p.op}: ${why}`);
      else orders.set(hashOf(Object.fromEntries(Object.entries(p).filter(([k]) => k !== "ballots" && k !== "iat"))), p);
    }
    if (p.type === "council" && !(i >= first && i < seeded) && !orders.has(p.order)) unbacked.push(`council ${p.op} ${p.member.account}`);
    if ((p.type === "void" || p.type === "cut" || p.type === "issue") && roster(pub.entries.slice(0, i), p.iat).members.length && orders.get(p.order)?.id !== p.id) unbacked.push(`${p.type} ${p.id}`);
  });
  check("council: after the first, every change and the game's own acts are orders its council signed (§14)", !unbacked.length, unbacked.slice(0, 3).join("; "));
  const l = links(pub.entries);
  const firstLink = pub.entries.findIndex((e) => e.payload.type === "link");
  const bare = firstLink < 0 ? [] : pub.entries.slice(firstLink).filter((e) => e.payload.type === "accept" && !e.payload.holder);
  check("R10: links logged, one source at a time, a week after undoing one; every accept names its holder", !l.breaches.length && !bare.length, l.breaches[0] ?? `accept ${bare[0]?.payload.id} without a holder`);
  // §5.2: a sandbox until it goes live, once; live, it crossed both ways while still a sandbox, and its crossings with
  // sandboxes since are its test accounts
  check("stage: the card says sandbox or live (§5.2)", c.stage === "sandbox" || c.stage === "live", String(c.stage));
  const cards = pub.entries.filter((e) => e.payload.type === "card" && e.payload.stage);
  const wentLive = cards.findIndex((e) => e.payload.stage === "live");
  check("stage: live is for good — no sandbox card after a live one", wentLive < 0 || cards.slice(wentLive).every((e) => e.payload.stage === "live"), "went back");
  if (c.stage === "live") {
    const before = pub.entries.slice(0, pub.entries.indexOf(cards[wentLive]));
    check("stage: tried before going live — at least one crossover out (burn) and one in (grant)", before.some((e) => e.payload.type === "burn") && before.some((e) => e.payload.type === "grant"), "none while a sandbox");
    const from = cards[0] ? pub.entries.indexOf(cards[0]) : pub.entries.length;
    const others = new Map();
    for (const o of new Set(pub.entries.filter((e) => e.payload.type === "contract").map((e) => e.payload.aud))) others.set(o, await publicOf(o).catch(() => null));
    const stageAt = (o, t) => stageOf(others.get(o)?.entries.findLast((e) => e.payload.type === "card" && e.payload.iat <= t)?.payload);
    const unmarked = pub.entries.slice(from).filter((e) => (e.payload.type === "offer" || e.payload.type === "accept") && stageAt(e.payload.aud, e.payload.iat) !== "live" && !e.payload.test);
    check("stage: every crossing with a sandbox marked test (§5.2)", !unmarked.length, `${unmarked[0]?.payload.type} ${unmarked[0]?.payload.id}`);
    const t = testers(pub.entries);
    const toLive = pub.entries.filter((e) => e.payload.type === "offer" && t.set.has(e.payload.player) && stageAt(e.payload.aud, e.payload.iat) === "live");
    check("stage: test accounts registered (`tester`), for good, only with sandboxes, at most 20 (§5.2)", !t.breaches.length && !toLive.length, t.breaches[0] ?? `offer ${toLive[0]?.payload.id} to a live game`);
  }
  // §5.2: a staging copy, when a live game names one, is a sandbox naming it back
  if (c.staging) {
    const st = await publicOf(c.staging).catch(() => null);
    check("staging: a sandbox whose card names this game back (stagingOf)", st?.card.payload.stage === "sandbox" && st.card.payload.stagingOf === origin, st ? `${st.card.payload.stage}, stagingOf ${st.card.payload.stagingOf}` : "unreachable");
  }
  const effort = await fetch(`${origin}/gnl/effort.json`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
  check("effort sheet: /gnl/effort.json, a thing for each export at the card's prices (§4.1)", effort && c.exports.every((x) => effort.things?.some((t) => t.id === x.id && t.out === x.cgnlPer)), "missing or off the card");
  const bad = pub.entries.filter((e) => e.payload.type === "offer").map((e) => r2(pub, e)).filter(Boolean);
  check("R2: every logged offer within its time bound", !bad.length, bad[0]);

  // Doors that must refuse: no ticket, a stranger's signature, someone else's audit
  const stranger = newKey("stranger");
  const strangerOrigin = "https://stranger.invalid";
  const refuse = async (name, path, body) => {
    const r = await fetch(`${origin}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => null);
    check(name, r.status >= 400 && r.status < 500 && j?.error?.code, `HTTP ${r.status} ${JSON.stringify(j)?.slice(0, 80)}`);
  };
  const id = randomBytes(16).toString("base64url");
  await refuse("POST /gnl/offer: garbage refused with { error }", "/gnl/offer", { hello: 1 });
  await refuse("POST /gnl/offer: a stranger's offer refused", "/gnl/offer", seal({ type: "offer", id, iss: strangerOrigin, aud: origin, iat: new Date().toISOString() }, stranger));
  await refuse("POST /gnl/burn: a burn for no accept refused", "/gnl/burn", seal({ type: "burn", id, iss: strangerOrigin, aud: origin, accept: id }, stranger));
  await refuse("POST /gnl/audit: an audit from a stranger refused", "/gnl/audit", seal({ type: "audit", iss: strangerOrigin, aud: origin, offer: id }, stranger));
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let failed = 0;
  for (const origin of process.argv.slice(2)) {
    console.log(origin);
    for (const r of await conform(origin)) {
      failed += !r.ok;
      console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.why ? `  — ${r.why}` : ""}`);
    }
  }
  process.exit(failed ? 1 : 0);
}
