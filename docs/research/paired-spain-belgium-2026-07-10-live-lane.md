# Spain-Belgium Paired Live-Lane Evidence

Generated: 2026-07-11T06:35:38.499Z

> Research evidence only. The mapping is capture-confirmed but not settlement-verified, every in-play result remains paper-only, and the material-move threshold is exploratory rather than an approved detector threshold.

## Scope

- Fixture: `18218149`
- Canonical target assets: 13 across 6 exact market groups
- Material midpoint move: 50 probability bps
- Polymarket messages scanned through the last response window: 1,986,443
- Canonical Polymarket events normalized: 2,262,950

## Feed Health

- TXLine odds receive latency p50/p90/p99: 142 / 721 / 8875 ms
- TXLine score receive latency p50/p90/p99: 39 / 362 / 50772 ms
- Polymarket non-book venue-timestamp age outside reconnect recovery p50/p90/p99: 119 / 9399 / 158965 ms
- Polymarket all-event venue-timestamp age p50/p90/p99: 121 / 9066 / 158965 ms
- Polymarket payload timestamps show event age, not a pure network-latency clock; stale/repeated venue timestamps remain visible outside reconnect windows and must be treated as feed-health evidence rather than transport timing alone.
- Public WebSocket outages: 8; total 91171 ms; max 25375 ms

| Outage start | Reconnected | Duration ms | Code |
|---|---|---:|---:|
| 2026-07-10T19:42:56.902Z | 2026-07-10T19:42:58.713Z | 1811 | 1006 |
| 2026-07-10T20:27:07.908Z | 2026-07-10T20:27:10.460Z | 2552 | 1006 |
| 2026-07-10T20:32:22.564Z | 2026-07-10T20:32:27.317Z | 4753 | 1006 |
| 2026-07-10T20:36:04.809Z | 2026-07-10T20:36:14.354Z | 9545 | 1006 |
| 2026-07-10T20:41:09.121Z | 2026-07-10T20:41:24.612Z | 15491 | 1006 |
| 2026-07-10T20:50:17.844Z | 2026-07-10T20:50:43.219Z | 25375 | 1006 |
| 2026-07-10T20:52:35.358Z | 2026-07-10T20:52:51.491Z | 16133 | 1006 |
| 2026-07-10T23:32:55.720Z | 2026-07-10T23:33:11.231Z | 15511 | 1006 |

| Polymarket observation | Events | Age p50 ms | Age p90 ms | Age p99 ms |
|---|---:|---:|---:|---:|
| best_bid_ask | 56,942 | 102 | 11852 | 158792 |
| book | 37,723 | 123 | 13024 | 158812 |
| last_trade | 25,793 | 122 | 14657 | 158848 |
| price_change | 2,142,492 | 121 | 8857 | 158965 |

## Goal Delivery

| Goal | First seen | Participant | Match clock sec | TXLine receive latency ms | Confirmation delay ms |
|---:|---|---:|---:|---:|---:|
| 1 | 2026-07-10T19:30:00.389Z | 1 | 1761 | 11 | 74416 |
| 2 | 2026-07-10T19:40:50.195Z | 2 | 2411 | -8 | 162426 |
| 3 | 2026-07-10T20:49:37.081Z | 1 | 5244 | 49 | 92191 |

## Repricing Evidence

A pre-trigger move compares the book at T-5s with the last state before TXLine delivered the goal. Material movement before T0 means the venue had already reacted before Samaritan received the score event; that is evidence against a post-TXLine stale-quote window for that market instance.

| Goal | Clock sec | Market | First quote update ms | First material move ms | Pre-trigger move pp | Classification | Outage overlap |
|---:|---:|---|---:|---:|---:|---|---|
| 1 | 1761 | match_result | 24 | 228 | 7.750 | polymarket_moved_before_txline | no |
| 1 | 1761 | total_goals 0.5 | 24 | 243 | 1.625 | polymarket_moved_before_txline | no |
| 1 | 1761 | total_goals 1.5 | 24 | 546 | 5.375 | polymarket_moved_before_txline | no |
| 1 | 1761 | total_goals 2.5 | 24 | 243 | 8.375 | polymarket_moved_before_txline | no |
| 1 | 1761 | total_goals 3.5 | 24 | 3257 | 6.000 | polymarket_moved_before_txline | no |
| 1 | 1761 | total_goals 4.5 | 24 | 1671 | 8.000 | polymarket_moved_before_txline | no |
| 2 | 2411 | match_result | 0 | 1284 | 5.750 | polymarket_moved_before_txline | no |
| 2 | 2411 | total_goals 0.5 | 1900 | n/a | 0.000 | no_material_reprice_in_window | no |
| 2 | 2411 | total_goals 1.5 | 0 | 3042 | 5.375 | polymarket_moved_before_txline | no |
| 2 | 2411 | total_goals 2.5 | 0 | 1781 | 5.750 | polymarket_moved_before_txline | no |
| 2 | 2411 | total_goals 3.5 | 0 | 162 | 6.375 | polymarket_moved_before_txline | no |
| 2 | 2411 | total_goals 4.5 | 31 | 1611 | 8.250 | polymarket_moved_before_txline | no |
| 3 | 5244 | match_result | 1 | 1368 | 0.500 | polymarket_moved_before_txline | no |
| 3 | 5244 | total_goals 0.5 | n/a | n/a | 0.000 | no_material_reprice_in_window | no |
| 3 | 5244 | total_goals 1.5 | 5656 | n/a | 0.000 | no_material_reprice_in_window | no |
| 3 | 5244 | total_goals 2.5 | 1 | n/a | 0.000 | no_material_reprice_in_window | no |
| 3 | 5244 | total_goals 3.5 | 1 | n/a | 0.125 | no_material_reprice_in_window | no |
| 3 | 5244 | total_goals 4.5 | 6781 | n/a | 0.000 | no_material_reprice_in_window | no |

## Gate Readout

- Market-event cases measured: 18
- Polymarket moved at least the exploratory threshold before TXLine first delivery: 12
- Material post-TXLine repricing observed without a prior move: 0
- No material move inside the 30-second response window: 6
- Result for STALE_QUOTE: `not_supported_by_this_match`

For this match, Polymarket was already repricing before the first TXLine goal event arrived whenever a material move was visible. The capture therefore does not support a post-TXLine stale-order edge. STALE_QUOTE remains disabled and paper-only; more synchronized matches may add evidence but cannot reverse this result by assumption.

## Interpretation Guardrails

- These are three event instances from one match, not a fitted latency distribution.
- A code-1006 reconnect interval is unavailable data, never evidence that a quote stayed unchanged.
- Match Result is grouped from the three canonical Yes tokens; complement No tokens are not double-counted.
- Every mapped totals line is reported. No O/U line is hard-coded as the production main total.
- No trading, fill simulation, or real-money claim is authorized by this report.
