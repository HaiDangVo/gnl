# Roadmap

English · [Tiếng Việt](ROADMAP.md)

Each stage has a "done when". A stage isn't left until it's done. Priorities, in order: **fairness and transparency**, then **near-zero cost**.

## Stage 0: Draft (in progress)

- [x] Repo, SPEC `gnl/0`, README, license
- [x] Reference code: canonical JSON, Ed25519, Merkle tree + inclusion proofs, rules R2/R8, with a self-check
- [x] A script anchoring checkpoints on Ronin (Saigon/mainnet). Measured mainnet fee ~0.00048 RON each, about $0.01 for a year of daily anchors
- [x] A trial anchor on Saigon: [tx 0xfba4…7d86](https://saigon-explorer.roninchain.com/tx/0xfba4184255ae1028f502e355ea77d12199df1bbb8206894de9fb669ca2737d86), 22 440 gas, 0.00047124 RON (negligible L1 fee), `npm run anchor -- verify` matches
- [x] JSON Schema for the rate card, messages and log (`schemas/gnl.schema.json`)
- [x] First red-team pass (SPEC §13). Two holes closed: tickets linking one person's accounts across games (now a one-time `sub`) and audits making a partner run code (now `pace` is data). Still open: the default `lineCap`
- [ ] Reference code validating messages against the schema

**Done when:** the SPEC has no hole we found ourselves; schema and reference code match the SPEC.

## Stage 1: Sandbox

Two copies of a fake game (`sandbox/node.mjs`: gold, levels, gems; a simulated day clock), fake things only, running the whole protocol. `npm run sandbox` runs one clean crossover, five cheats and two contract cases.

- [x] Rate card, ticket, the five messages, hold/burn/grant, refund, log `entries.jsonl` + `checkpoint.json` (local, in memory)
- [x] Daily commitments, audits (§8), witnessing each other (witnesses catch forks when they co-sign)
- [x] Weekly line (R5), 20% vesting + clawback on a fraud proof
- [x] **Auditor** (`npm run audit -- <origin>…`): reads every log, checks R1, R2, R7 (promised but never granted, forks), re-checks every R3/R4 fraud proof other games logged
- [x] Five built-in cheats, all five caught: over the time bound (R2), burn but keep (R4), growth past pace (R3), forked log (R7), accepted but never granted (R7). Breaking a rule turns the demo red in the right place
- [x] Another hole found on the way: a public ticket is no consent for an audit (SPEC §8, §13)
- [x] Online: https://gnl-endless.web.app and https://gnl-sandbox.web.app (Firebase Functions behind Hosting, Firestore, daily commit, co-signing, audits)
- [x] Daily anchors in OpenTimestamps (Bitcoin)
- [x] Daily anchors on Ronin Saigon from the cloud (the key is the `GNL_SAIGON_KEY` secret the owner set): first cloud tx 2026-11-04, block 57264240
- [x] A page for people at each node's `/`: rate card, the log in plain words, contracts, anchor links (Ronin, .ots files), and the signatures and Merkle root checked right in the browser
- [x] Conformance test (`npm run conform -- <origin>`): both sandboxes pass. It caught an SSRF hole (an offer from a stranger's origin made the server fetch anything), closed: offers only from partners
- [x] `AGENTS.md` + MCP server (`mcp/server.mjs`, read-only): another game's agent reads the SPEC, tries the sandboxes, runs conformance and audits by itself
- [x] Endless Run (https://endless-run.web.app) on a node as the **second sandbox** (not a real partner game, 2026-11-05): each run's coins go to a wallet at `gnl-endless`, with a "Carry them to Sandbox" button on the game over screen. Two sandboxes to try things and shake out bugs

**Done when:** a full crossover runs both ways; the auditor catches all five cheats; the conformance test passes on the sandboxes.

## Stage 2: Res World joins (beta, 2026-11-04)

Res World is a node: https://resworld.web.app/.well-known/gio-no-luc.json (code in the game's repo: `functions/gnlNode.js`, `functions/crossover.js`, this library vendored into `functions/gnl/`).

- [x] Real pace measured from verified save histories (the median growth per hour played), frozen with the rate card
- [x] Exports: Coin Cash (in thousands), Spirit Stones, the cultivation **of the current layer** (2026-11-05: the realm no longer falls, since falling undid quests and set them off again); every new save must pass `checkSnapshot`
- [x] Imports: CC or Spirit Stones, the player's choice, 20% at once, the rest unlocking with play
- [x] In game: Account → "Carry your effort to other games"; a wiki page
- [x] A 16 h daily ceiling (the game is 18+ since v0.11.38)
- [x] Run for real on test accounts: Sandbox → RW, RW → Endless Run (CC), RW → Sandbox (cultivation), auditor clean on all three games
- [x] A hole found testing: restoring an old save after a burn duplicated things. The first fix (by pace) still let it through once enough hours had passed (2026-11-05). The second: the server counts crossovers into the save itself, and a save counting fewer than the account is refused for good; the attack replayed and blocked. SPEC §13
- [x] Importing cultivation: onto the current layer's bar, waiting once full, never breaking through (2026-11-05)
- [x] MCP: `gnl_rates`, `gnl_effort` (read-only) on `resworldMcp`
- [x] No more overpricing from rounding: CC in thousands (100 CC was worth 0.33 cgnl, rounded up to 1), and a cultivation layer whose 1% is worth under 1 cgnl isn't exported. Both in partners' favor, so in force at once (SPEC §4)
- [x] Ronin anchoring for Res World, indirectly: both sandboxes co-sign Res World's checkpoint daily, and theirs go on Ronin Saigon daily. No chain library in the game. Direct anchors at mainnet
- [ ] Beta open to every player

## Contracts and votes (2026-11-05)

- [x] Monthly contracts between each pair of games (SPEC §5.1): each side signs in its own log; renewed in the month's last 7 days; in that week nothing crosses until both have signed next month's; no renewal, no contract. In `game.mjs`, with lapse and renewal scenarios in the demo, and the signing window in the conformance test
- [x] The weekly line (R5) doubles with each month renewed without a break
- [x] Rates may change weekly, in force from the first Monday at least 7 days after being logged; changes in partners' favor at once (SPEC §4). Every new rate card is logged
- [x] Voting rules (SPEC §14): host 50, community 50, 55 to pass; a player is eligible after ≥ 30 days in the daily commitments and ≥ 10 hours played in 30 days; one-time anonymous ballots with Merkle proofs; with under 30 eligible players the host decides and says so. `tally()` in `ref/gnl.js`
- [x] Host councils (SPEC §14): members public in the rate card, each with an account in the game and their own key, ballots signed in public; the 50 shared per head, a council blocks alone only when all of it says no
- [x] Games made to farm effort (SPEC §13.1): R9 forbids passing on what came in (demo `relay`), R5's 90-day net enforced, the auditor's flow report (`npm run audit`, MCP `gnl_flows`), a checklist before signing a new partner (§5.1)
- [x] The council is the people who run the game, not elected: joins and leaves logged (a newcomer signs their own consent), a vote's council frozen when it opens, joins counting after 7 days, leavers keeping a no seat for 7
- [x] Only decisions that widen exposure (a new contract, a higher policy, a new pricing method) need a vote; narrowing ones (not renewing, ending, lowering) the host takes alone; renewing on the same terms needs no new vote
- [x] R10: one source per receiving account (per partner game), a receiving bound by days present (demo `sources`)
- [x] Voids and penalties (SPEC §8.1): the giving game voids a crossover on its own evidence; both the sending and the receiving account owe 100% of its hours, paid before anything else (demo `void`)
- [x] `JOINING.md` / `JOINING.en.md`, issue templates "Join" and "I found a way to cheat"
- [x] The master (SPEC §14): one per game, normally one seat, deciding close results (50–60) but never past the community's 10%; every council or master change counts in votes only after 7 days. Res World: its owner is master, key and consent made on their machine with `npm run council`
- [x] R10 loosened: one source at a time, unlink and wait 7 days (demo `sources`)
- [x] The standard effort sheet `/gnl/effort.json` (SPEC §4.1), shown on the status page; Res World's page at https://resworld.web.app/gnl/
- [x] The minimum partner age is each game's own (`policy.partnerMinDays`): Res World 7, rising toward 30
- [x] `examples/your-game.mjs`; a bot runs conformance + audit under every join issue
- [x] Res World: incoming cultivation priced at sitting's pace when that's slower than measured (it was ~15× too cheap); the Sandbox for test accounts only; the sheet in three tabs
- [x] The council decides, not the master (SPEC §14): a council of one is its master; from two members on, every act of the game's own is an `order` signed by more than half the seats (on acts that only reduce risk a tie goes the master's way; seats and the master are never decided by a tie); the master alone can only `pause`, at most 7 days. `POST /gnl/order`, `npm run order`, `orderOk()`; conformance re-checks every order (demo `council`)
- [x] Cutting what hasn't been handed over (SPEC §8.2, `cut`): a receiving game fixing its own pricing mistake, nobody owes. Res World cut what Bọ Chét hadn't unlocked from the Sandbox (the master's order)
- [x] R10 logged: `link` on/off, each accept naming its `holder`; `links()` checks it from the log, the auditor against the giving game's offers, conformance too
- [x] Endless Run is the second sandbox: Res World's real accounts cross with neither
- [ ] Res World: voting in game, `proposal` / `tally` in its log (backlog #368)
- [ ] Protocol votes: each member game logs a `proposal` for a SPEC pull request, combined with `tallyProtocol()`

## Stage 3: Going public

- [x] The repo public on GitHub (https://github.com/HaiDangVo/gnl)
- [x] English: `README.en.md`, `ROADMAP.en.md`, a bilingual status page (Vietnamese by default)
- [ ] A forum post: the problem, the idea, why nobody can cheat anybody, sandboxes to try right away, an invitation
- [ ] Gather comments, publish SPEC `gnl/0.1`

**Done when:** at least one outside developer has run the conformance test against their game.

## Stage 4: The first partner, real players

- [ ] A small line (`lineStart`), vesting on, both witnessing each other
- [ ] MCP tool `gnl_propose`: an agent only drafts into the inbox, the player confirms in game
- [ ] A public page: crossovers (anonymous), lines, fraud proofs if any

**Done when:** a month of real use without incident, or with one the protocol handled as the SPEC says.

## Stage 5: On chain (from 3 games up)

The list of games, lines and fraud proofs moved to a contract on Ronin **with no admin key**. Then no game, Res World included, can bend the rules.

- [ ] Contract: `register`, `setLine`, `offer/accept/burn/grant` (hashes only), `proveFraud` (checks the evidence itself, suspends by itself)
- [ ] A few months on Saigon with the partners; an outside review
- [ ] Mainnet. One wallet per game, holding a little RON for fees

**Done when:** games read suspensions and lines from the chain instead of from the repo.

## Expected costs

| Thing | Cost |
|---|---|
| Log, rate card, API | Static files + a function: within each game's free tier |
| OpenTimestamps (Bitcoin) | 0 |
| Daily Ronin mainnet anchor | ~0.18 RON a year (~$0.01 at November 2026 prices) |
| Stage 5, per crossover | a few contract calls, each around a thousandth of a RON. Measured on Saigon before promising a number |
| Ronin testnet | 0 (faucet, 5 times a day) |

## The maintainers' job

- Answer issues, above all "found a way to cheat"
- Keep the sandboxes' signing keys and the Saigon wallet's key (`.secrets/`, never committed)
- Every new SPEC version goes through a protocol vote (§14) before it's merged
