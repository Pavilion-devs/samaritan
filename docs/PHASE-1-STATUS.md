# Phase 1 — Data Backbone Status

*Completed July 10, 2026; evidence status corrected July 15. The synchronized Spain–Belgium capture and replay are complete. Its 18 goal×market feasibility observations found no clean post-TXLine stale window, so STALE_QUOTE remains disabled and the corpus is research-only.*

## Spain–Belgium capture confirmation

Deborah confirmed the Spain–Belgium pairing for synchronized public-data capture:

- TXLine fixture `18218149`: Spain vs Belgium, kickoff `2026-07-10T19:00:00.000Z`.
- Polymarket event `676288`, slug `fifwc-esp-bel-2026-07-10`: the same teams and kickoff.
- Polymarket Match Result rules refer to the first 90 minutes plus stoppage time.
- The confirmation is **capture-only**. It is not settlement verification and cannot authorize a trade.

The machine-readable record is `config/captures/spain-belgium-2026-07-10.json`. The planned five-hour paired window begins at `17:00 UTC / 18:00 WAT`, two hours before kickoff.

## Implemented

- Node `22.23.1`, pnpm `11.13.0`, strict TypeScript, ESM, and vitest are pinned at the workspace root.
- `CanonicalEventBus` exposes one event union to every downstream consumer. There is no live/replay mode field.
- TXLine normalization uses captured field shapes. `Pct` is divided by 100; `Prices` remains integer x1000; `NA` stays missing rather than becoming zero.
- Total lines are exact integer milli-goals, so `2.5` is keyed as `2500` rather than by floating-point identity.
- TXLine odds/scores SSE supports gzip, `Last-Event-ID`, reconnect, fixture snapshot backfill, and downstream event-ID deduplication.
- The TXLine session manager detects JWT expiry and accepts a proven reactivation callback. It does not assume a refresh endpoint that was not observed.
- Polymarket books, price changes, best bid/ask, last trades, and sampled history normalize through an evidence-bearing asset registry.
- Moneyline `No` tokens are explicitly labeled complements; they cannot be double-counted as additional 1X2 outcomes.
- Candidate mappings stay non-tradeable. Only `verified` mappings with an explicit human settlement review can report `tradeable: true`.
- SQLite journals hash-chain raw ingress and canonical events and reject update/delete operations. Reconnect redelivery is idempotent.
- DuckDB stores flattened TXLine outcomes, Polymarket observations, score events, and full canonical payloads.
- Large TXLine arrays and nested Polymarket `history` arrays are read as streams instead of loading the archive into memory.

## Verification evidence

`pnpm check` passes with 12 tests covering normalization, live/replay equality, exact line identity, mapping fail-closed behavior, journal deduplication/collision detection, serialized multi-source publishing, hash-chain verification, and DuckDB writes.

`pnpm smoke:replay` replayed 250 TXLine records from the real France–Morocco capture and 250 sampled Polymarket history points through the same bus:

```json
{
  "deliveredTxLine": 250,
  "deliveredPolymarket": 250,
  "quotes": 193,
  "polymarketPrices": 250,
  "stored": 500,
  "hashChainValid": true,
  "hasModeField": false
}
```

A combined read-only mainnet live smoke for Spain–Belgium passed with 19 TXLine quotes, two score updates, 22 Polymarket books, and 113 Polymarket price events sharing one serialized bus and one valid 159-row journal chain. No authentication changes, wallet actions, trading, or money movement occurred.

The machine-readable research registry contains 196 mapping records covering 98/102 fixtures, 294 complete Match Result conditions, 590 TXLine-observed totals conditions, and 1,768 mapped assets. The same four Phase-0 exceptions remain excluded. Every row is a candidate and `tradeable: false`.

The full local archive import completed in 73.6 seconds and created `data/research/samaritan-research-v1.duckdb`:

- 9,025,361 normalized TXLine outcome rows across 102 fixtures.
- 85,249,582 sampled Polymarket rows across 98 mapped fixtures.
- Zero invalid probability, non-positive odds, non-candidate mapping, or tradeable-asset violations.
- The database and raw-derived mapping artifacts remain under gitignored `data/`.

## Post-exit follow-up

Gamma rolling discovery is connected to the mapping-candidate writer. A July 10 smoke found 57 open World Cup match-family events, refreshed 48 candidate assets, merged them with the research registry, and produced zero tradeable assets.

The synchronized Spain–Belgium capture was replayed through the product bus and used for the live-lane feasibility study. Across 18 goal×market observations, 12 had already moved before TXLine and 6 had no material reprice; none established a clean post-TXLine stale window. `STALE_QUOTE` remains disabled, and the capture did not enter an execution or Claude runtime.
