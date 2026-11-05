/**
 * The checks of SPEC §7 that need more than one envelope — shared by the sandbox's nodes (before they accept) and the
 * auditor (after the fact). Each returns null when the rule holds, or why it doesn't.
 */
import { canonical, contractWindow, hashOf, merkleRoot, monthAdd, opens, paceBreaks, sha256, verifyInclusion } from "../ref/gnl.js";

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

/** §5.2: a card's stage — "live", or a sandbox (also a card from before stages: never taken for live). */
export const stageOf = (card) => (card?.stage === "live" ? "live" : "sandbox");

/** R1: signed by one of the game's listed keys, and claiming to be from it. */
export const signedBy = (env, pub) => env?.payload?.iss === pub.origin && opens(env, pub.card.payload.keys);

/** A player's leaf `c` ({day, s, index, size, proof}) is under one of the game's logged commitments of that day (a
 * game may commit again the same day when someone joins: R2 counts days, not commitments). */
export const provedIn = (pub, p, c) =>
  pub.entries.some(
    (e) => type("commit")(e) && e.payload.day === c?.day && e.payload.size === c.size && verifyInclusion(leafOf(p, c.day, c.s), c.index, c.size, c.proof, e.payload.root),
  );

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
      if (x && stageOf(x.card.payload) === "live" && signedBy(cp, x) && merkleRoot(x.entries.slice(0, cp.payload.size)) !== cp.payload.root)
        out.push({ against: x.origin, rule: "R7", why: `forked log: its checkpoint of size ${cp.payload.size}, co-signed by ${w.origin}, no longer matches`, evidence: [cp, x.checkpoint] });
    }
  return out;
}

/** §4.2: what the game itself gave pseudonym `p` (`issue`: gifts, compensation, paid things) on days `d1`..`d2`, both
 * included (a day's state may be committed before or after that day's gift): never growth past pace. */
export function issuedOn(entries, p, d1, d2) {
  const out = {};
  for (const e of entries)
    if (e.payload.type === "issue" && e.payload.iat.slice(0, 10) >= d1 && e.payload.iat.slice(0, 10) <= d2)
      for (const t of e.payload.to) if (t.player === p) for (const it of t.items) out[it.id] = (out[it.id] ?? 0) + it.qty;
  return out;
}
const minus = (state, gift) => Object.fromEntries(Object.entries(state).map(([k, v]) => [k, typeof v === "number" ? v - (gift[k] ?? 0) : v]));

/** §5.2: a live game's test accounts are pseudonyms it registered (`tester`), for good, at most TESTERS_MAX. */
export const TESTERS_MAX = 20;
const TESTERS_SINCE = "2026-11-06"; // Test crossings from before the registry are carried over
/** The test accounts in a live game's log, checked: each test crossing names a tester registered before it, a tester
 * never crosses for real, an account that crossed for real never becomes one. */
export function testers(entries) {
  const reg = new Set();
  const real = new Set();
  const breaches = [];
  const start = [entries.find((e) => e.payload.type === "tester")?.payload.iat ?? TESTERS_SINCE, TESTERS_SINCE].sort()[0];
  for (const { payload: p } of entries) {
    if (p.type === "tester") {
      if (reg.has(p.player) || real.has(p.player)) breaches.push(`tester ${p.player.slice(0, 8)}…: registered twice, or after crossing for real`);
      reg.add(p.player);
      if (reg.size === TESTERS_MAX + 1) breaches.push(`more than ${TESTERS_MAX} test accounts`);
    }
    if ((p.type !== "offer" && p.type !== "accept") || p.iat < start) continue;
    if (p.test && !(reg.has(p.tester) && (p.type === "accept" || p.tester === p.player))) breaches.push(`${p.type} ${p.id}: marked test, no registered tester`);
    if (!p.test && p.type === "offer") {
      if (reg.has(p.player)) breaches.push(`offer ${p.id}: a test account crossing for real`);
      real.add(p.player);
    }
  }
  return { set: reg, breaches };
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
    const gift = issuedOn(pubA.entries, p, prev.day, next.day); // The game's own gifts aren't growth (§4.2)
    const broke = paceBreaks(pace, prev.state, minus(next.state, gift), (Date.parse(next.day) - Date.parse(prev.day)) / 1000);
    if (broke.length) return { rule: "R3", why: `${broke.join(", ")} grew past pace from ${prev.day} to ${next.day}` };
  }
  const burnt = burn.payload.iat.slice(0, 10);
  const before = r.days.find((d) => d.day === burnt);
  const after = r.days.find((d) => d.day > burnt);
  if (!before || !after) return null; // Nothing committed since the burn yet
  const hours = (Date.parse(after.day) - Date.parse(before.day)) / 3_600_000;
  const gift = issuedOn(pubA.entries, p, before.day, after.day);
  for (const it of offer.payload.items) {
    const g = pace[it.id] ?? { burst: 0, perHour: 0 };
    if ((after.state[it.id] ?? 0) - (gift[it.id] ?? 0) > (before.state[it.id] ?? 0) - it.qty + g.burst + g.perHour * hours)
      return { rule: "R4", why: `${it.qty} ${it.id} burnt on ${burnt}, still there on ${after.day}` };
  }
  return null;
}

