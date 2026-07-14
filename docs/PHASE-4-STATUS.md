# Phase 4 — Reasoning and Paper Execution Status

*Started July 12, 2026. The real-money gate is closed.*

> **July 14 governance correction:** the signed v1 paper protocol is invalidated and suspended because its upstream market selector was future-informed. Its zero-observation ledgers remain preserved as audit history and cannot admit cases. Execution-clock repairs now live under `paper-study-v2-candidate-2026-07-14`, status `engineering_candidate_unregistered`; the operational Claude-readiness command is deliberately disabled until Deborah signs a corrected protocol. Statements below describing the registered runtime document the preserved v1 build history, not an active profitability study.

## Implemented vertical slice

- Strict Zod contracts define triage and analyst outputs. The thesis schema is closed to unknown fields and contains no stake, bankroll, order, wallet, or venue-authentication field.
- Bounded Anthropic Messages adapters use `claude-haiku-4-5` for triage and `claude-opus-4-8` with adaptive thinking for analysis. Haiku is forced through one strict `submit_triage` call; Opus cannot combine adaptive thinking with forced tool choice, so code accepts exactly one strict `submit_thesis` call and rejects prose, missing/duplicate/wrong tools, refusal, or truncation.
- Prompt versions, input/output limits, request deadlines, retry limits, and idempotency keys are code-owned. The analyst schema also binds model identity and a 15-minute thesis window; sizing or order fields remain impossible.
- A separate append-only SQLite spend ledger atomically reserves conservative worst-case cost before each API request, settles measured uncached/cache/output usage at the current model rates, and charges the full reservation when billing is unknown. The `$300` hard project ceiling is checked before network I/O.
- One production composition factory shares the bounded Claude client and spend ledger across isolated bounty/long-run decision ledgers. It rejects multiple credential sources, a spend ceiling above `$300`, shared lane ledgers, or a fixture universe built for a different long-run start.
- The thesis identity, market, outcome, and direction must exactly match the originating detector signal.
- The signed paper risk configuration is code-owned: `$50` bankroll, `$3` fixed stake, `$15` aggregate exposure, `$20` drawdown rejection stop, totals-only `CONSENSUS_MOVE`, live-book evidence, and a closed real-money gate.
- Deterministic risk rechecks the locked gap/z-score/CUSUM evidence, market family, score context, thesis expiry, post-latency book identity/freshness, current fee metadata, exposure, drawdown, and owned inventory for sells.
- Deterministic risk independently vetoes every `research_only` signal even if upstream fixture filtering is bypassed.
- The paper adapter never calls a venue. It walks canonical asks/bids, honors the deterministic limit, supports partial/no fills, applies per-market taker fees, records entry half-spread, executable displayed depth, and realized slippage, and stores all USD values as integer micro-units.
- A separate SQLite decision ledger hash-chains signal, triage, thesis, risk verdict, execution intent, paper result, and terminal state. Update/delete triggers enforce append-only storage.
- The orchestrator records the risk verdict and execution intent before invoking the paper adapter. Agent failure, schema failure, mismatch, stale evidence, malformed fees, and execution errors terminate fail-closed.
- The scheduler creates lane-specific bounty/long-run case identities, records the signal before model I/O, measures actual triage+analysis wall time, deterministically stamps thesis completion/expiry in event time, ignores books before that completion, executes against the first eligible pre-kickoff canonical book, updates paper exposure from actual simulated consideration, and terminally expires cases with no executable book. Analysis that reaches kickoff cannot become an in-play entry.
- One shared frozen config now owns the signed feature windows, detector threshold, 15-minute pre-kickoff cutoff, and dynamic-total selector. The canonical runtime sends every event to existing pending cases first, then features/detectors, and permanently suppresses duplicate signal IDs.
- The unauthenticated V2 CLOB resolver validates condition/token identity and caches explicit fee rate/exponent/taker-only, minimum-order, and tick-size parameters. Legacy `base_fee`-only shapes are rejected rather than converted by assumption.
- Captured book freshness remains event-time based while fee-metadata freshness is checked against processing wall time, so offline replay neither rewrites captured timestamps nor falsely rejects newly fetched condition metadata.
- Paper execution enforces the venue's minimum shares and tick grid and rounds fees conservatively to the documented five-decimal USDC precision.
- The paper portfolio records actual entry cost, distinguishes kickoff midpoint CLV from executable bid-side liquidation CLV, settles binary payouts into integer-micro-unit P&L/Brier, and feeds realized drawdown and open exposure back into risk state.
- Capture-order replay rejects regressing source timestamps atomically before stale TXLine observations can affect CUSUM/de-vig state or stale Polymarket books can overwrite the current quote. Per-source rejection counts remain observable.
- The kickoff close scheduler caches only canonical books whose venue timestamp is at or before kickoff, refuses capture-order regressions, and records cutoff, source, observation, and processing timestamps separately.
- The public Polymarket `market_resolved` frame is canonicalized with condition and winning asset identity. The settlement scheduler pays a paper position only when its exact asset won and refuses to settle a position that lacks its registered kickoff close.
- The registered evaluator rebuilds all eligible signals, fills, closes, and settlements from the append-only ledger. Bounty output is always exploratory; long-run rows and endpoints remain sealed until 20 filled matches and 40 fills, then use a seeded 10,000-iteration match-block bootstrap plus fill-rate, slippage, depth, settlement, and drawdown guardrails.
- Separate persistent bounty and long-run SQLite ledgers start with one hash-chained `study_initialized` record containing every frozen feature, detector, selector, risk, stopping, bootstrap, and real-money-gate setting. The long-run start is `2026-07-12T09:45:17.212Z`; its initial report is sealed at zero matches/signals/fills.
- The generated fixture universe physically separates evidence grades. Spain-Belgium has synchronized paired books but starts inside the 15-minute cutoff, so it is lifecycle-only; Norway-England and Argentina-Switzerland have sampled prices only, so they are signal-research-only. None can enter the long-run stopping count.
- The persistent lane factory exposes only strategy-executable fixture keys to the paper scheduler. Sampled-history and late-start paired captures cannot reach risk or execution even if replayed on the canonical bus.
- Rolling admission plans both lanes before mutation, then adds only post-start fixtures with verified mappings and pre-match paired executable books to the scheduler and kickoff-close maps. Removing or changing an admitted fixture fails closed; `research_only` signals are rejected before any Claude request.
- `paper:report` reconstructs machine-readable JSON and the exact preregistered per-match Markdown evidence table from the decision ledgers. Bounty evidence stays visibly exploratory and sealed long-run reports carrying rows/endpoints are rejected as invalid.
- A read-only authenticated TXLine refresh exact-matched France-Spain fixture `18237038` and England-Argentina fixture `18241006` to their public Polymarket match/totals families at 19:00 UTC on July 14 and 15. Deborah confirmed capture-only use on July 12. Six-hour `tradeable: false` captures and post-run verification are scheduled through four fail-closed local automations.

