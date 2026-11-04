/**
 * The auditor anyone can run: reads every game's public log and checks the rules that need no one's consent — R1
 * signatures, R2 time bounds, R7 promises and forks — and re-checks every fraud proof a game logged (R3/R4 from
 * audits). It trusts no game, only signatures and arithmetic.
 *
 *   node sandbox/auditor.mjs http://localhost:4001 http://localhost:4002
 */
import { hashOf } from "../ref/gnl.js";
import { auditFinds, forks, publicOf, r2, r7Promises, signedBy } from "./rules.mjs";

export async function audit(origins) {
  const pubs = await Promise.all(origins.map(publicOf));
  const out = [];
  for (const pub of pubs) {
    for (const e of pub.entries) if (!signedBy(e, pub)) out.push({ against: pub.origin, rule: "R1", why: `entry ${e.payload?.type} not signed by it` });
    for (const e of pub.entries.filter((x) => x.payload.type === "offer")) {
      const why = r2(pub, e);
      if (why) out.push({ against: pub.origin, rule: "R2", why, evidence: [e] });
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const found = await audit(process.argv.slice(2));
  for (const f of found) console.log(`${f.rule}  ${f.against}  ${f.why}`);
  console.log(found.length ? `${found.length} finding(s)` : "clean");
  process.exit(found.length ? 1 : 0);
}
