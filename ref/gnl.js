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
