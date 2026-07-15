# SAMARITAN — Build Plan

*v1.2, July 15, 2026. Ground truth captured; strategy designs corrected to CONSENSUS_MOVE, XMARKET, FADER, MODELER. The bounty release is paper-only, the complete lifecycle proof uses deterministic model stubs, and the current receipt is unanchored. Deadline: submission **July 18** (one-day buffer before the July 19 close, which is also World Cup final day).*

## The one-line mission

Ship a live/replay-capable, risk-gated paper sports-trading system on TXLine World Cup data with independently verifiable local decision evidence by July 18. Real-money execution and Solana submission remain separately human-gated roadmap items, not bounty-release claims.

## Non-negotiables (from research + legal terms)

1. **The Gate:** no real money moves until the group-stage replay study (Phase 3) is complete and reviewed.
2. **Judge access:** hosted demo, zero cost, zero wallets for judges. Credentials live server-side.
3. **Submission framing:** Deborah is the participant; Samaritan is her product that uses Claude. Never framed as "AI-built."
4. **The bounty build is paper-only.** Any later real-money path would be pre-match only and remains blocked by the Phase 3 gate plus Deborah's explicit authority; in-play signals stay paper-only until loop latency is measured.
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
- [x] Adopt the conservative human-participant framing: Deborah is the participant, product decision-maker, narrator, reviewer, and submitter; Claude is only a bounded product component and development aid
- [ ] Retain written sponsor clarification before relying on any broader interpretation of the hackathon AI clause or public derived-data display rights

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
- [x] Feature engine foundation: TXLine StablePrice velocity and acceleration, EWMA/CUSUM state, consensus-vs-Polymarket spread, Polymarket-only velocity, score-event context, and feed freshness
- [ ] Detector bank v1: `CONSENSUS_MOVE`, `XMARKET_DIVERGENCE`, `FADER_CANDIDATE`, `MODEL_MARKET_GAP`, `STALE_QUOTE` (paper/live measurement only)
- [x] Replay engine: timestamp-merge and re-emit historical sources onto the bus at configurable speed
- [x] Dynamic main-total research harness: build per-fixture balance/volume/liquidity/coverage evidence and rank exact full-time lines under injected weights; production rule remains unfrozen until Phase 3
- [x] Detector metrics harness: streaming threshold grids, forward convergence/reversal labels, and outage-aware score-event/book latency labels are implemented; Spain-Belgium produced no supporting STALE_QUOTE case, so the detector remains disabled

**Exit criteria:** detectors firing sensibly on replayed group-stage matches, with dashboards-in-terminal output.

### Phase 3 — THE GATE: cross-market & calibration study (Jul 13–14)

The mandatory study before any real-money trading. Deliverable is a written report (`docs/06-gate-study.md`):

- [x] Historical lane: timestamp-align TXLine StablePrice with Polymarket sampled prices; measure divergence, convergence, signal CLV, continuation/reversal, and FADER behavior with chronological train/test separation
- [x] Preserve and suspend the invalidated v1 paper protocol; corrected causal selector and execution timing now exist only in an unregistered v2 engineering candidate pending Deborah sign-off
- [x] Apply conservative historical fee/spread/slippage proxies and label all historical results as signal research, not executable-fill proof
- [x] Live lane: synchronized Spain-Belgium TXLine SSE + Polymarket books measured feed availability, event→repricing lag, spread/depth, and STALE_QUOTE feasibility; 0/18 cases showed a clean post-TXLine stale window, so in-play remains paper-only and STALE_QUOTE stays disabled
- [x] Tune `CONSENSUS_MOVE`, XMARKET, and FADER threshold candidates on training replay; report sealed heldout precision/recall, CLV, market-family attribution, cost sensitivity, and sample sizes without freezing them
- [ ] MODELER calibration baseline: fit the in-play goal model on group stage, report Brier vs market
- [ ] **Go/No-Go review with Deborah:** which pre-match edges are real; set per-trade and drawdown caps within the locked $50 bankroll / $15 initial aggregate-exposure ceiling
- [ ] Run the signed two-lane paper validation in `docs/07-paper-study-preregistration.md` (`$3` stake, `$15` exposure, `$20` rejection stop; executable CLV, match-clustered CI, per-match P&L; real-money gate stays closed)

**Exit criteria:** signed-off study; thresholds frozen for v1; real-money numbers agreed and written into config.

### Phase 4 — Claude reasoning layer (Jul 14–15)

