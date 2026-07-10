# SAMARITAN — Build Plan

*v1.1, July 10, 2026. Ground truth captured; strategies corrected to CONSENSUS_MOVE, XMARKET, FADER, MODELER. Deadline: submission **July 18** (one-day buffer before the July 19 close, which is also World Cup final day).*

## The one-line mission

Ship a live, replayable, risk-gated sports trading system on TXLine World Cup data — paper + gated Polymarket execution — with a verifiable on-chain track record by July 18.

## Non-negotiables (from research + legal terms)

1. **The Gate:** no real money moves until the group-stage replay study (Phase 3) is complete and reviewed.
2. **Judge access:** hosted demo, zero cost, zero wallets for judges. Credentials live server-side.
3. **Submission framing:** Deborah is the participant; Samaritan is her product that uses Claude. Never framed as "AI-built."
4. **Real money is pre-match only in v1.** In-play signals trade on paper until loop latency is measured.
5. **No bookmaker scraping/automation. Ever.** TXLine + Polymarket APIs only.
6. **Replay and live share one code path.** If a strategy behaves differently in replay vs live, that's a bug, not a feature.

---

## Phases

### Phase 0 — Access & ground truth (complete Jul 10)

The docs only tell us so much; now we touch the real thing.

- [x] Guest JWT flow working (`/auth/guest/start`)
- [x] Devnet SL1 subscription (integration testing) + **mainnet SL12 subscription (real-time)** — wallet signatures, `/api/token/activate`
- [x] Capture and archive real fixtures, historical odds/scores, and a full mainnet odds+scores SSE match
- [x] Verify price format, `Pct` scale, market taxonomy, World Cup `CompetitionId`, score action envelope, retention, and latency behavior
- [x] Polymarket V2 public-market smoke test: metadata, rules, tick/fee fields, order book
- [x] Confirm human-participant framing: Deborah is the participant; AI development assistance and Claude as a product component are allowed

**Exit criteria:** a `samples/` directory of real payloads + a short WHAT-WE-GOT-WRONG.md correcting any doc-vs-reality gaps.

### Phase 0.5 — Polymarket history rescue (complete Jul 10)

- [x] Discover 799 World Cup match-family records across 100 unique matches
- [x] Capture 300 Match Result + 861 full-time totals conditions: 2,320 non-empty tokens, 90,795,313 sampled price points
- [x] Produce research-only TXLine↔Polymarket candidates for 98/102 captured TXLine fixtures; no mapping marked tradeable
- [x] Build resumable public Polymarket WebSocket recorder with rolling market discovery and paired TXLine capture mode
- [x] Split ordinary SSE delivery from reconnect catch-up, replay, outage, and clock-skew observations

**Exit criteria met:** pre-match XMARKET/FADER/CLV research is unblocked. Historical prices are sampled `t,p` series, not executable bid/ask archives; STALE_QUOTE remains blocked on synchronized live evidence.

### Phase 1 — Data backbone (complete Jul 10)

- [x] Initialize the project Git repository before product code; retain `.gitignore` protections for secrets and licensed raw captures
- [x] Install/pin Node 22 (`.nvmrc` + `engines`), then scaffold the strict TypeScript/pnpm/vitest workspace; do not build Phase 1 under the currently active Node 24 runtime
- [x] Auth/session manager (expiry detection + injectable reactivation lifecycle on both networks; do not invent an undocumented refresh endpoint)
- [x] SSE clients: odds + scores, auto-reconnect, `Last-Event-ID` resume, gzip, reconnect backfill via snapshot+dedupe
- [x] Canonical event bus (typed, in-process) — **live and replay emit identical event types**
- [x] Append-only raw/canonical journals + SQLite/DuckDB time-series store
- [x] Import/normalize the rescued TXLine + Polymarket archives without copying raw licensed data into public assets
- [x] Polymarket ingestor: V2 public market WebSocket + mapped-market books/mids into the same bus; rolling fixture/market discovery
- [x] Mapping registry with explicit aliases, kickoff/rules evidence, duplicate-outcome rejection, and no nearest-name/time fallback

**Exit criteria:** live ticks flow through the canonical bus, and the rescued archive replays through that same bus without strategies detecting live versus replay mode.

### Phase 2 — Probability, features, detectors, replay (Jul 11–13)

- [x] Normalization: `market_key = fixtureId + oddsType + period + parameters`; probability space everywhere; use TXLine `Pct` as fair-prob source, compute our own de-vig as cross-check
- [x] Feature engine foundation: TXLine StablePrice velocity and CUSUM state, consensus-vs-Polymarket spread, Polymarket-only velocity, score-event context, feed freshness (acceleration is the next derived feature)
- [ ] Detector bank v1: `CONSENSUS_MOVE`, `XMARKET_DIVERGENCE`, `FADER_CANDIDATE`, `MODEL_MARKET_GAP`, `STALE_QUOTE` (paper/live measurement only)
- [x] Replay engine: timestamp-merge and re-emit historical sources onto the bus at configurable speed
- [ ] Detector metrics harness: precision/recall vs labeled score events

**Exit criteria:** detectors firing sensibly on replayed group-stage matches, with dashboards-in-terminal output.

### Phase 3 — THE GATE: cross-market & calibration study (Jul 13–14)

The mandatory study before any real-money trading. Deliverable is a written report (`docs/06-gate-study.md`):

