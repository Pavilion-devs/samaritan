# Samaritan Submission Claims Matrix

**Purpose:** Single source of truth for README, dashboard, video, bounty form, and judge-interview claims<br>
**Owner:** Deborah, the human participant and submitter<br>
**Rule:** A claim may move to “implemented and verified” only after its evidence gate passes on the exact public submission commit.

## Status vocabulary

| Status | Meaning | Public treatment |
|---|---|---|
| **Implemented and verified** | Present in the current system and supported by a named test, artifact, or captured observation | May be stated narrowly, with its limitation |
| **Planned / conditional** | Designed, in progress, or dependent on an unmet gate | Roadmap only; never use present tense |
| **Prohibited / withdrawn** | False, legally unsafe, invalidated, unsupported, or outside the bounty build | Must not appear as a positive claim |

This matrix records the evidence available in the Phase status documents. It is not permission to publish a dirty or unverified workspace. Re-run the release checks and update the matrix before the final submission is frozen.

## Implemented and verified claims

| Claim area | Safe public formulation | Evidence and boundary |
|---|---|---|
| Human ownership | “Samaritan is Deborah's submission. Claude is a constrained component of the product.” | Deborah remains participant, project owner, submitter, narrator, and interview representative. Do not call Claude the participant or submitter. Sponsor clarification remains required. |
| TXLine integration | “Samaritan consumes official TXLine fixture, odds, and score surfaces and normalizes captured field shapes into canonical events.” | Phase 1 reports mainnet live and historical integration. `Pct` is divided by 100; `Prices` remains integer ×1000; missing values are not coerced to zero. See [Phase 1](../PHASE-1-STATUS.md). |
| Mainnet real-time evidence | “The integration has consumed TXLine mainnet SL12 live data.” | A read-only live smoke and synchronized capture are documented. This does not mean the public deployment currently has live credentials or that every public case is live. |
| Shared replay/live conductor | “Live and captured-replay adapters feed the same `runPaperSession` conductor with canonical events; no replay/live mode field is exposed to strategies.” | The captured adapter is exercised through the conductor; live fan-in/cleanup and the shared typed source contract are tested separately. Session tests cover chain verification, abort, and fail-closed source/runtime errors. Claim one implemented conductor and contract parity—not a deployed 24/7 autonomous service or a completed live trading lifecycle. |
| SSE resilience | “TXLine ingestion supports gzip, `Last-Event-ID`, reconnect, snapshot backfill, and event-ID deduplication.” | Implemented and tested in Phase 1. Do not claim zero data loss under every outage unless a release test proves it. |
| Storage integrity | “Raw ingress, canonical events, and decision lifecycle records are append-only in SQLite and locally hash-chained.” | Update/delete triggers and chain verification are documented in Phases 1 and 4. Do not call the current local chain externally timestamped, fully canonical, or Solana-anchored. |
| Strict LLM boundary | “Claude can submit only a strict research thesis. It cannot size a trade, access a wallet, authenticate to a venue, or place an order.” | Strict Zod/tool contracts and negative-path tests are documented in Phase 4. The analyst output is bound to the source signal. |
| Deterministic paper risk | “Code—not the model—rechecks eligibility, evidence, freshness, fee metadata, limits, exposure, drawdown, and inventory before paper execution.” | Implemented for the Phase 4 paper slice. Current sizing is a fixed `$3` paper stake under a `$50` paper bankroll, not full Kelly/correlation production risk. |
| Paper execution | “The paper adapter walks captured executable depth, supports partial/no fills, applies market metadata, and never calls a trading venue.” | Phase 4 documents depth walking, tick/minimum checks, fee handling, slippage, close, and settlement logic. The public proving case is synthetic and cannot support a fill-rate or profitability claim. |
| Fail-closed behavior | “Schema failures, mismatches, stale evidence, malformed fee metadata, ineligible research signals, and execution errors terminate without a paper order.” | Covered by the Phase 4 focused tests. Avoid the absolute “all failures” formulation. |
| Pre-action lifecycle recording | “The current orchestrator records the risk verdict and execution intent before invoking the paper adapter.” | Verified by Phase 4 tests. This is a local ordering property, not yet externally timestamped proof. |
| Model-spend control | “Samaritan reserves model spend before each API call and enforces a code-owned `$300` project ceiling.” | Phase 4 documents an append-only spend ledger and pre-network budget check. Do not present the ceiling as trading bankroll or economic profitability. |
| Claude invocation local audit | “For an admitted Anthropic API run, Samaritan can hash prompt/response/usage metadata into a separate append-only chain and verify the exact record locally before receipt generation.” | The live ledger validates chain continuity, run identity, usage/cost fields, and `anthropic_api` classification created by the real-client factory. A portable receipt carries a generation-time reference; its offline verifier does not independently prove membership. This is not provider attestation, an Anthropic-signed receipt, independently verified billing, or proof of response quality. V2 admission is currently blocked, so do not imply a current eligible run exists. |
| Historical Claude smoke | “Before the v2 suspension, a bounded Haiku triage and Opus thesis path completed under the strict schemas.” | Phase 4 records a synthetic research-only smoke from the preserved engineering history. It is not a live trade, performance sample, active-v2 observation, provider-attested invocation, or end-to-end paper fill. Real Anthropic/runtime admission remains blocked while v2 is `engineering_candidate_unregistered`. |
| Synthetic lifecycle proof | “A deterministic, closed-world proving fixture sends 20 invented canonical events through `runPaperSession`, traversing detection, triage and analyst stubs, deterministic risk, pre-action intent, paper depth execution, close, settlement, ledger verification, and receipt generation.” | `pnpm demo` completes at `filled_settled` with 12 v2 ledger rows and zero Anthropic, TXLine API, Polymarket API, wallet, Solana RPC, or real-order calls. Both agent records are `synthetic_stub`. It is permanently `excluded_synthetic` and proves conductor wiring—not live-agent behavior, autonomy quality, alpha, fill rate, or profitability. |
| Restart reconstruction | “The paper runtime can rebuild dedupe state, pending/terminal cases, positions, exposure, realized P&L, peak equity, and drawdown from the append-only ledger before resuming.” | Restart parity and inconsistent-history rejection are covered by the state-rehydrator and ledger tests. This does not make the overall system a deployed 24/7 service. |
| Canonical decision hash | “V2 decision-ledger hashes commit to event kind, case identity, event and insertion timestamps, canonical payload, sequence, and prior hash.” | Tamper tests cover changed kinds, IDs, timestamps, payloads, ordering, omissions, and prior hashes. V1 records remain preserved and separately identifiable. |
| Offline Decision Receipt | “A judge can verify the frozen synthetic receipt's strict schema, canonical hash, disclosed lifecycle relationships, and committed ledger head without private data.” | `pnpm receipt:verify -- public/artifacts/dashboard/synthetic-decision-receipt.json` passes. It does not replay private source payloads and does not perform Solana network verification. |
| Licence-safe public bundle | “The dashboard reads a strict, hash-verified frozen bundle containing derived evidence only.” | `pnpm public:audit` rejects raw/reconstructive TXLine shapes, secret patterns, private paths, unsafe links, and oversized artifacts. The clean-clone-shaped API test runs without ignored `data/` or `samples/`; sponsor clarification is still required before final publication. |
| Research-only sampled history | “Sampled Polymarket price history is research-only and cannot authorize execution.” | Enforced at detector eligibility, scheduler admission, and deterministic risk according to Phases 2 and 4. |
| Honest strategy rejection | “Current evidence rejects XMARKET_DIVERGENCE, FADER_CANDIDATE, and Match Result CONSENSUS_MOVE for v1.” | Phase 2 explicitly records these no-go decisions. A rejected strategy is not evidence that it can never work. |
| Stale-quote feasibility case | “In one synchronized Spain–Belgium study, no clean post-TXLine stale window appeared in the measured cases.” | Narrow result only: 0/18 measured market-event cases met that exploratory condition. It is not proof that stale quotes never occur. |
| Historical study invalidation | “Samaritan's causal audit invalidated its v1 dynamic-total result and withdrew it from strategy promotion.” | The defect and affected claims are preserved in [the invalidation record](../research/historical-gate-study-v1-invalidation.md). This is evidence of falsification discipline, not alpha. |
| Corrected historical Total Goals signal | “Under the unchanged chronological boundary, the corrected Total Goals candidate produced 38 normalized held-out buy cases across 18 fixtures, `+132.7` probability bps after the 100 bps proxy, with a fixture-clustered 95% interval of `+14.3` to `+243.9` bps.” | [Corrected v4 report](../research/historical-gate-study-causal-economic-v4.md). Must immediately add: sampled prices lack executable depth; this supports only a fresh forward paper review, not alpha, fills, profitability, or an active study. |
| Real-money boundary | “The bounty system is paper-only and the real-money gate is closed.” | Explicit in Phase 4 and the generated paper report. Repeat this in every judge-facing description of execution. |
| Preserved v1 ledger state | “The invalidated v1 paper ledgers are retained for audit history and remain sealed at zero filled matches and zero fills.” | These are suspended historical artifacts, not active preregistered evidence. See [current v1 paper evidence](../research/paper-study-current.md) and the invalidation record. Do not imply that an active long-run study or performance endpoint exists. |
| Candidate mappings | “Market mappings fail closed and remain non-tradeable until explicit verification.” | Phase 1 records candidate mapping coverage but all research-registry rows remain `tradeable: false`. Do not turn candidate counts into execution coverage. |
| Failed semifinal capture | “The France–Spain paired capture failed closed before kickoff and was not admitted.” | Artifacts stopped before kickoff, had no completion marker or resolution event, and produced no verified mapping record. This is failure-handling evidence, not a completed replay or live-lifecycle case. |
| Testing | “The release-candidate judge gate passes.” | On July 14 the full private workspace passed 37 test files / 214 tests. A separate 223-file, private-data-free release tree installed from lock and passed 36 files / 207 tests with the 7 private-projection tests intentionally skipped, plus deterministic demo, receipt verification, artifact audit, dashboard build, root high-severity dependency gate, and isolated Phase 0 typecheck/test. Re-run on the exact public commit before stating counts in the submission. |

