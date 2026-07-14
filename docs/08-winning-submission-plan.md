# Samaritan Winning Submission Plan

**Status:** Active war-room plan<br>
**Owner and hackathon participant:** Deborah<br>
**Internal ship date:** July 18, 2026<br>
**Hard deadline:** July 19, 2026 at 23:59:59 UTC<br>
**Real-money gate:** **CLOSED**

This document converts the July 14 product, code, evidence, competition, legal, and submission audit into the shortest credible path to a winning TxODDS Trading Tools and Agents submission.

It is a bounty-critical overlay on `plan.md`, not a replacement for the long-term Samaritan roadmap. It does not authorize real-money trading, relax any risk invariant, or permit raw TXLine data to be published.

## 0. July 14 release-candidate checkpoint

The product is no longer an idea looking for a demo. The current local release candidate has the core judge story implemented and verified:

| Surface | Current evidence | Status |
|---|---|---|
| Real TXLine use | Mainnet SL12 ingestion and a synchronized Spain–Belgium replay are documented; the public case ends in a disciplined no-trade | **Ready, narrowly claimed** |
| Complete judge lifecycle | `pnpm demo` publishes 20 canonical events and completes signal → deterministic agent stubs → hard risk → paper fill → close → settlement | **Ready, synthetic and performance-excluded** |
| Decision proof | 12 v2 ledger rows; ledger head `a034cd86…1575dc4`; receipt hash `130f1ee7…883f265`; offline verification passes | **Ready, local integrity only** |
| Public evidence bundle | Six strict, hash-checked files; bundle hash `4950d9a9…5366276`; derived-only audit passes | **Ready for final public-commit audit** |
| Dashboard | Command, Matchroom, Casebook, Study, and separated synthetic-proof panel build and serve read-only | **Ready locally; not deployed** |
| Historical claim | Corrected causal/economic v4 reports 38 held-out normalized buys / 18 fixtures / `+132.7` bps after proxy / clustered interval `+14.3` to `+243.9` | **Signal research only; v2 unregistered** |
| External anchor | Unsigned devnet intent `cb921e05…e0bc03` generated offline; no signer, RPC, wallet, or transaction used | **Awaiting Deborah's explicit authorization** |
| Capture expansion | France–Spain capture is scheduled for July 14 at 16:00 UTC; England–Argentina follows July 15 | **Pending verification; capture-only** |

Release-gate evidence recorded July 14:

- root typecheck and dashboard typecheck passed;
- 37 root test files / 214 tests passed;
- deterministic demo and receipt verifier passed;
- public artifact audit passed over 6 files;
- production dashboard build passed;
- the root judge/runtime graph passed the high/critical dependency-advisory gate;
- Phase 0 typecheck and capture deadline test passed; and
- both future capture configurations passed strict validation as `tradeable: false`.

A separate 223-file release-candidate tree containing every intended tracked/untracked file—but no `data/`, `samples/`, `content/`, `design/`, `.env`, or private archive—installed from the frozen lock and passed the judge gate. Its 7 private-projection tests skipped by design; all 207 clean-tree tests passed. The isolated Phase 0 install, typecheck, and test also passed.

The remaining path to submission is deliberately small and authority-sensitive:

1. Preserve and verify the two scheduled synchronized captures; do not auto-promote either into a study.
2. Freeze an intentional public Git commit, run CI from that exact commit, add a public remote, and deploy the no-login dashboard.
3. Deborah decides whether to submit the exact frozen synthetic commitment to Solana devnet. Until then, every public surface must say **unanchored**.
4. Deborah sends and retains the sponsor clarification request on human participation and derived-data display.
5. Deborah reviews the claims in her own words, narrates the sub-five-minute video, verifies the deployed URL incognito/mobile, and submits the entry herself.

The current environment exposed no controllable browser target, so the final rendered/incognito visual pass is a real open gate—not a box to mark from build output.

---

## 1. The decision

Samaritan will not compete as another AI betting bot, generic sharp-move detector, or unfinished autonomous hedge fund.

It will compete as:

> **The governed autonomous sports-trading system: Claude investigates uncertainty, deterministic code alone controls risk and execution, and every action—or refusal—is committed before it happens.**

The bounty submission wins by proving four things extremely well:

1. Samaritan consumes real TXLine data through a production-quality live/replay path.
2. It completes one autonomous paper-trading lifecycle end to end.
3. An LLM can contribute judgment without receiving authority over money.
4. A stranger can independently verify what the system saw, decided, permitted, and executed.

The submission will not depend on:

- real-money Polymarket execution;
- four personas or a tournament;
- MODELER;
- a Head Trader;
- a Data Doctor;
- additional detectors;
- unsupported profitability claims.

Those remain post-submission roadmap items.

---

## 2. Winning position

### Category

**Governed autonomous sports-market intelligence**

### One-line pitch

> **Samaritan turns verified TXLine data into bounded, replayable market decisions. Claude investigates; deterministic code controls risk and execution; every action—or refusal—is independently auditable.**

### Judge-facing promise

Most agents prove that they made a prediction. Samaritan proves why an autonomous system was permitted—or forbidden—to act.

### Buyer

The primary buyer is a prediction-market desk, sportsbook trading team, market operator, or B2B intermediary that wants agent automation without surrendering risk control, reproducibility, or auditability.

### Defensible moat

- Identical canonical event contracts in replay and live operation.
- Evidence-gated strategy promotion instead of story-driven backtests.
- A strict LLM authority boundary: thesis only, never size or order.
- Deterministic risk and execution after the thesis.
- Append-only lifecycle records written before action.
- Externally timestamped decision receipts and independent verification.
- Honest refusal of unsupported strategies.

### Words we will not use without completed evidence

- “Proof of alpha”
- “Profitable strategy”
- “Production real-money trader”
- “Every decision is anchored on-chain”
- “Provably un-cherry-picked”
- “73 executable trades”
- “AI-built submission”

---

## 3. Definition of winner-ready

Samaritan is winner-ready only when all of the following are true:

- [ ] A clean public clone installs and launches the judge demo with one documented command.
- [x] The demo does not require TXLine credentials, a wallet, paid access, or local private archives.
- [x] A live-connectivity proof demonstrates that the same canonical runtime accepts TXLine SL12 events.
- [x] One explicitly synthetic case visibly completes signal → triage stub → thesis stub → risk → intent → paper result → close → settlement.
- [x] One real captured case visibly ends in a justified no-trade or veto.
- [x] Any synthetic proving case is unmistakably labelled and excluded from performance results.
- [x] The corrected evidence study contains no future-informed market selection.
- [x] Historical counts represent unique executable economic decisions, not duplicate detector emissions.
- [x] Paper fills use actual observation readiness plus model latency plus venue delay.
- [x] Restarting the runtime reconstructs dedupe, positions, exposure, P&L, peak equity, and drawdown.
- [x] The decision hash authenticates the full canonical record, including event type and timestamps.
- [ ] At least one corrected ledger head is anchored on Solana devnet and has a public explorer link.
- [ ] An independent verifier validates the receipt and anchor from frozen public artifacts.
- [ ] The deployed dashboard exposes only licence-safe derived data.
- [x] The current README, dashboard, video script, and submission draft make no claim beyond implemented evidence; rerun on the final public commit/video.
- [ ] Deborah can explain and defend the architecture, evidence, limitations, and major design decisions.
- [ ] Sponsor clarification on human participation and public derived data is retained in writing.
- [ ] The video is below five minutes and every URL works in an incognito browser.

---

## 4. P0 — Repair the truth before building the show

These items block every profit, edge, or production-readiness claim.

### 4.1 Invalidate gate-study v1

The current dynamic-total study chooses the market using a price observed as late as kickoff minus five minutes, even though eligible signals stop at kickoff minus fifteen minutes. In the audited artifact, 95 of 98 selected lines used information after the signal window. Coverage also counts observations without the same as-of cutoff.

Actions:

- [x] Mark the current `+119 probability bps` result as causally invalidated.
- [x] Preserve the old artifact for audit history; do not silently overwrite it.
- [x] Add a dated methodology note explaining the defect and its impact.
- [x] Create a new protocol/config version before recomputing results.
- [x] Remove the invalidated number from the README, dashboard, video, and submission copy until a corrected result exists.

Acceptance tests:

- The old result is clearly labelled invalidated anywhere it remains visible.
- No current product surface calls it held-out edge, alpha, or profitability evidence.
- The corrected protocol has a distinct identifier and config hash.

### 4.2 Make total-line selection causal

