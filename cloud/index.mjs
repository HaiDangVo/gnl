/**
 * The two sandbox games online (ROADMAP stage 1): a function each. State in Firestore (`gnl-sandbox/<name>`, one JSON string each); a day's work — the
 * commitment, co-signing the other, audits, anchoring the checkpoint on Bitcoin (OpenTimestamps) and Ronin Saigon —
 * runs on the first write of a new UTC day and from the daily schedule.
 *
 *   https://gnl-endless.web.app — endless-run's coins (apps/endless-run in goodgame_engine), function `gnl` behind Hosting
 *   https://gnl-sandbox.web.app — the toy game (gold, levels, gems), function `gnlsandbox` behind Hosting
 */
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { createWalletClient, defineChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { canonical, sha256 } from "./lib/ref/gnl.js";
import { freshState, game, realClock } from "./lib/sandbox/game.mjs";
import { serve, TOY } from "./lib/sandbox/node.mjs";

initializeApp();
const db = getFirestore();
// The Saigon wallet's key, a Secret Manager secret the owner set (never in the repo): each day's Ronin anchor
const SAIGON_SECRET = defineSecret("GNL_SAIGON_KEY");
const SAIGON_KEY = () => process.env.GNL_SAIGON_KEY?.trim();
const REGION = "asia-southeast1";

const ENDLESS = {
  name: "Endless Run (sandbox)",
  contact: "https://endless-run.web.app",
  grantId: "coin",
  items: [{ id: "coin", name: "Coin", unit: "coin", cgnlPer: 1 }], // ponytail: a guess (100 coins an hour); measure runs first
  pace: { coin: { burst: 500, perHour: 3000 } },
};
const ENDLESS_ORIGIN = "https://gnl-endless.web.app";
const SANDBOX = "https://gnl-sandbox.web.app";
const RESWORLD = "https://resworld.web.app"; // Res World, the first real game (its node lives in its own functions)
const GAMES = {
  [ENDLESS_ORIGIN]: { name: "endless", config: { ...ENDLESS, peers: [SANDBOX, RESWORLD], partners: [SANDBOX, RESWORLD] } },
  [SANDBOX]: { name: "sandbox", config: { ...TOY, name: "Sandbox (toy)", peers: [ENDLESS_ORIGIN, RESWORLD], partners: [ENDLESS_ORIGIN, RESWORLD] } },
};

const live = {}; // origin → { s, g, save } for this instance
const locks = {};
/** One writer at a time per game (maxInstances 1: this process is the only one). */
const locked = (host, fn) => (locks[host] = (locks[host] ?? Promise.resolve()).then(fn, fn));

async function load(host) {
  if (live[host]) return live[host];
  const { name, config } = GAMES[host];
  const ref = db.doc(`gnl-sandbox/${name}`);
  const snap = await ref.get();
  const s = snap.exists ? JSON.parse(snap.get("json")) : freshState(name, new Date().toISOString());
  const g = game(s, { origin: host, clock: realClock, config });
  return (live[host] = { s, g, save: () => ref.set({ json: JSON.stringify(s), at: new Date() }) });
}

const chain = defineChain({ id: 202601, name: "Ronin Saigon", nativeCurrency: { name: "RON", symbol: "RON", decimals: 18 }, rpcUrls: { default: { http: ["https://saigon-testnet.roninchain.com/rpc"] } } });
const OTS_MAGIC = Buffer.from("004f70656e54696d657374616d7073000050726f6f6600bf89e2e884e89294", "hex");

/** The checkpoint into Bitcoin (an .ots file anyone can `ots upgrade` then verify against the checkpoint's JCS) and
 * onto Ronin Saigon (SPEC §6.3). A failure costs only that day's anchor. */
async function anchor(s) {
  const cp = s.checkpoint.payload;
  const digest = sha256(canonical(cp));
  const of = digest.toString("base64url");
  try {
    const r = await fetch("https://a.pool.opentimestamps.org/digest", { method: "POST", headers: { Accept: "application/vnd.opentimestamps.v1" }, body: digest });
    if (r.ok) {
      const ots = Buffer.concat([OTS_MAGIC, Buffer.from([0x01, 0x08]), digest, Buffer.from(await r.arrayBuffer())]);
      s.anchors.push({ kind: "ots", ref: ots.toString("base64"), checkpoint: of });
    }
  } catch {}
  if (SAIGON_KEY()) try {
    const account = privateKeyToAccount(SAIGON_KEY());
    const hash = await createWalletClient({ chain, transport: http(), account }).sendTransaction({ to: account.address, value: 0n, data: `0x474e4c31${digest.toString("hex")}` });
    s.anchors.push({ kind: "ronin", ref: `202601:${hash}`, checkpoint: of });
  } catch {}
  s.anchors = s.anchors.slice(-8);
}

/** A new UTC day's work for one game, once: the commitment, witnessing, audits — then the day's anchors, once too. */
async function daily(origin) {
  const { s, g, save } = await load(origin);
  const today = realClock.today();
  if (s.lastDay !== today) {
    await g.newDay();
    await save(); // Its commitment is public before it asks anyone else for anything
    try {
      await g.witness();
      await g.runAudits();
    } catch (e) {
      console.warn(`${origin} daily:`, e.message);
    }
  }
  if (s.anchoredDay === today) return;
  s.anchoredDay = today; // Before anchoring: two writes at once don't spend the chain account's nonce twice
  await anchor(s);
  await g.commit(); // The anchors into the next signed checkpoint (and a fresh commitment: R2 counts days, not commitments)
  await save();
}

const OPTS = { region: REGION, invoker: "public", maxInstances: 1, concurrency: 20, cpu: 1, memory: "512MiB", timeoutSeconds: 60, secrets: [SAIGON_SECRET] };

/** One game's HTTP face: SPEC §9 plus the sandbox's /dev doors (CORS open: endless-run's page calls them). */
const node = (origin) =>
  onRequest(OPTS, async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Headers", "content-type");
    if (req.method === "OPTIONS") return void res.status(204).end();
    if (origin.includes("PENDING")) return void res.status(503).json({ error: { code: "NOT_YET", message: "this game's address isn't set yet" } });
    const run = async () => {
      if (req.method === "POST") await daily(origin);
      const { g, save } = await load(origin);
      const out = await serve(g.routes, req.method, req.path, req.rawBody?.length ? req.rawBody.toString() : undefined);
      if (req.method === "POST" && out.status < 500) await save();
      return out;
    };
    // Reads never wait on a writer: a game witnessing the other calls back into it mid-write
    const out = req.method === "GET" ? await run() : await locked(origin, run);
    res.status(out.status).type(out.type).send(out.body);
  });

export const gnl = node(ENDLESS_ORIGIN);
export const gnlsandbox = node(SANDBOX);

/** Each game's day's work even when no one plays. */
export const gnlDaily = onSchedule({ region: REGION, schedule: "10 0 * * *", timeZone: "UTC", maxInstances: 1 }, async () => {
  for (const origin of Object.keys(GAMES)) {
    const r = await fetch(`${origin}/dev/tick`, { method: "POST" });
    console.log(origin, r.status);
  }
});