## Planned or conditional claims

| Feature or claim | Required gate before promotion | Allowed public treatment now |
|---|---|---|
| Active forward dynamic-total study | Deborah reviews the completed causal/economic v4 report, explicitly registers the exact v2 candidate config before any qualifying observation, and fresh ledgers are initialized | “Corrected historical signal evidence exists; paper v2 remains `engineering_candidate_unregistered` and awaits Deborah's registration.” No active-study claim or qualifying admission. |
| Live-model complete lifecycle | One eligible captured case completes event → signal → real Haiku → real Opus thesis → risk → paper result → close → settlement under a registered protocol | The current complete proving case uses deterministic model stubs. Do not describe it as a live Claude trading case or performance sample. |
| England–Argentina capture outcome | The watchdog-supervised absolute `2026-07-15T16:00:00Z`–`2026-07-15T22:00:00Z` capture completes; terminal artifacts, synchronized overlap, lifecycle evidence, mapping, and rules all verify | “England–Argentina is scheduled capture-only.” Do not claim completion, resolution coverage, mapping admission, study admission, or current live behavior before post-run verification. Successful verification still cannot bypass Deborah's v2 registration. |
| Solana decision anchor | Corrected chain head anchored on Solana devnet with explorer transaction and exact public receipt | “Solana anchoring is planned.” No “on-chain decisions” or “every decision anchored.” |
| Network-backed anchor verification | A submitted devnet transaction, explorer URL, and receipt metadata all commit to the same receipt and ledger head | Offline receipt verification and read-only anchor-verifier tooling are implemented; no network-backed anchor claim is allowed until Deborah authorizes submission and the exact transaction verifies. |
| Hosted judge MVP | Public no-login URL works incognito/mobile without wallet, subscription, API key, or local archives | Local dashboard may be shown as development work, not a deployed MVP. |
| Final public release of derived replay | Sponsor approves the displayed derived fields and the exact public commit passes the artifact audit | The frozen derived-only bundle is technically ready; do not publish private archives or exact normalized TXLine series. |
| Public live-connectivity proof | Release artifact demonstrates current TXLine connectivity without exposing server credentials or raw feed data | “The local integration has consumed live SL12” is safe; “the hosted app is live” is not. |
| Economic model gate | Case-level inference cost and expected decision value are recorded; expensive analysis fails closed when uneconomic | State measured model cost where relevant, but do not claim net-positive economics. |
| Analyst evidence tools | Implement bounded, read-only tools; test authority, latency, cost, prompt-injection, and failure handling | The current implemented analyst exit is `submit_thesis`; do not advertise unimplemented search/query tools. |
| Full deterministic risk suite | Implement and exhaustively test quarter-Kelly, correlation/global exposure, kill switch, and durable drawdown state | Current fixed-stake paper controls may be described; the complete planned suite may not. Any money-touching judgment requires Deborah's explicit decision. |
| Strategy tournament/personas | Four isolated paper bankrolls, scoring, and deterministic reallocation exist and are demonstrated | Architecture/roadmap only. Not part of the winning critical path. |
| MODELER / Data Doctor | Fitted/calibrated model certificate or implemented feed-health agent and halt boundary | Roadmap only. Never imply these agents currently run. |
| Real Polymarket execution | Phase 3 gate passes, Deborah explicitly authorizes money-touching work, deterministic controls complete, and V2 integration is independently verified | Post-bounty roadmap at most. It is intentionally outside the submission's proof. |
| Post-hackathon operation | Appropriate commercial TXLine licence and venue/legal requirements are in place | State that continued operation requires the appropriate licence. |

