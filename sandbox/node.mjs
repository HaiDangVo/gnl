/**
 * A sandbox game speaking gnl/0 (SPEC.md): fake players with gold, levels and gems, a simulated day clock, its own
 * log, daily commitments, witnessing its peers, and both sides of a crossover. In memory; one process can run several.
 *
 * `cheat` makes it lie on purpose, so the rules can be seen catching it:
 *   inflate — offers more than its time bound (R2)        keep — signs a burn, keeps the things (R4)
 *   pace    — fakes a jump in a player's progress (R3)    nogrant — accepts, takes the burn, never grants (R7)
 *   (fork: call `rewrite()` — it drops an entry a witness already co-signed (R7))
 *
 *   node sandbox/node.mjs <name> <port> [cheat]          one node on its own, for poking with curl
 */
import { createHmac, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { hashOf, inclusionProof, merkleRoot, newKey, opens, seal } from "../ref/gnl.js";
import { auditFinds, leafOf, publicOf, r2, signedBy, stateHash } from "./rules.mjs";

const DAY = 86_400_000;
const PACE = { gold: { burst: 200, perHour: 100 }, level: { burst: 1, perHour: 1 }, gems: { burst: 5, perHour: 3 } };
const EXPORTS = [
  { id: "gold", name: "Gold", unit: "coin", cgnlPer: 2 },
  { id: "level", name: "Level", unit: "level", cgnlPer: 3000 },
  { id: "gems", name: "Gem", unit: "gem", cgnlPer: 60 },
];
const IMPORTS = EXPORTS.map((r) => ({ ...r, cgnlPer: Math.ceil(r.cgnlPer * 1.5) })); // R8: in costs more than out
const POLICY = { lineStart: 10_000, lineCap: 1_000_000, upfront: 0.2, vestPerHour: 300 };

const rid = () => randomBytes(16).toString("base64url");
const fail = (status, code, message) => Object.assign(new Error(message), { status, code });

async function post(url, body) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw fail(r.status, j.error?.code, j.error?.message ?? `${url}: ${r.status}`);
  return j;
}

