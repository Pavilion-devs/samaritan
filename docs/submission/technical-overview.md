# Samaritan — Technical Overview

## What Samaritan is

Samaritan is an auditable, risk-gated sports-market decision system built around TXLine World Cup odds and scores. Live and captured-replay adapters feed the same canonical conductor; deterministic TypeScript computes probability-space features and raises typed market signals. For an eligible registered session, Claude can be invoked only at a judgment boundary to return a strict thesis; it cannot size a position, access a wallet, or place an order. Code-owned risk checks make the final decision, a depth-aware simulator executes **paper orders only**, and an append-only hash chain records the lifecycle before each action.

The evidence boundary is explicit: the real Spain–Belgium capture is a retrospective no-trade feasibility corpus and never entered the Claude/execution runtime. The complete lifecycle fixture uses deterministic stubs at both model boundaries. Corrected v2 was registered for forward paper observation on July 18, but no real Anthropic case is claimed until a fresh fixture passes every admission gate.

This directly targets the bounty's five published criteria: **Core Functionality & Data Ingestion**, **Autonomous Operation**, **Clean, deterministic, defensible logic/code**, **Innovation/novelty**, and **Production readiness**. The current bounty build is deliberately **paper-only**: the real-money gate is closed, corrected v2 is registered for forward observation only, and no profitability claim is made.

## Architecture

```text
TXLine odds + scores SSE       Public Polymarket books
            \                         /
             normalized canonical events
                         |
            one serialized event bus
                         |
        rolling features + deterministic detectors
                         |
 eligible admitted case: Haiku triage -> Opus strict thesis
 public lifecycle proof: deterministic stubs at both boundaries
                         |
        deterministic eligibility + risk rules
                         |
              paper execution adapter
                         |
    append-only v2 decision ledger -> public receipt
```

The high-frequency path is deterministic. The model sees only escalated cases and its only analyst exit is `submit_thesis`, validated by a strict schema. Risk and paper execution recheck identity, evidence class, timing, market mapping, book freshness, venue metadata, exposure, and drawdown without trusting model prose. The same canonical event types feed live and replay operation; strategies receive no replay/live mode flag.

### Specific TXLine endpoints used

Mainnet origin: `https://txline.txodds.com`; devnet was also used for integration tests.

| Method and endpoint | Use in Samaritan |
|---|---|
| `POST /auth/guest/start` | Start the documented guest-authentication flow. |
| `POST /api/token/activate` | Activate a wallet-backed TXLine subscription and obtain the API token used server-side. |
| `GET /api/fixtures/snapshot` | Discover fixtures and exact fixture/kickoff identities. |
| `GET /api/odds/stream` | Consume live odds SSE, optionally scoped by `fixtureId`; gzip and `Last-Event-ID` are supported. |
| `GET /api/scores/stream` | Consume live score/action SSE on the same canonical bus. |
| `GET /api/odds/snapshot/{fixtureId}?asOf=<epoch-ms>` | Reconnect/backfill the current odds state before resuming a fixture stream. |
| `GET /api/scores/snapshot/{fixtureId}` | Reconnect/backfill the current score state. |
| `GET /api/odds/updates/{epochDay}/{hourOfDay}/{interval}` | Build the five-minute historical replay archive used for detector research. |
| `GET /api/scores/updates/{epochDay}/{hourOfDay}/{interval}` | Build the aligned historical score archive. |
| `GET /api/scores/historical/{fixtureId}` | Recover the score/action sequence for a fixture where retained. |

Captured TXLine `Pct` is parsed as a de-vigged percentage and divided by 100; `Prices` is retained as integer odds multiplied by 1000. Empty quote transitions are not converted to zero. Public artifacts do not contain raw TXLine responses, exact TXLine probability levels, or reconstructive time series.

The Command surface supports a server-side-only connectivity check against the official fixture snapshot. The deployment enables it only with the JWT, API token, and an explicit `TXLINE_SERVICE_LEVEL_ID=12` runtime assertion; otherwise it reports `degraded`. Its strict public response contains only mainnet/SL12, check time, connected/degraded status, rounded latency, aggregate fixture count, and coarse HTTP-response freshness. A timeout, oversized body, non-JSON response, non-array response, or malformed fixture identity row fails closed. The deployed endpoint returned `connected` and `current` during July 18 release verification. That is point-in-time operational metadata—not a v2 paper-study observation, a trading signal, a raw-feed view, or an uptime guarantee.

## Live and replay are one path

Both live SSE envelopes and captured historical records pass through the same strict normalizers into the same `CanonicalEvent` union and serialized bus. Features, detectors, schedulers, risk, and the decision ledger consume those events without a mode switch. Replay therefore exercises the product path rather than a separate backtest implementation.

