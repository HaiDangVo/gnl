/**
 * A witness's copies of the logs it co-signs (SPEC §6.3): each game's entries as last seen, and every history a game
 * replaced (a sandbox starting over, a fork) kept apart, for good. A game that deletes its log still has these.
 *
 *   head(origin)          → { size, root } of the current copy, or null
 *   put(origin, entries, fresh)  stores the entries as the current copy; `fresh`: the old one is kept as history first
 *   get(origin, gen)      → the entries of copy `gen` (0 the oldest; the last one current)
 *   list()                → [{ of, gens: [{ size, root }] }]
 */
import { merkleRoot } from "../ref/gnl.js";

/** In memory (the demo, a node on its own). */
export function memoryMirror() {
  const m = new Map();
  return {
    async head(o) {
      const g = m.get(o)?.at(-1);
      return g ? { size: g.length, root: merkleRoot(g) } : null;
    },
    async put(o, entries, fresh) {
      const gens = m.get(o) ?? [];
      if (fresh || !gens.length) gens.push([]);
      gens[gens.length - 1] = [...entries];
      m.set(o, gens);
    },
    get: async (o, gen) => m.get(o)?.[gen] ?? null,
    list: async () => [...m].map(([of, gens]) => ({ of, gens: gens.map((g) => ({ size: g.length, root: merkleRoot(g) })) })),
  };
}

const CHUNK = 400; // Entries a document: ~300 KB, under Firestore's 1 MiB

/** In Firestore (`db` from firebase-admin): `<col>/<host>` holds the copies' sizes and roots, `<col>/<host>~<gen>~<n>`
 * their entries, CHUNK at a time. Only the chunks that changed are written. */
export function firestoreMirror(db, col) {
  const id = (o) => new URL(o).host;
  const meta = async (o) => (await db.doc(`${col}/${id(o)}`).get()).data() ?? { of: o, gens: [] };
  return {
    async head(o) {
      return (await meta(o)).gens.at(-1) ?? null;
    },
    async put(o, entries, fresh) {
      const m = await meta(o);
      if (fresh || !m.gens.length) m.gens.push({ size: 0, root: "" });
      const g = m.gens.length - 1;
      const batch = db.batch();
      for (let k = Math.floor(m.gens[g].size / CHUNK) * CHUNK; k < entries.length; k += CHUNK)
        batch.set(db.doc(`${col}/${id(o)}~${g}~${k / CHUNK}`), { lines: entries.slice(k, k + CHUNK).map((e) => JSON.stringify(e)) });
      m.gens[g] = { size: entries.length, root: merkleRoot(entries) };
      batch.set(db.doc(`${col}/${id(o)}`), m);
      await batch.commit();
    },
    async get(o, gen) {
      const g = (await meta(o)).gens[gen];
      if (!g) return null;
      const docs = await Promise.all(Array.from({ length: Math.ceil(g.size / CHUNK) }, (_, k) => db.doc(`${col}/${id(o)}~${gen}~${k}`).get()));
      return docs.flatMap((d) => d.get("lines") ?? []).map((l) => JSON.parse(l));
    },
    async list() {
      return (await db.collection(col).select("of", "gens").get()).docs.filter((d) => !d.id.includes("~")).map((d) => ({ of: d.get("of"), gens: d.get("gens") }));
    },
  };
}