## Explicit boundary

This slice starts from an emitted `DetectorSignal`; code ledgers it, runs bounded triage/analysis, and records measured readiness before the scheduler can accept the first later pre-kickoff `PolymarketBookEvent`. Triage and analyst executors remain injected interfaces, with bounded Anthropic implementations and deterministic test doubles. The Claude path has no Polymarket authentication, wallet access, approval, token action, deposit, or order-placement capability.

The following work remains before the Phase 4 replay exit criterion is met:

- Expand the analyst's code-assembled evidence bundle and only then evaluate whether bounded read-only evidence tools earn their latency and cost.
- Execute and verify the scheduled semifinal captures as capture-only evidence. Do not append them to a study ledger or spend Claude tokens until a corrected v2 protocol is signed and fresh ledgers are initialized.
- Add the dashboard view over the generated ledger-derived evidence artifact.
- Run the complete canonical replay: event → feature → detector → case → agents → risk → paper fill → score.

## Verification

`pnpm test` passes under Node `22.23.1` with 102 tests across 27 files; full build and Phase 0 verification are rerun after each integration change. Production composition readiness opened the actual spend, bounty, long-run, and fixture-universe stores with the key configured, made zero API requests, and left all three chain heads unchanged. Both eligible fixture lists are correctly empty until a post-start paired capture passes admission. `paper:report` generated `docs/research/paper-study-current.md` from the real one-row lane ledgers: bounty is exploratory at zero observations and long-run is sealed at zero without leaking rows or endpoints. A live Haiku 4.5 synthetic triage smoke correctly dropped the non-executable signal for `$0.001641`. A live Opus 4.8 adaptive-thinking smoke returned exactly one valid `submit_thesis`, selected `no_trade` for research-only proxy evidence, and cost `$0.0460475`. Successful-call measured cost is `$0.0476885`; the append-only ledger conservatively reports `$0.29935725` because the first pre-classification 400 schema rejection was charged at its full `$0.25166875` reservation rather than rewritten after error classification was added. No reservation remains outstanding and the eight-entry chain verifies. A public, unauthenticated CLOB smoke resolved a captured condition to fee rate `0.05`, exponent `1`, taker-only fees, minimum order size `5`, and its condition-specific tick size.

