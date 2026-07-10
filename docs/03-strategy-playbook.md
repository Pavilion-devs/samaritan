# 03 — Strategy Playbook

*v0.2 (July 10, 2026). Status: V1 STRATEGIES LOCKED; numeric thresholds remain unset until the Phase-3 gate.*

## First principles (why anything here works at all)

A betting/prediction market is a price discovery machine. Edge = **information or speed the market hasn't priced yet**, minus costs (vig, fees, slippage). There are exactly three durable sources:

1. **Speed** — you see repricing-relevant information (a sharp move, a goal) before a slower venue reprices.
2. **Aggregation** — you combine sources (sharp consensus + your own model + flow context) into a better probability estimate than any single venue's price.
3. **Structure** — you exploit mechanical inefficiencies (vig asymmetries, stale lines, retail-driven distortions in prediction markets).

An LLM predicting match winners from general knowledge is none of these. An LLM *interpreting why a market moved*, on top of a fast signal layer — that serves #2. Samaritan is built on that distinction.

**The measuring stick: Closing Line Value (CLV).** The closing line (final pre-kickoff sharp consensus) is the best public estimate of true probability. If we consistently beat the close — enter at better prices than where the market settles — we have edge, provable within days, without waiting for long-run P&L variance to resolve. TXLine's de-vigged `Pct` at kickoff IS our closing benchmark. Every strategy below is scored on CLV first, P&L second.

---

## Strategy 1 — CONSENSUS MOVE: StablePrice momentum

**Ground-truth correction.** Phase 0 scanned 14,408,706 free-tier World Cup odds rows and found one source only: `10021:TXLineStablePriceDemargined`. V1 cannot classify named bookmakers or claim bookmaker leader-lag. The former STEAM strategy is replaced by an honest consensus-momentum strategy.

**Hypothesis.** TXLine StablePrice aggregates and de-margins operator prices. When that consensus makes an unusual, persistent move and Polymarket has not incorporated it, the remaining cross-venue gap may be captureable before Polymarket converges.

**Mechanics.**
1. Maintain normalized StablePrice `Pct / 100` per outcome and market line.
2. Detect an unusual directional regime shift with EWMA velocity plus one-sided CUSUM.
3. Require persistence across updates, no fresh score-event explanation, fresh feeds, and a Polymarket price still lagging the new consensus.
4. `CONSENSUS_MOVE` emits the move magnitude, age, persistence, event context, and remaining cross-market gap.
5. Momentum enters only on an executable live Polymarket ask below the new fair-value boundary; sampled historical prices are research proxies, never executable quotes.

**Parameters to tune in the gate:** velocity z-score, CUSUM drift/threshold, persistence, minimum post-cost gap, maximum chase, TTL, and continuation/reversal horizon.

**Failure modes:** StablePrice batching or timestamp semantics masquerading as a move; public news already priced by Polymarket; consensus reverses; feed reconnect catch-up creates false velocity; the observed historical price was not executable.

**Claude's role:** for pre-match cases with enough TTL, classify plausible cause (lineup/news/information/noise) and determine whether the thesis survives current book depth. Claude is not in the in-play hot path.

---

## Strategy 2 — XMARKET: cross-market divergence (TXOdds consensus vs Polymarket)

**Hypothesis.** Polymarket World Cup prices are set substantially by retail flow and narrative; TXOdds de-vigged sharp consensus is a better probability estimate. When they diverge beyond costs, buy the cheap side on Polymarket.

**Mechanics.**
1. Map TXLine fixture+market ↔ Polymarket condition for v1 Match Result and full-time combined-goals totals only.
2. Compute `edge = consensus_Pct − polymarket_mid`, adjust for Polymarket fees + expected slippage from book depth.
3. `XMARKET_DIVERGENCE` fires above a gate-fitted threshold after persistence and consensus-stability checks. No 3–4 point number is frozen before measurement.
4. Sizing by fractional Kelly on the adjusted edge.

**Special case — the in-play repricing-lag hypothesis.** In the seconds after a goal/red card, stale resting orders may briefly remain on Polymarket. Phase 0.5 did not prove this: historical Polymarket data is one-minute sampled `t,p` history without books. `STALE_QUOTE` is therefore a Layer-1 paper measurement only in v1, using synchronized TXLine SSE + live Polymarket books. It cannot place real orders.

**Failure modes:** the divergence is *us* being wrong (Polymarket sometimes leads on news TXOdds models haven't ingested — check `UNEXPLAINED_MOVE` on the Polymarket side too); resolution-rules mismatches (Polymarket settlement terms vs bookmaker market definitions — e.g. extra time handling in knockout matches: Match Result 90-min vs to-advance markets. **Every market mapping must be settlement-verified before it's tradeable.** This is a known killer of naive arbs).

**Claude's role:** settlement-rules verification at mapping time (read the Polymarket market description, compare against market period semantics); divergence cause analysis pre-trade.

---

## Strategy 3 — MODELER: in-play model vs market

**Hypothesis.** A live goal-intensity model (Poisson/Dixon-Coles family), initialized from pre-match consensus and updated on score events + elapsed time, produces probabilities that occasionally disagree with in-play market prices — especially in emotionally charged states (favorite trailing early, red cards, late-game desperation) where retail flow distorts prices.

