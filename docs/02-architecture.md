# 02 — Architecture: The Samaritan Harness

*Design doc, v0.3 (July 14, 2026). Status: target architecture plus an explicitly identified bounty slice.*

> **Implementation boundary:** the bounty build currently ships the canonical live/replay data path, three deterministic detectors, single-turn Haiku triage, a single-turn Opus structured evaluator over a code-assembled signal bundle, deterministic paper risk/execution, a v2 local decision ledger, and offline-safe receipt/anchor tooling. The read-only analyst tools, risk-agent judgment pass, strategy tournament, real-money adapter, Data Doctor, and submitted Solana anchor remain roadmap work and must not be described as implemented.

## Design thesis

**LLMs don't belong in the hot path. They belong in the judgment path.**

Everyone else connecting Claude to a sports API will build: `odds → prompt → "should I bet?" → response`. That fails for three reasons: it's too slow for market-speed events, it's too expensive to run per-tick, and an LLM guessing match outcomes from vibes has no edge. Samaritan inverts it: a deterministic signal core watches every tick and costs ~nothing; Claude is invoked **only when a detector fires**, with real evidence attached, to do what LLMs are actually good at — interpreting *why* a market moved, weighing conflicting context, and writing a structured, auditable trade thesis.

```
                 ┌──────────────────────────────────────────────────────────┐
                 │ LAYER 1 — SIGNAL CORE (pure TypeScript, ms latency)      │
  TXLine SSE ──▶ │ ingestors → event bus → time-series store               │
  odds+scores    │ → feature engine (consensus velocity, divergence,      │
  Polymarket ──▶ │    model-vs-market gap) → DETECTOR BANK → typed signals │
  prices         └───────────────┬──────────────────────────────────────────┘
                                 │ signals (rare, structured)
                 ┌───────────────▼──────────────────────────────────────────┐
                 │ LAYER 2 — REASONING (Claude, invoked on signal only)     │
                 │ triage (Haiku) → analyst (Opus 4.8, bounded bundle)     │
                 │ → structured TRADE THESIS → deterministic paper risk    │
                 └───────────────┬──────────────────────────────────────────┘
                                 │ approved tickets
                 ┌───────────────▼──────────────────────────────────────────┐
                 │ LAYER 3 — EXECUTION & SCORING                            │
                 │ strategy tournament (paper bankrolls, CLV/Brier scored) │
                 │ bounty adapter: PAPER; real CLOB remains gated roadmap  │
                 │ decision ledger → hashed → receipt; anchor is human-gated│
                 └──────────────────────────────────────────────────────────┘
```

---

## Layer 1 — Signal core

**Ingestors.** One SSE client per stream (TXLine odds, TXLine scores), resumable via `Last-Event-ID`, gzip on, auto-reconnect with history backfill from the snapshot/updates endpoints (the SSE-has-no-replay problem is solved by fetch-then-dedupe on reconnect). A Polymarket V2 public WebSocket ingestor streams books, price changes, best bid/ask, and trades for mapped World Cup markets while rolling discovery adds later fixtures. Historical adapters read the rescued five-minute TXLine and one-minute Polymarket archives.

**Event bus.** Every inbound message is normalized to a canonical event: `{source, fixtureId, market, ts, payload}`. Live mode and replay mode emit the *same* event types onto the *same* bus — this single decision is what makes backtesting honest (strategies literally cannot tell replay from live).

**Mapping registry.** TXLine fixture IDs and Polymarket conditions are joined only through an evidence-bearing registry: participant aliases, both kickoff timestamps, market type/line, and full rules text. Duplicate or rescheduled fixtures remain explicit records; there is no nearest-name/time fallback. Automated discovery creates candidates, never tradeable mappings.

Polymarket Match Result is represented as three binary conditions per match (home Yes, draw Yes, away Yes), not one native 3-way token. Canonical 1X2 groups those three Yes outcomes under one market key; their No tokens remain captured for consistency/cost checks but are never double-counted as additional 1X2 outcomes. Full-time totals use the captured Over/Under outcome pair for an exact line.

