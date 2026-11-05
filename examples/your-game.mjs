/**
 * Your game on Giờ Nổ Lực with the least code (JOINING.md): the protocol node (sandbox/game.mjs) over your own
 * accounts. Copy it, then put your database where the Maps are. Everything a player can carry out must live on your
 * server: a game that trusts saves from devices can't burn for sure (SPEC §13).
 *
 *   ORIGIN=https://your-game.example PORT=4400 node examples/your-game.mjs
 *   npm run conform -- https://your-game.example        (behind HTTPS)
 *
 * Still yours to build: the page in your game where the player chooses and confirms (signed in), and unlocking
 * `vesting` as they play (R6). Worked, real versions: cloud/index.mjs (the sandboxes), Res World's functions/gnlNode.js.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { fail, freshState, game, realClock } from "../sandbox/game.mjs";
import { serve } from "../sandbox/node.mjs";

const ORIGIN = process.env.ORIGIN ?? "http://localhost:4400";
const FILE = new URL("./your-game.state.json", import.meta.url); // The node's own state (its keys too): your database, privately

// Your accounts — what can leave, as numbers per account
const accounts = new Map([["u1", { coins: 5000, gems: 20, vesting: [] }]]);
const daysTable = new Map();

const players = {
  uids: async () => [...accounts.keys()], // Who is committed daily: everyone who may ever carry something out
  state: async (uid) => accounts.has(uid) && { coins: accounts.get(uid).coins, gems: accounts.get(uid).gems },
  async burn(uid, items) {
    const a = accounts.get(uid); // In a real game: one transaction, all or nothing
    for (const it of items) if ((a[it.id] ?? 0) < it.qty) throw fail(409, "NOT_ENOUGH", `too little ${it.id}`);
    for (const it of items) a[it.id] -= it.qty;
  },
  async grant(uid, thing, qty, { from, id, upfront }) {
    const a = accounts.get(uid);
    const now = Math.floor(qty * upfront);
    a[thing] = (a[thing] ?? 0) + now;
    a.vesting.push({ from, id, thing, left: qty - now }); // Unlocked as they play here (R6): yours to do
  },
  async clawback(from) {
    for (const a of accounts.values()) for (const v of a.vesting) if (v.from === from) v.left = 0;
  },
  async clawbackOne(uid, id) {
    for (const v of accounts.get(uid)?.vesting ?? []) if (v.id === id) v.left = 0;
  },
};
const days = { put: async (d, rec) => void daysTable.set(d, rec), get: async (d) => daysTable.get(d) ?? null };

const config = {
  name: "Your Game",
  contact: "https://your-game.example",
  // Prices from your players' measured pace (SPEC §4): cgnl (hundredths of an hour) a unit took a typical player
  items: [
    { id: "coins", name: "Coins", unit: "coin", cgnlPer: 1 },
    { id: "gems", name: "Gems", unit: "gem", cgnlPer: 50 },
  ],
  pace: { coins: { burst: 500, perHour: 3000 }, gems: { burst: 5, perHour: 10 } }, // Your anti-cheat ceilings, as data
  grantId: "coins", // What incoming effort becomes
  partners: [], // Origins you hold contracts with (SPEC §5.1); nobody else is fetched or accepted
  peers: [], // The games you witness
  sandbox: false, // No /dev doors: your players act through your game, signed in
  stage: "sandbox", // SPEC §5.2: try everything with the two sandboxes first; "live" once, for good (conform checks)
};

const s = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : freshState("your-game", new Date().toISOString());
const g = game(s, { origin: ORIGIN, clock: realClock, config, players, days });
const save = () => writeFileSync(FILE, JSON.stringify(s));

createServer(async (req, res) => {
  let body = "";
  for await (const c of req) body += c;
  if (req.method === "POST" && s.lastDay !== realClock.today()) await g.newDay(); // A day's commitment on the first write
  const out = await serve(g.routes, req.method, req.url, body);
  if (req.method === "POST") save();
  res.writeHead(out.status, { "content-type": out.type });
  res.end(out.body);
}).listen(+(process.env.PORT ?? 4400), () => console.log(`your game's node at ${ORIGIN}`));