export async function startNode({ name, port, cheat = "", seed = {}, grow = {}, base = "2026-11-01" }) {
  const origin = `http://localhost:${port}`;
  const key = newKey(`${name}-1`);
  const secret = randomBytes(32);
  let day = -1; // The simulated clock: newDay() starts it at `base`
  const today = () => new Date(Date.parse(base) + Math.max(0, day) * DAY).toISOString().slice(0, 10);
  const at = (days = 0) => new Date(Date.parse(`${today()}T12:00:00Z`) + days * DAY).toISOString();

  const log = [];
  let checkpoint = null;
  const players = new Map(Object.entries(seed).map(([uid, state]) => [uid, { state: { ...state }, held: {}, hist: new Map(), first: null, vesting: [] }]));
  const byPseudonym = new Map();
  const leaves = new Map(); // day → that day's commitment leaves
  const tickets = new Map(); // one-time sub → { uid, nonce, used }
  const accepts = new Map(); // accept hash → { acc, uid, from, offer }
  const grants = new Map(); // offer id → GRANT
  const audits = []; // grants still to audit once a day has passed
  const suspended = new Set();
  const found = []; // proofs this node logged

  const pseudonym = (uid) => createHmac("sha256", secret).update(uid).digest("base64url");
  for (const uid of players.keys()) byPseudonym.set(pseudonym(uid), uid);
  const append = (payload) => {
    const env = seal({ ...payload, iss: origin, iat: at() }, key);
    log.push(env);
    return env;
  };
  const sign = () => (checkpoint = seal({ type: "checkpoint", iss: origin, iat: at(), size: log.length, root: merkleRoot(log), t: at() }, key));
  const proofFor = (p, d) => {
    const ls = leaves.get(d);
    const index = ls.findIndex((l) => l.p === p);
    return { day: d, s: ls[index].s, index, size: ls.length, proof: inclusionProof(ls, index) };
  };
  const card = seal(
    {
      type: "card", protocol: "gnl/0", iss: origin, iat: at(), game: { name: `Sandbox ${name}`, contact: "sandbox", jurisdiction: "VN" },
      keys: [key.jwk], hoursPerDay: { minor: 1, adult: 16 }, pace: PACE, exports: EXPORTS, imports: IMPORTS, policy: POLICY, witnesses: [],
    },
    key,
  );
  const imp = Object.fromEntries(IMPORTS.map((r) => [r.id, r.cgnlPer]));
  const exp = Object.fromEntries(EXPORTS.map((r) => [r.id, r.cgnlPer]));

  /** A new day: everyone grows a day's worth, then the day's commitment and a checkpoint. */
  function newDay() {
    if (day++ >= 0)
      for (const [uid, pl] of players) for (const [f, n] of Object.entries(grow[uid] ?? {})) pl.state[f] = (pl.state[f] ?? 0) + n;
    if (cheat === "pace" && day === 2) players.values().next().value.state.gold += 100_000; // Progress no one earned
    const d = today();
    const ls = [...players].map(([uid, pl]) => {
      const p = pseudonym(uid);
      const salt = createHmac("sha256", secret).update(`${p}|${d}`).digest("base64url");
      pl.hist.set(d, { state: structuredClone(pl.state), salt });
      pl.first ??= d;
      return leafOf(p, d, stateHash(salt, pl.state));
    });
    ls.sort((a, b) => (a.p < b.p ? -1 : 1));
    leaves.set(d, ls);
    append({ type: "commit", day: d, root: merkleRoot(ls), size: ls.length });
    sign();
  }

  /** Co-sign every peer's current checkpoint, after checking it only grew from the last one co-signed. */
  async function witness(peers) {
    for (const o of peers) {
      const pub = await publicOf(o);
      if (merkleRoot(pub.entries) !== pub.checkpoint.payload.root) throw new Error(`${o} serves entries that don't match its checkpoint`);
      const last = log.findLast((e) => e.payload.type === "cosign" && e.payload.of === o)?.payload.checkpoint;
      if (last && merkleRoot(pub.entries.slice(0, last.payload.size)) !== last.payload.root) {
        found.push(append({ type: "proof", against: o, rule: "R7", why: `forked log: no longer extends its checkpoint of size ${last.payload.size}`, evidence: [last, pub.checkpoint] }));
        punish(o);
        continue;
      }
      append({ type: "cosign", of: o, checkpoint: pub.checkpoint });
    }
    sign();
  }

  /** B: audit what it granted once the giver has committed a day since the burn (R3, R4); a lie → a proof, cut off. */
  async function runAudits() {
    for (const job of audits.splice(0)) {
      if (job.burn.payload.iat.slice(0, 10) >= today()) {
        audits.push(job);
        continue;
      }
      const req = seal({ type: "audit", iss: origin, iat: at(), aud: job.from, offer: hashOf(job.offer.payload) }, key);
      const reply = await post(`${job.from}/gnl/audit`, req);
      const f = auditFinds(await publicOf(job.from), job.offer, job.burn, reply);
      if (f) {
        found.push(append({ type: "proof", against: job.from, rule: f.rule, why: f.why, evidence: [job.offer, job.burn, reply] }));
        punish(job.from);
      }
    }
    sign();
  }

  /** On a fraud proof: no more from that game, and what's still vesting from it is taken back. */
  function punish(o) {
    suspended.add(o);
    for (const pl of players.values()) for (const v of pl.vesting) if (v.from === o) v.left = 0;
  }

  // --- The player's side ---------------------------------------------------------------------------------------

  /** B: the one-time ticket a player of this game carries to the game they leave (SPEC §5). */
  function ticket(uid, to) {
    const sub = rid();
    const t = seal({ type: "ticket", iss: origin, iat: at(), aud: to, sub, nonce: rid(), exp: at(0.01) }, key);
    tickets.set(sub, { uid, nonce: t.payload.nonce, used: false });
    return t;
  }

  /** A: the player, signed in, confirms giving these things up for a start in `to`. */
  async function cross(uid, to, items, tk) {
    const pl = players.get(uid);
    const p = pseudonym(uid);
    for (const it of items) if ((pl.state[it.id] ?? 0) - (pl.held[it.id] ?? 0) < it.qty) throw fail(400, "NOT_ENOUGH", `${uid} has too little ${it.id}`);
    const rated = items.map((it) => ({ ...it, cgnl: it.qty * exp[it.id] }));
    const offer = append({
      type: "offer", id: rid(), aud: to, ticket: tk, player: p, items: rated, cgnl: rated.reduce((n, it) => n + it.cgnl, 0),
      first: proofFor(p, pl.first), commit: proofFor(p, today()), exp: at(1),
    });
    if (cheat !== "inflate") {
      const why = r2({ origin, card, entries: log }, offer);
      if (why) {
        log.pop(); // An honest game never logs an offer it would have to refuse itself
        throw fail(422, "R2", why);
      }
    }
    for (const it of items) pl.held[it.id] = (pl.held[it.id] ?? 0) + it.qty;
    const release = () => items.forEach((it) => (pl.held[it.id] -= it.qty));
    let acc;
    try {
      acc = await post(`${to}/gnl/offer`, offer);
      if (!signedBy(acc, await publicOf(to)) || acc.payload.offer !== hashOf(offer.payload)) throw fail(502, "BAD_ACCEPT", "an accept that doesn't open");
    } catch (e) {
      release();
      append({ type: "refund", id: offer.payload.id, offer: hashOf(offer.payload), why: "refused" });
      sign();
      return { offer, refused: `${e.code}: ${e.message}` };
    }
    release();
    if (cheat !== "keep") for (const it of items) pl.state[it.id] -= it.qty;
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
    const o = env.payload;
    if (o?.type !== "offer" || o.aud !== origin) throw fail(400, "BAD_OFFER", "not an offer for this game");
    const a = await publicOf(o.iss);
    if (!signedBy(env, a)) throw fail(401, "R1", "signature");
    if (suspended.has(o.iss)) throw fail(403, "SUSPENDED", "a fraud proof stands against this game");
    if (o.exp < at()) throw fail(400, "EXPIRED", "offer expired");
    const t = o.ticket?.payload;
    const tk = tickets.get(t?.sub);
    if (!opens(o.ticket, [key.jwk]) || t.iss !== origin || t.aud !== o.iss || t.exp < at() || !tk || tk.used || tk.nonce !== t.nonce)
      throw fail(400, "TICKET", "no valid ticket from this game");
    const why = r2(a, env);
    if (why) throw fail(422, "R2", why);
    const week = [...accepts.values()].filter((x) => x.from === o.iss && Date.parse(x.acc.payload.iat) > Date.parse(at(-7))).reduce((n, x) => n + x.acc.payload.cgnl, 0);
    if (week + o.cgnl > POLICY.lineStart) throw fail(429, "R5", `line: ${week} of ${POLICY.lineStart} taken this week`); // ponytail: the line doesn't grow yet
    tk.used = true;
    const acc = append({
      type: "accept", id: o.id, aud: o.iss, offer: hashOf(o), cgnl: o.cgnl,
      grant: [{ id: "gold", qty: Math.floor(o.cgnl / imp.gold) }], upfront: POLICY.upfront, burnBy: at(1),
    });
    accepts.set(hashOf(acc.payload), { acc, uid: tk.uid, from: o.iss, offer: env });
    sign();
    return acc;
  }

  async function onBurn(env) {
    const rec = accepts.get(env.payload?.accept);
    if (!rec || env.payload.type !== "burn" || !signedBy(env, await publicOf(rec.from))) throw fail(400, "BAD_BURN", "no accept of ours for this burn");
    const id = rec.acc.payload.id;
    if (grants.has(id)) return grants.get(id); // Idempotent: the same burn, the same grant
    if (cheat === "nogrant") throw fail(503, "BUSY", "try later");
    const pl = players.get(rec.uid);
    const qty = rec.acc.payload.grant[0].qty;
    const up = Math.floor(qty * POLICY.upfront);
    pl.state.gold = (pl.state.gold ?? 0) + up;
    pl.vesting.push({ from: rec.from, left: qty - up });
    const g = append({ type: "grant", id, aud: rec.from, burn: hashOf(env.payload) });
    grants.set(id, g);
    audits.push({ from: rec.from, offer: rec.offer, burn: env });
    sign();
    return g;
  }

  async function onAudit(env) {
    const req = env.payload;
    const off = log.find((e) => e.payload.type === "offer" && hashOf(e.payload) === req?.offer);
    // Only the game the offer went to may audit it: the public ticket is no consent for anyone else
    if (!off || req.iss !== off.payload.aud || !signedBy(env, await publicOf(req.iss))) throw fail(403, "AUDIT", "not yours to audit");
    const pl = players.get(byPseudonym.get(off.payload.player));
    const days = [...pl.hist].map(([d, h]) => ({ ...proofFor(off.payload.player, d), state: h.state, salt: h.salt }));
    return seal({ type: "audit-reply", iss: origin, iat: at(), aud: req.iss, offer: req.offer, days: days.map(({ s, ...d }) => d) }, key);
  }

  /** The fork cheat: drop the first offer from the log after a witness co-signed it, and sign the new history. */
  function rewrite() {
    log.splice(log.findIndex((e) => e.payload.type === "offer"), 1);
    sign();
  }

  const routes = {
    "GET /.well-known/gio-no-luc.json": () => card,
    "GET /gnl/log/entries.jsonl": () => log.map((e) => JSON.stringify(e)).join("\n") + "\n",
    "GET /gnl/log/checkpoint.json": () => checkpoint,
    "POST /gnl/offer": onOffer,
    "POST /gnl/burn": onBurn,
    "POST /gnl/audit": onAudit,
    "GET /dev/players": () => Object.fromEntries([...players].map(([u, pl]) => [u, { ...pl.state, vesting: pl.vesting.reduce((n, v) => n + v.left, 0) }])),
  };
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    try {
      const route = routes[`${req.method} ${req.url}`];
      if (!route) throw fail(404, "NOT_FOUND", req.url);
      const out = await route(body ? JSON.parse(body) : undefined);
      res.writeHead(200, { "content-type": typeof out === "string" ? "application/jsonl" : "application/json" });
      res.end(typeof out === "string" ? out : JSON.stringify(out));
    } catch (e) {
      res.writeHead(e.status ?? 500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code: e.code ?? "ERROR", message: e.message } }));
    }
  });
  await new Promise((ok) => server.listen(port, ok));
  newDay();

  return {
    origin, name, newDay, witness, runAudits, ticket, cross, rewrite, found, suspended,
    player: (uid) => ({ ...players.get(uid).state, vesting: players.get(uid).vesting.reduce((n, v) => n + v.left, 0) }),
    close: () => new Promise((ok) => server.close(ok)),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [name = "a", port = "4001", cheat = ""] = process.argv.slice(2);
  const n = await startNode({ name, port: +port, cheat, seed: { alice: { gold: 2000, level: 1, gems: 0 } }, grow: { alice: { gold: 2000, level: 1, gems: 5 } } });
  console.log(`sandbox ${name} at ${n.origin}${cheat ? ` (cheat: ${cheat})` : ""}`);
}