Choose the exact market using only information available before the first eligible detector decision. A fixed T−180-minute cutoff or the first eligible jointly observable book are acceptable starting designs; the rule must be deterministic, frozen, and applied before labels or future prices are inspected.

Actions:

- [x] Define one causal selector timestamp and document why it is live-reproducible.
- [x] Apply the same cutoff to probability, coverage, volume, liquidity, and market availability.
- [x] Fail closed when no line is eligible at the cutoff.
- [x] Prohibit selector inputs later than the earliest evaluated signal.
- [x] Record selector evidence and cutoff in every fixture artifact.
- [x] Add tests that inject a highly attractive future line and prove it cannot affect selection.
- [x] Add tests that future coverage cannot make a line eligible.

Acceptance tests:

- Every selected fixture satisfies `selectorEvidenceTsMs <= detectorEvaluationStartTsMs`.
- Replacing all post-cutoff market data produces the same selected line.
- A fixture with insufficient as-of evidence is rejected rather than rescued by future observations.

### 4.3 Count executable economic decisions

The current totals result contains buys, unsupported sells, and simultaneous complementary Over/Under expressions of the same move.

Actions:

- [x] Define a deterministic economic-case identity for fixture, market condition, direction, and decision window.
- [x] Collapse complementary same-move emissions into one case.
- [x] Either convert a sell into a verified complement-token buy or exclude it from executable results.
- [x] Prevent both sides of one binary condition from being counted as independent opportunities.
- [x] Report raw detector emissions separately from cases, orders, fills, and unique fixtures.
- [x] Cluster uncertainty by fixture and disclose repeated decisions within a match.

Acceptance tests:

- Every performance row maps to an order the current paper executor can actually express.
- One underlying movement cannot inflate the primary sample through complementary tokens.
- The report shows emissions → unique cases → approved intents → fills as separate counts.

### 4.4 Rerun and report the corrected study

Actions:

- [x] Rerun chronological training/held-out evaluation from scratch.
- [x] Preserve the train/test boundary.
- [x] Report gross CLV, venue-cost sensitivities, unique cases, unique fixtures, and confidence intervals.
- [x] Report model operating cost separately from executable CLV.
- [x] Keep the real-money gate closed regardless of the bounty result.
- [x] Reject unsupported strategy families and make the rejection part of the demo; the one positive Total Goals family remains only a forward-paper candidate.

Acceptance tests:

- A single command regenerates the corrected JSON and Markdown artifacts.
- The generated report contains protocol ID, config hash, source hashes, and causal selector diagnostics.
- No manual result selection occurs after held-out metrics are visible.

---

## 5. P0 — Make paper execution causally honest

### 5.1 Separate market time from knowledge time

`sourceTsMs` says when a market event occurred. `observedTsMs` or processing time says when Samaritan could act on it. Execution readiness must use knowledge time.

Actions:

- [x] Carry signal source time and signal observed/processing time separately.
- [x] Start measured decision latency from actual signal observation/processing.
- [x] Compute `readyAtTsMs` from observation time, not source time.
- [x] Retain source time for provenance, market ordering, and latency measurement.
- [x] Fail closed on invalid, regressing, or impossible observed timestamps.
- [x] Test delayed delivery and reconnect catch-up explicitly.

Acceptance tests:

- A five-second-late event cannot produce an execution before its actual receipt.
- Replaying the same captured source and observed timestamps yields the same eligibility outcome.
- Dashboard evidence shows source → observed → signal → decision-ready → execution timestamps.

### 5.2 Model current Polymarket sports-order behavior

Actions:

- [x] Add the current sports marketable-order placement delay to paper readiness.
- [x] Use the first eligible book after analysis latency **and** venue delay.
- [ ] Parse and validate current accepting-orders, start-time, clear-book, tick, size, and fee metadata required for safe execution.
- [x] Represent delayed, unmatched, partial, filled, and no-fill outcomes explicitly.
- [x] Fail closed if required fee/tick/minimum-size metadata is absent or unsupported.
- [x] Freeze the current sports-order delay and execution-metadata contract in the study configuration.

Acceptance tests:

- A favorable book inside the delay window cannot fill the simulated order.
- A market that stops accepting orders cannot produce an intent or fill.
- A later adverse book is used when it is the first actually eligible execution state.

### 5.3 Attribute AI operating cost

Actions:

- [ ] Record triage and analyst cost per case.
- [ ] Report executable CLV and operating economics as different metrics.
- [ ] Add a deterministic pre-Opus economic-value gate.
- [ ] Allow the gate only to avoid model spend; it must never create or enlarge a trade.
- [ ] Prefer deterministic or Haiku-only handling when Opus cannot plausibly earn its cost.

Acceptance tests:

- Every completed case reports model cost, venue cost, and their units.
- The dashboard never subtracts dollar inference cost directly from probability CLV.
- Opus is not invoked when the configured value threshold fails.

---

## 6. P0 — Make the runtime autonomous and restart-safe

### 6.1 Build one production orchestration entrypoint

The bounty-critical service must connect the implemented pieces without test-only assembly.

Required path:

```text
TXLine/Polymarket events
→ canonical bus
→ feature engine
→ frozen detector
→ case scheduler
→ Haiku
→ Opus
→ deterministic risk
→ paper executor
→ portfolio lifecycle
→ ledger
→ dashboard projection
```

Actions:

- [ ] Add one documented service command for live and one for frozen judge replay.
- [ ] Inject sources at the edge; do not expose a replay/live flag to strategies.
- [ ] Surface feed health, queue state, current cases, terminal failures, and ledger head.
- [ ] Shut down cleanly and finish durable writes before exit.

Acceptance tests:

- One command runs the frozen judge case from input through final receipt.
- The same orchestration accepts live canonical sources without strategy-code changes.
- An agent/API failure becomes a ledgered terminal state, not an unhandled crash.

### 6.2 Reconstruct state from the append-only ledger

Actions:

- [x] Rehydrate seen signals and case terminal states.
- [x] Rehydrate open, closed, and settled positions.
- [x] Recompute exposure, realized P&L, equity peak, and drawdown.
- [x] Recover or deterministically expire pending cases.
- [x] Reject inconsistent or incomplete ledger histories.
- [x] Resume only after local ledger-chain verification and state reconstruction succeed; external Solana verification remains a separate release gate.

Acceptance tests:

- Restarting with an open position retains exactly the same exposure and drawdown.
- Replaying an already-seen signal after restart cannot spend Claude tokens or create another order.
- Corrupt lifecycle ordering prevents startup.

---

## 7. P0 — Turn local integrity into external proof

### 7.1 Version the canonical decision envelope

The record hash must authenticate everything a judge relies on.

Minimum committed fields:

- schema version;
- sequence;
- entry ID;
- case ID;
- event kind;
- event/source timestamp;
- observed timestamp where applicable;
- durable insertion timestamp;
- canonical payload;
- previous hash.

Actions:

- [x] Define one stable canonical serialization.
- [x] Introduce a new hash schema version without destructively rewriting the old ledger.
- [x] Verify every field used by UI or proof claims.
- [x] Add tamper tests for kind, case ID, timestamps, payload, order, and prior hash.

Acceptance tests:

- Changing any committed field breaks verification.
- Old v1 evidence remains identifiable and readable but cannot masquerade as v2 proof.
- The verifier rejects reordered, omitted, duplicated, or rewritten events.

### 7.2 Produce the Samaritan Decision Receipt

Every demonstrated case should export one small, licence-safe receipt containing:

- source proof reference or derived source hash;
- code/config hash;
- signal evidence;
- model and prompt version;
- model cost;
- structured thesis;
- deterministic risk verdict;
- execution intent;
- post-readiness book evidence;
- fill/no-fill;
- close/settlement evidence;
- final ledger head;
- Solana network and transaction signature.

Actions:

- [x] Define the receipt schema.
- [x] Generate receipts directly from verified ledger entries.
- [x] Add a CLI verifier that needs no private database.
- [x] Make receipt verification visible in the dashboard as a separate synthetic evidence class.

### 7.3 Anchor the corrected proof externally

Actions:

- [ ] Anchor at least one corrected v2 ledger head on Solana devnet before the demonstrated outcome is known where possible.
- [ ] Store network, signature, slot, commitment status, and anchored head.
- [ ] Surface a working public explorer link.
- [ ] Verify that the public receipt head equals the anchored value.
- [ ] Add one TXLine Merkle/validation demonstration where the official API permits it.

Acceptance tests:

- A stranger can run the verifier and reach the explorer transaction without a wallet.
- The dashboard distinguishes local integrity, replay parity, and external anchoring.
- No page calls a replay-manifest hash a decision-ledger head.

