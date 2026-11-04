/**
 * The checks of SPEC §7 that need more than one envelope — shared by the sandbox's nodes (before they accept) and the
 * auditor (after the fact). Each returns null when the rule holds, or why it doesn't.
 */
import { canonical, hashOf, merkleRoot, opens, paceBreaks, sha256, verifyInclusion } from "../ref/gnl.js";

const DAY = 86_400_000;
const type = (t) => (e) => e.payload.type === t;

export const stateHash = (salt, state) => sha256(salt, canonical(state)).toString("base64url");
export const leafOf = (p, day, s) => ({ p, day, s });

async function get(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return url.endsWith(".jsonl") ? r.text() : r.json();
}

/** A game's public face: its card, log and checkpoint, fetched fresh. */
export async function publicOf(origin) {
  const [card, text, checkpoint] = await Promise.all([
    get(`${origin}/.well-known/gio-no-luc.json`),
    get(`${origin}/gnl/log/entries.jsonl`),
    get(`${origin}/gnl/log/checkpoint.json`),
  ]);
  const pub = { origin, card, entries: text.split("\n").filter(Boolean).map((l) => JSON.parse(l)), checkpoint };
  if (!signedBy(card, pub)) throw new Error(`${origin}: its card isn't signed by its own keys`);
  return pub;
}

/** R1: signed by one of the game's listed keys, and claiming to be from it. */
export const signedBy = (env, pub) => env?.payload?.iss === pub.origin && opens(env, pub.card.payload.keys);

/** A player's leaf `c` ({day, s, index, size, proof}) is under the game's logged commitment of that day. */
export function provedIn(pub, p, c) {
  const commit = pub.entries.find((e) => type("commit")(e) && e.payload.day === c?.day)?.payload;
  return !!commit && commit.size === c.size && verifyInclusion(leafOf(p, c.day, c.s), c.index, c.size, c.proof, commit.root);
}

/** R2: an offer within days since the player's first commitment × the card's hours a day, counting earlier offers. */
export function r2(pub, offer) {
  const o = offer.payload;
  const at = pub.entries.findIndex((e) => type("offer")(e) && e.payload.id === o.id);
  if (at < 0) return "the offer isn't in its issuer's log";
  if (!provedIn(pub, o.player, o.first) || !provedIn(pub, o.player, o.commit)) return "its commitments don't prove the player";
  const days = (Date.parse(o.commit.day) - Date.parse(o.first.day)) / DAY + 1;
  const refunded = new Set(pub.entries.filter(type("refund")).map((e) => e.payload.offer));
  const before = pub.entries
    .slice(0, at)
    .filter((e) => type("offer")(e) && e.payload.player === o.player && !refunded.has(hashOf(e.payload)))
    .reduce((n, e) => n + e.payload.cgnl, 0);
  const bound = days * pub.card.payload.hoursPerDay.adult * 100; // ponytail: the sandbox's players are all adults
  return o.cgnl + before > bound ? `${o.cgnl + before} cgnl offered, ${bound} allowed (${days} days)` : null;
}

/** R7, promises: an ACCEPT whose BURN came, with no GRANT a day past `burnBy`. */
export function r7Promises(pubs, now) {
  const out = [];
  for (const b of pubs)
    for (const acc of b.entries.filter(type("accept"))) {
      const a = pubs.find((x) => x.origin === acc.payload.aud);
      const burn = a?.entries.find((e) => type("burn")(e) && e.payload.accept === hashOf(acc.payload));
      if (!burn) continue;
      const granted = b.entries.some((e) => type("grant")(e) && e.payload.burn === hashOf(burn.payload));
      if (!granted && Date.parse(acc.payload.burnBy) + DAY <= Date.parse(now))
        out.push({ against: b.origin, rule: "R7", why: `no grant for burnt offer ${acc.payload.id}`, evidence: [acc, burn, b.checkpoint] });
    }
  return out;
}

/** R7, forks: every checkpoint a witness co-signed must still be the root of that game's first `size` entries. */
export function forks(pubs) {
  const out = [];
  for (const w of pubs)
    for (const cos of w.entries.filter(type("cosign"))) {
      const x = pubs.find((p) => p.origin === cos.payload.of);
      const cp = cos.payload.checkpoint;
      if (x && signedBy(cp, x) && merkleRoot(x.entries.slice(0, cp.payload.size)) !== cp.payload.root)
        out.push({ against: x.origin, rule: "R7", why: `forked log: its checkpoint of size ${cp.payload.size}, co-signed by ${w.origin}, no longer matches`, evidence: [cp, x.checkpoint] });
    }
  return out;
}

/** R3 and R4 on an audit reply: every day proved, growth within the card's pace, and the burn showing the next day. */
export function auditFinds(pubA, offer, burn, reply) {
  const r = reply?.payload;
  if (!signedBy(reply, pubA) || r.type !== "audit-reply" || r.offer !== hashOf(offer.payload)) return { rule: "R3", why: "no valid audit reply" };
  const p = offer.payload.player;
  for (const d of r.days)
    if (!provedIn(pubA, p, { ...d, s: stateHash(d.salt, d.state) })) return { rule: "R3", why: `day ${d.day} doesn't match its commitment` };
  const pace = pubA.card.payload.pace;
  for (let i = 1; i < r.days.length; i++) {
    const [prev, next] = [r.days[i - 1], r.days[i]];
    const broke = paceBreaks(pace, prev.state, next.state, (Date.parse(next.day) - Date.parse(prev.day)) / 1000);
    if (broke.length) return { rule: "R3", why: `${broke.join(", ")} grew past pace from ${prev.day} to ${next.day}` };
  }
  const burnt = burn.payload.iat.slice(0, 10);
  const before = r.days.find((d) => d.day === burnt);
  const after = r.days.find((d) => d.day > burnt);
  if (!before || !after) return null; // Nothing committed since the burn yet
  const hours = (Date.parse(after.day) - Date.parse(before.day)) / 3_600_000;
  for (const it of offer.payload.items) {
    const g = pace[it.id] ?? { burst: 0, perHour: 0 };
    if ((after.state[it.id] ?? 0) > (before.state[it.id] ?? 0) - it.qty + g.burst + g.perHour * hours)
      return { rule: "R4", why: `${it.qty} ${it.id} burnt on ${burnt}, still there on ${after.day}` };
  }
  return null;
}
