# Phase 3 Gate Study

*Drafted July 11, 2026. Invalidated for decision use on July 14 after a causal-selector audit. The original measurements remain below as an audit record, not evidence of edge. This report does not authorize paper promotion or real-money execution. See `docs/research/historical-gate-study-v1-invalidation.md`.*

## Decision

The real-money gate remains **closed**. The corrected rerun supports preparing a fresh Total Goals–only forward paper protocol for Deborah's review, but no paper study is active or registered.

The v1 historical lane does not currently support promoting any detector. Its dynamic-total market was selected with a Polymarket observation after the last eligible signal time for 95 of 98 fixtures; coverage was also counted without the same cutoff. The reported signal sample additionally mixed unsupported sells and complementary expressions of the same economic move. The synchronized Spain-Belgium evidence remains valid for its narrow stale-quote feasibility conclusion because it does not depend on the historical selector.

| Lane | Evidence decision | Reason |
|---|---|---|
| `CONSENSUS_MOVE`, dynamic total | **Registered for forward paper observation** | Corrected v4: 38 held-out normalized Total Goals buys / 18 fixtures; `+132.7 bps` after the 100 bps proxy; fixture-clustered 95% CI `+14.3` to `+243.9 bps`. Sampled prices still cannot prove fills or profitability; Deborah registered v2 on July 18 under a closed real-money gate |
| `CONSENSUS_MOVE`, Match Result | No-go for v1 | 34 heldout signals; mean after-cost CLV `-67.0 bps` |
| `XMARKET_DIVERGENCE` | No-go for v1 | Overall mean after-cost CLV `-2.1 bps`; Match Result was `-15.2 bps`. The positive total slice does not justify promoting a detector whose sealed aggregate result failed |
| `FADER_CANDIDATE` | No-go for v1 | Overall mean after-cost CLV `-46.0 bps`, with both market families negative |
| `STALE_QUOTE` | Disabled | The synchronized Spain-Belgium study found zero clean post-TXLine repricing windows in 18 market-event cases |
| `MODEL_MARKET_GAP` | Not evaluated | No fitted goal model or calibration certificate exists yet |

The prior paper approval remains suspended. The corrected selector, economic-case definition, versioned rerun, and candidate protocol draft now exist, but only Deborah can register a fresh forward study. Historical Polymarket observations are sampled prices, not executable books, so even the corrected historical study cannot establish spread, slippage, fill probability, or settlement correctness.

## Corrected V4 Result — Research Evidence Only

Protocol `historical-gate-causal-economic-v4-2026-07-14` preserves the 68/30 chronological split and records configuration SHA-256 `9a4eeff928f697fc55ab5147a4dc07f611c40bb749501fc3bd92b211f24b2e54` plus hashes of the archive, mappings, and causal selector evidence.

- All 590 selector rows pass the causal audit: zero future probabilities, future coverage rows, late selector cutoffs, or nonzero untimestamped liquidity/volume inputs.
- The training-selected `CONSENSUS_MOVE` configuration had 135 normalized Total Goals training cases before held-out Total Goals review.
- Held-out Total Goals produced 38 normalized buy cases across 18 fixtures.
- Mean directional CLV was `+232.7 bps`; after the fixed 100 bps historical proxy it was `+132.7 bps`.
- The 10,000-iteration whole-fixture bootstrap interval was `+14.3` to `+243.9 bps` after the proxy.
- The aggregate detector, including Match Result, did not pass its clustered interval; Match Result stays rejected.
- No model calls occurred in the deterministic historical replay, so model operating cost was `$0.00`; a forward paper case must report inference economics separately.

This result clears only a historical signal threshold for a **fresh forward paper review**. It is not an executable backtest: the Polymarket observations are sampled prices without bid/ask, depth, or fill probability. The proposed replacement protocol is documented at `docs/09-paper-study-v2-candidate.md` and remains deliberately unsigned.

## Historical Lane — Invalidated V1 Audit Record

The study used 98 mapped World Cup fixtures and selected configurations only on a chronological training partition. Identical kickoff timestamps were kept in the same partition.

- Training: 68 fixtures, 136/136 source-aligned market groups, 164,655 canonical events, and 227,368 feature snapshots.
- Heldout: 30 fixtures, 52/60 source-aligned market groups, 60,092 canonical events, and 77,445 feature snapshots.
- Window: final three hours before kickoff through kickoff; in-running TXLine records excluded.
- Labels: 15-minute forward horizon and 25 probability-bps minimum movement.
- Selection: labeled training F1 with at least 30 predicted-positive training cases and detector gaps no smaller than the 100 probability-bps cost floor.
- Cost handling: 100 probability bps subtracted per signal, with 50/150/200 bps sensitivity checks.