- [x] Trade-thesis schema (strict) — the only bridge from AI to deterministic risk; unknown sizing/order fields are rejected
- [x] Triage agent (Haiku 4.5): bounded strict-tool classify/drop/escalate with one-line rationale
- [x] Analyst agent bounty slice: Opus 4.8 adaptive thinking over a bounded code-assembled signal bundle; strict `submit_thesis` is the only tool/exit
- [ ] Analyst pull-tools extension: `query_series`, `get_match_state`, `web_search`, and `get_polymarket_book` remain unimplemented and are not submission claims
- [ ] Risk manager: signed paper caps/drawdown/market/evidence rules and settled portfolio state are implemented; quarter-Kelly, correlation buckets, global kill switch, and agent judgment pass remain
- [x] Decision ledger: append-only hash-chained record of every signal → triage → thesis → veto/approval → execution intent → paper result
- [x] Paper execution adapter: deterministic limit, post-latency canonical book, depth walking, partial/no fills, per-market fees, micro-unit accounting
- [x] Paper case scheduler/runtime: pre-model lane-specific ledgering, measured wall-clock decision latency mapped to event time, frozen detector/selector config, 15-minute kickoff cutoff, first eligible post-decision canonical book, duplicate suppression, terminal expiry
- [x] Public CLOB execution metadata: cached V2 fee curve, taker-only flag, minimum shares, tick size, condition/token identity; malformed or legacy-only metadata fails closed
- [x] Paper portfolio evidence: actual entry cost, midpoint/executable CLV, settlement P&L/Brier, exposure, equity peak, and drawdown state
- [x] Kickoff/settlement lifecycle: latest canonical pre-kickoff close, public winning-asset resolution, and pre-mutation append-only accounting
- [x] Protocol-configured evidence evaluator: ledger reconstruction, sealed long-run endpoints, per-match rows, 10,000-iteration match-block bootstrap, random-direction control, and guardrails
- [x] Preserve the v1 two-lane zero-observation ledgers as audit history; do not append under the unregistered v2 candidate
- [x] Fixture evidence/readiness gates: paired-book vs sampled-history classification, physical scheduler exclusion, observed-time captured replay merge, and three-hour pre-kickoff capture target
- [x] Semifinal capture candidates: authenticated read-only TXLine refresh, exact France-Spain / England-Argentina cross-source identity, full-time totals rules check, and launch withheld pending human capture-only confirmation
- [x] Semifinal capture schedule: Deborah capture-only confirmation, fail-closed starts three hours pre-kickoff, detached process checks, and post-run canonical replay verification
- [x] Rolling fixture admission: atomic two-lane refresh, verified mapping + paired executable evidence, immutable admitted identity, and pre-Claude research-only rejection
- [x] Evidence artifact writer: ledger-derived JSON + frozen-protocol per-match Markdown table with strict long-run sealing
- [x] Spend controls: shared append-only reservations, $200 operating target, $300 pre-request hard project ceiling, and fail-closed API accounting

**Bounty-slice exit criteria:** the shared replay conductor completes signal → deterministic Haiku-shaped stub → deterministic Opus-shaped stub → hard risk → paper fill → settlement and ledger proof. A real Haiku/Opus replay remains separately blocked until Deborah registers v2 and a fixture passes exact admission.

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
- [ ] Dashboard (the judge surface), implemented against the approved Matchroom v2 dark-hybrid direction in [`docs/UI.md`](docs/UI.md): Command, Matchroom, Decision Rail, Casebook, Study, and Proof; live/replay state, triage -> thesis -> veto/approval, CLV/calibration, and verification remain visibly auditable. Light mode is deferred and non-blocking.
- [ ] Hosted deployment: credentials server-side, judges get a URL, read-only

**Exit criteria:** a stranger with a link can inspect captured evidence and the clearly separated synthetic lifecycle without credentials, a wallet, or private feed redistribution. A current live-Claude case is not required or claimed while v2 is unregistered.

### Phase 7 — Live fire & submission (Jul 17–18)

- [ ] Run live through semifinals; capture the best sequences
- [ ] Demo video: real captured refusal → corrected historical signal evidence → synthetic stubbed lifecycle → offline receipt verification → explicit unanchored/closed-gate boundary
- [ ] Submission writeup: what it is, what's measured, what's verifiable; framing per legal terms
- [ ] **Submit July 18.** July 19 (final day) is buffer + live victory lap, not crunch.

---

## Risk register

| Risk | Mitigation |
|---|---|
| TXLine free tier has no named bookmakers | Momentum is consensus-regime detection; no v1 claim of bookmaker leader-lag |
| Historical Polymarket prices are non-executable samples | Conservative research fills only; live books establish executable spread/depth behavior |
| Polymarket integration changes | V2 public-data and fee integration only in the bounty build; deterministic paper execution is the demonstrated path and no production order adapter is connected |
| Few live matches left | Rescued replay data carries the demo; remaining matches provide synchronized microstructure evidence |
| Loop too slow for in-play edges | In-play is paper-only in v1 by design; latency measured, not assumed |
| Claude API spend | Triage-first funnel; Haiku screens everything; Opus only on escalation; prompt caching on static context |
| Feed degradation mid-match | Data Doctor watchdog auto-halts trading |
| Mapping/settlement mismatch | Research candidates are never tradeable; rules verification + human confirmation per live market |

## Locked and pending from Deborah

- **Locked:** Match Result + dynamic main full-time O/U only; Claude $200 target/$300 hard ceiling; $50 total bankroll; $15 maximum initial aggregate live exposure; daily lesson review; concurrency 3; nightly batch post-mortems.
- **Suspended July 14:** the v1 totals-only paper protocol is preserved but cannot admit new cases after its upstream selector was found to use future information. The `$3` stake, `$15` aggregate exposure, `$20` drawdown rejection stop, and separate ledgers remain historical v1 configuration only until a corrected protocol is signed.
- **Pending after paper ACCEPT:** separate approval of any real-money edge and its real-money caps; paper approval does not carry over.
- **Pending per live mapping:** human confirmation of teams, kickoff, market period, and full Polymarket rules text.