An actual Spain-Belgium capture frame normalized to fixture `18218149`, full-time total `1.5`, condition `0xd143...00c9`, and winning asset `138369...93641` (`Over`). Its venue timestamp was 64 ms ahead of local receipt; both timestamps are retained rather than rewritten.

Focused paper-pipeline tests prove:

- unknown analyst sizing fields are rejected;
- missing, duplicate, wrong, prose-only, and truncated Claude submissions fail closed; budget exhaustion prevents the Anthropic client call;
- API failure is redacted and conservatively charged at the reserved maximum;
- ineligible fixtures invoke neither Haiku nor Opus, while both eligible lanes share one bounded spend chain and retain separate decision chains;
- `signal_received` is durable while a slow triage request is unresolved, measured analysis latency is ledgered, and a book one millisecond before readiness cannot execute;
- a pre-match signal whose analysis reaches kickoff is terminally closed and cannot become an in-play paper entry;
- long-run admission requires all three gates: post-start kickoff, verified mapping, and pre-match paired executable books;
- admitted fixture identities cannot be removed or changed during refresh, and repeated admission is idempotent;
- evidence rendering refuses sealed long-run output containing rows, endpoints, or guardrails;
- fee freshness uses processing time during captured replay without changing canonical event timestamps;
- research-only signals are vetoed again inside deterministic risk, not merely filtered by the scheduler;
- a `$3` marketable buy walks multiple ask levels and includes the current sports taker-fee formula;
- malformed fee metadata fails closed inside the adapter itself;
- legacy fee shapes, wrong condition assets, off-grid books, and sub-minimum orders cannot become fills;
- the `$20` drawdown stop vetoes the case;
- the execution intent is present in the verified hash chain before the adapter runs;
- early books are ignored, signals inside the 15-minute cutoff are rejected, and no-book cases expire with terminal ledger evidence;
- kickoff midpoint/executable CLV and settlement P&L remain distinct, with settled losses updating the drawdown halt state.
- regressing source timestamps are observable no-ops, not feature or detector inputs;
- only a pre-kickoff canonical book can become the kickoff mark, even when capture order regresses;
- public winning-asset resolution settles marked positions and cannot bypass a missing close;
- long-run metrics remain sealed below either stopping threshold, while bounty metrics stay explicitly exploratory;
- match-clustered bootstrap output is deterministic and a positive point estimate cannot override failed guardrails.
