# Paper-Study Pre-Registration — Totals-Only CONSENSUS_MOVE

*Registered July 11, 2026 and signed by Deborah July 12. **Invalidated and suspended July 14 before producing any paper observation:** its upstream historical market selector used information later than the eligible signal window. This document is preserved as the immutable v1 audit record; it must not admit new cases. A corrected study requires a new protocol ID and signature. The real-money gate remains **closed**.*

The corrected implementation was reviewed separately and registered for forward paper observation only on July 18, 2026 as `paper-study-v2-2026-07-18`; see [`10-paper-study-v2-registration.md`](10-paper-study-v2-registration.md). That decision does not repair or reactivate this v1 protocol, copy any v1 row forward, admit a fixture, or unlock real money.

## Purpose

The historical gate study originally appeared to produce a pre-match `CONSENSUS_MOVE` candidate on a dynamically selected full-time total. A July 14 audit found that the selector chose the market using a price observed after the last eligible signal for 95 of 98 fixtures. The v1 sample also mixed unsupported sells and complementary expressions of the same economic move. Its previously reported positive measurements are therefore audit history, not valid held-out edge evidence.

That number rests on three proxies that a backtest cannot remove:

- entry at a **sampled Polymarket midpoint** rather than an executable ask/bid,
- fair value proxied by the **bookmaker consensus close** rather than the real Polymarket close/settlement,
- a **flat 100 bps** stand-in for spread, slippage, fees, and fill risk.

This v1 paper study is suspended and cannot receive new cases. Its ledgers remain preserved. A v2 registration may be created only after the causal selector and executable-case definition are fixed and the historical study is rerun without using future information.

## Locked candidate (immutable for this study)

No parameter below may be re-tuned during or after the run. Any change voids this registration and requires a new one.

### Detector — `CONSENSUS_MOVE`, totals markets only

```json
{
  "velocityWindowMs": 300000,
  "consensusMoveAbsZ": 1,
  "consensusCusumThreshold": 0.001,
  "consensusMinimumUpdates": 5,
  "consensusMinimumRawGap": 0.01,
  "consensusStableAbsZ": 1
}
```

- Runs **only** on the `total_goals:full_time` market selected by the dynamic-total selector below.
- `XMARKET_DIVERGENCE`, `FADER_CANDIDATE`, match-result `CONSENSUS_MOVE`, `STALE_QUOTE`, and `MODEL_MARKET_GAP` stay disabled / research-only. They are **not** in this study.

### Dynamic-total selector

```json
{
  "minimumCoveragePoints": 1000,
  "minimumVolume": 0,
  "minimumLiquidity": 0,
  "maximumDistanceFromEven": 0.15,
  "weights": { "balance": 1, "volume": 0, "liquidity": 0, "coverage": 0 }
}
```

Selects the exact mapped full-time total whose pre-kickoff Over probability is closest to 0.50, at least five minutes before kickoff; fails closed if no eligible line is within 0.15 of even. **Note:** liquidity is unweighted only because historical Gamma depth was post-close/zero. The paper study must record the live executable depth of the line it picks (see Guardrails) so we learn whether "most balanced" is also tradeable.

### Feature and forward-label config

```json
{
  "feature": {
    "velocityWindowsMs": [60000, 300000, 900000],
    "velocityEwmaHalfLifeMs": 900000,
    "cusumDriftProbability": 0.0005,
    "scoreContextWindowMs": 300000,
    "freshnessMaxAgeMs": 360000
  },
  "label": { "horizonMs": 900000, "minimumGapClosure": 0.0025 },
  "window": { "beforeKickoffMs": 10800000, "includeInRunning": false }
}
```

Signals are eligible only when detected at least 15 minutes before kickoff (one forward-label horizon), pre-match, in-running rows excluded — identical to the study that produced the candidate.

## What the paper study must replace

| Proxy in the backtest | Reality the paper study must use |
|---|---|
| Sampled Polymarket midpoint as entry | A conservative simulated marketable order against the first canonical book observed after measured signal-to-order latency: buy by walking **asks**, sell only against owned inventory by walking **bids** |
| Consensus close as fair value | The real Polymarket **closing midpoint at kickoff** as the primary CLV reference, directional closing bid/ask as a supporting executable-liquidation mark, and actual **settlement** where available |
| Flat 100 bps cost | Measured spread and book-walk slippage plus the official per-market fee parameters loaded and recorded at runtime |
| Assumed 100% fill | Depth- and latency-aware fills, including partial/no fills; feed outages, insufficient depth, stale books, and invalid mappings are no-trades rather than wins |

