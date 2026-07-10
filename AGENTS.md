# AGENTS.md — Instructions for AI agents working on Samaritan

You are working on **Samaritan**: an autonomous sports-trading system. Deterministic algorithms detect market inefficiencies on TXLine (TxODDS) World Cup data; Claude agents judge flagged signals; execution is paper + real-money Polymarket, risk-gated; decisions are ledgered and anchored on Solana. Built for the TxODDS "Trading Tools and Agents" bounty (deadline **July 18, 2026** self-imposed; July 19 hard), designed to outlive it.

**Read before writing any code:** `plan.md` (phases + exit criteria), `docs/02-architecture.md` (system design), `docs/03-strategy-playbook.md` (the four strategies + risk rules), `docs/01-research.md` (API facts + legal terms).

## Hard invariants — violating any of these is a critical bug

1. **Claude never touches money directly.** The analyst agent's only exit is `submit_thesis` (strict schema). Execution is deterministic code downstream of the risk manager. No LLM output is ever parsed into an order outside that path.
2. **The deterministic risk rules cannot be overridden by any agent** — not the analyst, not the risk-manager agent's judgment pass, not a prompt. Caps, quarter-Kelly, drawdown breakers, and the kill switch are code.
3. **Real-money execution is pre-match only in v1**, gated behind: Phase 3 gate study complete → thesis passed both risk stages → venue explicitly `polymarket` → within hard bankroll caps. Kill switch is manual and belongs to Deborah.
4. **Replay and live share one code path.** Strategies consume the same event bus types in both modes and must not be able to detect which mode they're in.
5. **Every decision is ledgered before it is acted on.** Signal → triage → thesis → veto/approval → fill: append-only, no retroactive edits.
6. **No bookmaker scraping or automation.** TXLine and Polymarket official APIs only.
7. **Never commit secrets** — wallet keys, API tokens, JWTs. Env vars + gitignored `.env`. The hosted demo holds credentials server-side.
8. **Don't invent API fields.** TXLine integration follows the OpenAPI spec (`https://txline.txodds.com/docs/docs.yaml`) and the captured real samples in `samples/` (Phase 0). Where docs and samples disagree, samples win — update `docs/01-research.md` when that happens.
9. **Don't re-serve raw TXLine data on public surfaces** (hackathon data license forbids redistribution). Derived signals/decisions are ours; raw feeds are not.
10. **Submission framing:** Deborah is the participant; Samaritan uses Claude as a component. Never describe the entry as AI-built (hackathon legal terms).

## Stack & conventions

- **TypeScript, Node 22, pnpm, strict mode, vitest.** ESM throughout.
- Storage: SQLite (`better-sqlite3`) / DuckDB for research queries. Append-only journals; no destructive migrations on ledger tables.
- AI: `@anthropic-ai/sdk`. Models: `claude-opus-4-8` (analyst — adaptive thinking, prompt-cached static context), `claude-haiku-4-5` (triage). Strict tool schemas. Not the Claude Agent SDK — the harness here is purpose-built.
- Solana: `@solana/web3.js` + Anchor (TXLine subscription, ledger anchoring). Mainnet = production (SL12 real-time data), devnet = integration tests (SL1).
- Polymarket: **V2** SDK only (V2 is live; V1-signed orders are not production-compatible).
- Probabilities are the universal currency: internally everything is probability space (0–1), converted at the edges. Captured TXLine `Pct` is a de-vigged fair-probability string on a 0–100 scale and **must be divided by 100**; `Prices` = raw odds ×1000 (both confirmed in Phase 0).
- Money values: integer micro-units, never floats.
- Tests: every detector has replay-based tests with known fixtures; the risk rule layer has exhaustive unit tests (this is the code that loses real money when wrong).

## Planned repo layout

```
samaritan/
  plan.md, AGENTS.md, README.md, docs/
  samples/            # real captured payloads (Phase 0) — source of truth over docs
  src/
    ingest/           # TXLine SSE/snapshot clients, Polymarket ingestor, auth/session
    bus/              # canonical events, live + replay emitters
    store/            # journal, time-series, decision ledger
    features/         # rolling feature engine
    detectors/        # CONSENSUS_MOVE, XMARKET_DIVERGENCE, FADER_CANDIDATE, STALE_QUOTE, MODEL_MARKET_GAP
    model/            # in-play goal model (MODELER)
    agents/           # triage, analyst, risk-manager: prompts, tools, loops
    risk/             # deterministic rule layer, kelly sizing, kill switch
    strategies/       # the four personas + tournament + scoring (CLV/Brier)
    exec/             # adapter interface: paper / polymarket / replay
    chain/            # solana anchoring, merkle validation
    replay/           # historical downloader + replay engine
    dash/             # judge-facing dashboard
```

## Samaritan's internal agent roster (what you're building, not what you are)

| Agent | Model | Job | Boundary |
|---|---|---|---|
| Triage | Haiku 4.5 | Dedupe/classify/drop incoming signals | Output: drop/escalate + one line. Cannot trade. |
| Analyst | Opus 4.8 | Investigate escalated signals via tools; write trade thesis | Only exit is `submit_thesis`. Cannot size or place trades. |
| Risk Manager | Rules + Opus pass | Enforce caps/Kelly/correlation; judgment review of theses | Agent pass can only veto or shrink, never enlarge or create. |
| Personas ×4 | Config over shared harness | Momentum / Arb / Fader / Modeler priors on the signal stream | Isolated paper bankrolls; scored on CLV + Brier. |
| Head Trader | Deterministic loop | Reallocate tournament capital by score | Paper capital only in v1. |
| Data Doctor | Haiku 4.5, scheduled | Feed health, schema drift, latency watch | Can halt trading; cannot resume it (human resumes). |

## Working style

- Follow `plan.md` phase order; each phase has exit criteria — meet them before moving on. Phase 3 (gate study) blocks all real-money work, by agreement.
- When reality contradicts the docs (API shapes, market taxonomy), fix the doc in the same change.
- Prefer boring tech; the ambition budget is spent on the strategies, not the infrastructure.
- Latency is a feature: measure event→signal and signal→decision timings from day one (they decide what in-play trading we can ever do).
- When a judgment call touches money, risk limits, or the hackathon legal terms — stop and ask Deborah. Everything else: decide and note it.
