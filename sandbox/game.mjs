/**
 * A game node speaking gnl/0 (SPEC.md): its card, its log, daily commitments, witnessing its peers, both sides of a
 * crossover, and audits — over a plain JSON state `s` the caller keeps (memory, a Firestore doc…) and two adapters
 * the game supplies:
 *
 *   players — uids() who to commit · state(uid) their exportable things as numbers · burn(uid, items) take them away
 *             (all or nothing, throws when short) · grant(uid, thing, qty, {from, id, upfront}) give · clawback(from)
 *   days    — put(day, {leaves, states}) · get(day): each day's commitment, its leaves and the salted states behind them
 *
 * With none given it's the sandbox's toy game: players and days in `s` itself (memoryPlayers, memoryDays). `clock`
 * gives the day: simulated in the demo, the real one online.
 *
 * `cheat` makes it lie on purpose, so the rules can be seen catching it:
 *   inflate — offers more than its time bound (R2)      keep — signs a burn, keeps the things (R4)
 *   nogrant — accepts, takes the burn, never grants (R7) (fork: `rewrite()`; pace: `earn(…, true)` past the pace)
 */
import { createHmac, randomBytes } from "node:crypto";
import { hashOf, inclusionProof, merkleRoot, newKey, opens, privateFromJwk, seal } from "../ref/gnl.js";
import { auditFinds, leafOf, publicOf, r2, signedBy, stateHash } from "./rules.mjs";

const DAY = 86_400_000;
const rid = () => randomBytes(16).toString("base64url");
export const fail = (status, code, message) => Object.assign(new Error(message), { status, code });

async function post(url, body) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw fail(r.status, j.error?.code, j.error?.message ?? `${url}: ${r.status}`);
  return j;
}

/** A new game's state: its keys, its secret, an empty log. */
export function freshState(name, iat) {
  const k = newKey(`${name}-1`);
  const { kty, crv, x, d } = k.privateKey.export({ format: "jwk" });
  return {
    name, day: -1, lastDay: null, cardIat: iat, log: [], checkpoint: null, players: {}, leaves: {}, first: {}, uids: {}, tickets: {},
    accepts: {}, grants: {}, audits: [], suspended: [], anchors: [], key: { kid: k.kid, jwk: k.jwk, private: { kty, crv, x, d } },
    secret: randomBytes(32).toString("base64url"),
  };
}

/** The demo's clock: day `s.day` after `base`, advanced by newDay(). */
export function simClock(s, base = "2026-11-01") {
  const today = () => new Date(Date.parse(base) + Math.max(0, s.day) * DAY).toISOString().slice(0, 10);
  return { advance: () => s.day++, today, at: (days = 0) => new Date(Date.parse(`${today()}T12:00:00Z`) + days * DAY).toISOString() };
}
export const realClock = { advance() {}, today: () => new Date().toISOString().slice(0, 10), at: (days = 0) => new Date(Date.now() + days * DAY).toISOString() };

/** The sandbox's players, in `s.players`: things held while an offer is out, a vesting share, earning at the card's pace. */
export function memoryPlayers(s) {
  const pl = (uid) => s.players[uid] ?? fail(404, "NO_PLAYER", "no such player");
  return {
    uids: async () => Object.keys(s.players),
    state: async (uid) => s.players[uid] && { ...s.players[uid].state },
    async burn(uid, items) {
      const p = pl(uid);
      for (const it of items) if ((p.state[it.id] ?? 0) < it.qty) throw fail(409, "NOT_ENOUGH", `too little ${it.id}`);
      for (const it of items) p.state[it.id] -= it.qty;
    },
    async grant(uid, thing, qty, { from, upfront }) {
      const p = (s.players[uid] ??= { state: {}, held: {}, hist: {}, vesting: [] });
      const up = Math.floor(qty * upfront);
      p.state[thing] = (p.state[thing] ?? 0) + up;
      p.vesting.push({ from, id: thing, left: qty - up });
    },
    async clawback(from) {
      for (const p of Object.values(s.players)) for (const v of p.vesting) if (v.from === from) v.left = 0;
    },
  };
}

