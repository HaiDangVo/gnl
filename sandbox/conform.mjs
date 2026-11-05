/**
 * The conformance test: point it at a game's origin and it checks what that game shows the world against SPEC.md —
 * its card, its log, its checkpoint, its daily commitment, the rules anyone can check, and that its game-to-game doors
 * refuse what they must. Read-only apart from requests that must be refused; it never needs the game's cooperation.
 *
 *   npm run conform -- https://your-game.example
 */
import { randomBytes } from "node:crypto";
import { arbitrage, contractWindow, hashOf, merkleRoot, newKey, seal } from "../ref/gnl.js";
import { consentOk, publicOf, r2, roster, signedBy } from "./rules.mjs";

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