The live evidence case in the public dashboard is a synchronized, read-only Spain–Belgium capture pairing TXLine mainnet SL12 delivery with public Polymarket books. Across 18 measured market-event cases, **zero showed a clean post-TXLine stale window**. Samaritan keeps `STALE_QUOTE` disabled and presents the refusal as the correct result; it does not manufacture a trade from an unsupported hypothesis.

## Risk boundary

- Claude can classify or submit a research thesis only. Its schemas contain no stake, bankroll, order, wallet, credential, or venue-authentication field.
- Deterministic code can veto; model output cannot override the implemented paper caps, enlarge a position, create an order, or bypass the closed real-money gate. A global manual kill switch belongs to the unimplemented real-money roadmap, not this release.
- Research-only sampled prices cannot authorize execution. Only correctly mapped, post-readiness executable-book evidence can reach the paper adapter.
- The paper adapter walks displayed depth, handles partial/no fills, applies validated fee/tick/minimum metadata, and never calls an order endpoint.
- Every signal, triage result, thesis, risk verdict, execution intent, paper result, close, and settlement is appended before its downstream action. Restart reconstruction verifies the chain before restoring pending cases, positions, exposure, P&L, and drawdown.
- The bounty build has no real-money execution path enabled. The real-money gate is closed and requires a separate human decision outside this submission.

## Evidence and proof

1. **Captured refusal:** the Spain–Belgium case demonstrates real synchronized input and a defensible no-trade result. Only derived, non-reconstructive TXLine movement buckets are public.
2. **Corrected historical signal evidence:** under a fixed chronological split, the Total Goals `CONSENSUS_MOVE` candidate produced 38 normalized held-out buy cases across 18 fixtures, with mean `+132.7` probability bps after a 100-bps proxy and a fixture-clustered 95% interval of `+14.3` to `+243.9` bps. These sampled-price results justified Deborah's July 18 registration decision for forward paper observation; they are not themselves a v2 observation, alpha, fills, or profitability.
3. **Falsification record:** Samaritan preserved and withdrew its earlier result after discovering a future-informed selector, repaired the selector and economic-case semantics, and reran the unchanged boundary.
4. **Synthetic full lifecycle:** `pnpm demo` runs 20 invented canonical events through the production paper components, creating one signal, paper fill, kickoff close, settlement, and 12 v2 ledger records. The two model boundaries use deterministic stubs; there are zero external API, model, wallet, RPC, or real-order calls. The fixture is permanently marked synthetic and excluded from performance evidence.
5. **Decision Receipt:** the public receipt commits to build/config hashes, source-evidence hashes, bucketed derived signals, model-run metadata, lifecycle ordering, and the final ledger head. `receipt:verify` checks the strict schema, canonical receipt hash, disclosed lifecycle consistency, and committed ledger head offline. It does not replay private source data or prove profitability.
6. **Current Solana status:** offline prepare, human-gated devnet submit, and read-only verify tooling is implemented and tested, but the bounty release intentionally submits **no anchor transaction**. The public receipt is unanchored: `solanaAnchorMetadataPresent: false` and `solanaNetworkVerificationPerformed: false`; no explorer link exists.

## Run the judge path locally

Requirements: Node 22, pnpm 11, and a clean clone of the final public repository.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm judge
```

Open `http://127.0.0.1:4173`. The command runs the clean-clone verification gate before starting the server. The frozen observer bundle requires no TXLine credential, Anthropic key, wallet, RPC write, paid subscription, or private archive.

In another terminal, run the reproducible proof path:

```bash
pnpm demo
pnpm receipt:verify -- public/artifacts/dashboard/synthetic-decision-receipt.json
pnpm public:audit
```

For engineering verification:

```bash
pnpm check
```

The public audit rejects raw/reconstructive TXLine fields, common secret patterns, unsafe links, private paths, and oversized artifacts. Maintainers regenerate the frozen bundle only from the private licensed workspace; judges do not need those inputs.

## Business and production fit

Samaritan is a decision-control and evidence layer for a professional trading team, market operator, or B2B intermediary—not a tip generator. Its reusable value is the harness: normalized live evidence, identical replay behavior, bounded judgment, deterministic authorization, failure-safe paper execution, and portable receipts. New competitions or venues can sit behind adapters while the risk and audit boundaries remain unchanged. Continued operation after the hackathon requires the appropriate TXLine commercial licence and all applicable legal/venue approvals.

Further detail: [canonical architecture](../../ARCHITECTURE.md), [live documentation](https://getsamaritan.xyz/docs), and [TXLine integration notes](txline-api-feedback.md).