The four fixtures missing from heldout source alignment were France-Morocco (`18209181`), Spain-Belgium (`18218149`), Norway-England (`18213979`), and Argentina-Switzerland (`18222446`). Missing groups were excluded rather than imputed.

### Original Sealed Results — Not Valid for Decision Use

| Detector | Train-selected candidate | Heldout precision | Heldout recall | CLV signals | Fixtures | Raw CLV | Net at 100 bps |
|---|---|---:|---:|---:|---:|---:|---:|
| `XMARKET_DIVERGENCE` | gap `100 bps`, persistence `0s`, stable z `< 1` | 50.0% | 1.9% | 372 | 25 | `+97.9 bps` | `-2.1 bps` |
| `CONSENSUS_MOVE` | z `>= 1`, CUSUM `10 bps`, gap `100 bps`, updates `5` | 50.5% | 0.6% | 107 | 23 | `+159.9 bps` | `+59.9 bps` |
| `FADER_CANDIDATE` | PM z `>= 1`, gap `100 bps`, persistence `0s`, stable z `< 1` | 5.6% | 0.1% | 72 | 16 | `+54.0 bps` | `-46.0 bps` |

These are the original v1 outputs retained for traceability. They must not be described as held-out edge, alpha, or an executable opportunity. The causal-selector and economic-case defects require a full rerun rather than a numerical adjustment.

### Cost Sensitivity

| Detector | 50 bps | 100 bps | 150 bps | 200 bps |
|---|---:|---:|---:|---:|
| `XMARKET_DIVERGENCE` | `+47.9` | `-2.1` | `-52.1` | `-102.1` |
| `CONSENSUS_MOVE` | `+109.9` | `+59.9` | `+9.9` | `-40.1` |
| `FADER_CANDIDATE` | `+4.0` | `-46.0` | `-96.0` | `-146.0` |

These values are mean directional signal CLV after each assumed cost. They are sensitivity estimates, not historical P&L.

## Dynamic Total — Defective V1 Method

V1 selected the exact mapped full-time total closest to 50/50 using a point as late as five minutes before kickoff, while eligible signals ended at kickoff minus fifteen minutes. That is future-informed market selection. Its 1,000-point coverage calculation was also not filtered to the same cutoff. The following distribution is retained only to identify the invalidated artifact:

| Line | Fixtures |
|---|---:|
| O/U 1.5 | 5 |
| O/U 2.5 | 77 |
| O/U 3.5 | 15 |
| O/U 4.5 | 1 |

Volume and liquidity were intentionally unweighted because the captured Gamma values are post-close and zero for most lines. No part of this selector is a production or paper default. The corrected selector must use only evidence available before detector evaluation begins and must apply one as-of cutoff to every eligibility input.

## Live Lane

The synchronized Spain-Belgium capture normalized 2,262,950 Polymarket book events across Match Result and five exact full-time totals. Across three unique goals and six market groups, Polymarket had already moved in the five seconds before first TXLine delivery in 12/18 cases. The remaining 6/18 had no material move within 30 seconds. No case showed a clean post-TXLine stale window without a prior Polymarket move.

Eight public-WebSocket outages totaling 91.171 seconds were excluded rather than classified as unchanged markets. This evidence disables `STALE_QUOTE`; it does not prove that such a window can never occur.

## Pending Gate Work

The following items block any signed-off Phase 3 gate:

1. Deborah must review the corrected v4 evidence and either register or reject the unsigned v2 paper candidate.
2. Only fresh post-signature v2 ledgers may pursue the 20-match/40-fill stopping rule without endpoint peeking.
3. Polymarket settlement rules and every live mapping need human confirmation.
4. `MODEL_MARKET_GAP` needs a fitted group-stage model and Brier comparison against the market.
5. Any real-money proposal needs separate per-trade/drawdown approval; the locked `$3` stake and `$20` stop apply only to paper validation.

Until all required review items pass, thresholds remain research-only, no real-money adapter may act on them, and the paper components may be used only for clearly labelled engineering or bounty demonstrations—not a qualifying profitability study.

## Evidence

- Historical detector report: `docs/research/historical-gate-study.md`
- Historical machine-readable output: `data/research/historical-gate-study.json`
- Corrected causal/economic report: `docs/research/historical-gate-study-causal-economic-v4.md`
- V3→V4 methodology note: `docs/research/historical-gate-study-v3-to-v4-methodology-note.md`
- Synchronized live report: `docs/research/paired-spain-belgium-2026-07-10-live-lane.md`
- Synchronized live machine-readable output: `data/research/paired-spain-belgium-2026-07-10-live-lane.json`