## Prohibited or withdrawn claims

| Prohibited wording or implication | Why it is prohibited | Required replacement |
|---|---|---|
| “Proof of alpha” / “profitable strategy” | No valid corrected edge study or completed paper sample exists | “Falsification-first governed paper system; corrected research pending.” |
| “+119 bps held-out edge,” “+219 bps raw edge,” or any v1 totals profitability number | V1 used future-informed market selection and unbounded coverage | “V1 invalidated by causal audit; no totals candidate is approved.” |
| “73 executable trades” | Emissions included unsupported sells and complementary duplicates | Report unique executable economic cases only after v2. |
| “Every decision is anchored on-chain” | Current decision chain is local and Solana anchoring is unfinished | “Lifecycle records are locally append-only and hash-chained; external anchoring is planned.” |
| “Production real-money trader” / “Samaritan executes real Polymarket orders” | Real-money gate is closed and no production adapter is demonstrated | “Paper execution only.” |
| “Production-ready autonomous daemon” | Complete lifecycle, restart reconstruction, deployment, and public proof remain open | Describe the implemented slice and exact missing gates. |
| “AI-built submission,” “Claude's entry,” or “autonomously submitted” | Deborah is the human participant and submitter; terms require human participation | “Deborah built and submits Samaritan; Claude is a constrained product component.” |
| Raw TXLine API responses, captures, replay files, or a reconstructable feed | Hackathon data terms prohibit redistribution/publishing of Data | Publish only sponsor-approved, non-reconstructive derived output. |
| Exact normalized TXLine probability time series as automatically licence-safe | Dividing `Pct` by 100 may be too close to source data to constitute non-reconstructive output | Omit unless TxODDS approves it in writing; prefer rounded aggregates, movements, features, decisions, and hashes. |
| “TXLine gives us individual bookmaker lead/lag in the free World Cup feed” | Captures exposed StablePrice consensus rows rather than a bookmaker panel | “TXLine provides a de-vigged consensus price in the captured tier.” |
| “STALE_QUOTE is validated” | One live feasibility study found no supporting clean post-TXLine window | “STALE_QUOTE remains disabled and paper-only.” |
| “Historical sampled prices prove executable fills” | Sampled histories lack bid, ask, size, spread, and executable depth | Use paired canonical books and post-readiness execution evidence. |
| “All five detectors / all four personas are running” | Only three detector types are implemented in the documented Phase 2 slice; tournament/personas are unfinished | Name only the exact implemented detectors and their current evidence status. |
| “Claude performs autonomous web/book/series research” | Current bounded production path exposes strict submissions, not the planned tool suite | “Claude evaluates a code-assembled evidence bundle and returns a strict thesis.” |
| “The Claude invocation is provider-attested,” “Anthropic signed this receipt,” or “the portable receipt independently proves local-ledger membership” | The invocation-evidence chain is created and verified locally by Samaritan; the receipt carries only a generation-time reference and has no provider signature or independent billing oracle | “Samaritan verified the exact invocation record in its local chain before generating this reference; offline membership and provider attestation are not claimed.” |
| “Risk uses quarter-Kelly and full portfolio correlation controls” | Current Phase 4 paper slice uses fixed stake and bounded exposure/drawdown checks | State the exact current paper risk configuration. |
| “The proof is provably un-cherry-picked” | No corrected protocol has been registered or externally timestamped | “The v2 engineering configuration is locally versioned but unregistered”; strengthen only after Deborah registers it before observations and the external proof exists. |
| “The v2 study is preregistered,” “the long-run study is active,” or any equivalent present-tense claim | V1 is invalidated and suspended; v2 is an `engineering_candidate_unregistered` until Deborah explicitly registers it | “V1 is preserved as invalidated audit history; v2 awaits Deborah registration.” |
| “SL1 always means a 60-second delay” | The observed devnet on-chain row reported a conflicting sampling interval | Name the network/tier and current on-chain metadata explicitly. |
| “World Cup data licence continues automatically after the hackathon” | The hackathon licence terminates; future operation requires the appropriate normal licence | Disclose the post-hackathon licensing dependency. |
| FIFA branding, logos, or implied affiliation | Hackathon terms prohibit the implication and trademark use is unsafe | Use neutral “World Cup data via TxODDS” copy. |
| Any guarantee of winnings, safety, correctness, or zero loss | Neither research nor deterministic controls eliminate market or implementation risk | Describe bounded controls and measured evidence, never guarantees. |

## Final claim-release checklist

Before freezing any README, video, dashboard, or submission copy:

- [ ] Deborah has received and retained sponsor clarification on human participation.
- [ ] Deborah has received and retained sponsor clarification on publicly displayed derived TXLine fields.
- [ ] Every implemented claim points to evidence produced by the exact public commit.
- [x] Every planned feature uses future tense and is visibly separated from the judge path.
- [x] The v1 edge numbers and 73-emission framing are absent except inside the labelled invalidation history.
- [x] V1 ledgers are described only as suspended audit history, and v2 is never called registered or active before Deborah's explicit registration.
- [x] Paper-only and real-money-gate-closed language appears wherever execution is described.
- [x] No public artifact contains raw TXLine Data, secrets, private paths, or reconstructive series.
- [x] No public surface requires a judge to pay, subscribe, authenticate, or create a wallet.
- [ ] The Solana claim matches the exact explorer transaction and receipt that can be independently verified.
- [ ] The final test/typecheck/build counts were rerun and recorded rather than copied from an earlier phase report.
- [ ] Deborah can explain every claim, limitation, and rejected strategy in her own words.
