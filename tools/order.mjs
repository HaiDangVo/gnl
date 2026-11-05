/**
 * An order of a game's council (SPEC §14): one member writes it, each member signs it on their own machine with the key
 * `npm run council` made (.secrets/, never printed), anyone sends it. The game logs it with the ballots and does it.
 *
 *   npm run order -- new <https://game> '<fields as JSON, op included>' "<why>"   → order-<hash>.json here
 *   npm run order -- sign <order file> <your account in the game>
 *   npm run order -- send <order file>
 *
 * Ops: seat {member, consent} · unseat {account} · master {account} · resign {account} · pause {aud, until}
 *      end {aud} · void {id} · cut {id}
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { hashOf, privateFromJwk, seal } from "../ref/gnl.js";

const [cmd, a, b, c] = process.argv.slice(2);
const usage = () => {
  console.error("usage: npm run order -- new <https://game> '<JSON>' \"<why>\" | sign <file> <account> | send <file>");
  process.exit(1);
};
if (cmd === "new") {
  if (!a?.startsWith("https://") || !b || !c) usage();
  const order = { type: "order", iss: a, ...JSON.parse(b), why: c, made: new Date().toISOString() };
  const file = `order-${hashOf(order).slice(0, 8)}.json`;
  writeFileSync(file, JSON.stringify({ order, ballots: [] }, null, 2));
  console.log(file);
} else if (cmd === "sign") {
  if (!a || !b) usage();
  const f = JSON.parse(readFileSync(a, "utf8"));
  const jwk = JSON.parse(readFileSync(new URL(`../.secrets/council-${createHash("sha256").update(`${f.order.iss}|${b}`).digest("hex").slice(0, 12)}.jwk`, import.meta.url), "utf8"));
  f.ballots = [...f.ballots.filter((x) => x.payload.member !== b), seal({ type: "ballot", iss: f.order.iss, member: b, proposal: hashOf(f.order), choice: "yes" }, { kid: jwk.kid, privateKey: privateFromJwk(jwk) })];
  writeFileSync(a, JSON.stringify(f, null, 2));
  console.log(`${b} signed: ${f.ballots.length} ballot(s)`);
} else if (cmd === "send") {
  if (!a) usage();
  const f = JSON.parse(readFileSync(a, "utf8"));
  const r = await fetch(`${f.order.iss}/gnl/order`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...f.order, ballots: f.ballots }) });
  console.log(r.status, await r.text());
  process.exit(r.ok ? 0 : 1);
} else usage();