- [ ] Historical lane: align 5-minute TXLine StablePrice with one-minute Polymarket sampled prices; measure divergence, convergence, signal CLV, continuation/reversal, and FADER behavior with train/test separation
- [ ] Freeze a dynamic main-full-time-total selection rule from captured evidence; never hard-code O/U 2.5
- [ ] Apply conservative historical fee/spread/slippage proxies and label all historical results as signal research, not executable-fill proof
- [ ] Live lane: use synchronized TXLine SSE + Polymarket books to measure feed availability, event→repricing lag, spread/depth, and STALE_QUOTE feasibility; in-play stays paper-only
- [ ] Tune `CONSENSUS_MOVE`, XMARKET, and FADER thresholds on replay; report precision/recall and sample sizes
- [ ] MODELER calibration baseline: fit the in-play goal model on group stage, report Brier vs market
- [ ] **Go/No-Go review with Deborah:** which pre-match edges are real; set per-trade and drawdown caps within the locked $50 bankroll / $15 initial aggregate-exposure ceiling

**Exit criteria:** signed-off study; thresholds frozen for v1; real-money numbers agreed and written into config.

### Phase 4 — Claude reasoning layer (Jul 14–15)

- [ ] Trade-thesis schema (strict) — the only bridge from AI to money
- [ ] Triage agent (Haiku 4.5): dedupe/classify/drop, one-line rationale
- [ ] Analyst agent (Opus 4.8, adaptive thinking, prompt-cached context): tools = `query_series`, `get_match_state`, `web_search`, `get_polymarket_book`, `submit_thesis`
- [ ] Risk manager: deterministic rule layer (caps, quarter-Kelly, correlation buckets, drawdown breakers, kill switch) + agent review pass; veto logged with reasons
- [ ] Decision ledger: append-only record of every signal → triage → thesis → veto/approval → fill
- [ ] Paper execution adapter (slippage-modeled fills)
- [ ] Spend controls: $200 operating target, $300 hard project ceiling; fail to detectors-only mode rather than exceed it

**Exit criteria:** end-to-end on replay — signal fires, Haiku triages, Opus writes a thesis, risk manager rules, paper fill lands, ledger records all of it.

### Phase 5 — Tournament & real execution (Jul 15–16)

- [ ] Four personas live: Momentum(CONSENSUS_MOVE), Arb(XMARKET), Fader, Modeler — isolated paper bankrolls
- [ ] Scoring engine: CLV vs TXLine closing `Pct`, Brier, P&L, drawdown; head-trader reallocation (paper capital only in v1)
- [ ] Polymarket market mapping w/ **settlement-rules verification step** (Claude reads market rules; 90-min vs to-advance semantics checked per market) — human confirm on each mapping
- [ ] `PolymarketAdapter` (V2): real orders, **pre-match markets only**, hard bankroll cap from Phase 3 numbers, global kill switch (manual, Deborah's)
- [ ] Real-money dry run only if the gate approves, mapping is human-confirmed, and Polymarket's minimum order fits every cap; otherwise record an explicit fail-closed no-trade

**Exit criteria:** tournament running on replay/live data; any eligible real fill is correctly ledgered, while absence of a qualifying trade is an acceptable and visible no-trade outcome.

### Phase 6 — On-chain proof & dashboard (Jul 16–17)

- [ ] Ledger anchoring: hash ledger segments → Solana memo tx per match/hour; explorer links surfaced
- [ ] Merkle spot-validation of TXLine data we acted on (validation endpoints)
- [ ] Dashboard (the judge surface): live board, signal tape, agent reasoning feed (triage→thesis→veto visible), tournament leaderboard, CLV/calibration curves, verification panel (message IDs, proofs, anchor txs)
- [ ] Hosted deployment: credentials server-side, judges get a URL, read-only

**Exit criteria:** a stranger with a link can watch Samaritan think during a live match.

### Phase 7 — Live fire & submission (Jul 17–18)

- [ ] Run live through semifinals; capture the best sequences
- [ ] Demo video: replay proof (group stage CLV curves) → live signal → agent debate → risk veto/approval → fill → on-chain anchor
- [ ] Submission writeup: what it is, what's measured, what's verifiable; framing per legal terms
- [ ] **Submit July 18.** July 19 (final day) is buffer + live victory lap, not crunch.

---

## Risk register

| Risk | Mitigation |
|---|---|
| TXLine free tier has no named bookmakers | Momentum is consensus-regime detection; no v1 claim of bookmaker leader-lag |
| Historical Polymarket prices are non-executable samples | Conservative research fills only; live books establish executable spread/depth behavior |
| Polymarket integration changes | V2-only adapter; paper is the always-working fallback |
| Few live matches left | Rescued replay data carries the demo; remaining matches provide synchronized microstructure evidence |
| Loop too slow for in-play edges | In-play is paper-only in v1 by design; latency measured, not assumed |
| Claude API spend | Triage-first funnel; Haiku screens everything; Opus only on escalation; prompt caching on static context |
| Feed degradation mid-match | Data Doctor watchdog auto-halts trading |
| Mapping/settlement mismatch | Research candidates are never tradeable; rules verification + human confirmation per live market |

## Locked and pending from Deborah

- **Locked:** Match Result + dynamic main full-time O/U only; Claude $200 target/$300 hard ceiling; $50 total bankroll; $15 maximum initial aggregate live exposure; daily lesson review; concurrency 3; nightly batch post-mortems.
- **Pending at Phase 3:** per-trade cap and drawdown halts; approval of any real-money edge.
- **Pending per live mapping:** human confirmation of teams, kickoff, market period, and full Polymarket rules text.
