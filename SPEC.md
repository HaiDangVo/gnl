# Giờ Nổ Lực protocol — `gnl/0` (draft)

Status: **draft 0**, open for comment. Nothing here is final; nothing runs for real players yet. The reference code is in `ref/gnl.js` (`npm run check`), the chain anchoring in `chain/`.

The key words MUST, SHOULD and MAY are as in RFC 2119.

## 1. What it is

A player who spent effort in one game (A) carries it to another (B). A values what the player gives up in **Giờ Nổ Lực** (GNL): roughly the hours a typical player needs to earn it. A **holds** those things, B **commits** to what it will give, A **burns** them, B **grants**. Nothing ever moves between games but signed statements; each game makes and destroys only its own things, under its own rules.

Design goals, in order: **fairness and transparency** (nobody can cheat another game or a player without it showing, and what a cheater can take is small and chosen in advance by the one at risk), then **near-zero cost** (static files, a few HTTP endpoints, free timestamps).

What the protocol cannot do, and does not pretend to: make a game unable to lie about its own database. It makes lies **signed, public, mechanically detectable and bounded** (§7).

## 2. Terms

- **Game**: identified by its **origin** (`https://game.example`). One rate card, one log, one set of keys per origin.
- **cgnl**: amounts are integers in hundredths of a Giờ Nổ Lực (`1250` = 12.5 GNL). No floats on the wire.
- **Pseudonym**: how a game names a player to the world: `base64url(HMAC-SHA256(game secret, account id))`. Stable per game, meaningless outside it. Games MUST NOT publish account ids, names or e-mails.
- **Envelope**: `{ "payload": {…}, "sig": { "kid": "…", "value": "<base64url Ed25519 signature>" } }`.
- Times: ISO 8601 UTC strings. Ids: 128-bit random, base64url.

## 3. Keys and signatures

- Every game has one or more **Ed25519** keys, published as JWKs (with `kid`) in its rate card.
- A signature covers the UTF-8 bytes of the payload's **canonical JSON** (RFC 8785 JCS).
- Every payload MUST carry `type`, `iss` (the signer's origin), `iat`, and where it is addressed, `aud`. Receivers MUST reject: an unknown `kid`, an `iss` that isn't the card's origin, an expired `exp`, a reused `id` or `nonce`.
- Envelopes are self-authenticating: transport is plain HTTPS, no shared secrets, no extra HTTP signatures.
- Key rotation: add the new key to the card, log a `key` entry (§6), keep the old one listed until all its envelopes have expired. A compromised key is revoked by a `revoke` entry; envelopes it signed after that entry's checkpoint are void.
- A game's chain account (§6.3) is a separate key and never signs envelopes.

## 4. The rate card

Served at `GET /.well-known/gio-no-luc.json`, as an envelope signed by the game itself.

```json
{
  "type": "card", "protocol": "gnl/0", "iss": "https://game.example", "iat": "2026-11-04T00:00:00Z",
  "game": { "name": "…", "contact": "…", "jurisdiction": "VN" },
  "keys": [{ "kty": "OKP", "crv": "Ed25519", "x": "…", "kid": "2026-11" }],
  "hoursPerDay": { "minor": 1, "adult": 16 },
  "pace": { "gold": { "burst": 5000, "perHour": 3000 }, "level": { "burst": 2, "perHour": 1 } },
  "exports": [{ "id": "gold", "name": "Gold", "unit": "coin", "cgnlPer": 2 }],
  "imports": [{ "id": "gold", "name": "Gold", "unit": "coin", "cgnlPer": 3 }],
  "policy": { "lineStart": 10000, "lineCap": 1000000, "upfront": 0.2, "vestPerHour": 300 },
  "witnesses": ["https://other-game.example"]
}
```

- `exports`: what a player can give up, and what each unit is worth. A game SHOULD derive `cgnlPer` from the **measured** typical pace of its players (median growth per hour), times a published difficulty factor ≥ 1 for skill-gated things. Everything effort bought MAY be listed — currency, items, levels, cultivation.
- `imports`: what the game gives for incoming GNL, per unit. **No arbitrage (R8):** for every `id` in both lists, `imports.cgnlPer` MUST be ≥ `exports.cgnlPer`. Then no loop of crossovers through any number of games can return more than it left with.
- `hoursPerDay`: the most hours a day an account can be credited with (R2). It MUST NOT exceed the play-time limits of the game's jurisdiction. Vietnam (Decree 147/2024/NĐ-CP): players under 18 at most **60 minutes per game a day** (180 across all games), so `minor` is 1. Where the law sets no limit for adults the protocol ceiling is **16**. A game that cannot tell minors from adults MUST use `minor` for everyone.
- `pace`: the game's own growth limits **as data, never code**: for each numeric field of a player's exportable state, how much it may grow at once (`burst`) plus per hour (`perHour`). Between two states `seconds` apart, field `f` passes when `next.f − prev.f ≤ burst + perHour × seconds / 3600`. Audits (R3) apply it; nobody runs another game's code. (Res World's `GROWTH` table in `functions/validate.js` is this shape.)
- **Changes.** A game logs every new version of its card (the card envelope itself, newly dated) before serving it. Rates may change **once a week**: a version takes effect at 00:00 UTC on the first Monday at least 7 days after it was logged, and partners act on the version in force. A change wholly in partners' favor — an export removed or worth less per thing, a lower `hoursPerDay`, a tighter `pace` — and any change to `imports` that keeps R8 (imports are the game's own generosity, at no partner's risk) — MAY take effect as soon as it is logged. Changing the *method* a game prices by (not just the numbers it measures) is a decision (§14). (The v0 reference node serves a new card at once, so it may only make changes in partners' favor.)

