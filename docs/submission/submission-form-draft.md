# Samaritan — Superteam Submission Form Draft

> **Not ready for copy/paste without human review.** Deborah is the participant, owner, narrator, and submitter. She must personally verify the final build and links, rewrite this draft in her own voice, remove any claim that is not true on the final public commit, and submit it herself. Claude is a constrained component of Samaritan; it is not the participant or submitter.

Listing checked: [TxODDS — Trading Tools and Agents](https://superteam.fun/earn/listing/trading-tools-and-agents/) on July 18, 2026. The listing requires a public repository, public working MVP, public demo video of at most five minutes, technical documentation with the exact TXLine endpoints, and API feedback. Its five criteria are **Core Functionality & Data Ingestion**, **Autonomous Operation**, **Clean, deterministic, defensible logic/code**, **Innovation/novelty**, and **Production readiness**.

## Project Title

**Samaritan — The Auditable, Risk-Gated Sports Trading Agent**

## One-liner

Samaritan turns official TXLine evidence into deterministic signals and fail-closed paper decisions, with a bounded Claude-thesis boundary and independently verifiable decision receipts.

## Briefly explain your Project

Sports-trading agents are easy to demo badly: send odds to a model, accept confident prose, and hide the timing, risk, or failed hypotheses. Samaritan is built around the opposite idea—**detect deterministically, reason within a strict boundary, authorize in code, and prove the entire decision lifecycle**.

Samaritan consumes official TXLine fixture, odds, and score APIs, including live mainnet SL12 SSE. Live and captured-replay adapters emit the same canonical event types into one conductor, so strategy code receives no mode flag. Deterministic detectors escalate only selected cases. In an eligible registered session, Claude can return a strict thesis but cannot size a position, access a wallet, or place an order. Code-owned checks revalidate eligibility, timing, evidence, mapping, fees, exposure, and drawdown before a depth-aware paper simulator acts. Every stage is appended to a v2 hash-chained ledger before the next action and can be exported as a licence-safe Decision Receipt. Corrected v2 is registered for forward paper observation, but the current real capture did not enter Claude and the complete public lifecycle still uses deterministic model stubs.

The demo proves two different things honestly. A synchronized Spain–Belgium capture shows a real no-trade: across 18 measured market-event cases, zero produced a clean post-TXLine stale window, so the detector stays disabled. A separate, prominently labelled synthetic fixture runs the full paper lifecycle—signal, triage, thesis, deterministic risk, intent, fill, close, settlement, and receipt—without any external model, venue, wallet, or network call and is excluded from performance evidence.

The corrected historical Total Goals candidate produced 38 normalized held-out buy cases across 18 fixtures, `+132.7` probability bps after a 100-bps proxy, with a fixture-clustered 95% interval of `+14.3` to `+243.9` bps. This is sampled-price **signal evidence only**: it is not alpha, executable-fill evidence, or profitability. The v2 paper protocol is registered for forward observation only, the bounty build is paper-only, and the real-money gate is closed.

## Problem

An autonomous market tool must answer more than “what would the model bet?” It must prove which evidence was available at decision time, whether the venue had already moved, whether the position was allowed, and whether the displayed result came from the same logic used live. Without those controls, agent autonomy becomes an unreviewable risk surface.

## Solution

Samaritan provides one end-to-end control plane:

- official TXLine live and historical ingestion with reconnect/backfill;
- probability normalization and deterministic signal detection;
- bounded Claude triage/thesis schemas;
- code-owned paper-risk and execution rules;
- identical live/replay event contracts;
- restart-safe append-only lifecycle state;
- a derived-only public observer dashboard; and
- offline-verifiable Decision Receipts.

## Innovation and novelty

The novelty is not “AI predicts football.” It is the separation of market-speed detection, model judgment, deterministic authorization, and verifiable evidence. Samaritan treats a refusal as a first-class output, makes invalidated research visible instead of deleting it, and exposes proof boundaries precisely: a local receipt is not called an on-chain anchor, and sampled prices are not called executable fills.

## Business and technical fit

Samaritan is designed as an auditable decision layer for professional trading teams, market operators, and B2B intermediaries. The reusable product is the harness—feed normalization, replay parity, agent boundaries, risk authorization, execution adapters, and receipts—rather than one tournament-specific prediction. It can expand to other competitions and venues under the appropriate TXLine commercial licence and applicable legal/venue approvals.

## Current status and limits

- **Execution:** paper only; no real Polymarket orders.
- **Gate:** real-money gate closed.
- **Study:** v1 invalidated and preserved; corrected v2 registered July 18 for forward paper observation only, with zero qualifying observations at registration.
- **Performance:** no profitability or alpha claim.
- **Solana:** devnet prepare/submit/verify tooling exists, but the bounty release intentionally submits no transaction; the current receipt is unanchored and has no explorer link.
- **Public data:** derived, non-reconstructive output only; no raw TXLine feed or exact TXLine probability series is redistributed.
- **Ownership:** Deborah is the human participant and submitter; Claude is a constrained runtime component.

## Required links

Replace every placeholder only after testing it in a signed-out/incognito browser.

- **Live and working MVP:** `[PUBLIC_MVP_URL]`
- **Public judge-evidence endpoint:** `[PUBLIC_MVP_URL]/api/judge/evidence`
- **Live demo video (≤5:00, publicly viewable):** `[YOUTUBE_OR_LOOM_URL]`
- **Public repository:** [github.com/Pavilion-devs/samaritan](https://github.com/Pavilion-devs/samaritan)
- **Technical documentation:** [Samaritan technical overview](https://github.com/Pavilion-devs/samaritan/blob/main/docs/submission/technical-overview.md)
- **Optional X profile/post:** `[PUBLIC_X_URL_OR_REMOVE]`

The bounty release intentionally includes no Solana explorer link because no decision-receipt anchor is submitted. If Deborah separately changes that scope later, add a link only after the public `anchor:verify` command passes against the exact receipt.

## TxLINE API experience

What worked best was the combination of normalized de-vigged `Pct`, live odds and score SSE, historical interval access, rich score/action envelopes, stable fixture/market identities, and TXLine's documented validation direction. The integrated fixture/odds/score surfaces made a single live/replay event contract possible instead of forcing a demo-only architecture. Validation remains researched feedback, not a Merkle/on-chain verification claim for Samaritan's current receipt.

The main friction was contract precision rather than product scope: timestamp units and snapshot omission behavior, quote-array/no-quote semantics, service-level capability metadata, score/VAR revision lifecycle, retention/empty-result semantics, auth expiry/reactivation, and end-to-end proof-verification examples. Our highest-value requests are explicit numeric units in OpenAPI, a versioned score/action state machine, authoritative per-network service-level metadata, a documented auth/SSE resume lifecycle, and fixed validation vectors with a first-party TypeScript verifier.

Full draft feedback: [TXLine API feedback](https://github.com/Pavilion-devs/samaritan/blob/main/docs/submission/txline-api-feedback.md).

## Final human release checklist

- [ ] Deborah has rewritten the submission in her own voice and can explain every sentence.
- [ ] The MVP, video, repository, and documentation links work while signed out.
- [ ] The video targets 4:30–4:45, never exceeds five minutes, and shows the working product, TXLine's backend role, and the exact proof commands.
- [ ] The final public commit passes install, checks, build, demo, receipt verification, and public-artifact audit.
- [ ] Paper-only, closed real-money gate, registered-v2-without-observations, unanchored-receipt, and sampled-price limitations remain visible.
- [ ] No raw TXLine data, secret, private path, FIFA branding, or unsupported result is public.
- [ ] Deborah—not an agent—submits the entry through Superteam Earn.
