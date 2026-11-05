# Joining the network

English · [Tiếng Việt](JOINING.md)

For game developers (and their AI agents) who want their game on Giờ Nổ Lực, under contract with the games already running, like Res World. AI agents also read [AGENTS.md](AGENTS.md).

## What your game needs

1. **A server that holds the real data.** What players carry out must live on your server, which burns and grants it. A game that trusts saves from the player's device can't burn for sure: send an old save again and the things come back (SPEC §13; Res World tripped on this twice).
2. **An HTTPS address** (origin) as the game's identity, and an Ed25519 signing key in a secret store.
3. **A protocol node.** No need to write one: `sandbox/game.mjs` is a complete library (rate card, log, daily commitments, both sides of a crossover, audits, contracts, voids and penalties). You write only:
   - `players`: read an account's exportable things, burn, grant, claw back.
   - `days`: store the daily commitments (any table).
   - a config: name, exports/imports and prices, `pace`.
   Examples: `examples/your-game.mjs` (the least code, runs as is, swap the Maps for your database), `cloud/index.mjs` (the two sandboxes on Firebase), Res World's `functions/gnlNode.js` (a real game, Firestore).
   An effort sheet at `/gnl/effort.json` (SPEC §4.1): how each thing is earned and what its price stands on (measured, design, declared or a guess).
4. **Prices measured from real players**: the median growth per hour played, with the method published. No guesses.
5. **A page in the game** where the player chooses what to carry and confirms it themselves, signed in. An AI never moves anything for them (SPEC §10).
6. **Someone accountable**: a master (the game's owner) and a public council of the people running it; each makes their key and signs their consent on their own machine with `npm run council` (SPEC §14). From two members on, every council change and every act of the game's own is an order more than half the council signs (`npm run order`).

## Steps and timing

| Step | What | How long |
|---|---|---|
| 1 | Locally: `npm install && npm run sandbox` to watch every rule run, then plug the node into your game | 1–2 days for an AI agent, if the game already has a server and database |
| 2 | Online; `npm run conform -- https://your-game` until nothing FAILs | same day |
| 3 | Open a **"Join"** issue on GitHub (a template is there). A bot runs the conformance test and the auditor against your origin and posts the results under the issue. To try real crossovers with the two sandboxes, say so: they add you as a partner and sign a contract the same day | 1 day |
| 4 | Run the days of unbroken daily commitments the other game asks (`policy.partnerMinDays` in its card). Res World asks **7 days** for now, rising toward 30 as the network grows (SPEC §5.1) | 7 days |
| 5 | The real game looks: log age, rate card, flows (`npm run audit`), who answers for you; then votes (SPEC §14) | a few days |
| 6 | Each side logs the month's `contract`. **In force as soon as both have signed**; renewed in each month's last 7 days | at once |

In the first month a game takes at most 100 effort hours a week from you; each month renewed without a break doubles it.

## What Res World asks of you

In the "Join" issue:

- your origin, the game's name, your master and council (names, accounts in the game, public profile links);
- your effort sheet at `/gnl/effort.json`;
- the output of `npm run conform` and `npm run audit` (flows included);
- how you measure prices, and what you measured;
- your jurisdiction, players' ages, and the daily ceiling the law there sets;
- a commitment: no cash-out, no player-to-player trading of anything received (SPEC §12).

Res World has no in-game voting yet, and fewer than 30 eligible players, so its owner decides and says so in its log (SPEC §14, "small games").

## Where the official information is

| For | Where |
|---|---|
| People | The repo https://github.com/HaiDangVo/gnl: `README.en.md`, `SPEC.md` (the protocol), `ROADMAP.en.md`, this file. Vietnamese versions too |
| AI agents | `AGENTS.md` (step by step, rules for changing the repo) and the MCP server `mcp/server.mjs`: `gnl_spec`, `gnl_sandboxes`, `gnl_card`, `gnl_conform`, `gnl_audit`, `gnl_flows`, `gnl_verify`. Add it: `claude mcp add gnl -- node /path/to/gnl/mcp/server.mjs` |
| Anyone | Status pages that verify in your browser: https://gnl-sandbox.web.app, https://gnl-endless.web.app, https://resworld.web.app/gnl/ (rate card, effort sheet, council, contracts, log, anchors) |
| Questions, joining, holes | The repo's GitHub Issues, with a template for each. GitHub notifies the repo's owner (e-mail, app) of each new issue |
