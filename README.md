# SAMARITAN

**An autonomous sports-trading system.** Deterministic signal algorithms detect market inefficiencies in real time; Claude agents act as the judgment layer; every decision is scored, ranked, and anchored on-chain.

- **Testing ground:** TxODDS "Trading Tools and Agents" bounty — World Cup Hackathon (Superteam Earn / Solana). 16,000 USDT track prize. **Submission deadline: July 19, 2026.**
- **Real mission:** a durable, money-making trading harness for sports and prediction markets. The hackathon is chapter one, not the book.

## Status

**PHASE: PHASE 1 COMPLETE — PHASE 2 SIGNAL CORE STARTED.** The strict Node 22 workspace, canonical event contracts, evidence-bearing mapping registry, TXLine SSE clients, Gamma-refreshed Polymarket WebSocket source, streaming replay adapters, and append-only SQLite/DuckDB stores are implemented. The local research database holds 9,025,361 normalized TXLine outcomes and 85,249,582 mapped Polymarket points. Combined three-source live and two-source archive replay smokes pass. Tonight's synchronized capture supplies Phase-3 microstructure evidence while Phase 2 proceeds.

Phase 2 now has rolling velocity/EWMA/CUSUM features, feed freshness and score context, research-gated `CONSENSUS_MOVE`/`XMARKET_DIVERGENCE`/`FADER_CANDIDATE`, timestamp-merged replay, and classification/Brier/CLV metric primitives. Numeric thresholds remain deliberately unset outside explicit test configuration until the Phase-3 gate.
Decisions locked so far:

| Decision | Choice |
|---|---|
| Execution modes | **Both** — paper trading (verifiable ledger) AND real-money Polymarket execution |
| Wallets | Solana mainnet wallet ready (for free real-time data tier); devnet also for testing |
| Data source | TXLine (TxODDS) — free World Cup tier, Service Level 12 (real-time, mainnet) |
| v1 markets | Match Result + dynamically selected main full-time Over/Under only |
| Signal source reality | Free tier exposes `TXLineStablePriceDemargined` consensus, not named bookmakers; Momentum uses `CONSENSUS_MOVE`, not bookmaker leader-lag |
| AI | Claude — Opus 4.8 (analysis), Haiku 4.5 (triage); custom harness, NOT a prompt template |
| Claude budget | $200 operating target; $300 hard project ceiling |
| Real-money envelope | $50 bankroll ceiling; $15 maximum aggregate live exposure initially; per-trade/drawdown caps set at the Phase-3 gate |
| Stack | Node 22 + strict TypeScript/pnpm/vitest; SQLite + DuckDB |

## Docs

| Doc | What's in it |
|---|---|
| [docs/01-research.md](docs/01-research.md) | Everything verified about the bounty, the TXLine API, Polymarket, and the competitive landscape |
| [docs/02-architecture.md](docs/02-architecture.md) | The three-layer harness design: signal core → Claude reasoning → strategy tournament |
| [docs/03-strategy-playbook.md](docs/03-strategy-playbook.md) | The edges, the math, the risk framework — and the open questions we're discussing before building |
| [docs/04-algorithms.md](docs/04-algorithms.md) | The detector math: trigger conditions, free parameters, sizing, scoring — the spec the gate study fills with numbers |
| [docs/05-harness.md](docs/05-harness.md) | The agent harness machine room: case lifecycle, context assembly, two-speed deliberation, memory stores, hooks, budgets |
| [docs/PHASE-1-STATUS.md](docs/PHASE-1-STATUS.md) | Implemented backbone contracts, verification evidence, and the remaining Phase-1 work |
| [plan.md](plan.md) | 7 phases to submission (July 18) with exit criteria and the mandatory Phase-3 gate |
| [AGENTS.md](AGENTS.md) | Hard invariants + conventions for any AI agent writing Samaritan code |

## Timeline pressure

World Cup final is July 19 — same day as the submission deadline. Submission remains targeted for July 18. Phase 0/0.5 rescued ~14 GB of local TXLine + Polymarket history; synchronized live capture supplies the order-book evidence that sampled history cannot.
