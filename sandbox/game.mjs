/**
 * A game node speaking gnl/0 (SPEC.md): its card, its log, daily commitments, witnessing its peers, both sides of a
 * crossover, and audits — over a plain JSON state `s` the caller keeps (memory, a Firestore doc…) and two adapters
 * the game supplies:
 *
 *   players — uids() who to commit · state(uid) their exportable things as numbers · burn(uid, items) take them away
 *             (all or nothing, throws when short) · grant(uid, thing, qty, {from, id, upfront}) give · clawback(from)
 *             what hasn't vested from a game · clawbackOne(uid, id) from one crossover (a void, §8.1)
 *   days    — put(day, {leaves, states}) · get(day): each day's commitment, its leaves and the salted states behind them
 *
 * With none given it's the sandbox's toy game: players and days in `s` itself (memoryPlayers, memoryDays). `clock`
 * gives the day: simulated in the demo, the real one online.
 *
 * `cheat` makes it lie on purpose, so the rules can be seen catching it:
 *   inflate — offers more than its time bound (R2)      keep — signs a burn, keeps the things (R4)
 *   nogrant — accepts, takes the burn, never grants (R7) (fork: `rewrite()`; pace: `earn(…, true)` past the pace)
 *
 * Crossovers need a contract in force between the two games (SPEC §5.1): each signs its side monthly (`contracts()`).
 */