/** The sandbox's days, in `s` too (s.leaves, each player's hist). */
export const memoryDays = (s) => ({
  async put(day, { leaves, states }) {
    s.leaves[day] = leaves;
    for (const [p, h] of Object.entries(states)) ((s.players[s.uids[p]] ??= { state: {}, held: {}, hist: {}, vesting: [] }).hist ??= {})[day] = h;
  },
  async get(day) {
    if (!s.leaves[day]) return null;
    const states = {};
    for (const l of s.leaves[day]) states[l.p] = s.players[s.uids[l.p]]?.hist?.[day];
    return { leaves: s.leaves[day], states };
  },
});

export function game(s, { origin, clock, config, cheat = "", players = memoryPlayers(s), days = memoryDays(s) }) {
  s.first ??= {};
  s.uids ??= {};
  const key = { kid: s.key.kid, privateKey: privateFromJwk(s.key.private) };
  const { today, at } = clock;
  const exp = Object.fromEntries(config.items.map((r) => [r.id, r.cgnlPer]));
  const imports = config.imports ?? config.items.map((r) => ({ ...r, cgnlPer: Math.ceil(r.cgnlPer * 1.5) })); // R8: in costs more than out
  const imp = Object.fromEntries(imports.map((r) => [r.id, r.cgnlPer]));
  const policy = { lineStart: 10_000, lineCap: 1_000_000, upfront: 0.2, vestPerHour: 300, ...config.policy };
  const card = seal(
    {
      type: "card", protocol: "gnl/0", iss: origin, iat: s.cardIat, game: { name: config.name, contact: config.contact, jurisdiction: "VN" },
      keys: [s.key.jwk], hoursPerDay: config.hoursPerDay ?? { minor: 1, adult: 16 }, pace: config.pace, exports: config.items, imports, policy,
      witnesses: config.peers ?? [],
    },
    key,
  );
  /** What this game gives for incoming effort: its `grantId`, as many as the cgnl buy — or the game's own choice, from
   * the ticket its player asked for (`tk`: its uid and whatever the game kept with it). */
  const grantFor = config.grantFor ?? ((cgnl) => [{ id: config.grantId, qty: Math.floor(cgnl / imp[config.grantId]) }]);

  const pseudonym = (uid) => createHmac("sha256", s.secret).update(uid).digest("base64url");
  for (const [uid, pl] of Object.entries(s.players)) {
    // A state from before the adapters kept these per player
    s.uids[pseudonym(uid)] ??= uid;
    if (pl.first) s.first[pseudonym(uid)] ??= pl.first;
  }
  const append = (payload) => {
    const env = seal({ ...payload, iss: origin, iat: at() }, key);
    s.log.push(env);
    return env;
  };
  const sign = () => {
    const anchors = s.anchors.length ? { anchors: s.anchors.slice(-4) } : {};
    s.checkpoint = seal({ type: "checkpoint", iss: origin, iat: at(), size: s.log.length, root: merkleRoot(s.log), t: at(), ...anchors }, key);
  };
  async function proofFor(p, d) {
    const ls = (await days.get(d))?.leaves ?? [];
    const index = ls.findIndex((l) => l.p === p);
    if (index < 0) throw fail(409, "NOT_COMMITTED", "the player isn't in that day's commitment");
    return { day: d, s: ls[index].s, index, size: ls.length, proof: inclusionProof(ls, index) };
  }

  /** Today's commitment of every player (again, if someone new joined since: R2 counts days, not commitments). */
  async function commit() {
    const d = today();
    const states = {};
    const ls = [];
    for (const uid of await players.uids()) {
      const st = await players.state(uid);
      if (!st) continue;
      const p = pseudonym(uid);
      const salt = createHmac("sha256", s.secret).update(`${p}|${d}`).digest("base64url");
      s.uids[p] = uid;
      s.first[p] ??= d;
      states[p] = { state: st, salt };
      ls.push(leafOf(p, d, stateHash(salt, st)));
    }
    ls.sort((a, b) => (a.p < b.p ? -1 : 1));
    await days.put(d, { leaves: ls, states });
    append({ type: "commit", day: d, root: merkleRoot(ls), size: ls.length });
    sign();
  }

  async function newDay() {
    clock.advance();
    s.lastDay = today();
    await commit();
  }

  /** Co-sign every peer's checkpoint, after checking it still extends the last one co-signed; a fork → a proof. */
  async function witness(peers = config.peers ?? []) {
    for (const o of peers) {
      const pub = await publicOf(o);
      if (merkleRoot(pub.entries) !== pub.checkpoint.payload.root) throw new Error(`${o} serves entries that don't match its checkpoint`);
      const last = s.log.findLast((e) => e.payload.type === "cosign" && e.payload.of === o)?.payload.checkpoint;
      if (last && merkleRoot(pub.entries.slice(0, last.payload.size)) !== last.payload.root) {
        append({ type: "proof", against: o, rule: "R7", why: `forked log: no longer extends its checkpoint of size ${last.payload.size}`, evidence: [last, pub.checkpoint] });
        await punish(o);
        continue;
      }
      if (last?.payload.root !== pub.checkpoint.payload.root) append({ type: "cosign", of: o, checkpoint: pub.checkpoint });
    }
    sign();
  }

  /** Audit what was granted once the giver has committed a day since its burn (R3, R4); a lie → a proof, cut off. */
  async function runAudits() {
    for (const job of s.audits.splice(0)) {
      if (job.burn.payload.iat.slice(0, 10) >= today()) {
        s.audits.push(job);
        continue;
      }
      const req = seal({ type: "audit", iss: origin, iat: at(), aud: job.from, offer: hashOf(job.offer.payload) }, key);
      const reply = await post(`${job.from}/gnl/audit`, req);
      const f = auditFinds(await publicOf(job.from), job.offer, job.burn, reply);
      if (f) {
        append({ type: "proof", against: job.from, rule: f.rule, why: f.why, evidence: [job.offer, job.burn, reply] });
        await punish(job.from);
      }
    }
    sign();
  }

  async function punish(o) {
    if (!s.suspended.includes(o)) s.suspended.push(o);
    await players.clawback(o);
  }

  // --- The player's side ---------------------------------------------------------------------------------------

  /** As the receiving game: the one-time ticket a player carries to the game they leave (SPEC §5). */
  function ticket(uid, to, keep = {}) {
    const sub = rid();
    const t = seal({ type: "ticket", iss: origin, iat: at(), aud: to, sub, nonce: rid(), exp: at(0.01) }, key);
    s.tickets[sub] = { ...keep, uid, nonce: t.payload.nonce, used: false };
    return t;
  }

  /** What these things are worth here, in cgnl: the player's quote before choosing. */
  const worth = (items) => items.reduce((n, it) => n + it.qty * (exp[it.id] ?? NaN), 0);

  /** As the giving game: the player, signed in, gives these things up for a start in `to`. */
  async function cross(uid, to, items, tk) {
    if (!Array.isArray(items) || !items.length || items.some((it) => !exp[it.id] || !(it.qty > 0) || !Number.isInteger(it.qty))) throw fail(400, "BAD_ITEMS", "items");
    const st = await players.state(uid);
    if (!st) throw fail(404, "NO_PLAYER", uid);
    const held = s.players[uid]?.held ?? {};
    for (const it of items) if ((st[it.id] ?? 0) - (held[it.id] ?? 0) < it.qty) throw fail(400, "NOT_ENOUGH", `too little ${it.id}`);
    const p = pseudonym(uid);
    if (!(await days.get(today()))?.leaves.some((l) => l.p === p)) await commit(); // Not in today's commitment yet (joined since)
    const rated = items.map((it) => ({ id: it.id, qty: it.qty, cgnl: it.qty * exp[it.id] }));
    const offer = append({
      type: "offer", id: rid(), aud: to, ticket: tk, player: p, items: rated, cgnl: rated.reduce((n, it) => n + it.cgnl, 0),
      first: await proofFor(p, s.first[p]), commit: await proofFor(p, today()), exp: at(1),
    });
    if (cheat !== "inflate") {
      const why = r2({ origin, card, entries: s.log }, offer);
      if (why) {
        s.log.pop(); // An honest game never logs an offer it would have to refuse itself
        throw fail(422, "R2", why);
      }
    }
    sign();
    if (s.players[uid]) for (const it of items) held[it.id] = (held[it.id] ?? 0) + it.qty;
    const release = () => s.players[uid] && items.forEach((it) => (held[it.id] -= it.qty));
    const refund = (why) => {
      append({ type: "refund", id: offer.payload.id, offer: hashOf(offer.payload), why });
      sign();
    };
    let acc;
    try {
      acc = await post(`${to}/gnl/offer`, offer);
      if (!signedBy(acc, await publicOf(to)) || acc.payload.offer !== hashOf(offer.payload)) throw fail(502, "BAD_ACCEPT", "an accept that doesn't open");
    } catch (e) {
      release();
      refund("refused");
      return { offer, refused: `${e.code}: ${e.message}` };
    }
    release();
    if (cheat !== "keep") {
      try {
        await players.burn(uid, items);
      } catch (e) {
        refund("cancelled"); // Spent meanwhile: no burn, so no grant either — the accept lapses
        return { offer, accept: acc, refused: `${e.code}: ${e.message}` };
      }
    }
    const burn = append({ type: "burn", id: offer.payload.id, aud: to, accept: hashOf(acc.payload) });
    sign();
    let grant = null;
    try {
      grant = await post(`${to}/gnl/burn`, burn);
    } catch {
      // The receiver broke its promise: ACCEPT + BURN in the logs are the proof (R7)
    }
    return { offer, accept: acc, burn, grant };
  }

  // --- Game to game (SPEC §9) -------------------------------------------------------------------------------

  async function onOffer(env) {
    const o = env?.payload;
    if (o?.type !== "offer" || o.aud !== origin) throw fail(400, "BAD_OFFER", "not an offer for this game");
    // Partners only, checked before fetching anything: an unchecked `iss` would make this server fetch any address
    // a stranger names (SSRF). The demo, all on localhost, lists none and takes anyone.
    if (config.partners && !config.partners.includes(o.iss)) throw fail(403, "NOT_PARTNER", "not a partner of this game");
    const a = await publicOf(o.iss).catch(() => {
      throw fail(400, "UNREACHABLE", "the offering game's card can't be fetched");
    });
    if (!signedBy(env, a)) throw fail(401, "R1", "signature");
    if (s.suspended.includes(o.iss)) throw fail(403, "SUSPENDED", "a fraud proof stands against this game");
    if (o.exp < at()) throw fail(400, "EXPIRED", "offer expired");
    const t = o.ticket?.payload;
    const tk = s.tickets[t?.sub];
    if (!opens(o.ticket, [s.key.jwk]) || t.iss !== origin || t.aud !== o.iss || t.exp < at() || !tk || tk.used || tk.nonce !== t.nonce)
      throw fail(400, "TICKET", "no valid ticket from this game");
    const why = r2(a, env);
    if (why) throw fail(422, "R2", why);
    const week = Object.values(s.accepts).filter((x) => x.from === o.iss && x.acc.payload.iat > at(-7)).reduce((n, x) => n + x.acc.payload.cgnl, 0);
    if (week + o.cgnl > policy.lineStart) throw fail(429, "R5", `line: ${week} of ${policy.lineStart} taken this week`); // ponytail: the line doesn't grow yet
    const grant = (await grantFor(o.cgnl, imp, tk)).filter((g) => g.qty > 0);
    if (!grant.length) throw fail(422, "TOO_LITTLE", "too little effort to give anything for");
    tk.used = true;
    const acc = append({ type: "accept", id: o.id, aud: o.iss, offer: hashOf(o), cgnl: o.cgnl, grant, upfront: policy.upfront, burnBy: at(1) });
    s.accepts[hashOf(acc.payload)] = { acc, uid: tk.uid, from: o.iss, offer: env };
    sign();
    return acc;
  }

  async function onBurn(env) {
    const rec = s.accepts[env?.payload?.accept];
    if (!rec || env.payload.type !== "burn" || !signedBy(env, await publicOf(rec.from))) throw fail(400, "BAD_BURN", "no accept of ours for this burn");
    const id = rec.acc.payload.id;
    if (s.grants[id]) return s.grants[id]; // Idempotent: the same burn, the same grant
    if (cheat === "nogrant") throw fail(503, "BUSY", "try later");
    for (const g of rec.acc.payload.grant) await players.grant(rec.uid, g.id, g.qty, { from: rec.from, id, upfront: policy.upfront });
    const g = append({ type: "grant", id, aud: rec.from, burn: hashOf(env.payload) });
    s.grants[id] = g;
    s.audits.push({ from: rec.from, offer: rec.offer, burn: env });
    sign();
    return g;
  }

  async function onAudit(env) {
    const req = env?.payload;
    const off = s.log.find((e) => e.payload.type === "offer" && hashOf(e.payload) === req?.offer);
    // Only the game the offer went to may audit it: the public ticket is no consent for anyone else
    if (!off || req.iss !== off.payload.aud || !signedBy(env, await publicOf(req.iss))) throw fail(403, "AUDIT", "not yours to audit");
    const p = off.payload.player;
    const out = [];
    for (let d = s.first[p]; d <= today(); d = new Date(Date.parse(d) + DAY).toISOString().slice(0, 10)) {
      const rec = await days.get(d);
      const h = rec?.states?.[p];
      if (!h) continue;
      const { s: _, ...proof } = await proofFor(p, d);
      out.push({ ...proof, state: h.state, salt: h.salt });
    }
    return seal({ type: "audit-reply", iss: origin, iat: at(), aud: req.iss, offer: req.offer, days: out }, key);
  }

  /** The fork cheat: drop the first offer from the log after a witness co-signed it, and sign the new history. */
  function rewrite() {
    s.log.splice(s.log.findIndex((e) => e.payload.type === "offer"), 1);
    sign();
  }

  // --- The sandbox's own: earning, a look at a player ------------------------------------------------------

  function earn(uid, delta, force = false) {
    const pl = (s.players[uid] ??= { state: {}, held: {}, hist: {}, vesting: [], lastEarn: at() });
    pl.lastEarn ??= at();
    const hours = (Date.parse(at()) - Date.parse(pl.lastEarn)) / 3_600_000;
    for (const [f, n] of Object.entries(delta)) {
      const g = config.pace[f];
      if (!g || !Number.isFinite(n) || n < 0) throw fail(400, "BAD_EARN", `nothing called ${f} to earn`);
      if (!force && n > g.burst + g.perHour * hours) throw fail(429, "PACE", `${n} ${f} is faster than this game allows`);
    }
    for (const [f, n] of Object.entries(delta)) pl.state[f] = (pl.state[f] ?? 0) + n;
    pl.lastEarn = at();
    return player(uid);
  }
  const player = (uid) => {
    const pl = s.players[uid];
    return pl && { ...pl.state, vesting: (pl.vesting ?? []).reduce((n, v) => n + v.left, 0) };
  };

  const routes = {
    "GET /.well-known/gio-no-luc.json": () => card,
    "GET /gnl/log/entries.jsonl": () => s.log.map((e) => JSON.stringify(e)).join("\n") + "\n",
    "GET /gnl/log/checkpoint.json": () => s.checkpoint,
    "POST /gnl/offer": onOffer,
    "POST /gnl/burn": onBurn,
    "POST /gnl/audit": onAudit,
    "POST /dev/tick": () => ({ day: s.lastDay }), // Online: any write first does the new day's work; this is the write that does only that
  };
  // The sandbox's own doors for players and testers: fake things, no sign-in (a real game puts its accounts there)
  if (config.sandbox !== false)
    Object.assign(routes, {
      "GET /dev/players": () => Object.fromEntries(Object.keys(s.players).map((u) => [u.slice(0, 6), player(u)])),
      "POST /dev/player": (b) => {
        const p = player(String(b?.uid));
        if (!p) throw fail(404, "NO_PLAYER", "no such player");
        return p;
      },
      "POST /dev/earn": (b) => earn(String(b?.uid), b?.delta ?? {}),
      "POST /dev/ticket": (b) => ticket(String(b?.uid), String(b?.to)),
      "POST /dev/cross": (b) => cross(String(b?.uid), String(b?.to), b?.items, b?.ticket),
    });

  return { card, routes, newDay, commit, earn, witness, runAudits, ticket, cross, worth, rewrite, player, punish, pseudonym, state: s };
}