/** `pub`'s own contract with `other` for month `m`, signed in its window and by `t` (SPEC §5.1). */
const signedFor = (pub, other, m, t) => {
  const w = contractWindow(m);
  return pub.entries.find((e) => type("contract")(e) && e.payload.aud === other && e.payload.month === m && e.payload.iat >= w.opens && e.payload.iat < w.ends && e.payload.iat <= t);
};
const both = (a, b, m, t) => signedFor(a, b.origin, m, t) && signedFor(b, a.origin, m, t);

/** May these two games cross over at `t` (an ISO time)? null, or why not: no contract for this month, or its last 7
 * days without next month's signed by both. `a`, `b`: `{origin, entries}` (a game's own log is enough for itself). */
export function contractAt(a, b, t) {
  const m = t.slice(0, 7);
  if (!both(a, b, m, t)) return `no contract between ${a.origin} and ${b.origin} for ${m}`;
  const next = monthAdd(m, 1);
  if (t >= contractWindow(next).opens && !both(a, b, next, t)) return `the last week of ${m}: ${next}'s contract isn't signed by both yet`;
  return null;
}

/** How many months running the contract has held at `t`: each one renewed (signed by both before it began). */
export function contractMonths(a, b, t) {
  let n = 0;
  for (let m = t.slice(0, 7); ; m = monthAdd(m, -1)) {
    const [x, y] = [signedFor(a, b.origin, m, t), signedFor(b, a.origin, m, t)];
    if (!x || !y) return n;
    n++;
    const starts = contractWindow(m).starts;
    if (x.payload.iat >= starts || y.payload.iat >= starts) return n; // Signed inside its month: a new start
  }
}

/** A council member's consent (§14): `{type: "consent", iss: <game>, member: <account>}`, signed by the key listed for
 * them — so nobody is seated, or given a key, without knowing. */
export const consentOk = (origin, member, consent) =>
  consent?.payload?.type === "consent" && consent.payload.iss === origin && consent.payload.member === member.account && opens(consent, [{ kty: "OKP", crv: "Ed25519", x: member.x, kid: member.kid }]);

/** The council a log shows at `t` (default: now): members seated and not gone, the master. With `forVote`, a vote's
 * council as it opens at `t`: joins count from 7 days after, those gone within the 7 days before still hold a seat. */
export function roster(entries, t = "9999", forVote = false) {
  const week = (iso, n) => new Date(Date.parse(iso) + n * 7 * DAY).toISOString();
  const seats = new Map();
  let master = null;
  for (const e of entries) {
    const p = e.payload;
    if (p.type !== "council" || p.iat > t) continue;
    if (p.op === "join" && (!forVote || week(p.iat, 1) <= t)) seats.set(p.member.account, { ...p.member, since: p.iat });
    if (p.op === "join" && p.master) master = p.member.account;
    if (p.op === "master" && (!forVote || week(p.iat, 1) <= t)) master = p.member.account;
    if (p.op === "leave" && (!forVote || week(p.iat, 1) <= t)) seats.delete(p.member.account);
  }
  return { members: [...seats.values()].map(({ since: _, ...m }) => m), master };
}

/** §4.1, the least a game says about its effort: each thing it prices, both ways, and that the prices are declared. */
export const effortOf = (c) => ({
  protocol: c.protocol, game: c.iss, at: c.iat,
  things: c.exports.map((r) => ({ id: r.id, name: r.name, unit: r.unit, out: r.cgnlPer, in: c.imports.find((i) => i.id === r.id)?.cgnlPer ?? null, basis: "declared", how: "" })),
});

/** The game's own acts, once it has a council (§14): an `order` {op, …, why, made, ballots} its members signed. null
 * when it holds at `t`: yes from more than half the seats, or from half with the master among them — the council as
 * frozen for a vote (joins count after 7 days; the council as it stands while it's younger than that); on an act that
 * only reduces risk, half with the master among them; a `resign` by the member alone; a `pause` by the master alone. */
