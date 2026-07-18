# SAMARITAN

**A governed autonomous sports-trading system.** Deterministic signal algorithms detect market inefficiencies; Claude acts only as a bounded judgment layer; deterministic code controls risk and paper execution; decisions are recorded in an append-only local ledger. Decision receipts verify offline and devnet anchoring tooling is implemented, but no anchor transaction has been submitted.

- **Testing ground:** TxODDS "Trading Tools and Agents" bounty — World Cup Hackathon (Superteam Earn / Solana). 16,000 USDT track prize. **Submission deadline: July 19, 2026.**
- **Product direction:** durable decision-control and evidence infrastructure for sports and prediction-market teams. The bounty build is paper-only.

## Status

**PHASE: PHASE 4 PAPER REASONING RUNTIME IMPLEMENTED — BOUNDED EVIDENCE COLLECTION IN PROGRESS.** The strict Node 22 workspace, canonical event contracts, evidence-bearing mapping registry, TXLine SSE clients, Gamma-refreshed Polymarket WebSocket source, streaming replay adapters, append-only SQLite/DuckDB stores, feature engine, detectors, chronological research harness, bounded Claude layer, deterministic paper risk, and paper portfolio are implemented. Live and captured-replay source adapters feed the same `runPaperSession` conductor; the strategy runtime receives canonical events rather than a live/replay mode flag. This is an implemented orchestration boundary, not a claim that Samaritan is already a deployed 24/7 autonomous service. The local research database holds 9,025,361 normalized TXLine outcomes and 85,249,582 mapped Polymarket points. The synchronized Spain-Belgium study found no supporting post-TXLine STALE_QUOTE case, so that detector remains disabled.

**Evidence correction and registration:** Samaritan invalidated its original dynamic-total result after finding a future-informed selector and inflated emission semantics, preserved the artifact, repaired both defects, and reran the unchanged chronological boundary. The corrected Total Goals–only `CONSENSUS_MOVE` family has 38 held-out normalized buy cases across 18 fixtures, mean `+132.7` probability bps after the 100 bps historical proxy, and a fixture-clustered 95% interval of `+14.3` to `+243.9` bps. This remains sampled-price historical signal evidence—not alpha, profitability, or executable fills. On July 18 Deborah registered the exact corrected v2 configuration for forward paper observation only. No qualifying v2 observation existed at registration, and the real-money gate remains closed. See [the registration record](docs/10-paper-study-v2-registration.md), [corrected v4 report](docs/research/historical-gate-study-causal-economic-v4.md), and [v1 invalidation record](docs/research/historical-gate-study-v1-invalidation.md).

The Phase-4 paper spine runs canonical events through deterministic detection, ledgers signals before model I/O, measures Haiku/Opus wall-clock decision latency from local observation time, and waits for both that latency and the current sports-order placement delay before deterministic risk and depth-aware simulation. Haiku and Opus can submit only strict structured judgments; neither can size or place an order. Real invocation metadata can be appended to a separate local hash chain. Receipt generation accepts a reference only after that local chain and exact record verify; the portable offline receipt does not independently prove membership. This is a local integrity audit—not Anthropic/provider attestation, independently signed billing proof, or proof of model quality. The July 12 v1 registration and empty ledgers remain preserved and suspended. Registered v2 uses fresh versioned ledgers; registration removes the human protocol-status block but does not bypass fixture admission. No trading credential is connected and the real-money gate remains closed.

Both semifinal paired captures failed closed and are inadmissible. France–Spain stopped before kickoff. England–Argentina hit a watchdog-detected Polymarket stall and never produced complete terminal manifests, final score state, public resolution, or a verified mapping. Neither fixture may be replayed into v2 or used for a real-Claude claim.

## Public release links

