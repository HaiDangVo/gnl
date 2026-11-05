/**
 * Giờ Nổ Lực — the reference pieces every game needs (SPEC.md): canonical JSON, signed envelopes, the log's Merkle
 * tree, and the two rules anyone can check from public data alone. Node's own crypto only.
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";

/** RFC 8785 (JCS) for the JSON this protocol uses: keys sorted, no whitespace, numbers as JS prints them. */
export function canonical(v) {
  if (typeof v === "number" && !Number.isFinite(v)) throw new Error("JCS: non-finite number");
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
}

export const sha256 = (...parts) => {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return h.digest();
};
export const hashOf = (payload) => sha256(canonical(payload)).toString("base64url");

// --- Keys and envelopes (SPEC §3) ---------------------------------------------------------------------------

export function newKey(kid) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { kid, jwk: { ...publicKey.export({ format: "jwk" }), kid }, privateKey };
}

export const privateFromJwk = (jwk) => createPrivateKey({ key: jwk, format: "jwk" });

/** `{ payload, sig: { kid, value } }`, the signature over the payload's canonical JSON. */
export const seal = (payload, key) => ({
  payload,
  sig: { kid: key.kid, value: sign(null, Buffer.from(canonical(payload)), key.privateKey).toString("base64url") },
});

/** True only for a signature by one of `jwks` (a rate card's `keys`) — the caller still checks iss/aud/exp. */
export function opens(envelope, jwks) {
  const jwk = jwks.find((k) => k.kid === envelope?.sig?.kid);
  if (!jwk) return false;
  const key = createPublicKey({ key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x }, format: "jwk" });
  return verify(null, Buffer.from(canonical(envelope.payload)), key, Buffer.from(envelope.sig.value, "base64url"));
}

// --- The log's tree: RFC 9162 (Certificate Transparency 2.0) hashing --------------------------------------

const leafHash = (entry) => sha256(Buffer.from([0]), canonical(entry));
const nodeHash = (l, r) => sha256(Buffer.from([1]), l, r);
const split = (n) => 2 ** Math.floor(Math.log2(n - 1)); // Largest power of two below n

function rootOf(leaves) {
  if (leaves.length === 0) return sha256("");
  if (leaves.length === 1) return leaves[0];
  const k = split(leaves.length);
  return nodeHash(rootOf(leaves.slice(0, k)), rootOf(leaves.slice(k)));
}

export const merkleRoot = (entries) => rootOf(entries.map(leafHash)).toString("base64url");

/** The audit path proving entries[i] is in the tree of all `entries`. */
export function inclusionProof(entries, i) {
  const go = (leaves, m) => {
    if (leaves.length <= 1) return [];
    const k = split(leaves.length);
    return m < k
      ? [...go(leaves.slice(0, k), m), rootOf(leaves.slice(k))]
      : [...go(leaves.slice(k), m - k), rootOf(leaves.slice(0, k))];
  };
  return go(entries.map(leafHash), i).map((h) => h.toString("base64url"));
}

/** RFC 9162 §2.1.3.2: recompute the root from one entry, its index, the tree size and its path. */
export function verifyInclusion(entry, index, size, proof, root) {
  if (index >= size) return false;
  let fn = index, sn = size - 1, r = leafHash(entry);
  for (const p of proof.map((h) => Buffer.from(h, "base64url"))) {
    if (sn === 0) return false;
    if (fn % 2 === 1 || fn === sn) {
      r = nodeHash(p, r);
      if (fn % 2 === 0) while (fn % 2 === 0 && fn !== 0) (fn >>= 1), (sn >>= 1);
    } else r = nodeHash(r, p);
    fn >>= 1;
    sn >>= 1;
  }
  return sn === 0 && r.toString("base64url") === root;
}

// --- Rules anyone can check from public data (SPEC §7) ----------------------------------------------------

/** R8: importing a thing never costs less than exporting it pays, so no loop of crossovers gains. Returns offenders. */
export const arbitrage = (card) =>
  card.imports.filter((i) => {
    const e = card.exports.find((x) => x.id === i.id);
    return e && i.cgnlPer < e.cgnlPer;
  }).map((i) => i.id);

/** R3: the fields of `next` that grew past the card's own `pace` since `prev`, `seconds` earlier. Data, never code. */
export const paceBreaks = (pace, prev, next, seconds) =>
  Object.entries(pace)
    .filter(([f, { burst, perHour }]) => (next[f] ?? 0) - (prev[f] ?? 0) > burst + (perHour * Math.max(0, seconds)) / 3600)
    .map(([f]) => f);

const DAY = 86_400_000;

/** R2: the most an account may export, from its first committed day, the card's daily ceiling and what it already sent. */
export const timeBound = ({ firstDay, now, hoursPerDay, exported }) =>
  Math.max(0, Math.ceil((now - firstDay) / DAY) * hoursPerDay * 100 - exported); // In cgnl (hundredths of an hour)

// --- Contracts and decisions (SPEC §5.1, §14) ----------------------------------------------------------------

/** "2026-11" → "2026-12" (and back with -1). */
export const monthAdd = (m, n) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1 + n, 1)).toISOString().slice(0, 7);
/** When a contract for month `m` may be signed: from the start of the last 7 days of the month before (the renewal
 * window) to the end of `m` itself (a new start, not a renewal). ISO strings, end exclusive. */
export const contractWindow = (m) => {
  const start = Date.parse(`${m}-01T00:00:00Z`);
  return { opens: new Date(start - 7 * DAY).toISOString(), starts: new Date(start).toISOString(), ends: `${monthAdd(m, 1)}-01T00:00:00.000Z` };
};

/** A game's decision, out of 100: 50 × the share of its host's council that said yes (`host`: {yes, of}; one person
 * running the game is a council of one, "yes"/"no"), plus 50 × the share of its eligible players who said yes —
 * abstaining counts as not yes, on both sides. Passes at 55, so neither side decides alone. */
export function tally({ host, yes, eligible }) {
  const council = typeof host === "string" ? { yes: host === "yes" ? 1 : 0, of: 1 } : host;
  const hostShare = council.of > 0 ? Math.min(council.yes, council.of) / council.of : 0;
  const weight = 50 * hostShare + (eligible > 0 ? (50 * Math.min(yes, eligible)) / eligible : 0);
  return { weight, pass: eligible < SMALL ? hostShare >= 0.55 - 1e-9 : weight >= 55 - 1e-9 }; // Under 30 eligible: the council's own 55%, shown as such
}
const SMALL = 30;
/** A protocol decision: every member game's host and community weigh 50/N each, from each game's own tally. */
export function tallyProtocol(games) {
  const n = games.length;
  const weight = games.reduce((w, g) => w + tally(g).weight / n, 0);
  return { weight, pass: n > 0 && weight >= 55 - 1e-9 };
}
