# Giờ Nổ Lực

English · [Tiếng Việt](README.md)

**Carry your effort from one game to another: transparent, fair, nearly free.**

You put 300 hours into one game. Now you want to try another without starting from zero. With Giờ Nổ Lực ("effort hours"), the old game converts what you achieved (money, items, levels, cultivation…) into **effort hours**. You choose to carry some or all of it. The new game gives you a matching start, under its own rules. Your things in the old game are gone only once the new game has signed that it will grant.

It is an **open protocol**: any game, studio or server can join. No token, no coin, no exchange, no middleman taking a cut.

> Status: **draft 0** (November 2026). Res World (https://resworld.web.app) is the first real game running it, in beta. Comments welcome.

## Why nobody can cheat anybody

No protocol can make a game *unable* to lie about its own database. Giờ Nổ Lực does these instead:

1. **Every promise is signed and public.** Each game writes every step into its own public log. The other games witness it and keep copies. Every day the log is timestamped in Bitcoin (OpenTimestamps, free) and can also be anchored on Ronin. Nobody can rewrite it quietly or backdate it.
2. **Every lie that matters is caught by a machine:**
   - An account made yesterday can't carry out 500 hours (a daily ceiling, set by the law where the game runs).
   - Growing faster than the game's own rules allow leaves proof.
   - Signing a burn and keeping the things leaves proof.
   - Taking a commitment and never granting leaves proof.
3. **What a cheater can take is small, and chosen in advance by whoever bears the risk:**
   - A game accepts only a small weekly amount from a new partner. It grows only by formula, as long as both stay clean.
   - What a player receives unlocks gradually as they really play the new game.
   - On any proof of fraud, every game cuts the cheater off and takes back what hasn't unlocked yet.
4. **Monthly contracts.** Two games cross over only while both have signed a contract for that month, each in its own log. To continue, they renew in the month's last 7 days; during that week, nothing crosses until both have signed for the next month. No renewal, no contract. Rates may change once a week, with a week's notice. Each month renewed without a break doubles the weekly amount.
5. **Nobody decides alone.** Every public decision (signing, renewing or ending a contract, changing how things are priced, changing the protocol) goes to a vote: the game's host has 50, its community of players 50, and 55 passes. A host of several people is a public council: each member has an account in the game itself, signs their vote with their own key, votes are public, and the 50 is shared per head. A council blocks on its own only when **all of it** says no. Details in SPEC §14.
6. **A game made only to farm effort?** No log can prove that effort fake, so the protocol makes it not worth it: a small weekly line, at most 4 lines per 90 days one way, what arrives unlocks only with real play in the receiving game, and **what came in never leaves again** (R9), so it can't be laundered through a trusted game. Flows between games are public; the auditor points out what to look at before signing. Details in SPEC §13.1.
7. **One person, many accounts?** A receiving account takes from **one** account of each partner game, and the other way round; a fresh account takes at most 16 hours for each day it has been there (R10). When cheating is proven, the crossover is voided and **both the sending and the receiving account owe its hours**, paid before anything else (SPEC §8.1). So take only from yourself, or someone you know well.

Also: the receiving game **never sees the other game's items**, only hours, and it prices its own things itself. A junk sword from a junk game can't become a fine sword in a hit game.

Details: [SPEC.md](SPEC.md). Roadmap: [ROADMAP.en.md](ROADMAP.en.md). Bringing your game in: [JOINING.en.md](JOINING.en.md).

## What's in this repo

| | |
|---|---|
| `SPEC.md` | The `gnl/0` protocol: rate card, five messages, contracts, logs, rules R1–R8, API, security, law, decisions |
| `ROADMAP.en.md` | The concrete roadmap, stage by stage ([Vietnamese](ROADMAP.md)) |
| `JOINING.en.md` | Joining the network: what your game needs, the steps, how long, what Res World asks of you |
| `schemas/gnl.schema.json` | JSON Schema for the rate card, the messages and the log |
| `ref/gnl.js` | Reference code (`node:crypto` only): canonical JSON (RFC 8785), Ed25519, the log's Merkle tree (RFC 9162), rules R2, R3 and R8, contract windows, vote tallies |
| `chain/` | Anchoring checkpoints on Ronin (Saigon testnet / mainnet) |
| `sandbox/` | A sandbox game speaking `gnl/0` (`game.mjs`), an auditor anyone can run (`auditor.mjs`), the conformance test (`conform.mjs`), a demo of one clean crossover, five kinds of cheating and two contract cases (`demo.mjs`) |
| `cloud/` | The two live sandboxes (Firebase) |
| `mcp/server.mjs` | An MCP server for agents: read the SPEC, see a rate card, run conformance, audit, verify an envelope. Read-only, holds no secrets |
| `AGENTS.md` | Guide for AI agents: helping a game join, rules for changing this repo |

```sh
npm install
npm run check                # the reference code's self-check
npm run wallet               # make a Saigon wallet, show its balance (test RON: https://faucet.roninchain.com)
npm run anchor               # anchor a sample checkpoint on Saigon
npm run anchor -- verify <tx hash>
npm run sandbox              # 2 sandbox games: a clean crossover + 5 cheats (all must be caught) + contract lapse / renewal
npm run conform -- <origin>  # the conformance test against your game
npm run audit -- <origin>…   # the auditor over those games' public logs
```

## Live sandboxes

Fake things, no sign-in, anyone can try:

- https://gnl-endless.web.app: the Endless Run game's coin wallet
- https://gnl-sandbox.web.app: a toy game (gold, levels, gems)

Open either link for a page made for people: the rate card, the public log in plain words, contracts, anchors (Ronin, Bitcoin), and your browser checks the signatures and the Merkle root itself, no need to trust the server. Every day both games commit, co-sign each other's logs and anchor their checkpoints in Bitcoin (OpenTimestamps) and on Ronin Saigon. The curl steps: see `AGENTS.md`, or the MCP tool `gnl_sandboxes`.

## For AI agents

Read [AGENTS.md](AGENTS.md). Add the MCP server: `claude mcp add gnl -- node /path/to/gnl/mcp/server.mjs`.

## Joining

- Read `SPEC.md` and open an issue wherever you see a way to cheat. That's the most valuable contribution.
- To bring your game in: read [JOINING.en.md](JOINING.en.md), then open a "Join" issue (there's a template).
- Each game is responsible for the law where it operates (SPEC §12).

## License

Code: MIT ([LICENSE](LICENSE)). Protocol text (SPEC.md): CC BY 4.0.