**Mechanics.**
1. Pre-kickoff: back out implied team-strength parameters from the market itself (1X2 + totals de-vigged consensus → expected goals per side). We don't need a better pre-match model than the market — we *inherit* the market's prior. Our edge is in-play state transitions, not pre-match handicapping.
2. In-play: match state = (score, red cards, minute, period). Model gives P(home/draw/away), P(over/under line) at every minute. Corners/cards optionally feed intensity adjustments.
3. `MODEL_MARKET_GAP` fires when |model − market| exceeds threshold with stable model inputs (i.e., not mid-repricing after a goal).

**Honest assessment:** hardest strategy of the four; bookmaker in-play models are excellent, so we mostly won't beat *them* — the target is again the slower venue (Polymarket in-play), using the model as our independent fair-value anchor. Kept in v1 because it's also the calibration engine (Brier-scored continuously) and demo-visible (live fair-value line vs market on the dashboard).

**Failure modes:** model miscalibration (measure Brier from replay before trusting it); the market knows something the score doesn't show (injury on pitch, momentum) — mitigated by capping MODELER stakes below the other strategies.

---

## Strategy 4 — FADER: fade unconfirmed retail moves

**Hypothesis.** Prediction-market prices can overreact to narrative (big-name teams, social sentiment, "everyone knows" picks) without StablePrice confirmation. When Polymarket moves and TXLine StablePrice does not follow within a fitted window, the move may be retail noise worth fading toward consensus.

Effectively the mirror image of CONSENSUS_MOVE, sharing its infrastructure: `Polymarket velocity high + StablePrice flat + no score event → FADER_CANDIDATE`. Mean-reversion sizing and tight invalidation apply; if StablePrice later follows, the move may have been information rather than noise.

**Deborah field observations (July 10).** SportyBet retail flow clusters around famous teams and "fun" event markets: big-club straight wins even at very low odds, Over 2.5 goals for high-scoring teams, corners overs for attacking teams, and booking/card overs in high-tension derbies. Lineup/news discipline is a separator: professional bettors check missing stars before backing the big side, while casual flow may underreact. SportyBet itself locks markets for seconds after goals and reopens with updated prices, so this is NOT a plan to beat SportyBet in-play. Use these observations as priors for Polymarket FADER/XMARKET triage: look for public-favorite, overs, corners/cards-style narratives moving without TXLine confirmation, then require measured divergence before any trade.

**Why it's in v1:** near-zero extra build cost, and its performance against Momentum in the tournament is exactly the empirical strategy selection the system exists to demonstrate.

---

## Risk framework (non-negotiable layer)

- **Fractional Kelly.** Stake = bankroll × kelly_fraction × edge/odds, with kelly_fraction ≤ 0.25 (quarter-Kelly) — full Kelly is ruin-adjacent under estimation error, and our edges ARE estimates. Per-trade hard cap regardless of formula output.
- **Exposure caps:** per fixture, per market type, per strategy, per day. Correlated-position rule: positions on the same fixture across markets count toward one bucket.
- **Real-money gates (execution = BOTH paper and real, per decision):** $50 total bankroll ceiling; no more than $15 aggregate live exposure initially; pre-match only; thesis + deterministic rules + risk judgment + human-confirmed mapping required. Per-trade and drawdown caps are frozen at the Phase-3 review. If Polymarket's minimum order exceeds any cap, Samaritan does not trade.
- **Drawdown circuit breakers:** strategy paused at X% paper drawdown; real-money halted entirely at Y% — X, Y to be agreed.
- **No martingale, no chasing, ever.** Stake sizing is a pure function of (edge, bankroll); losses don't change the function.

## Scoring & calibration

| Metric | What it tells us | Cadence |
|---|---|---|
| **CLV (bps vs close)** | Do we have edge, at all | Per trade, aggregated daily |
| **Brier score** | Are our probabilities calibrated | Continuous (model + thesis `fair_prob`) |
| **Paper P&L + max drawdown** | Does edge survive costs | Per strategy, daily |
| **Detector precision/recall** | Are signals worth Claude's time | From replay + live |
| **Thesis hit rate vs veto rate** | Is the analyst adding value over raw detectors | Weekly review |

---

## Locked scope and remaining gate decisions

- **Build order:** XMARKET → CONSENSUS_MOVE → FADER → MODELER. Shared infrastructure means the first three overlap heavily.
- **Markets:** Match Result + a dynamically selected main full-time combined-goals O/U line only. Capture found the closest-to-50/50 line was 2.5 in 77/98 usable matches, but selection criteria disagreed in 73/100 groups; 2.5 is not hard-coded.
- **In-play:** detect and paper-trade only. Real money is pre-match-only in v1.
- **Historical evidence:** five-minute TXLine + one-minute Polymarket sampled prices supports divergence, convergence, signal CLV, and calibration research—not historical executable-fill claims.
- **Live evidence:** synchronized books are required for spread, depth, repricing-lag, and STALE_QUOTE measurement.
- **Outrights, handicaps, corners/cards, and player props:** deferred.
- **Claude:** $200 operating target, $300 hard project ceiling; triage and degradation enforce it.
- **Harness governance:** concurrency 3, nightly batch post-mortems, Deborah reviews proposed lessons daily.
- **Still decided at the gate:** numeric detector thresholds, dynamic O/U main-line rule, per-trade cap, daily/full drawdown halts, and whether any pre-match edge earns real-money permission.
