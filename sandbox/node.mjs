/**
 * A sandbox game (game.mjs) served over plain HTTP from memory, on a simulated clock — the demo runs several in one
 * process; on its own it's something to poke with curl.
 *
 *   node sandbox/node.mjs <name> <port> [cheat]
 */
import { createServer } from "node:http";
import { freshState, game, simClock } from "./game.mjs";

/** The sandbox's toy game: gold, levels, gems. */
export const TOY = {
  name: "Sandbox",
  contact: "https://github.com/HaiDangVo/gnl",
  grantId: "gold",
  items: [
    { id: "gold", name: "Gold", unit: "coin", cgnlPer: 2 },
    { id: "level", name: "Level", unit: "level", cgnlPer: 3000 },
    { id: "gems", name: "Gem", unit: "gem", cgnlPer: 60 },
  ],
  pace: { gold: { burst: 200, perHour: 100 }, level: { burst: 1, perHour: 1 }, gems: { burst: 5, perHour: 3 } },
};

/** One request against a game's routes: JSON in, JSON (or JSON lines) out, errors as SPEC §9's `{ error }`. */
export async function serve(routes, method, url, body) {
  try {
    const route = routes[`${method} ${url.split("?")[0]}`];
    if (!route) throw Object.assign(new Error(url), { status: 404, code: "NOT_FOUND" });
    const out = await route(body ? JSON.parse(body) : undefined);
    return { status: 200, type: typeof out === "string" ? "application/jsonl" : "application/json", body: typeof out === "string" ? out : JSON.stringify(out) };
  } catch (e) {
    return { status: e.status ?? 500, type: "application/json", body: JSON.stringify({ error: { code: e.code ?? "ERROR", message: e.message } }) };
  }
}

export async function startNode({ name, port, cheat = "", config = TOY }) {
  const origin = `http://localhost:${port}`;
  const s = freshState(name, "2026-11-01T00:00:00.000Z");
  const g = game(s, { origin, clock: simClock(s), config, cheat });
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    const out = await serve(g.routes, req.method, req.url, body);
    res.writeHead(out.status, { "content-type": out.type });
    res.end(out.body);
  });
  await new Promise((ok) => server.listen(port, ok));
  return { ...g, origin, suspended: s.suspended, close: () => new Promise((ok) => server.close(ok)) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [name = "a", port = "4001", cheat = ""] = process.argv.slice(2);
  const n = await startNode({ name, port: +port, cheat });
  n.newDay();
  console.log(`sandbox ${name} at ${n.origin}${cheat ? ` (cheat: ${cheat})` : ""}`);
}
