# 04 — Algorithm Specification

*v0.2 (July 10, 2026). Status: DESIGN LOCKED TO CAPTURED DATA — every named constant marked `θ_*`, `z*`, `T`, `h`, `k` is a FREE PARAMETER fitted in the Phase-3 gate study, never hand-picked.*

## 0. Common substrate

**Probability space.** Everything internal is probability ∈ (0,1). Sources:
- `C_o(t)` — TXLine StablePrice de-vigged fair probability for outcome `o`: captured `Pct` string divided by 100. Phase 0 found only `10021:TXLineStablePriceDemargined`, so `C` is the v1 consensus source rather than a weighted median across named books.
- `C'_o(t)` — our independent de-vig of captured integer `Prices / 1000`, used as a data-quality cross-check. A gate-fitted discrepancy tolerance raises a feed alert; it does not silently replace `C`.
- `PM_hist,o(t)` — Polymarket one-minute sampled historical `t,p`. It has no bid, ask, size, or spread and is never called executable.
- `PM_mid,o(t)`, `PM_ask/bid_o(t)`, `D(t)` — live Polymarket midpoint, executable prices, and visible book depth.

**Polymarket outcome grouping.** Match Result uses the Yes token from each of three binary conditions (home/draw/away) as the canonical 1X2 vector; No tokens are validation/alternate-execution instruments, not three more outcomes. Totals use the exact-line Over and Under tokens. Probability-sum checks occur after grouping, never across all six Match Result tokens.

**Event clock.** All series keyed by exchange timestamp `Ts` (TXLine) / venue timestamp (Polymarket); receive-time recorded separately → `latency = t_recv − Ts` is itself a monitored series (feeds Data Doctor + the in-play go/no-go).

**Rolling statistics.** For any series `x(t)`: EWMA mean `μ_λ(t)` and EWMA std `σ_λ(t)` with half-lives λ ∈ {1m, 5m, 30m}. Velocity `v_w(t) = x(t) − x(t−w)` over windows `w` ∈ {60s, 300s, 900s}. Z-scores `z_w(t) = (v_w(t) − μ) / σ` are the universal “is this move unusual?” unit—normalized per source and market, because a 2-point move in a 1X2 favorite is not the same event as a 2-point move in an O/U 3.5.

**Score-event context.** `E(t)` = set of score events (goal, red, penalty…) in window `[t−T_e, t]`. Every detector conditions on it: a move *with* a fresh goal is repricing; a move *without* one is information or noise — different signals entirely.

---

## 1. CONSENSUS_MOVE — StablePrice regime shift

**Signal definition.** TXLine StablePrice makes an unusual, persistent directional move while Polymarket has not fully incorporated the new consensus. This is consensus momentum, not named-bookmaker steam.

**Trigger (all conditions AND):**
1. `|z_C,o,w(t)| > z*` in one direction over a gate-selected window.
2. One-sided CUSUM confirms persistence: `S(t) = max(0, S(t−1) + (signed ΔC_o(t) − k))`; `S(t) > h`.
3. The move spans at least the gate-selected number/duration of unique first-delivery updates; reconnect/bootstrap catch-up frames cannot create a signal.
4. `E(t) = ∅` for pre-match/information moves. Score-explained moves are routed to event-repricing measurement instead.
5. The live executable Polymarket price still leaves post-cost directional gap `e_exec > θ_cm`. Historical replay substitutes `PM_hist` and labels the result signal-only.
6. Both feeds pass freshness and latency-health checks.

**Output payload:** direction, `ΔC`, velocity/CUSUM evidence, move age, feed-health state, event context, Polymarket response so far, and remaining live executable gap when available.

**Trade logic (Momentum persona):** pre-match only; enter at a human-confirmed mapped venue price that stays behind the new StablePrice boundary. Never chase past `C_new − θ_chase`; expire if Polymarket reprices, consensus reverses, mapping changes, or TTL ends.

## 2. XMARKET_DIVERGENCE — consensus vs Polymarket

**Executable edge** (the only edge that matters):
```
e_exec,o(t) = C_o(t) − PM_ask,o(t) − fees − slip(D(t), stake)
```
(buying `o` on PM; symmetric with bids for selling). `slip()` = walk the visible book for our stake size.

**Trigger (AND):**
1. `e_exec > θ_x` — fee/slippage-adjusted edge above a gate-fitted threshold.
2. Persistence: condition 1 held for ≥ `τ` seconds (kills one-tick phantoms from feed jitter).
3. Consensus stability: `|z_C,60s| < z_stable` — consensus is not mid-move. A moving StablePrice routes to CONSENSUS_MOVE instead of XMARKET.
4. Settlement-verified mapping: the (TXLine market ↔ PM condition) pair carries a `settlement_verified: true` flag (see harness doc — Claude verifies rules text at mapping time, human confirms). **Unverified mappings are untradeable, period** — 90-minutes-vs-advance mismatches are the classic arb-killer.