## 5. Messages and flow

```
 Player       A (gives)                                   B (receives)
   | 1. in B: "cross over from A" ── B signs TICKET (aud A, its pseudonym of the player, nonce, exp ≤ 15 min)
   |── ticket + chosen things ──> A
   |                 2. A holds them; signs OFFER ──────────> B (POST /gnl/offer)
   |                 3.                            B checks; signs ACCEPT ──> A (response)
   |                 4. A burns; signs BURN ────────────────> B (POST /gnl/burn)
   |                 5.                            B grants; signs GRANT ──> A (response)
   |  every envelope also goes to the player's device, and into its signer's log
```

| type | signer | payload (besides type, iss, aud, iat, id) |
|---|---|---|
| `ticket` | B | `sub` (a **one-time** id for this player and this crossover, never B's stable pseudonym — B keeps the mapping; otherwise the public OFFER would link one person's accounts across games), `nonce`, `exp` (≤ 15 min) |
| `offer` | A | `ticket` (the envelope), `player` (A's pseudonym), `items` `[{id, qty, cgnl}]`, `cgnl`, `first` and `commit`, each `{day, s, index, size, proof}`: the player's leaf in their **first** and **latest** daily commitments (§6.2) with its inclusion proof — what R2 is computed from, `exp` (deadline for ACCEPT, ≤ 24 h) |
| `accept` | B | `offer` (hash of the OFFER payload), `cgnl` (what B takes, ≤ offered), `grant` `[{id, qty}]`, `upfront`, `burnBy` |
| `burn` | A | `accept` (hash of the ACCEPT payload) |
| `grant` | B | `burn` (hash of the BURN payload) |
| `refund` | A | `offer` (hash), `why` — the hold released: no ACCEPT before `exp`, or the player cancelled before ACCEPT |

- A MUST hold the things on its server from OFFER until BURN or REFUND; held things can't be used, sold or offered again.
- B MUST NOT grant before it has a valid BURN for its ACCEPT. A MUST NOT burn without a valid ACCEPT.
- GRANT is **idempotent** on the offer id: the player (or A) may present the same BURN any number of times and gets one grant.
- Hashes are `base64url(sha256(JCS(payload)))`.
- What B grants vests (R6): `upfront` share at once, the rest as the player plays in B.

### 5.1 Contracts

Two games cross over only under a **contract**: one calendar month (UTC) at a time, each game signing its own side.

- A side is a `contract` entry in the signer's own log: `{type: "contract", id, iss, aud: <the other game>, month: "2026-12"}`. The contract for month M is **in force** at a time t in M when both games' sides for M are logged by t.
- A side for M is valid only when logged from the start of the **last 7 days of the month before M** (the renewal window — for December, 24–30 November) to the end of M. Logged in the window, it **renews**; logged inside M itself, it is a **new start**.
- **The last week.** From the moment M+1's window opens to the end of M, the two games MUST NOT cross over until both sides for M+1 are logged. A contract not renewed by the end of M ends with M; signing again later is a new start.
- A game MUST refuse an OFFER, and MUST NOT send one, without a contract in force or in an unrenewed last week (error `CONTRACT`).
- **Months running**: each month renewed in its window adds one; a new start is 1. Trust lines grow with it (R5).
- Signing, renewing and ending are decisions of each game (§14). A game MAY decide once to renew every month until a later decision ends it.
- Rates are not part of a contract: they change weekly by §4, and either side may let the contract end over them.

## 6. Logs, commitments, anchors

### 6.1 Each game's log

- Every envelope a game signs (`offer`, `accept`, `burn`, `grant`, `refund`, `commit`, `card`, `contract`, `proposal`, `tally`, `key`, `revoke`, `cosign`, `proof`) is appended to **its own** log. Tickets are not logged (they carry nothing of value and expire in minutes).
- The log is a Merkle tree with RFC 9162 (Certificate Transparency 2.0) hashing over each entry's canonical JSON. v0 serves `GET /gnl/log/entries.jsonl` (one envelope a line, in order) and `GET /gnl/log/checkpoint.json` (an envelope: `{type: "checkpoint", iss, size, root, t}`), both static files. Large logs MAY switch to the C2SP `tlog-tiles` layout later.
- A game MUST publish a checkpoint at least daily, and never two different roots for the same size.

### 6.2 Daily commitments

Once a day (UTC) a game appends a `commit` entry: the Merkle root over the leaves `{p, day, s}` for every player who may ever export, sorted by `p`, where `p` is the pseudonym and `s = base64url(sha256(salt ‖ JCS(state)))`, `state` being the player's exportable state that day and `salt = HMAC(game secret, p ‖ day)`. The salt keeps states private until the player consents to an audit; revealing `state` and `salt` later proves what the state was that day.

A player's **first committed day** is the first `commit` that contains their pseudonym. Nothing can be backdated, because checkpoints are timestamped (§6.3).

### 6.3 Witnesses and anchors

- **Witnesses**: every game listed in a card's `witnesses` fetches that game's checkpoint at least daily, checks the served entries hash to it and that it is an append-only extension of the last one it co-signed (RFC 9162 consistency, or v0: recompute the root of the first `size` entries), mirrors the entries, and appends a `cosign` entry (`{of: origin, checkpoint: <the checkpoint envelope>}`) to its **own** log. If the old checkpoint is no longer a prefix, it logs a `proof` (R7, the two signed checkpoints as evidence) instead.
- **Anchors**: each day's checkpoint is timestamped with **OpenTimestamps** (Bitcoin; free) and MAY also be anchored on **Ronin**: a zero-value transaction from the game's chain account to itself with data `0x474e4c31` ("GNL1") followed by `sha256(JCS(checkpoint payload))`. The `.ots` file and the transaction hash are logged in the next `checkpoint`'s optional `anchors` field.

## 7. Rules anyone can check

| # | Rule | Checked from | On failure |
|---|---|---|---|
| R1 | Every envelope is signed by a listed key of its `iss` | the envelope + card | reject |
| R2 | **Time bound**: an OFFER's `cgnl` + everything that pseudonym already offered (and wasn't refunded) ≤ days since its first committed day × `hoursPerDay` × 100 | public logs | reject; a logged OFFER over it is a fraud proof |
| R3 | **Pace**: on audit (§8), the revealed states between commitments obey the card's own `pace` | audit reply + card | fraud proof |
| R4 | **Burn shows**: on audit, the first state committed after a BURN no longer holds what was burned | audit reply | fraud proof |
| R5 | **Trust line**: B accepts from A at most `line(A)` cgnl a week, all A's players together; net (what B took from A minus what A took from B, last 90 days) at most 4 × `line(A)`. `line(A) = min(lineCap, lineStart × 2^(n−1))`, n the months their contract has run unbroken (§5.1) — by this formula only | B's policy + both logs | B refuses; going over it is B's own risk |
| R6 | **Vesting**: of a grant, `upfront` at once, the rest unlocking `vestPerHour` cgnl per hour the player actually plays in B (B's own measure) | B | — |
| R7 | **Promises kept**: an ACCEPT followed by its BURN has a GRANT in B's log before `burnBy` + 24 h; a checkpoint is never forked (two signed checkpoints, same size, different roots) | public logs | fraud proof |
| R8 | **No arbitrage** within each card | the card | reject the card |

**A fraud proof** is a `proof` entry: `{against: origin, rule, evidence: [envelopes…]}` that any program can check with no judgement. Anyone MAY publish one (in their log, or just post it). On a valid proof every game MUST, as soon as it sees it: set the line for that origin to zero, stop accepting its envelopes, and claw back what has not yet vested from grants that came from it. Lines restart at `lineStart` only by the partner's own decision, logged.

For R7's "no GRANT before the deadline", the evidence is the ACCEPT, the BURN and a checkpoint of B's log dated after the deadline without the GRANT (B rebuts by showing the GRANT's inclusion proof in an earlier checkpoint).

## 8. Audit

`POST /gnl/audit` (B → A), body: an envelope `{type: "audit", iss: B, aud: A, offer: hash}`. **A answers only the game the offer went to** (`iss` = the offer's `aud`, signature checked): the ticket inside the OFFER is public, so it can't be consent for anyone else. The player's consent is the crossover itself. A answers with a signed `{type: "audit-reply", aud: B, offer: hash, days: [{day, state, salt, index, size, proof}]}` covering every day from the player's first commitment to today. B checks each against the logged `commit` roots, then applies A's `pace` limits to consecutive states (R3) and checks the burn (R4: a day's pace allowance at most). The reply is signed, so when it shows a lie it **is** the fraud proof, together with the OFFER and the BURN. A game MUST answer audits for its own offers for 180 days. Refusing an audit is treated as R3 failing.

## 9. HTTP API

| Method | Path | Who calls | Returns |
|---|---|---|---|
| GET | `/.well-known/gio-no-luc.json` | anyone | the rate card (envelope) |
| GET | `/gnl/quote?from=<origin>&cgnl=<n>&want=<ids>` | a game, for its player | a signed `quote` (what this game would grant now, after R5/R6), valid 15 min |
| POST | `/gnl/offer` | A → B | ACCEPT envelope, or `{error}` |
| POST | `/gnl/burn` | A → B (or the player) | GRANT envelope |
| GET | `/gnl/status/{id}` | anyone with the id | the envelopes of that crossover |
| POST | `/gnl/audit` | B → A | §8 |
| GET | `/gnl/log/entries.jsonl`, `/gnl/log/checkpoint.json` | anyone | §6.1 |

Errors: `{ "error": { "code": "…", "message": "…" } }` with a 4xx/5xx status. Rate limits are each game's own.

## 10. Security

- Players, not agents, move value. An AI agent (MCP, §11) MAY quote and draft; holding and burning MUST follow the player's own confirmation inside the game, signed in.
- A game MUST NOT fetch an origin taken from an unauthenticated message unless that origin is already its partner (in its registry): otherwise anyone can make it fetch any address (SSRF).
- Everything received from another game is **untrusted data**: validate it against the schema, cap string lengths (names ≤ 64 chars, no markup), and never pass it to an AI agent as instructions.
- Replays: ids and nonces single-use, short expiries, holds server-side.
- Privacy: logs are public and permanent — only pseudonyms, item ids and numbers go in them. An audit reveals one player's states to one partner, only with that player's ticket as consent.
- Each game keeps its signing keys in a secret store, rotates them at least yearly, and publishes revocations at once.

## 11. MCP (for players' and developers' agents)

A game MAY expose an MCP server. Recommended tools: `gnl_spec`, `gnl_card(origin)`, `gnl_verify(envelope)` (signature + inclusion + anchor), `gnl_audit_game(origin)` (its standing: proofs, lines) — public; `gnl_quote(selection, partner)`, `gnl_propose(selection, partner)` (a draft into the player's in-game inbox), `gnl_status(id)` — with the player's own key, scoped and revocable. Follow the MCP security best practices (2025-11-25): tokens issued for this server only (no passthrough), per-client consent, exact redirect URIs. Game-to-game traffic uses §9, never MCP.

## 12. Law

Each game is responsible for the law where it operates, its players' ages and its own items. The protocol moves no money and no items: a game **retires** things at its player's request and signs what they were worth in effort; another game **creates its own** things for that player under its own rules. GNL is never held, sold, traded between players or priced in money. Games MUST NOT offer cash-out or player-to-player trading of anything received through it. (Vietnam: Decree 147/2024/NĐ-CP art. 57 limits virtual items to the game that made them and forbids converting them to money or trading them between players — read it before joining.)

## 13. Attacks considered (draft 0 red team, 2026-11-04)

Each one names the attacker and what limits it. Anything still marked **open** is a hole someone should try to close.

| Attack | Who | Stopped or bounded by |
|---|---|---|
| Invent effort for fake accounts | A | R2: an account's export is capped by days since its first commitment × `hoursPerDay`, in GNL (so inflating `cgnlPer` gains nothing); R5 caps all of A's accounts together; R6 keeps most of it locked |
| Be honest for months, then dump at `lineCap` | A | Bounded by `lineCap` and vesting; clawback on the first proof. **Open:** the right default cap |
| Fake progress that respects its own pace, committed daily from the start | A | Not detectable by design; bounded by R2/R5/R6. The honest ceiling of any scheme that doesn't trust a game's database |
| Export the same things to B and C | A | R2 counts every OFFER by that pseudonym in all logs; R4 on audit |
| Burn on paper, keep the things | A | R4 on audit; the BURN signature is the evidence |
| Accept, let A burn, never grant | B | R7: ACCEPT + BURN + a later checkpoint without GRANT; the player can present BURN again |
| Rewrite or fork its own log | A or B | Witness cosignatures and the Bitcoin/Ronin anchors of earlier checkpoints |
| Replay a ticket or an offer elsewhere | anyone | `aud`, single-use `nonce` and `id`, short `exp` |
| Spam B with offers | anyone | An OFFER without a valid ticket B issued is rejected before any other work; rate limits |
| Link one person's accounts across games from public logs | anyone | One-time ticket `sub` (§5); only pseudonyms in logs |
| Run code on a partner's server through an audit | A | `pace` is data, never code (§4) |
| Make a game's server fetch any address (SSRF) by naming it as an offer's `iss` | anyone | A game fetches only partners' origins, checked **before** any fetch; a stranger's offer is refused unread (found by the conformance test) |
| Read a player's whole history by replaying the public ticket as "consent" | anyone | Audits answered only for the offer's own `aud`, signature checked (§8) — found building the sandbox |
| Restore an old copy of a save after its things were burnt, keeping both | player | The giving game MUST refuse a save that brings back what left (Res World: past its pace in what left, within 30 days of a crossover — refused, not just flagged). If it doesn't, R4 catches **the game** on the next audit — found testing Res World |
| Change rates overnight, catching partners mid-month | A | Once a week at most, in force a week after it's logged; only changes in partners' favor at once (§4); and partners may let the contract end |
| Keep crossing with a game that no longer vouches for it | A or B | Monthly contracts, each side signed in its own log; refused without one, and in an unrenewed last week (§5.1) |
| Pass its own decisions by inventing voters | host | Eligible accounts must be in the daily commitments 30 days before the vote, the count is in the signed tally, each voter can check their ballot's inclusion. **Open:** a host that plans months ahead; partners can only sample |
| Buy or coerce votes | anyone | **Open** |
| A stolen signing key | outsider | Bounded by the victim's lines; `revoke` entry; partners stop at that checkpoint |
| Lie about a minor's age | player | Each game's own duty; a game that can't tell uses `minor` for everyone |

## 14. Decisions

Every public decision a game makes under this protocol — signing, renewing or ending a contract (§5.1), changing how it prices things (§4) or its `policy` — and every change to the protocol itself is put to a vote. **Nobody decides alone.**

**Weights.** 100 in all: the game's **host** (the team that runs it) 50, its **community** (its players) 50. A decision passes with **at least 55** in favor.

- Host: 50 for yes, 0 otherwise.
- Community: 50 × (players who voted yes) / (eligible players). Abstaining counts as not yes.
- So neither the host (50) nor the community (50) passes anything alone. The host needs at least **10% of its eligible players** to say yes, and can always block: that is what these numbers mean, and changing them is a protocol decision. (`tally()` in `ref/gnl.js`.)

**Eligible players.** An account in the game's daily commitments for at least **30 days** before the vote opens, with at least **10 hours** of play in those 30 days (the game's own measure), signed in to vote. One account, one vote; a player may change their vote until the vote closes.

**Steps.**

1. The game logs a `proposal`: `{type, id, scope: "game" | "protocol", what (plain words, ≤ 500 chars), action, opens, closes, effective}`. A vote lasts **3 to 7 days**; `effective` is no earlier than `closes`. `action`, when there is one, says it for machines: `{contract: origin, renew: true}`, `{card: hash}`, `{spec: commit}`.
2. Players vote in the game. Each ballot is a leaf `{v, choice}` with `v = HMAC(game secret, pseudonym ‖ proposal id)`: one-time, so ballots link neither to crossovers nor to each other. The game shows each voter their `v`, and after the close its inclusion proof.
3. After `closes`, the game logs a `tally`: `{proposal (hash), host, eligible, yes, no, ballots (Merkle root of the leaves sorted by v), size (= yes + no), weight, pass}`. Whatever passed — a `contract` side, a new card — is logged after its tally.

**Protocol decisions** (this SPEC, its default numbers, these rules): a pull request on the protocol repository, logged as a `proposal` with `scope: "protocol"` by every member game (one with a contract in force when the vote opens). Each member game's host and community weigh 50/N each, N the member games: the protocol's weight is the mean of the games' own weights (`tallyProtocol()`), passing at 55. Merged only once it passes.

**Small games.** With fewer than **30** eligible players a community share means little; until a game has 30, its host decides alone and the `tally` shows it (`eligible` under 30). Its partners see that and decide for themselves.

**Draft 0.** No game runs votes yet. Each host's decisions so far are its own standing decisions (the reference nodes and Res World: renew their contracts every month). Votes start with draft 1.

## Open questions for draft 1

- The adult ceiling (16 h) and the default line and vesting numbers.
- The voting numbers (§14): 55 to pass, 30 days and 10 hours to vote, 30 players before a community counts — and how partners could check a host's eligible count.
- Whether `commit` should cover every player or only those who ever opened a crossover (privacy vs. the time bound).
- Stage 2: the registry, lines and fraud proofs as a contract on Ronin with no admin key (ROADMAP.md).
