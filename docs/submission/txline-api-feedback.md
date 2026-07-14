# TxLINE API Feedback Draft

**Status:** Submission draft; verify links and current service metadata immediately before sending<br>
**Project:** Samaritan<br>
**Participant:** Deborah<br>
**Basis:** Phase 0 through Phase 4 integration work using the OpenAPI specification, mainnet SL12, devnet subscription metadata, historical endpoints, snapshots, SSE, score data, and validation surfaces

## Executive summary

TxLINE gave Samaritan an unusually strong foundation for building a reproducible sports-market system. Its most valuable combination is not merely low-latency odds: it is normalized de-vigged probabilities, historical access, live SSE, rich score events, and on-chain validation surfaces under one data model. That combination makes it possible to test the same deterministic decision logic in replay and live operation and to retain evidence for why a system acted or refused to act.

The main integration cost came from places where the documented contract did not fully describe observed behavior: timestamp requirements, service-level metadata, empty quote transitions, array alignment, retention windows, score-state semantics, and authentication renewal. None is a request for more product scope. A tighter executable contract, explicit lifecycle semantics, and a small official SDK/conformance suite would remove most of the defensive reverse engineering required by a production consumer.

## What worked especially well

### 1. The de-vigged probability representation is excellent

`Pct` is a high-value primitive for quantitative products. It lets a consumer work in probability space without independently rebuilding bookmaker-margin removal for every quote. The captured values behaved as percentages on a 0–100 scale and summed near 100, so Samaritan normalizes them into 0–1 probabilities at ingestion.

This substantially reduced ambiguity in feature engineering. It also made movements across Match Result, Over/Under, and Handicap markets comparable under one internal convention.

### 2. Live and historical surfaces support reproducible research

The combination of:

- live odds and scores via SSE;
- latest snapshots;
- interval-based historical odds and scores;
- full score history by fixture; and
- stable fixture, market, period, parameter, and message identities

allowed Samaritan to build canonical events that can be consumed by the same downstream feature and detector code in replay and live operation. Historical access was large enough to support serious research rather than a hand-built demo.

### 3. SSE has the right production primitives

Standard `id`, `event`, `data`, and `retry` frames, heartbeats, `Last-Event-ID`, and gzip support are the right building blocks. Gzip is particularly valuable for high-volume odds streams. Resumability also makes it possible for a consumer to distinguish reconnect delivery from new market evidence and to deduplicate safely.

### 4. The score feed is richer than a scoreboard

The observed score envelope included clock, possession, score, possible-event state, kickoff state, player statistics, lineups, and actions such as shots, VAR, penalties, goals, corners, and cards. This is useful for building event-aware market diagnostics and for testing whether a venue repriced before or after a material match event.

### 5. Validation endpoints are a meaningful differentiator

Fixture, odds, score/stat, and batch-validation endpoints create the foundation for externally verifiable decision evidence. For an autonomous system, proving the provenance of the input is almost as important as recording the output. This is a stronger product surface than an ordinary centralized odds API.

### 6. The free World Cup access enabled a real integration

Mainnet SL12 real-time access and historical availability allowed Samaritan to test real event flow, reconnect behavior, replay, data normalization, and synchronized market observation. The product was able to exercise the actual service rather than rely on mocks alone.

## Friction encountered and suggested fixes

### 1. Make timestamp units and omission behavior explicit

**Observed friction:** `GET /api/odds/snapshot/{fixtureId}` required `asOf` to be supplied as an epoch-millisecond value in practice. Omitting it returned only a partial snapshot during a July 10 mainnet smoke. The contract did not make that operational consequence sufficiently clear.

**Suggestion:** Specify the unit and required/optional behavior in both OpenAPI and prose:

- `asOf`: Unix epoch milliseconds;
- what “omitted” means;
- whether the result is latest-known, partial, or bounded by a server default;
- inclusive/exclusive cutoff semantics; and
- an example response for each case.

An OpenAPI `format`, minimum/maximum example, and a conformance test would prevent seconds-versus-milliseconds failures.

### 2. Publish one authoritative service-level matrix per network

**Observed friction:** Mainnet SL1 was described as 60-second delayed and mainnet SL12 as real-time. The current devnet SL1 on-chain pricing row reported `samplingIntervalSec = 0`, which contradicted the earlier blanket association between SL1 and a 60-second delay.