**Time-series store.** Append-only per-(fixture, market, source) series: TXLine StablePrice, normalized `Pct` probabilities, Polymarket sampled history/live books, and score events. Phase 0 found one TXLine source (`TXLineStablePriceDemargined`), not named bookmakers. SQLite/DuckDB is enough at this scale; no infra heroics.

**Feature engine.** Rolling computations per market:
- probability velocity & acceleration (Δ`Pct` over 1m/5m/15m windows)
- StablePrice regime shifts and persistence (EWMA + CUSUM)
- consensus-vs-Polymarket spread (fee-adjusted)
- Polymarket-only velocity while StablePrice is flat (retail-move/FADER context)
- model-vs-market gap (in-play goal model probability vs market probability)
- score-event context flags (did a goal/red/corner burst explain this move?)

**Detector bank.** Pure functions over features → typed signals with evidence attached. Initial detectors (full specs in the [strategy playbook](03-strategy-playbook.md)): `CONSENSUS_MOVE` (TXLine StablePrice moved and Polymarket has not), `XMARKET_DIVERGENCE` (persistent gap while StablePrice is stable), `FADER_CANDIDATE` (Polymarket moved while StablePrice did not), `MODEL_MARKET_GAP`, and `STALE_QUOTE` (score event happened and a live venue did not reprice). Detection math uses EWMA z-scores and CUSUM; BOCPD remains v1.1. Named-bookmaker leader-lag is explicitly not a v1 claim.

---

## Layer 2 — Claude reasoning

**Triage agent — `claude-haiku-4-5`.** First contact for every signal: dedupe (the same move seen through multiple outcomes = one case), classify against known context, kill obvious noise. Cheap enough to run on every signal. Output: drop / escalate, with a one-line rationale.

**Analyst agent — implemented bounty slice.** `claude-opus-4-8` receives the strict triage decision plus one code-assembled detector signal/evidence bundle and may emit only `submit_thesis`. It has adaptive thinking, fixed input/output/time bounds, schema validation, identity checks, deterministic timestamps, and append-only cost accounting. It does **not** currently expose `query_series`, `get_match_state`, `web_search`, `get_polymarket_book`, or episodic-search tools. Those remain a post-bounty extension unless implemented and demonstrated before release.

**Trade thesis (strict schema — this is the API between AI and money):**
```
{ schemaVersion, signalId, fixtureId, marketKey, outcome, direction,
  recommendation: "paper_trade" | "no_trade", fairProbability,
  thesisSummary, evidenceFor[], steelmanAgainst, invalidationConditions[],
  submittedAtTsMs, expiresAtTsMs, analystModel }
```
No thesis, no trade. The thesis contains no stake, order, venue credential, wallet, or execution field; deterministic code downstream owns the paper stake and every execution decision. Free text never becomes an order.

