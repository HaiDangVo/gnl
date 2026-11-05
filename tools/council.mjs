/**
 * A council member's seat (SPEC §14), made on the member's own machine: their Ed25519 key (kept in .secrets/, never
 * printed) and the consent it signs. Prints what the game puts in its config's `council` — public data only.
 *
 *   npm run council -- <game origin> <account in the game> "<name>" <public profile URL> [--master]
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { newKey, privateFromJwk, seal } from "../ref/gnl.js";

const [origin, account, name, profile] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!origin?.startsWith("https://") || !account || !name || !profile?.startsWith("https://")) {
  console.error('usage: npm run council -- <https://game> <account> "<name>" <https://profile> [--master]');
  process.exit(1);
}
const file = new URL(`../.secrets/council-${createHash("sha256").update(`${origin}|${account}`).digest("hex").slice(0, 12)}.jwk`, import.meta.url);
mkdirSync(new URL("../.secrets/", import.meta.url), { recursive: true });
if (!existsSync(file)) {
  const k = newKey(`council-${Date.now().toString(36)}`);
  writeFileSync(file, JSON.stringify({ ...k.privateKey.export({ format: "jwk" }), kid: k.kid }), { mode: 0o600 });
}
const jwk = JSON.parse(readFileSync(file, "utf8"));
const member = { name, account, profile, kid: jwk.kid, x: jwk.x };
const consent = seal({ type: "consent", iss: origin, member: account, iat: new Date().toISOString() }, { kid: jwk.kid, privateKey: privateFromJwk(jwk) });
console.log(JSON.stringify({ member, consent, ...(process.argv.includes("--master") ? { master: true } : {}) }, null, 2));
console.error(`(the key stays in ${file.pathname}: never share it)`);