---

## 8. P0 — Demonstrate one complete product, not ten partial products

### Required evidence pair

#### A. Real captured refusal

Use Spain–Belgium or another verified synchronized capture to demonstrate:

- exact source timing;
- what hypothesis was tested;
- contrary evidence;
- deterministic reason for no trade;
- zero money moved;
- no claim that the case passed through Claude if it did not.

Correct the case classification: stale-quote feasibility evidence must not be labelled `CONSENSUS_MOVE`.

#### B. Complete lifecycle case

Preferred order:

1. A real captured eligible paper case.
2. A captured-book replay of a real eligible case.
3. A clearly labelled synthetic proving fixture if no real case qualifies before recording.

The lifecycle case must show:

- detector signal;
- Haiku decision;
- Opus `submit_thesis` result;
- deterministic risk verdict;
- execution intent recorded before execution;
- post-readiness book;
- fill, partial fill, no-fill, or veto;
- close and settlement;
- decision receipt and external anchor.

Synthetic data must be excluded from every research, profitability, and strategy-performance metric.

### Claude's visible value

Claude should contribute judgment a deterministic detector does not already provide:

- cause classification;
- strongest argument against the trade;
- evidence limitations;
- invalidation conditions;
- market/settlement-rule interpretation where relevant.

Before submission, either:

- [ ] implement the promised minimal read-only evidence tools; or
- [x] change all documentation to describe the analyst accurately as a bounded structured evaluator over a code-assembled evidence bundle.

Never claim tools the runtime does not expose.

---

## 9. P0 — Ship a clean, safe public product

### 9.1 Repository recovery and reproducibility

Actions:

- [x] Review modified and untracked release categories deliberately and freeze the inclusion allowlist in `docs/submission/public-release-scope.md`.
- [x] Remove temporary root scripts, design explorations, and social-render projects from submission scope through `.gitignore` without deleting local work.
- [x] Confirm the current two-commit Git history contains no secret-bearing path or known credential signature; only the safe `phase0/.env.example` is tracked.
- [ ] Commit the intended Phase 3/4/runtime/dashboard work in understandable commits.
- [ ] Add a public remote and push the submission branch.
- [x] Add CI for install, typecheck, tests, build, and frozen-demo verification.
- [x] Pin Node and pnpm requirements.
- [x] Provide a clean-clone quickstart.