The harness extends the existing live-lane path (production normalizers, reconstructed top-of-book and best-level depth, explicit reconnect-window exclusion) already used in `src/research/paired-live-study.ts`.

## Sample and stopping rule

- **Unit of analysis is the match**, not the signal. Signals inside one match are correlated; they do not count as independent bets.
- **Primary plan:** run forward on live mapped fixtures as they occur. Where live match supply is insufficient, the study may extend to the next mapped competition or replay **captured live order books** (not sampled history), but the executable-price and depth requirements above still apply.
- **Minimum to decide:** ≥ **20 matches** that each produce ≥ 1 executed paper signal, **and** ≥ **40 executed signals** total. **Target: 30 matches.**
- **No peeking:** primary endpoints are not computed or inspected until the minimum is reached. If anyone reads interim P&L to decide whether to continue, the run is disclosed as exploratory and does not count toward the gate.

### Two separate lanes

- **Bounty demonstration lane:** runs through submission using remaining live fixtures and captured-book replay to demonstrate the complete autonomous product. Its individual trades and metrics are explicitly exploratory and excluded from the registered profitability decision because the demo must expose them before the minimum sample exists.
- **Long-run profitability lane:** starts with a fresh ledger and unseen fixtures under this unchanged protocol. It alone can satisfy the 20-match/40-fill stopping rule. It continues after the hackathon if necessary.
- The long-run fixture universe is every eligible mapped full-time total exposed through Samaritan's lawful TXLine access after the lane starts. Any competition expansion requires a dated protocol addendum before its first included fixture and cannot be chosen using observed strategy results.

## Primary endpoint and decision rule

The primary endpoint is **executable CLV**, not realized settlement P&L. On ~20–30 matches, binary settlement P&L is too high-variance to gate a decision; CLV against the executable close is the standard, higher-power leading indicator.

**Executable CLV per signal** = (Polymarket closing midpoint at kickoff − simulated fill price) in the traded direction, net of measured entry fees and book-walk slippage. Directional closing bid/ask CLV is reported separately as a supporting liquidation-cost sensitivity check; it is not called a midpoint.

**ACCEPT (advance to a real-money discussion — not to real money) requires all of:**

1. Mean executable CLV net of costs `> 0`, with the **lower bound of the match-clustered 95% CI `> 0`**.
2. Mean realized settlement P&L (where markets resolved) `> 0` — reported with its CI, not required to reach significance.
3. Strategy net result **beats the no-trade baseline (0)** and a **random-direction control**.
4. All guardrails below satisfied.

**REJECT** if the match-clustered 95% CI for executable CLV includes or sits below 0, or any guardrail fails materially.

**INCONCLUSIVE** if the minimum sample is not reached, or required close/settlement evidence is incomplete — in which case extend the sample under the same registration or shelve the candidate. Inconclusive is not a pass. To resolve the original wording conflict conservatively, after the minimum is reached the explicit REJECT rule above controls: a CLV interval that touches or straddles 0 is a REJECT, not an ACCEPT.

The reproducible random-direction control uses a seeded SHA-256 sign assignment per signal. It applies that sign to gross directional midpoint CLV and subtracts the same observed entry cost as the strategy. This is a matched-cost synthetic control, not a claim that the untraded complement token had identical depth; the seed and method are reported.

## Required outputs (both are gating deliverables)

### 1. Match-clustered confidence interval

Compute the 95% CI by **block bootstrap over matches**, not over signals:

- Resample the set of matches **with replacement**, `B = 10000` iterations (seeded and recorded for reproducibility).
- Within each resampled match, take all of its signals; recompute the mean per-signal executable CLV across the resample.
- Report the 2.5th / 50th / 97.5th percentiles of the bootstrap distribution as [CI low, median, CI high].
- Report the same match-clustered CI for realized settlement P&L.

This is the mechanism that prevents ~20 matches from masquerading as 40+ independent bets. Report the number of matches and signals alongside every interval.

### 2. Per-match P&L table

One row per match, columns:

`fixtureId · kickoff · selected total line · signals · fills · fill rate · mean half-spread bps · mean realized slippage bps · gross CLV bps · net CLV bps · realized settlement P&L ($) · net return (bps)`

Plus a footer with: match count, signal count, fraction of matches net-positive, aggregate net CLV with match-clustered CI, aggregate settlement P&L with CI, and the no-trade / random-direction baseline rows.

