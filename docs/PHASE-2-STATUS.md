# Phase 2 — Signal Core Status

*In progress July 10, 2026. All numeric values reported below are smoke-study inputs, not approved trading thresholds.*

## Implemented

- The feature engine now computes probability velocity and change-in-velocity acceleration over injected windows, EWMA baselines/z-scores, two-sided CUSUM, cross-market gaps, source freshness, de-vig discrepancies, and recent score context.
- `CONSENSUS_MOVE`, `XMARKET_DIVERGENCE`, and `FADER_CANDIDATE` emit typed evidence bundles. Sampled Polymarket history is allowed only as a research proxy; it always produces `research_only` eligibility and can never authorize execution.
- DuckDB archive replay reconstructs canonical TXLine quote events and Polymarket sampled-price events as bounded streams. Replay and live retain the same event types and neither carries a mode field.
- Historical TX metadata is no longer guessed. The archive importer retains bookmaker ID/name, `InRunning`, and game state; the current local database was backfilled with 4,144,975 unique message records, including 2,244,442 correctly marked in-running messages.
- Feature extraction runs directly over the timestamp-merged archive without materializing match histories in process memory.
- Threshold grids are injected, hashed, and evaluated in parallel. Future labels are withheld until an explicit horizon elapses, then applied to the earlier prediction; pending cases are bounded by the horizon and discarded if no fresh resolution point arrives.
- The current post-hoc labels distinguish cross-market gap convergence, Polymarket reversion while consensus stays fixed, and Polymarket following a sustained consensus direction. Label horizons and minimum movements remain Phase-3 parameters.
- The dynamic main-total selector is evidence-driven and parameterized. It can weight distance from 50/50, log volume, log liquidity, and history coverage; it fails closed when no exact TX-observed full-time line passes the injected eligibility requirements.
- The paired-capture live-lane analyzer streams captured TXLine frames and Polymarket NDJSON through the production normalizers, reconstructs canonical top-of-book state and best-level depth, excludes explicit reconnect windows, and measures score-event delivery against every exact mapped market group without loading the 3.3 GB capture into memory.

## Real-archive smoke evidence

A one-hour pre-kickoff Match Result window for TX fixture `17588227` streamed through the production feature path:

```json
{
  "events": 483,
  "snapshots": 549,
  "txlineEvents": 123,
  "polymarketEvents": 360,
  "crossMarketSnapshots": 546,
  "acceleratedSnapshots": 540
}
```

The absolute StablePrice-versus-Polymarket gap in fresh snapshots had median `0.00241`, p90 `0.00849`, p99 `0.01054`, and maximum `0.01287`. Consequently, smoke grids at two- and three-point minimum gaps emitted no signals. A deliberately wider exploratory grid from 0.3 to 1.0 points did emit XMARKET cases, proving the evaluator path, but one match-hour is not a calibration sample and no value was promoted.

This early result is useful precisely because it rejects an assumed “3–4 point” default. The Phase-3 study must measure the full 98-fixture sample with train/test separation before freezing any detector number.

The total-line evidence builder produced 590 TX-observed full-time lines across all 98 mapped fixtures, with a latest Over probability at least five minutes before kickoff for every line. A balance-only exploratory rule exactly reproduced the Phase-0 closest-to-50/50 distribution: O/U 2.5 for 77 fixtures, 3.5 for 15, 1.5 for 5, and 4.5 for 1. Across balance-only, equal-weight, and balance-heavy exploratory schemes, weighting changed the winner for one fixture (`17588320`) and 69/98 fixtures still showed disagreement among the raw balance/volume/liquidity/coverage criteria. This is evidence for a stable candidate rule, not approval to freeze it. Archived post-close Gamma liquidity is often zero, so the gate must not treat it as historical executable depth.

The synchronized Spain-Belgium run added 2,262,950 normalized canonical Polymarket events across Match Result and five exact full-time totals groups. TXLine delivered three unique goals with first-seen receive latency of -8 to 49 ms; confirmation revisions arrived 74–162 seconds later. At an exploratory 50-probability-bps material-move threshold, Polymarket had already moved during the five seconds before TXLine first delivery in 12/18 market-event cases. The other 6/18 showed no material move inside 30 seconds, and 0/18 showed a clean post-TXLine repricing case without a prior move. This match does not support the STALE_QUOTE hypothesis. Eight public-WebSocket outages totaled 91.171 seconds and are marked unavailable rather than unchanged-market periods. Full evidence is in `docs/research/paired-spain-belgium-2026-07-10-live-lane.md`.

## Historical gate evidence

**July 14 correction:** the dynamic-total historical result described below is invalidated for decision use. The selector used a Polymarket observation after the eligible signal window for 95/98 fixtures, and its coverage calculation was not constrained to the same as-of cutoff. The reported sample also mixed unsupported sells and complementary expressions of the same economic move. The original values remain below as audit history only; no totals candidate is currently approved. See `docs/research/historical-gate-study-v1-invalidation.md`.

**Corrected rerun:** `docs/research/historical-gate-study-causal-economic-v4.md` uses a T−180-minute selector cutoff, zero future/coverage violations across 590 evidence rows, normalized buy-only Total Goals cases, and fixture-clustered uncertainty. The prespecified Total Goals `CONSENSUS_MOVE` family supports a fresh forward paper study (38 held-out cases / 18 fixtures; `+132.7 bps` after the proxy; 95% CI `+14.3` to `+243.9`), but it is sampled-price signal evidence, not alpha or fill proof. Deborah registered paper v2 for forward observation only on July 18; no qualifying v2 observation existed at registration.

The chronological historical study used 68 training fixtures and 30 sealed heldout fixtures. Training had both sources for 136/136 market groups; heldout had both for 52/60 groups. Configurations were selected only on training labels, required at least 30 predicted-positive training cases, and could not use a detector gap below the 100 probability-bps cost proxy.

The original v1 run produced the numerical outputs retained in `docs/research/historical-gate-study.md`, but the dynamic-total slice does not advance to human review after the causal audit. `XMARKET_DIVERGENCE`, `FADER_CANDIDATE`, and Match Result `CONSENSUS_MOVE` remain rejected on their existing evidence. Dynamic-total `CONSENSUS_MOVE` returns to unapproved research status until a new causal study is completed. The real-money gate remains closed.

## Verification

`pnpm check` passes under Node `22.23.1` with 39 tests across twelve files. `pnpm build` also passes. The Phase 0 recorder has an additional Node test that proves an open SSE response is aborted at the capture deadline. Tests cover acceleration, sampled-history research gating, archive event reconstruction, no-mode replay identity, future-label isolation, bounded deferred scoring, grid expansion, dynamic total-line ranking/fail-closed behavior, chronological split isolation, detector behavior, storage integrity, mappings, source normalization, outage pairing, latency histograms, and recorder shutdown.

## Still open

- Review and either freeze or reject the dynamic main-full-time-total candidate; do not hard-code O/U 2.5 or treat the candidate as production before Deborah's decision.
- Add `MODEL_MARKET_GAP` only behind a fitted model and valid calibration certificate. No hand-set match-state multipliers are allowed.
- Repeat synchronized live-lane measurement on any remaining mapped matches if practical. `STALE_QUOTE` remains disabled: Spain-Belgium supplied score-event latency labels but no supporting post-TXLine stale-window case.
- Review the totals-only `CONSENSUS_MOVE` candidate with Deborah, collect executable-book evidence, and freeze or reject its threshold. `XMARKET_DIVERGENCE`, Match Result `CONSENSUS_MOVE`, and `FADER_CANDIDATE` are no-go for v1 on current evidence.