**Risk manager — separate agent + hard-coded rule layer, veto power.** Deliberately adversarial split: the agent that wants the trade never sizes the trade. Two-stage: (1) deterministic hard rules that no LLM can override — max exposure per fixture, per strategy, per day; fractional Kelly cap; correlation limits (no stacking correlated positions across a match's markets); real-money kill switch; (2) an agent pass for judgment calls (does this thesis actually support this size? is the invalidation condition checkable?). Rejections are logged with reasons — they're training data for the playbook.

**Token economics.** Signals, not ticks, hit Claude — expected tens of Opus calls per match day, not thousands. Static strategy context + tool defs go in the cached prompt prefix; per-case evidence rides after the cache breakpoint.

---

## Layer 3 — Execution, tournament, ledger

**Strategy tournament (agent-vs-agent).** Strategy personas run in parallel on the same signal stream, each with an isolated paper bankroll: `Momentum` (follow confirmed StablePrice regime moves into lagging Polymarket prices), `Fader` (fade Polymarket moves StablePrice did not confirm), `Arb` (persistent cross-market divergence capture), `Modeler` (in-play model-vs-market). Personas differ in signal consumption and analyst instructions — same harness, different priors. Continuous scoring: **CLV**, **Brier score**, realized paper P&L, and drawdown. A head-trader loop reallocates virtual capital toward what's working; paper capital only in v1.

**Execution adapters — one interface, three implementations:**
1. `PaperAdapter` — fills at observed market price + modeled slippage; always available; the replay-mode default.
2. `PolymarketAdapter` — real orders via CLOB **V2** SDK. Real-money flow is gated: only pre-match theses that pass both risk stages, carry `venue: polymarket`, use a human-confirmed mapping, and fit within every bankroll/exposure/minimum-order constraint. Kill switch halts it globally. If no valid order fits, no trade is the correct output.
3. `ReplayAdapter` — used by the backtest runner; fills against historical series.

**Decision ledger + on-chain anchoring.** Every thesis, veto, fill, and outcome is an append-only ledger row. The target proof path hashes a versioned canonical record and writes the verified segment head to Solana, while inbound TXLine evidence is spot-validated where the official proof endpoints permit it. Local hash-chain integrity, deterministic replay parity, and external timestamping are reported as distinct guarantees. None of them alone is called proof of alpha; profitability requires separate valid evidence.

**Replay/backtest harness.** The rescued archive supplies five-minute TXLine odds/scores plus one-minute Polymarket sampled prices. The replay engine re-emits normalized records onto the same bus as live data; the stack runs unchanged. Historical Polymarket `t,p` points have no bid/ask/depth and therefore support signal/CLV research with conservative cost proxies, not claims of executable fills. Synchronized live books provide the spread/depth evidence. Outputs: per-strategy signal CLV, conservative simulated P&L, detector precision/recall, and calibration plots.

**Ops watchdog ("Data Doctor" — credit: rival memo).** A cheap scheduled agent pass over feed health: SSE gap detection, schema drift vs the OpenAPI spec, latency measurements (event `Ts` vs receive time), missing-fixture checks. Trading halts automatically on feed degradation — a trading system that doesn't know its data is bad is a donation machine.

**Demo constraint (binding, from verified hackathon terms):** judges must be able to evaluate with **zero cost and zero wallets** — so the submission surface is a hosted dashboard with our TXLine credentials server-side, a bundled replay dataset, and read-only access to the live board. The Solana anchoring runs on OUR wallet; judges just see the explorer links.

---

## Stack

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript (Node 22) | Solana web3.js/Anchor (needed for subscription + anchoring), Polymarket V2 SDK, and Anthropic SDK are all TS-first |
| AI | `@anthropic-ai/sdk` — Opus 4.8 (adaptive thinking) + Haiku 4.5; strict tools; structured outputs; prompt caching | Custom loop, purpose-built for the triage→analyst→risk pipeline. Not the coding-agent SDK — this harness IS the product |
| Storage | SQLite (better-sqlite3) or DuckDB | Append-only time series at modest volume; zero infra |
| Bus | In-process typed EventEmitter → upgrade path to Redis streams later | One process is plenty for the World Cup; don't build Kafka for 15 matches |
| Dashboard | Lightweight web UI (live signals, agent reasoning feed, tournament leaderboard, CLV curves) | The demo surface for judges |
| Chain | Solana mainnet (TXLine SL12 subscription + ledger anchoring), devnet for integration tests | Decision locked |

## Post-hackathon path

Same harness, three swaps: (1) TXLine paid tiers → club football year-round (USDT-priced, quote endpoint already mapped); (2) more venues behind the adapter interface (other prediction markets; booking-code output for NG bookmakers is a possible consumer layer); (3) the tournament grows strategies — the harness is the moat, strategies are cattle.

## Locked v1 operating decisions

1. Real money is pre-match only; all in-play signals are paper/live-measurement only.
2. Market scope is Match Result + dynamically selected main full-time Over/Under. Handicaps and micro-markets are deferred.
3. Automated mapping creates candidates only. Deborah must confirm teams, kickoff, market period, and full resolution text before a mapping is tradeable.
4. Real-money bankroll ceiling is $50 with at most $15 aggregate live exposure initially. Per-trade and drawdown caps are set at the Phase-3 gate; Deborah owns the manual kill switch.
5. Head-trader capital reallocation is paper-only in v1.
6. Claude spend targets $200 and may never exceed the $300 project ceiling.
