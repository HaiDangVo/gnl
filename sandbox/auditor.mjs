/**
 * The auditor anyone can run: reads every game's public log and checks the rules that need no one's consent — R1
 * signatures, R2 time bounds, R7 promises and forks, R10 links — and re-checks every fraud proof a game logged (R3/R4 from
 * audits). It trusts no game, only signatures and arithmetic.
 *
 *   node sandbox/auditor.mjs http://localhost:4001 http://localhost:4002
 */
import { hashOf } from "../ref/gnl.js";
import { auditFinds, forks, links, publicOf, r2, r7Promises, signedBy } from "./rules.mjs";

export async function audit(origins) {
  const pubs = await Promise.all(origins.map(publicOf));
  const out = [];
  for (const pub of pubs) {
    for (const e of pub.entries) if (!signedBy(e, pub)) out.push({ against: pub.origin, rule: "R1", why: `entry ${e.payload?.type} not signed by it` });
    for (const e of pub.entries.filter((x) => x.payload.type === "offer")) {
      const why = r2(pub, e);
      if (why) out.push({ against: pub.origin, rule: "R2", why, evidence: [e] });
    }
    // R10: links one source at a time in each log, and each accept's holder linked to the very account that offered
    const l = links(pub.entries);
    for (const why of l.breaches) out.push({ against: pub.origin, rule: "R10", why });
    for (const [offer, source] of l.sources) {
      const o = pubs.flatMap((x) => x.entries).find((e) => e.payload.type === "offer" && hashOf(e.payload) === offer);
      if (o && o.payload.player !== source) out.push({ against: pub.origin, rule: "R10", why: `accept for offer ${o.payload.id}: its holder is linked to another account` });
    }
    // Proofs a game logged from its own audits: re-checked here, not taken on its word
    for (const p of pub.entries.filter((x) => x.payload.type === "proof" && x.payload.rule !== "R7")) {
      const [offer, burn, reply] = p.payload.evidence;
      const accused = pubs.find((x) => x.origin === p.payload.against);
      const f = accused && auditFinds(accused, offer, burn, reply);
      if (f) out.push({ against: p.payload.against, rule: f.rule, why: f.why, by: pub.origin });
      else out.push({ against: pub.origin, rule: "R1", why: `its proof against ${p.payload.against} doesn't hold (offer ${hashOf(offer.payload).slice(0, 8)})` });
    }
  }
  const now = pubs.map((p) => p.checkpoint.payload.t).sort().at(-1);
  out.push(...r7Promises(pubs, now), ...forks(pubs));
  return out;
}

const DAY = 86_400_000;
/**
 * Where effort flows, from the logs alone: no proof of anything — an honest game can look like this too — but what a
 * game farming effort, or relaying it for another, has to look like (SPEC §13.1). For each game: its age, its
 * partners, what it sent and received in 90 days; then the patterns worth a human's look before signing or renewing:
 *   young — sending within 30 days of its first log entry       one-way — sent ≥ 4 × what it received from one partner
 *   single — everything it sent went to one game                 relay — received from one game and sent to another the same week
 */
export async function flows(origins, pubs) {
  pubs ??= await Promise.all(origins.map(publicOf));
  const now = Date.parse(pubs.map((p) => p.checkpoint.payload.t).sort().at(-1));
  const since = new Date(now - 90 * DAY).toISOString();
  // A crossover counts once granted: the receiver's GRANT, its ACCEPT for the cgnl, the giver from the ACCEPT's aud
  const moves = [];
  for (const b of pubs) {
    const granted = new Set(b.entries.filter((e) => e.payload.type === "grant").map((e) => e.payload.id));
    for (const e of b.entries) if (e.payload.type === "accept" && granted.has(e.payload.id) && e.payload.iat > since) moves.push({ from: e.payload.aud, to: b.origin, cgnl: e.payload.cgnl, t: e.payload.iat });
  }
  const week = (t) => Math.floor(Date.parse(t) / (7 * DAY));
  const games = pubs.map((p) => {
    const sent = moves.filter((m) => m.from === p.origin);
    const got = moves.filter((m) => m.to === p.origin);
    const sum = (ms) => ms.reduce((n, m) => n + m.cgnl, 0);
    const to = [...new Set(sent.map((m) => m.to))];
    const watch = [];
    const first = p.entries[0]?.payload.iat;
    if (sent.length && first && Date.parse(sent[0].t) - Date.parse(first) < 30 * DAY) watch.push("young");
    for (const o of to) if (sum(sent.filter((m) => m.to === o)) >= 4 * Math.max(1, sum(got.filter((m) => m.from === o))) && sum(sent.filter((m) => m.to === o)) >= 1000) watch.push(`one-way → ${o}`);
    if (to.length === 1 && sent.length >= 3) watch.push("single");
    for (const g of got) for (const m of sent) if (m.to !== g.from && week(m.t) === week(g.t)) watch.push(`relay ${new URL(g.from).host} → ${new URL(m.to).host}, week of ${g.t.slice(0, 10)}`);
    return { origin: p.origin, since: first?.slice(0, 10), partners: [...new Set(p.entries.filter((e) => e.payload.type === "contract").map((e) => e.payload.aud))], sent: sum(sent), received: sum(got), watch: [...new Set(watch)] };
  });
  return { games, moves };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const origins = process.argv.slice(2);
  const found = await audit(origins);
  for (const f of found) console.log(`${f.rule}  ${f.against}  ${f.why}`);
  console.log(found.length ? `${found.length} finding(s)` : "clean");
  console.log("\nFlows, last 90 days (cgnl; watch = worth a look, not a proof):");
  for (const g of (await flows(origins)).games) console.log(`  ${g.origin}  since ${g.since}  sent ${g.sent}  received ${g.received}  partners ${g.partners.length}${g.watch.length ? `  watch: ${g.watch.join("; ")}` : ""}`);
  process.exit(found.length ? 1 : 0);
}
