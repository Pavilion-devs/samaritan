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

## Verification

`pnpm check` passes under Node `22.23.1` with 33 tests across ten files. `pnpm build` also passes. Tests cover acceleration, sampled-history research gating, archive event reconstruction, no-mode replay identity, future-label isolation, bounded deferred scoring, grid expansion, dynamic total-line ranking/fail-closed behavior, detector behavior, storage integrity, mappings, and source normalization.

## Still open

- Fit and freeze the dynamic main-full-time-total selector on train/test evidence; do not hard-code O/U 2.5 or treat current exploratory weights as production values.
- Add `MODEL_MARKET_GAP` only behind a fitted model and valid calibration certificate. No hand-set match-state multipliers are allowed.
- Add `STALE_QUOTE` and score-event latency labels from synchronized TXLine plus executable Polymarket book data. Historical one-minute samples cannot support this detector.
- Run the full train/test Phase-3 gate study and freeze thresholds only after review with Deborah.