Clean-clone acceptance command:

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm demo
```

Expected result: a safe local judge surface with a verified frozen receipt, without private archives or credentials.

### 9.2 Derived-only public artifact bundle

The public demo must not depend on the ignored 8.6 GB `data/` tree or 41 GB `samples/` tree.

Actions:

- [x] Export the minimum judge fixtures from verified receipts.
- [x] Include only transformed, non-reconstructive, licence-safe evidence.
- [x] Replace exact raw/fair-probability histories with movement, deltas, z-scores, aggregates, and decision evidence unless written sponsor approval says otherwise.
- [x] Add a build-time check that raw TXLine payload shapes are absent.
- [x] Document which artifacts are synthetic, captured-derived, and externally verifiable.

### 9.3 Dashboard correction

Required routes:

- Command
- Matchroom
- Casebook
- Study
- Proof/Receipt

Actions:

- [x] Replace offline-only projection assumptions with the frozen public bundle plus runtime API.
- [x] Bind the service to a validated platform-provided interface/port configuration; deployment remains open.
- [x] Correct detector and proof labels.
- [ ] Show zero-state, failure, veto, no-trade, and fill states honestly.
- [x] Surface model cost and execution latency in the captured case and downloadable receipt.
- [x] Surface the exact Solana status (`not_submitted`) and offline verifier result without implying network proof.
- [x] Keep long-run sealed results sealed.
- [x] Remove any present-tense claim for an unimplemented feature from current judge-facing copy.

Acceptance tests:

- The deployed dashboard works on mobile and desktop in an incognito session.
- No wallet, subscription, API key, or authentication is required.
- Every displayed metric can be traced to a frozen public receipt or live derived runtime state.

---

## 10. Legal and sponsor gates

This section is an operational checklist, not legal advice.

### Human participation

The track markets agent products, but the listing metadata and binding terms create ambiguity around agent participation.

- [x] Deborah remains the participant, submitter, narrator, and interview representative in every current submission artifact.
- [x] Claude is described as a constrained runtime component inside Deborah's product.
- [x] The entry is never described as AI-built or autonomously submitted.
- [ ] Obtain written sponsor clarification and retain the response.
- [ ] Deborah can explain every important product and architecture decision.

### TXLine licence

- [x] Publish no raw captures, raw replay files, tokens, or reconstructive feed output in the frozen public bundle.
- [ ] Obtain written clarification for any exact normalized probability series proposed for the public UI.
- [x] Prefer derived signals, transformations, decisions, aggregates, and hashes.
- [x] Document that continued post-hackathon use requires the appropriate licence.

### Submission safety

- [x] No secrets in the intended release tree or current Git history under the recorded path/signature scans; rerun on the final commit.
- [x] No FIFA logo, tournament emblem, team crest, or implication of endorsement; public display copy uses neutral “World Cup” wording.
- [x] No real-money dependency.
- [x] No judge payment, token purchase, wallet, or subscription requirement.
- [x] All judge-facing third-party data services, fonts, assets, and software boundaries are documented in `docs/submission/third-party-notices.md`.

---

## 11. Scope cuts that protect the win

The following work is frozen until every P0 acceptance test above passes:

- Polymarket real-money adapter
- Mainnet execution
- Four-persona tournament
- Head Trader allocation
- MODELER calibration
- Data Doctor agent
- Additional strategy families
- Risk-manager judgment model
- Light theme
- General-purpose plugin architecture
- Multi-competition expansion
- Nonessential animation or dashboard ornament

Exception: a frozen item may only be resumed before submission if all winner-ready gates are green and it materially improves the five-minute demonstration.

---

## 12. Four-day execution order

### July 14 — Truth and causality

- [x] Declare the old gate result invalidated.
- [x] Fix causal total selection and as-of coverage.
- [x] Collapse economic duplicates and resolve sell semantics.
- [x] Correct the execution clock and model venue delay.
- [ ] Verify the scheduled synchronized capture.
- [ ] Send the sponsor clarification questions.
- [ ] Recover and commit the intended working tree.

**End-of-day gate:** corrected study can run; no invalid claim remains judge-facing.

### July 15 — Golden path and durability

- [ ] Add the production orchestration entrypoint.
- [x] Reconstruct state from the ledger on startup.
- [ ] Produce one complete ledgered Claude paper case.
- [x] Produce one real evidence-based refusal.
- [x] Record case-level latency and model cost in the receipt contract; the synthetic proving case records zero stub cost.
- [x] Complete close and settlement evidence for the synthetic proving fixture.

**End-of-day gate:** one command completes the entire product lifecycle.

### July 16 — Proof and public deployment

- [x] Version the complete hash envelope.
- [x] Generate the Decision Receipt.
- [ ] Anchor the corrected head on Solana devnet.
- [x] Ship the independent offline receipt verifier.
- [x] Freeze the licence-safe public artifact bundle.
- [ ] Deploy the read-only dashboard.
- [x] Add CI and verify a clean-clone-shaped bundle without private data; rerun from the final public commit.

**End-of-day gate:** a stranger can reproduce and verify the case without private access.

### July 17 — Submission packaging

- [x] Rewrite README around the judge's 90-second path.
- [x] Draft the required TXLine API feedback for Deborah's final review.
- [ ] Record and edit the demo below five minutes.
- [ ] Rehearse Deborah's narration and likely judge questions.
- [ ] Test every link, command, explorer URL, and mobile layout.

**End-of-day gate:** submission package is complete and frozen.

### July 18 — Submit

- [ ] Run the final clean-clone test.
- [ ] Run CI from the public branch.
- [ ] Watch the uploaded video from beginning to end.
- [ ] Test the deployed MVP incognito.
- [ ] Submit before the internal deadline.
- [ ] Preserve a local copy of the exact submission text and URLs.

July 19 is buffer, not feature-development time.

---

## 13. Five-minute demo script

### 0:00–0:20 — Hook

> “The dangerous thing about an AI trader is not a wrong prediction. It is that nobody can prove what it saw or why it was allowed to touch money.”

### 0:20–0:50 — Authority boundary

Show:

```text
TXLine → deterministic detector → bounded Claude thesis
→ deterministic risk → paper execution → decision receipt
```

State that Claude has no wallet, order, or position-sizing capability.

### 0:50–1:40 — Real captured refusal

Show the synchronized real case:

- event and observation timestamps;
- tested hypothesis;
- market moved first or no stale window existed;
- deterministic no-trade conclusion;
- zero money moved.

Close the segment with: **“Every decision. Especially the pass.”**

### 1:40–3:00 — Complete autonomous lifecycle

Show:

- signal;
- Haiku triage;
- Opus thesis and argument against itself;
- deterministic risk verdict;
- intent recorded before execution;
- latency- and venue-adjusted book;
- fill/no-fill;
- close and settlement.

### 3:00–3:35 — Falsification

Show “Strategies Samaritan refused to deploy”:

- XMARKET rejected;
- FADER rejected;
- Match Result momentum rejected;
- STALE_QUOTE unsupported;
- totals result reported exactly as the corrected study found it.

Do not hide a corrected negative result.

### 3:35–4:20 — Independent proof

Show:

- ordered lifecycle entries;
- receipt hash;
- verifier command;
- Solana explorer transaction;
- TXLine validation reference;
- distinction between local integrity and external anchoring.

### 4:20–4:50 — Production posture

Show:

- passing tests and CI;
- live/replay identity;
- restart reconstruction;
- fail-closed boundaries;
- licence-safe public deployment;
- no-wallet judge access.

### 4:50–5:00 — Close

> **“Samaritan does not promise certainty. It makes autonomous trading accountable.”**

---

## 14. README and submission structure

The public README should answer these questions in this order:

1. What is Samaritan?
2. Why is it different from an AI betting bot?
3. How can a judge run or open it in under 90 seconds?
4. Which TXLine endpoints and fields does it use?
5. What complete case can the judge inspect?
6. What does the Decision Receipt prove?
7. What evidence was rejected or remains inconclusive?
8. What is paper-only and what is unimplemented?
9. What are the legal/data boundaries?
10. Where are the demo, deployed MVP, repository, verifier, and Solana transaction?

Required links near the top:

- Hosted judge MVP
- Demo video
- Public repository
- Quickstart
- Architecture
- Corrected evidence report
- Example Decision Receipt
- Solana explorer transaction
- TXLine API feedback

---

## 15. Judge questions Deborah must be ready to answer

### “Where is the alpha?”

The correct answer is the corrected evidence result, including limitations. The product's novelty is governed autonomous execution and falsification, not an unsupported promise of profit.

### “Why use Claude?”

Claude handles bounded interpretation: competing explanations, contrary evidence, invalidation conditions, and rules ambiguity. It cannot size, approve risk, or place an order.

### “Why TXLine?”

TXLine supplies normalized, low-latency, verifiable sports-market and score evidence suitable for reproducible decisions. Samaritan demonstrates its value through timing, probability normalization, replay parity, health monitoring, and proof references.

### “Can the agent lose money?”

The bounty build is paper-only. In the architecture, deterministic code owns caps, eligibility, execution, drawdown, and the manual kill switch. The real-money gate remains closed.

### “What is actually on-chain?”

Only claim the corrected externally anchored ledger head and its exact receipt. Explain what is locally hash-chained, what is replay-verified, and what Solana timestamps.

### “Can I reproduce this?”

Yes: use the public clean-clone command or hosted no-wallet demo, then verify the frozen receipt independently.

### “What failed?”

Explain the rejected strategies and the selector causality defect openly. The system is designed to reject weak or invalid evidence before money is authorized.

---

## 16. Final submission kill criteria

Do not submit a claim or feature if any of these is true:

- It requires private raw TXLine data to understand or reproduce.
- It cannot be demonstrated from the public branch.
- It relies on the invalidated historical selector.
- It counts a decision the current executor cannot express.
- It uses source time as though it were observation time.
- It ignores the current venue delay.
- It calls an unanchored or incomplete hash external proof.
- It resets risk state after restart.
- It implies real-money readiness.
- It requires a judge wallet, payment, token, API key, or subscription.
- Deborah cannot explain it confidently in a live interview.

---

## 17. Final rally point

The winning move is not to look like the biggest system in the competition.

It is to be the most complete, honest, and verifiable autonomous system a judge can actually run.

> **Fix the evidence. Finish one vertical slice. Prove every boundary. Ship the receipt.**