import { createHmac, randomBytes } from "node:crypto";
import { contractWindow, hashOf, inclusionProof, merkleRoot, monthAdd, newKey, opens, privateFromJwk, seal } from "../ref/gnl.js";
import { auditFinds, consentOk, contractAt, contractMonths, effortOf, leafOf, links, orderOk, publicOf, r2, roster, signedBy, stateHash, UNLINK_DAYS } from "./rules.mjs";

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
    accepts: {}, grants: {}, audits: [], suspended: [], anchors: [], debts: {}, voided: {}, key: { kid: k.kid, jwk: k.jwk, private: { kty, crv, x, d } },
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
    async grant(uid, thing, qty, { from, id, upfront }) {
      const p = (s.players[uid] ??= { state: {}, held: {}, hist: {}, vesting: [] });
      const up = Math.floor(qty * upfront);
      p.state[thing] = (p.state[thing] ?? 0) + up;
      p.vesting.push({ from, crossover: id, id: thing, left: qty - up });
    },
    async clawbackOne(uid, id) {
      for (const v of s.players[uid]?.vesting ?? []) if (v.crossover === id) v.left = 0;
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
  s.debts ??= {};
  s.voided ??= {};
  const key = { kid: s.key.kid, privateKey: privateFromJwk(s.key.private) };
  const { today, at } = clock;
  const exp = Object.fromEntries(config.items.map((r) => [r.id, r.cgnlPer]));
  const imports = config.imports ?? config.items.map((r) => ({ ...r, cgnlPer: Math.ceil(r.cgnlPer * 1.5) })); // R8: in costs more than out
  const imp = Object.fromEntries(imports.map((r) => [r.id, r.cgnlPer]));
  const policy = { lineStart: 10_000, lineCap: 1_000_000, upfront: 0.2, vestPerHour: 300, ...config.policy };
  /** The card's content: the config, and the council as the log has it (§14). */
  const cardBody = () => {
    const c = roster(s.log);
    return {
      type: "card", protocol: "gnl/0", iss: origin, game: { name: config.name, contact: config.contact, jurisdiction: "VN" },
      keys: [s.key.jwk], hoursPerDay: config.hoursPerDay ?? { minor: 1, adult: 16 }, pace: config.pace, exports: config.items, imports, policy,
      witnesses: config.peers ?? [], effort: `${origin}/gnl/effort.json`,
      ...(c.members.length ? { council: c.members, master: c.master } : {}),
    };
  };
  let card = seal({ ...cardBody(), iat: s.cardIat }, key); // A changed card is dated and logged by upkeep()
  /** What this game gives for incoming effort: its `grantId`, as many as the cgnl buy — or the game's own choice, from
   * the ticket its player asked for (`tk`: its uid and whatever the game kept with it). */
  const grantFor = config.grantFor ?? ((cgnl) => [{ id: config.grantId, qty: Math.floor(cgnl / imp[config.grantId]) }]);

  const pseudonym = (uid) => createHmac("sha256", s.secret).update(uid).digest("base64url");
  /** R10's public name for an account here, toward one partner: links its crossovers from that game, nothing else. */
  const holderOf = (uid, aud) => createHmac("sha256", s.secret).update(`${uid}|${aud}`).digest("base64url");
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
    upkeep();
    await commit();
  }

  /** This game's side of a contract with each of `partners` (SPEC §5.1): this month's if it has none (a new start),
   * and next month's once the renewal window opens — unless `renew` is false (the contract then ends with the month).
   * A standing decision of this game's (§14); the other side signs its own. */
  function contracts(partners = config.partners ?? config.peers ?? [], { renew = config.renew ?? true } = {}) {
    const t = at();
    const has = (o, m) => s.log.some((e) => e.payload.type === "contract" && e.payload.aud === o && e.payload.month === m);
    const before = s.log.length;
    for (const o of partners) {
      if (s.log.some((e) => e.payload.type === "order" && e.payload.op === "end" && e.payload.aud === o)) continue; // Ended by the council: a new start is a new decision
      const m = t.slice(0, 7);
      if (!has(o, m)) append({ type: "contract", id: rid(), aud: o, month: m });
      const next = monthAdd(m, 1);
      if (renew && t >= contractWindow(next).opens && !has(o, next)) append({ type: "contract", id: rid(), aud: o, month: next });
    }
    if (s.log.length > before) sign();
  }

  /** The first council (§14): `config.council` lists each member with the consent they signed with their own key; one
   * is `master`. Seated once, while the log has no council; every change after that is the council's own `order`. */
  function councilUp() {
    if (s.log.some((e) => e.payload.type === "council")) return;
    for (const { member, consent, master } of config.council ?? []) {
      if (!consentOk(origin, member, consent)) throw new Error(`council: ${member.account}'s consent doesn't open with their key`);
      append({ type: "council", op: "join", member, consent, ...(master ? { master: true } : {}) });
    }
  }

  /** A link (R10) kept before links were logged: logged now, once. */
  function linksUp() {
    for (const [k, l] of Object.entries(s.links ?? {})) {
      const [aud, uid] = [k.slice(0, k.lastIndexOf("|")), k.slice(k.lastIndexOf("|") + 1)];
      append({ type: "link", aud, holder: holderOf(uid, aud), source: l.player, op: "on" });
      if (l.off) append({ type: "link", aud, holder: holderOf(uid, aud), source: l.player, op: "off" });
    }
    delete s.links;
  }

  /** What a game keeps up on its own, each day and on any write: its council, a changed card dated and logged (§4),
   * its contracts. */
  function upkeep() {
    const size = s.log.length;
    councilUp();
    linksUp();
    const body = cardBody();
    if (s.cardHash !== hashOf(body)) {
      s.cardHash = hashOf(body);
      s.cardIat = at();
      card = seal({ ...body, iat: s.cardIat }, key);
      s.log.push(card);
    }
    if (s.log.length !== size) sign();
    contracts();
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
    const rated = items.map((it) => ({ id: it.id, qty: it.qty, cgnl: it.qty * exp[it.id] }));
    // A debt (§8.1) is paid before anything else: these things burnt for it, nothing sent; more than it, refused
    const debt = s.debts[uid] ?? 0;
    if (debt > 0) {
      const pay = rated.reduce((n, it) => n + it.cgnl, 0);
      if (pay > debt) throw fail(409, "DEBT", `${debt} cgnl owed: pay it first (things worth at most that)`);
      await players.burn(uid, items);
      s.debts[uid] = debt - pay;
      append({ type: "repay", id: rid(), player: p, items: rated, cgnl: pay, left: s.debts[uid] });
      sign();
      return { repaid: pay, owed: s.debts[uid] };
    }
    if (config.partners && !config.partners.includes(to)) throw fail(403, "NOT_PARTNER", "not a partner of this game"); // Before fetching it
    const pubTo = await publicOf(to).catch(() => {
      throw fail(400, "UNREACHABLE", "that game's card can't be fetched");
    });
    const unbound = contractAt({ origin, entries: s.log }, pubTo, at());
    if (unbound) throw fail(403, "CONTRACT", unbound);
    if (paused(to)) throw fail(403, "PAUSED", "crossing with that game is paused by this game's council (§14)");
    // R9, no pass-through: what came in from other games never leaves again — only effort spent here does
    const received = Object.values(s.accepts).filter((x) => x.uid === uid && s.grants[x.acc.payload.id]).reduce((n, x) => n + x.acc.payload.cgnl, 0);
    const mine = worth(Object.entries(st).map(([id, qty]) => ({ id, qty })).filter((it) => exp[it.id])) - received;
    const asked = rated.reduce((n, it) => n + it.cgnl, 0);
    if (asked > mine) throw fail(422, "R9", `${asked} cgnl asked, ${Math.max(0, mine)} earned here (${received} came from other games and can't leave again)`);
    if (!(await days.get(today()))?.leaves.some((l) => l.p === p)) await commit(); // Not in today's commitment yet (joined since)
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
    const me = { origin, entries: s.log };
    const unbound = contractAt(me, a, at());
    if (unbound) throw fail(403, "CONTRACT", unbound);
    if (paused(o.iss)) throw fail(403, "PAUSED", "crossing with that game is paused by this game's council (§14)");
    const t = o.ticket?.payload;
    const tk = s.tickets[t?.sub];
    if (!opens(o.ticket, [s.key.jwk]) || t.iss !== origin || t.aud !== o.iss || t.exp < at() || !tk || tk.used || tk.nonce !== t.nonce)
      throw fail(400, "TICKET", "no valid ticket from this game");
    const why = r2(a, env);
    if (why) throw fail(422, "R2", why);
    // R10, one source at a time: an account here takes from one account of each partner game, which gives to it alone;
    // another needs the link undone first, and a week (UNLINK_DAYS) after undoing it before any new link, either side.
    // Logged (`link`), so anyone can check it from the log alone
    const holder = holderOf(tk.uid, o.iss);
    const now = links(s.log);
    const linked = now.live.get(`${o.iss}|h|${holder}`)?.source === o.player;
    const link = { type: "link", aud: o.iss, holder, source: o.player, op: "on" };
    const after = linked ? now : links([...s.log, { payload: { ...link, iat: at() } }]);
    if (after.breaches.length > now.breaches.length) throw fail(403, "SOURCE", after.breaches.at(-1).slice(12));
    // R10, the receiving side's time bound: at most hoursPerDay for each day the account has been here
    const joined = s.first[pseudonym(tk.uid)] ?? today();
    const taken = Object.values(s.accepts).filter((x) => x.uid === tk.uid).reduce((n, x) => n + x.acc.payload.cgnl, 0);
    const bound2 = ((Date.parse(today()) - Date.parse(joined)) / DAY + 1) * card.payload.hoursPerDay.adult * 100;
    if (taken + o.cgnl > bound2) throw fail(422, "R10", `${taken + o.cgnl} cgnl to one account here, ${bound2} allowed since ${joined}`);
    const week = Object.values(s.accepts).filter((x) => x.from === o.iss && x.acc.payload.iat > at(-7)).reduce((n, x) => n + x.acc.payload.cgnl, 0);
    const line = Math.min(policy.lineCap, policy.lineStart * 2 ** (contractMonths(me, a, at()) - 1)); // R5: doubles each month renewed
    if (week + o.cgnl > line) throw fail(429, "R5", `line: ${week} of ${line} taken this week`);
    // R5's net: what came from that game minus what went to it, 90 days, at most 4 lines — a one-way pump stops
    const since = at(-90);
    const took = Object.values(s.accepts).filter((x) => x.from === o.iss && x.acc.payload.iat > since).reduce((n, x) => n + x.acc.payload.cgnl, 0);
    const burnt = new Set(s.log.filter((e) => e.payload.type === "burn" && e.payload.aud === o.iss).map((e) => e.payload.id));
    const gave = s.log.filter((e) => e.payload.type === "offer" && e.payload.aud === o.iss && e.payload.iat > since && burnt.has(e.payload.id)).reduce((n, e) => n + e.payload.cgnl, 0);
    if (took - gave + o.cgnl > 4 * line) throw fail(429, "R5", `net: ${took - gave} of ${4 * line} taken from that game in 90 days`);
    const grant = (await grantFor(o.cgnl, imp, tk)).filter((g) => g.qty > 0);
    if (!grant.length) throw fail(422, "TOO_LITTLE", "too little effort to give anything for");
    tk.used = true;
    if (!linked) append(link);
    const acc = append({ type: "accept", id: o.id, aud: o.iss, offer: hashOf(o), cgnl: o.cgnl, grant, upfront: policy.upfront, burnBy: at(1), holder });
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
    // A debt here is paid first from what comes in (§8.1)
    const owed = s.debts[rec.uid] ?? 0;
    const pay = Math.min(owed, rec.acc.payload.cgnl);
    const keep = (rec.acc.payload.cgnl - pay) / rec.acc.payload.cgnl;
    for (const g of rec.acc.payload.grant) if (Math.floor(g.qty * keep) > 0) await players.grant(rec.uid, g.id, Math.floor(g.qty * keep), { from: rec.from, id, upfront: policy.upfront });
    if (pay) {
      s.debts[rec.uid] = owed - pay;
      append({ type: "repay", id: rid(), offer: rec.acc.payload.offer, cgnl: pay, left: s.debts[rec.uid] });
    }
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

  /** R10: the player here undoes their link to a partner's account. A new source, either side, waits UNLINK_DAYS. */
  function unlink(uid, from) {
    const holder = holderOf(uid, from);
    const l = links(s.log).live.get(`${from}|h|${holder}`);
    if (!l) throw fail(404, "NO_LINK", "no link to undo");
    const off = append({ type: "link", aud: from, holder, source: l.source, op: "off" });
    sign();
    return { from, off: off.payload.iat, newSourceFrom: at(UNLINK_DAYS) };
  }
  /** Each partner this account has had a link with: since when, and when undone (null while live). */
  function sources(uid) {
    const out = {};
    for (const e of s.log) {
      const p = e.payload;
      if (p.type !== "link" || p.holder !== holderOf(uid, p.aud)) continue;
      out[p.aud] = p.op === "on" ? { since: p.iat, off: null } : { ...out[p.aud], off: p.iat };
    }
    return out;
  }

  /** §8.1, as the giving game: one of its crossovers was cheated by its own player, on evidence it holds. It says so,
   * signed (VOID, to the receiver too); the sender owes what it carried, in cgnl, paid before anything else. */
  async function voidCrossover(offerId, why, order) {
    const off = s.log.find((e) => e.payload.type === "offer" && e.payload.id === offerId);
    if (!off || !s.log.some((e) => e.payload.type === "burn" && e.payload.id === offerId)) throw fail(404, "NO_CROSSOVER", "no burnt crossover by that id");
    if (s.voided[offerId]) return s.voided[offerId];
    const uid = s.uids[off.payload.player];
    const v = append({ type: "void", id: offerId, aud: off.payload.aud, offer: hashOf(off.payload), why: String(why).slice(0, 200), ...(order ? { order } : {}) });
    s.debts[uid] = (s.debts[uid] ?? 0) + off.payload.cgnl;
    append({ type: "penalty", id: rid(), offer: hashOf(off.payload), side: "sent", cgnl: off.payload.cgnl, player: off.payload.player });
    s.voided[offerId] = v;
    sign();
    await post(`${off.payload.aud}/gnl/void`, v).catch(() => null); // The receiver also reads it from this log
    return v;
  }

  /** §8.1, as the receiving game: a VOID from the giver — what hasn't vested is taken back, and the account that asked
   * for it owes as much again: it chose its source (R10), so it answers for it. */
  async function onVoid(env) {
    const v = env?.payload;
    const rec = Object.values(s.accepts).find((x) => x.acc.payload.offer === v?.offer);
    if (v?.type !== "void" || !rec || !signedBy(env, await publicOf(rec.from))) throw fail(400, "BAD_VOID", "no crossover of ours for this void");
    const id = rec.acc.payload.id;
    if (s.voided[id]) return { ok: true };
    s.voided[id] = env;
    await players.clawbackOne?.(rec.uid, id);
    s.debts[rec.uid] = (s.debts[rec.uid] ?? 0) + rec.acc.payload.cgnl;
    append({ type: "penalty", id: rid(), offer: v.offer, side: "received", cgnl: rec.acc.payload.cgnl, void: hashOf(v) });
    sign();
    return { ok: true };
  }

  /** §8.2, as the receiving game: its own mistake in a grant (a wrong price, a bug): what hasn't been handed over yet
   * is taken back, logged. Nobody owes anything: the fault is the game's. */
  async function cut(id, why, order) {
    const rec = Object.values(s.accepts).find((x) => x.acc.payload.id === id);
    if (!rec || !s.grants[id]) throw fail(404, "NO_CROSSOVER", "no granted crossover by that id");
    if (s.log.some((e) => e.payload.type === "cut" && e.payload.id === id)) return { ok: true };
    await players.clawbackOne?.(rec.uid, id);
    const c = append({ type: "cut", id, aud: rec.from, offer: rec.acc.payload.offer, why: String(why).slice(0, 200), ...(order ? { order } : {}) });
    sign();
    return c;
  }

  // §14: the council's acts. Each op names the fields it carries; the ballots sign all of them
  const ORDERS = { seat: ["member", "consent"], unseat: ["account"], master: ["account"], resign: ["account"], pause: ["aud", "until"], end: ["aud"], void: ["id"], cut: ["id"] };
  const seated = (a) => roster(s.log).members.some((m) => m.account === a);
  const paused = (aud) => s.log.some((e) => e.payload.type === "order" && e.payload.op === "pause" && e.payload.aud === aud && e.payload.until > at());
  /** An order of this game's council (§14): `{type: "order", iss, op, …, why, made}` and the yes `ballots` its members
   * signed over it (orderOk). Logged with them, then done. */
  async function onOrder(o) {
    const fields = ["type", "iss", "op", "why", "made", "ballots", ...(ORDERS[o?.op] ?? [])];
    if (o?.type !== "order" || o.iss !== origin || !ORDERS[o.op] || Object.keys(o).some((k) => !fields.includes(k)) || typeof o.why !== "string" || o.why.length > 200)
      throw fail(400, "BAD_ORDER", "not an order for this game");
    const no = orderOk(s.log, o, at());
    if (no) throw fail(403, "ORDER", no);
    const h = hashOf(Object.fromEntries(Object.entries(o).filter(([k]) => k !== "ballots")));
    if (s.log.some((e) => e.payload.type === "order" && hashOf(Object.fromEntries(Object.entries(e.payload).filter(([k]) => k !== "ballots" && k !== "iat"))) === h)) return { ok: true, again: true };
    const c = roster(s.log);
    const bad = {
      seat: () => (seated(o.member?.account) ? "already seated" : !consentOk(origin, o.member, o.consent) && "their consent doesn't open with their key"),
      unseat: () => (!seated(o.account) ? "not seated" : o.account === c.master && "name another master first"),
      master: () => !seated(o.account) && "a master must hold a seat",
      resign: () => o.account === c.master && c.members.length > 1 && "name another master first",
      pause: () => !(o.until > at() && o.until <= at(7)) && "a pause lasts at most 7 days",
      end: () => !(config.partners ?? config.peers ?? []).includes(o.aud) && "not a partner",
      void: () => false,
      cut: () => false,
    }[o.op]();
    if (bad) throw fail(409, "ORDER", bad);
    const { iss: _, ...entry } = o;
    append(entry);
    if (o.op === "seat") append({ type: "council", op: "join", member: o.member, consent: o.consent, order: h });
    if (o.op === "unseat" || o.op === "resign") append({ type: "council", op: "leave", member: { account: o.account }, by: o.op === "resign" ? "self" : "council", order: h });
    if (o.op === "master") append({ type: "council", op: "master", member: { account: o.account }, order: h });
    if (o.op === "void") await voidCrossover(o.id, o.why, h);
    if (o.op === "cut") await cut(o.id, o.why, h);
    upkeep(); // The card's council
    sign();
    return { ok: true, order: h };
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
    return pl && { ...pl.state, vesting: (pl.vesting ?? []).reduce((n, v) => n + v.left, 0), owes: s.debts[uid] ?? 0 };
  };

  const routes = {
    "GET /.well-known/gio-no-luc.json": () => card,
    "GET /gnl/log/entries.jsonl": () => s.log.map((e) => JSON.stringify(e)).join("\n") + "\n",
    "GET /gnl/log/checkpoint.json": () => s.checkpoint,
    "POST /gnl/offer": onOffer,
    "POST /gnl/burn": onBurn,
    "POST /gnl/audit": onAudit,
    "POST /gnl/void": onVoid,
    "POST /gnl/order": onOrder,
    "POST /dev/tick": () => ({ day: s.lastDay }),
    // §4.1: how each thing is earned and what the prices stand on — for people and agents alike
    "GET /gnl/effort.json": () => (config.effort ? config.effort() : effortOf(card.payload)), // Online: any write first does the new day's work; this is the write that does only that
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
      "POST /dev/unlink": (b) => unlink(String(b?.uid), String(b?.from)),
      "POST /dev/cross": (b) => cross(String(b?.uid), String(b?.to), b?.items, b?.ticket),
    });

  return { get card() { return card; }, routes, newDay, upkeep, contracts, commit, voidCrossover, onVoid, cut, onOrder, unlink, sources, earn, witness, runAudits, ticket, cross, worth, rewrite, player, punish, pseudonym, state: s };
}