### Supporting metrics (report, non-gating)

CLV distribution (mean, median, p25, p75, positive rate); hit rate; **Brier score** of entry-implied probabilities vs outcomes, compared to the market's Brier; equity curve and **max drawdown**; realized vs assumed (100 bps) cost, so we learn whether the historical proxy was optimistic.

## Guardrails (each must hold for ACCEPT)

- **Fill rate ≥ 60%** of eligible signals filled at or through the modeled price at stake size; misses logged, never scored as wins.
- **Mean realized slippage ≤ 100 bps** (the historical cost proxy). If realized costs run higher, the edge is presumed gone regardless of CLV point estimate.
- **Max drawdown within the risk cap** below.
- **Selected-line depth recorded** for every trade, so we can see whether the balance-only selector routinely picks thin books.

Source timestamps may regress slightly in capture order. Such observations are counted and rejected atomically before feature or quote state mutation. Kickoff marks select the latest canonical venue/source timestamp at or before kickoff; source, local observation, and processing timestamps are all retained so delayed delivery is visible.

## Risk caps (paper, mirroring intended live limits)

Paper stakes are **simulated USD notional** — no wallet, no tokens, no chain. The paper study reads real live order books and simulates fills in software; it needs nothing to spend. Stake size still mirrors the intended live limits because slippage and fill probability scale with order size, so the simulation must trade the size we would really trade. (For context: the only devnet in this project is the TXLine **data** feed on Solana used for integration testing and on-chain anchoring; the trading venue, Polymarket, is real-money USDC on Polygon with no test-token equivalent. See the handoff note.)

- Bankroll: **$50** (locked).
- Aggregate open exposure ceiling: **$15** (locked).
- Per-trade stake: **$3** (locked; up to five concurrent positions within the $15 ceiling).
- Max drawdown rejection stop: **$20** (locked; 40% of bankroll). Breaching it halts and rejects that paper lane; only Deborah may authorize a new, separately registered study.

All money values are stored as integer USD micro-units. The analyst cannot propose or modify stake, exposure, or drawdown values; deterministic risk code owns them.

## Fee protocol

The July 12 official Polymarket documentation lists the sports taker fee rate as `0.05`, maker fee as `0`, and the formula `fee = shares × feeRate × price × (1 − price)`. Fees are enabled per market and can change. Therefore Samaritan records the V2 fee rate, exponent, taker-only flag, minimum order size, and tick size returned by `getClobMarketInfo(conditionID)` for every simulated fill; runtime market parameters win over this dated documentation snapshot. Missing, legacy-only, malformed, wrong-token, unsupported-exponent, sub-minimum, or off-grid metadata fails closed. Fees are conservatively rounded to the documented `0.00001 USDC` precision.

## Out of scope / still closed

- **Real money.** ACCEPT here only unlocks a *separate* human decision about tiny real-money validation; it is not that decision.
- Polymarket **settlement-rule and mapping confirmation** for the totals markets remains a human prerequisite before any real-money step.
- Other detectors and `MODEL_MARKET_GAP` remain disabled/research-only.

## Locked run inputs

1. Paper stake is `$3`; aggregate exposure is `$15`; the lane is rejected at `$20` drawdown.
2. Fee parameters are loaded from the official per-market CLOB metadata at runtime and recorded with each fill.
3. The bounty lane and long-run lane use separate ledgers. The bounty lane may be viewed freely; the long-run primary endpoints remain sealed until its stopping rule is met.
4. Real money may be discussed only after a long-run `ACCEPT` result and still requires a separate Deborah approval.
5. The persistent long-run ledger began at `2026-07-12T09:45:17.212Z` under frozen config SHA-256 `7dcb4c20ac05195bdb4a6c8803432079eeefb8cc747c186f576084dc772fd2a2`. Earlier fixtures and captures are bounty/research evidence only and cannot count toward its stopping rule.

## Sign-off

- [x] Deborah accepts the locked candidate, sample rule, and decision thresholds above (July 12, 2026).
- [x] `$3` paper stake, `$15` aggregate exposure, and `$20` drawdown rejection stop are fixed.
- [x] Two-lane bounty/long-run protocol is fixed.
- [x] Real-money gate confirmed **closed** for the duration of this study and until separate post-`ACCEPT` approval.

Registered by: research validation review, July 11, 2026. Signed off by Deborah, July 12, 2026.
Evidence basis: `docs/06-gate-study.md`, `docs/research/historical-gate-study.md`, `data/research/historical-gate-study.json`.