**Direction-of-blame check** (is PM slow, or did PM move first?): compare recent information flow. If PM moved first and StablePrice later drifts toward it, do not trade XMARKET; log `PM_LEADS` for study.

**Replay limitation:** substitute `PM_hist` for executable price, apply conservative fee/spread/slippage proxies, and score signal convergence/CLV separately from simulated fills. Historical results may not claim fillability.

## 3. STALE_QUOTE — post-event stale orders (in-play; paper-only in v1)

**Setup.** Score event `E` at `t0` (goal or red card — the two largest instant repricers). Model jump: `Δp_model = p_model(post-state) − p_model(pre-state)` from MODELER's state machine (available instantly — it's a lookup on the fitted state grid, no fitting at trade time).

**Trigger:** at `t0 + δ`: the synchronized live PM book still shows resting orders within `θ_stale` of pre-event prices, size ≥ `s_min`, on the side that the event moved against. `δ` is fitted from live evidence, never assumed to be single-digit.

**Expected capture:** `Δp_model − fees` per unit lifted. This is a Layer-1-only signal — no agent in the loop per instance; the *class* of trade is pre-authorized by standing risk rules (max size per event, max events per match). v1: paper, with full latency accounting, to measure whether our loop is fast enough to ever do it live.

## 4. FADER — fade unconfirmed retail moves

**Overreaction score:** `O(t) = z_PM,w(t) − z_C,w(t)` — PM moving hard while consensus sits still.

**Trigger (AND):** `|z_PM,w| > θ_f`; `|z_C,w| < z_stable`; `E(t) = ∅`; and PM order-flow direction consistent with retail chase (price moving *away* from consensus, not toward it).

**Trade logic:** enter fade toward `C`, target = consensus, stop = StablePrice confirming the PM move (CUSUM on `C` fires in PM's direction within `T_confirm` → exit and log the case as CONSENSUS_MOVE evidence).

## 5. MODELER — in-play fair value

**Pre-match calibration (per fixture, minutes before kickoff):** invert the market. From de-vigged 1X2 `(p_H, p_D, p_A)` and O/U main line total, solve for goal intensities `(λ_H, λ_A)` and draw-inflation `ρ` such that a Dixon-Coles-adjusted Poisson reproduces the market's probabilities. We inherit the market's team assessment — our edge is never pre-match handicapping, only state-transition speed and crowd-distortion moments.

**In-play state:** `s(t) = (score_diff, total_goals, red_H, red_A, minute, period)`. Remaining-goal intensities: `λ'_i(t) = λ_i × g_time(t) × g_state(s)` where `g_time` = fitted within-match intensity curve (goals cluster late) and `g_state` = fitted multipliers (trailing team pushes, shorthanded team suppressed, leading team shells). All `g_*` fitted on the group-stage archive in the gate study — NOT hand-set.

**Outputs at every tick:** `p_model` for 1X2 and totals via Skellam/Poisson tails on remaining goals.

**Trigger:** `|p_model − p_market| > θ_m`, model inputs fresh (no un-ingested score event), AND **calibration certificate valid** — rolling Brier score of `p_model` vs settled outcomes within tolerance of the market's own Brier. Certificate expires → MODELER signals disabled automatically until recalibrated. A model that has drifted doesn't get to have opinions.

## 6. Position sizing — one function for everything

```
edge_shrunk = e_exec × shrink(confidence, n_similar_cases)   # never trust raw edge
f_kelly     = edge_shrunk / net_odds
stake       = bankroll × min(f_kelly × 0.25, f_max)          # quarter-Kelly, hard cap
```
`shrink()` pulls the edge toward zero when the analyst's confidence is low or the historical sample of similar cases is thin (exact form fitted in the gate). Correlation rule: all positions on one fixture share one exposure bucket—a Match Result position plus a totals position is one underlying match risk wearing two hats.

## 7. Scoring — the fitness functions

- **CLV per trade/signal:** `clv = p_close − p_entry` (in probability points; also reported in bps). For a historical sampled-price case this is explicitly **signal CLV**, not executable trade CLV. Live/paper cases use captured executable book prices plus costs. `p_close` is TXLine StablePrice at kickoff for pre-match cases. Positive mean CLV with `n>30` is a necessary promotion criterion, never sufficient by itself.
- **Brier** for every probability anyone (model or analyst thesis `fair_prob`) commits to record: `(p − outcome)²`, aggregated per source. Calibration curves per decile.
- **Detector precision/recall** vs post-hoc labels (did consensus follow within T? did PM converge?). A detector below precision floor gets its thresholds retuned or is benched — signals cost Claude tokens; noisy detectors are budget leaks.

## 8. What is deliberately NOT in v1

Named-bookmaker STEAM/leader-lag (the free tier does not expose the data). Market-making mode (Avellaneda-Stoikov quoting on PM). Handicaps, corners/cards, player props, and outright inference. BOCPD change-point upgrade (CUSUM first). All require evidence or infrastructure v1 does not have.