const NARROW = ["pause", "end", "void", "cut"]; // Acts that only ever reduce a game's exposure
export function orderOk(entries, o, t) {
  const { ballots = [], iat: _, ...body } = o;
  const h = hashOf(body);
  if (!(body.made <= new Date(Date.parse(t) + 600_000).toISOString() && body.made >= new Date(Date.parse(t) - 7 * DAY).toISOString())) return "made more than a week before it was logged";
  let c = roster(entries, t, true);
  if (!c.members.length) c = roster(entries, t);
  if (!c.members.length) return "no council";
  const yes = new Set();
  for (const b of ballots) {
    const m = c.members.find((x) => x.account === b?.payload?.member);
    if (m && b.payload.type === "ballot" && b.payload.iss === o.iss && b.payload.proposal === h && b.payload.choice === "yes" && opens(b, [{ kty: "OKP", crv: "Ed25519", x: m.x, kid: m.kid }])) yes.add(m.account);
  }
  if (o.op === "resign") return yes.has(o.account) && roster(entries, t).members.some((m) => m.account === o.account) ? null : "a resign is signed by that member, seated";
  if (o.op === "pause") return yes.has(c.master) ? null : "a pause is the master's";
  const n = c.members.length;
  const tie = NARROW.includes(o.op) && 2 * yes.size === n && yes.has(c.master); // A split council on reducing risk: the master's side
  return 2 * yes.size > n || tie ? null : `${yes.size} of ${n} seats said yes: more than half needed${NARROW.includes(o.op) ? " (half with the master)" : ""}`;
}

export const UNLINK_DAYS = 7;
/** R10 from a log's `link` entries {aud: partner, holder, source, op: "on" | "off"}, in order: the links live at the end,
 * and every breach — a holder or a source with two live links, a new link within UNLINK_DAYS of one undone (either
 * side), an accept whose `holder` has no live link; and the source each accept's holder was linked to. `holder` is the game's pseudonym of its account for that partner,
 * `source` the partner's of the giving account (its offers' `player`). */
export function links(entries) {
  const live = new Map(); // `${aud}|h|${holder}`, `${aud}|s|${source}` → the link's payload
  const off = new Map(); // the same keys → {at, other}: when that side last undid a link, and with whom
  const breaches = [];
  const sources = new Map(); // an accept's offer hash → the source its holder was linked to then
  const fail = (p, why) => breaches.push(`${p.iat.slice(0, 10)}: ${why}`);
  // The links a game kept before they were logged: the run of `link`s its log starts them with, carried over as they
  // were (a later one replacing an earlier it clashes with), like the first council
  const first = entries.findIndex((e) => e.payload.type === "link");
  let carried = first;
  while (carried >= 0 && entries[carried]?.payload.type === "link") carried++;
  for (const [i, e] of entries.entries()) {
    const p = e.payload;
    if (p.type === "accept" && p.holder) {
      const l = live.get(`${p.aud}|h|${p.holder}`);
      if (l) sources.set(p.offer, l.source);
      else fail(p, `accept ${p.id}: its holder has no live link (R10)`);
    }
    if (p.type !== "link") continue;
    const [h, s] = [`${p.aud}|h|${p.holder}`, `${p.aud}|s|${p.source}`];
    if (p.op === "off") {
      if (live.get(h)?.source !== p.source) fail(p, "undoes a link that isn't there");
      live.delete(h);
      live.delete(s);
      off.set(h, { at: p.iat, other: p.source });
      off.set(s, { at: p.iat, other: p.holder });
      continue;
    }
    if (i >= first && i < carried) {
      for (const k of [h, s]) if (live.has(k)) for (const x of [`${p.aud}|h|${live.get(k).holder}`, `${p.aud}|s|${live.get(k).source}`]) live.delete(x);
      live.set(h, p);
      live.set(s, p);
      continue;
    }
    if (live.has(h)) fail(p, "this account takes from another account of that game: undo that link first");
    if (live.has(s)) fail(p, "that account gives to another account here");
    const wait = (k, other) => off.get(k) && off.get(k).other !== other && Date.parse(p.iat) - Date.parse(off.get(k).at) < UNLINK_DAYS * DAY && off.get(k).at;
    const [wh, ws] = [wait(h, p.source), wait(s, p.holder)];
    if (wh) fail(p, `this account undid its link on ${wh.slice(0, 10)}: a new source waits ${UNLINK_DAYS} days`);
    if (ws) fail(p, `that account left another account here on ${ws.slice(0, 10)}: a new link waits ${UNLINK_DAYS} days`);
    live.set(h, p);
    live.set(s, p);
  }
  return { live, breaches, sources };
}