- **Hosted judge MVP:** [samaritan-txline-2026.asaborodaniel.chatgpt.site](https://samaritan-txline-2026.asaborodaniel.chatgpt.site/)
- **One-call judge evidence:** [public read-only evidence endpoint](https://samaritan-txline-2026.asaborodaniel.chatgpt.site/api/judge/evidence)
- **Demo video:** `[YOUTUBE_OR_LOOM_URL — pending recording and public playback verification]`
- **Public repository:** [github.com/Pavilion-devs/samaritan](https://github.com/Pavilion-devs/samaritan)

The hosted MVP has passed signed-out desktop/mobile route checks and strict API-method checks. The video placeholder remains a release blocker and must be replaced only after public playback is watched end to end.

## Judge quickstart

Requirements: Node `22.23.1` and pnpm `11.13.0`.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm judge
```

Then open `http://127.0.0.1:4173`. `pnpm judge` first runs the complete clean-clone verification gate, then serves the read-only dashboard. It needs no TXLine credential, Anthropic key, wallet, RPC write, paid subscription, or private archive.

Command also contains an optional live TXLine connectivity pulse. A hosted runtime enables it only when all three server-side values are present: `TXLINE_JWT`, `TXLINE_API_TOKEN`, and `TXLINE_SERVICE_LEVEL_ID=12`; local development may instead use the ignored, validated `phase0/.tokens/mainnet.json`. Missing or invalid credentials produce a truthful degraded card and do not affect the frozen judge evidence. The public pulse exposes only mainnet/SL12, check time, connection status, a rounded latency bucket, aggregate fixture count, and coarse HTTP-response freshness. It never returns fixture identities, names, kickoffs, raw rows, odds, probabilities, credentials, or study observations.

On the exact final public commit, the verification gate must prove:

- all TypeScript checks and the complete release test suite pass; the final count must be recorded only after that commit is frozen;
- a deterministic synthetic case traverses the shared `runPaperSession` conductor from canonical events through settlement, using deterministic model stubs;
- the public Decision Receipt verifies offline;
- the frozen dashboard bundle contains only allowlisted, derived artifacts; and
- the production dashboard builds from that clean-clone bundle.

The public experience presents two judge-demo cases while keeping historical sampled-price research as a separate third evidence class:

1. **Captured refusal:** the Spain–Belgium replay is real synchronized evidence and correctly ends in no trade. Only bucketed TXLine movement is public.
2. **Synthetic full lifecycle:** `pnpm demo` sends 20 invented canonical events through the same `runPaperSession` conductor used by the source adapters, then exercises signal → triage → thesis → deterministic risk → intent → paper fill → close → settlement → receipt. Its two model boundaries are deterministic stubs, it makes zero external calls, and it is visibly synthetic and permanently excluded from performance evidence.

Useful standalone commands:

```bash
pnpm demo
pnpm receipt:verify -- public/artifacts/dashboard/synthetic-decision-receipt.json
pnpm public:audit
pnpm judge:check
```

The downloadable receipt is locally verified but **not Solana-anchored**. Offline prepare, explicitly human-gated devnet submission, and read-only network verification tooling exist; the bounty release intentionally accesses no signer and submits no transaction, so there is no explorer link.

### Judge evidence map

| Bounty criterion | Where to inspect |
|---|---|
| Core Functionality & Data Ingestion | **Command** optional derived connectivity pulse; **Matchroom** derived captured replay; [technical overview](docs/submission/technical-overview.md); exact endpoints in [API feedback](docs/submission/txline-api-feedback.md) |
| Autonomous Operation | `pnpm demo` and **Proof** demonstrate deterministic end-to-end orchestration with model stubs—not an authentic Claude trading case; the forward-paper governance boundary is in [the v2 registration record](docs/10-paper-study-v2-registration.md) |
| Clean, deterministic, defensible logic/code | Risk verdict and pre-action ledger in the downloadable receipt; detector/risk tests; identical canonical live/replay contracts |
| Innovation/novelty | Strict Claude thesis boundary plus non-overridable deterministic authority, fail-closed evidence admission, and portable decision receipts |
| Production readiness | `pnpm judge:check`, restart-safe portfolio reconstruction, public-artifact audit, security headers, explicit failure states, and the signed-out [hosted MVP](https://samaritan-txline-2026.asaborodaniel.chatgpt.site/) |

Every public surface separates **real captured retrospective evidence**, **historical sampled-price research**, and **synthetic engineering proof**. Registration is a governance fact, not a performance result.

Decisions locked so far:

| Decision | Choice |
|---|---|
| Execution modes | **Bounty: paper only.** Real-money Polymarket execution remains a gated post-bounty architecture item |
| Wallets | No judge wallet and no execution wallet connected; any devnet proof submission is explicitly human-gated |
| Data source | TXLine (TxODDS) — free World Cup tier, Service Level 12 (real-time, mainnet) |
| v1 markets | Match Result + dynamically selected main full-time Over/Under only |
| Signal source reality | Free tier exposes `TXLineStablePriceDemargined` consensus, not named bookmakers; Momentum uses `CONSENSUS_MOVE`, not bookmaker leader-lag |
| AI | Claude — Opus 4.8 (analysis), Haiku 4.5 (triage); custom harness, NOT a prompt template |
| Claude budget | $200 operating target; $300 hard project ceiling |
| Real-money architecture | Disabled and outside the bounty proof; no production trading credential or adapter is connected |
| Stack | Node 22 + strict TypeScript/pnpm/vitest; SQLite + DuckDB |

## Docs

| Doc | What's in it |
|---|---|
| [docs/01-research.md](docs/01-research.md) | Everything verified about the bounty, the TXLine API, Polymarket, and the competitive landscape |
| [docs/02-architecture.md](docs/02-architecture.md) | The three-layer harness design: signal core → Claude reasoning → strategy tournament |
| [docs/03-strategy-playbook.md](docs/03-strategy-playbook.md) | The edges, the math, the risk framework — and the open questions we're discussing before building |
| [docs/04-algorithms.md](docs/04-algorithms.md) | The detector math: trigger conditions, free parameters, sizing, scoring — the spec the gate study fills with numbers |
| [docs/05-harness.md](docs/05-harness.md) | The agent harness machine room: case lifecycle, context assembly, two-speed deliberation, memory stores, hooks, budgets |
| [docs/06-gate-study.md](docs/06-gate-study.md) | Phase-3 historical/live evidence, detector decisions, cost sensitivity, and the evidence behind the now-registered forward-paper-only v2 protocol |
| [docs/UI.md](docs/UI.md) | Approved Floodlight UI/UX direction: information architecture, visual system, evidence states, replay behavior, and acceptance criteria |
| [docs/PHASE-1-STATUS.md](docs/PHASE-1-STATUS.md) | Implemented backbone contracts, verification evidence, and the remaining Phase-1 work |
| [docs/PHASE-2-STATUS.md](docs/PHASE-2-STATUS.md) | Current feature/detector/replay implementation, real-archive smoke evidence, and open Phase-2 work |
| [docs/PHASE-4-STATUS.md](docs/PHASE-4-STATUS.md) | Strict reasoning contracts, deterministic paper-risk/execution slice, verification, and remaining integration work |
| [docs/08-winning-submission-plan.md](docs/08-winning-submission-plan.md) | Release-candidate win plan, evidence checkpoint, remaining authority gates, and demo strategy |
| [docs/10-paper-study-v2-registration.md](docs/10-paper-study-v2-registration.md) | Deborah's exact forward-paper-only v2 registration, frozen limits, stopping rules, and closed real-money boundary |
| [docs/submission/public-release-scope.md](docs/submission/public-release-scope.md) | Exact public inclusion/exclusion rules, clean-clone gate, and dependency isolation |
| [docs/submission/third-party-notices.md](docs/submission/third-party-notices.md) | Data-service, font, asset, and software attribution boundaries |
| [plan.md](plan.md) | 7 phases to the July 19 hard deadline, with exit criteria and the mandatory Phase-3 gate |
| [AGENTS.md](AGENTS.md) | Hard invariants + conventions for any AI agent writing Samaritan code |

## Timeline pressure

World Cup final is July 19 — same day as the submission deadline. Submission remains targeted for July 18. Phase 0/0.5 rescued ~14 GB of local TXLine + Polymarket history; synchronized live capture supplies the order-book evidence that sampled history cannot.