**Suggestion:** Make the on-chain subscription row the explicitly documented source of truth and publish a generated table containing, for every network and service level:

- sampling interval;
- permitted competitions;
- historical availability;
- program ID and mint identity;
- activation requirements; and
- the metadata version/effective time.

Clients should be told to inspect the subscribed row instead of inferring latency from a service-level name.

### 3. Define quote-array invariants and no-quote transitions

**Observed friction:** Observed market rows sometimes retained `PriceNames` while both `Prices` and `Pct` were empty. Samaritan interpreted a row with both value arrays empty as an explicit no-quote transition and treated partially populated or misaligned arrays as invalid. That distinction was necessary for safety but was not fully specified.

**Suggestion:** Document the legal combinations of:

- `PriceNames`;
- `Prices`;
- `Pct`; and
- market availability/status.

Provide an explicit `quoteStatus` or `isAvailable` field if possible. At minimum, specify that empty `Prices` and `Pct` with retained names means “no current quote,” and define whether unequal non-empty array lengths are always malformed. Include examples for open, suspended, removed, and resumed markets.

### 4. Document units beside every numeric field

**Observed friction:** `Prices` were observed as integer odds multiplied by 1000, while `Pct` contained three-decimal strings on a 0–100 percentage scale. Both are usable, but the conventions are easy to misread and have materially different failure modes.

**Suggestion:** Put units directly into OpenAPI field descriptions and examples:

- `Prices`: decimal odds ×1000, integer;
- `Pct`: de-vigged probability percentage on 0–100, decimal string;
- timestamps: seconds or milliseconds, named per field;
- line parameters: representation and precision rules.

Consider adding machine-readable extension metadata such as `x-unit` and `x-scale` so generated clients can preserve the contract.

### 5. Clarify consensus coverage versus constituent bookmaker coverage

**Observed friction:** The free World Cup captures exposed `TXLineStablePriceDemargined` consensus rows rather than a multi-bookmaker panel, even though the object model includes `BookmakerId` and `Bookmaker`. That is a valid and useful product, but consumers can otherwise design a bookmaker-lead/lag strategy that the subscribed feed cannot support.

**Suggestion:** For every tier, state whether odds rows are:

- StablePrice consensus only;
- individual bookmaker observations; or
- both.

Expose a capability descriptor in subscription metadata so software can fail closed before assuming constituent-book availability.

### 6. Specify score/action lifecycle and revisions

**Observed friction:** Goal-related score messages included initial deliveries and later confirmation revisions. The feed also exposes `PossibleEvent`, `Action`, score counters, and match-state fields, but the semantic relationship between provisional, confirmed, corrected, and reversed events needs a stronger contract for VAR-sensitive systems.

**Suggestion:** Document a state machine for material events:

```text
possible → provisional → confirmed
                     ↘ corrected / cancelled
```

Define which identity remains stable across revisions, which timestamp denotes source occurrence versus publication, and how a consumer should recognize a correction or reversal. Include worked VAR and penalty examples.

### 7. Keep the score parser contract open and publish the full taxonomy

**Observed friction:** Captured `Stats` keys used period prefixes 0 through 7, while the earlier documentation summary did not describe the full observed range. Observed match-state IDs included 1–13 and 100, while the documentation listed a wider 1–19 family. Odds rows also frequently had blank `GameState` values.

**Suggestion:** Publish versioned enumerations for:

- period prefixes and their meanings;
- stat base keys;
- match-state IDs;
- action names;
- which fields may be blank on odds versus score events; and
- forward-compatibility behavior for unknown values.

An `unknown` rule is important: consumers should retain new actions and states instead of rejecting an entire event when the taxonomy expands.

### 8. State retention and empty-result semantics per endpoint

**Observed friction:** Interval endpoints returned data over a longer observed range than a consumer might infer from the prose documentation. Score interval coverage differed by network and date. `GET /api/scores/historical/{fixtureId}` returned successful empty bodies for some older fixtures rather than a not-found/expired distinction.

**Suggestion:** Publish a per-endpoint retention table with:

- guaranteed versus best-effort retention;
- network differences;
- current earliest available time;
- whether an empty 200 means no events, expired data, unavailable competition, or an unknown fixture; and
- whether retention can change by subscription tier.

Response metadata such as `coverageStart`, `coverageEnd`, `isComplete`, and `emptyReason` would make research admission deterministic.

### 9. Document authentication expiry and reactivation as a complete lifecycle

**Observed friction:** Authentication uses both a guest JWT and activated API token. No proven refresh endpoint was available to the integration, so Samaritan detects expiry and invokes a separately supplied reactivation path rather than inventing renewal behavior.

**Suggestion:** Provide an official lifecycle sequence covering:

- JWT expiry and renewal;
- API-token expiry and renewal;
- subscription expiration;
- whether a wallet signature may be reused;
- error codes for each expired component;
- retry safety and idempotency; and
- how an open SSE connection behaves when either credential expires.

A tiny official TypeScript session helper would eliminate substantial repeated work across submissions.

### 10. Define event ordering and resume guarantees

**Observed friction:** A safe consumer must distinguish source time, server publication time, local receipt time, replay order, and reconnect redelivery. `Last-Event-ID` and message IDs help, but the ordering guarantees across odds, scores, snapshots, and reconnect backfill need to be explicit.

**Suggestion:** State:

- whether IDs are unique per fixture, stream, endpoint, or globally;
- whether IDs are monotonic;
- whether reconnect may redeliver or reorder frames;
- the retention window for resume IDs;
- how gaps are signalled; and
- the supported snapshot-plus-stream handoff procedure.

An official “lossless reconnect” example should demonstrate snapshot backfill, `Last-Event-ID`, deduplication, and gap detection together.

### 11. Provide a first-party validation verifier and canonical proof example

**Observed friction:** The validation endpoints are strategically important, but consumers still need to understand canonical leaf serialization, proof ordering, on-chain account selection, network identity, and how to verify a returned proof independently.

**Suggestion:** Publish:

- one fixed fixture, odds, and score validation vector;
- the exact canonical bytes and resulting leaf hash;
- a TypeScript verifier;
- the expected root/account and transaction reference; and
- clear failure examples for the wrong network, stale root, malformed path, or mismatched payload.

This would turn validation from an advanced integration surface into a feature every hackathon entry could demonstrate correctly.

### 12. Add an executable conformance pack and changelog

**Observed friction:** The OpenAPI specification is a strong starting point, but several important behaviors were discovered only through captured traffic. In a money-adjacent system, documentation drift forces every client to build its own interpretation layer.

**Suggestion:** Ship a small versioned conformance pack containing sanitized examples and assertions for:

- authentication and activation;
- snapshots with and without `asOf`;
- live quote, no-quote, and resumed-quote rows;
- score revisions and VAR cancellation;
- SSE reconnect and deduplication;
- retention-empty responses; and
- validation proof verification.

Tie it to a public schema changelog with effective dates. A generated strict TypeScript client would be helpful, but the conformance vectors are the higher-value first step.

## Prioritized recommendations

If only five improvements can be made, Samaritan recommends:

1. Specify quote-array/no-quote invariants and numeric units in OpenAPI.
2. Publish the score/action revision state machine, especially for VAR.
3. Make service-level capability metadata authoritative and machine-readable per network.
4. Document the complete auth-expiry and SSE-resume lifecycle.
5. Release fixed validation vectors with a first-party TypeScript verifier.

## Closing feedback

TxLINE's strongest differentiator is the combination of normalized real-time evidence and independent validation, not any one endpoint. Samaritan was able to build a strict canonical event layer, replay research, score-aware diagnostics, and provenance-bearing decision records because those surfaces exist together.

The requested improvements are primarily contract clarity. Making the implicit lifecycle rules executable would shorten integration time, reduce unsafe assumptions, and make it much easier for developers to demonstrate TXLine's on-chain verification advantage accurately.

## Internal verification checklist

Before this feedback is submitted:

- Recheck current endpoint names and service-level rows against the live official documentation.
- Keep all examples aggregate or schematic; attach no raw response or private capture.
- Remove any observation that is no longer reproducible under the current API version.
- Submit the feedback in Deborah's name as the human participant.
- Keep Polymarket-specific feedback out of the TxLINE section.
