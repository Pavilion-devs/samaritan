# 05 — The Agent Harness

*v0.3 (July 14, 2026). Status: target harness with the implemented bounty slice identified below.*

> **Implementation boundary:** the current analyst is one bounded Opus call over the detector signal bundle and its only tool is `submit_thesis`. The multi-call investigative loop, pull-based evidence tools, episodic retrieval, risk-agent pass, debate council, learned-memory workflow, and Data Doctor are design targets, not current submission claims. The implemented path is deterministic scheduling, strict Haiku/Opus outputs, paper risk/execution, portfolio lifecycle, restart reconstruction, spend/decision ledgers, and a synthetic end-to-end proving case.

## 0. The core abstraction: the CASE

Claude Code's unit of work is a user turn. Samaritan's unit of work is a **Case** — one flagged signal moving through a pipeline until it dies or becomes a position. Everything in the harness exists to move cases.

```
                        ┌──────────── invalidation can strike at ANY stage ────────────┐
                        │  (TTL expiry · score event · price moved past tolerance ·     │
                        │   feed degradation · budget exhaustion · kill switch)         │
                        ▼                                                               │
DETECTED ──▶ TRIAGE ──▶ INVESTIGATING ──▶ THESIS ──▶ RISK_REVIEW ──▶ EXECUTING ──▶ FILLED
   │           │              │             │            │               │            │
   │        dropped        NO_TRADE      (none)       VETOED          EXPIRED         ▼
   │           ▼              ▼                          ▼               ▼         SETTLED
   └────────────────────── every terminal state ──────────────────▶ POST_MORTEM ──▶ LESSONS
```

A case is a **typed record**, not a conversation: `{case_id, signal, evidence_bundle, ttl, budget, stage, agent_turns[], thesis?, risk_verdict?, fills[], outcome?, clv?}`. Append-only. The full agent transcript of every turn is attached — any case can be audited ("why did you buy Ghana?") months later, and replayed against a newer prompt to regression-test prompt changes.

## 1. The agent loop — deterministic spine, model at the joints

The loop is **code-driven, not model-driven**. Claude Code lets the model decide the next action every turn; Samaritan inverts control for the pipeline itself — *code* decides which stage runs next, and the model gets autonomy only *inside* a stage. Markets punish wandering agents; the pipeline never wanders.

```
while case.alive:
    stage      = pipeline.next(case)                     # code decides
    context    = assemble_context(case, stage)           # code decides (§2)
    result     = run_stage(stage, context)               # agent OR pure function
    case       = ledger.append(case, result)             # before anything acts on it
    invariants.check(case)                               # hooks — code, unoverridable
```

The implemented INVESTIGATING stage is deliberately smaller: one bounded call, one strict exit tool, a maximum output budget, and a hard request timeout. A future multi-call loop may add a maximum `K`, but it is not part of the bounty runtime.

The paper runtime splits judgment from execution. It appends `signal_received` before model I/O, measures real wall-clock time through triage and analysis, maps completion back onto event time, and appends `analysis_completed`. Only then can the first later canonical book become an execution candidate. Model-supplied timestamps are replaced by deterministic completion/expiry stamps, so an analyst cannot shorten reported latency or extend its own validity window.

**Stage table:**

| Stage | Executor | Bounded by | Exit |
|---|---|---|---|
| TRIAGE | Haiku 4.5, single turn, submission tool only | 1 call, 512 output tokens, 60 s | drop / escalate(+priority) |
| INVESTIGATING | Opus 4.8 adaptive thinking, bounded evidence bundle | 1 call initially, 8,192 output tokens, 180 s | `submit_thesis` carrying paper-trade or no-trade |
| RISK_REVIEW | Rules engine (code) → Opus judgment pass | 1 call | veto / resize-down / approve |
| EXECUTING | Adapter (code only) | price-tolerance recheck | filled / expired |
| POST_MORTEM | Batch job (Haiku/Opus, off-peak) | daily budget | lesson entries |

## 2. Context assembly — the harness's real IP

The single biggest quality-and-cost lever. The model never "goes and fetches everything"; **code builds the case file** and the model starts warm. Assembly per stage:

1. **Static prefix (prompt-cached, byte-stable):** Samaritan constitution (who you are, what a thesis is, what you may never do) + the strategy persona's playbook + tool schemas. Changes only via versioned deploy — cache-friendly and auditable.
2. **Strategy memory (semi-static, cached with 1h TTL):** current distilled lessons for this strategy (§4) + current calibration certificates + current market-regime note.
3. **Case evidence bundle (dynamic, assembled by code):**
   - the signal payload with the exact trigger math (which books, what z-scores, what lags),
   - windowed series excerpts *pre-rendered as compact tables* (not raw JSON dumps — token discipline),
   - current match state + last N score events,
   - Polymarket book snapshot at detection time,
   - **k nearest historical cases** (same detector, similar market/state) with their outcomes and CLV — retrieved from the ledger by feature similarity. This is episodic memory doing real work: the analyst sees how prior CONSENSUS_MOVE cases with similar magnitude/persistence behaved.
4. **Freshness stamp:** every evidence item carries its timestamp; the thesis must reference evidence ≤ TTL-fresh, enforced at submit.

The current INVESTIGATING call receives the signal and triage output assembled by code. Its only tool is `submit_thesis`, whose recommendation is either `paper_trade` or `no_trade`. Proposed pull-based extensions—`query_series`, `get_match_state`, `get_polymarket_book`, `web_search`, and `find_similar_cases`—are not wired into the current runtime.

## 3. Deliberation design — when agents debate (the two-speed answer)

The rival memo proposed subagent debate per signal. Debate demonstrably improves judgment quality — and costs 2–4× calls and tens of seconds. Markets set our deadlines, so the harness runs **two speeds**:

**Fast path (case pipeline — seconds to low minutes).** No debate. The adversarial structure is already built in as *sequential opposition*: the analyst must argue FOR (thesis includes an explicit `steelman_against` field — it must write the best case against itself), and the risk manager's judgment pass reads the thesis *specifically hunting for the weakness*. Two adversarial reads, two calls, no committee latency.

**Slow path (deliberation council — minutes to hours, no market deadline).** Full structured debate is used where it earns its cost:
- **Strategy promotion/demotion:** persona moves between paper→real or real→benched only after an advocate agent and a skeptic agent argue over its CLV/calibration record, and a judge agent (fresh context, sees only the two briefs + the numbers) rules. Human confirm on any real-money promotion.
- **Market mapping verification:** one agent maps TXLine market ↔ PM condition; a second independently re-derives the mapping from the PM rules text; mismatch → human.
- **Parameter-change proposals (§4, self-improvement).**
- **Weekly deep post-mortems:** what class of case are we systematically wrong about?

One mechanism, honest accounting: debate is a *governance* tool, not a *trading* tool.

## 4. Memory architecture — four stores, four update rules

"Like Claude Code" means memory is files/records with explicit update discipline — not a vector-soup that drifts.

| Store | Contents | Written by | Read by | Update rule |
|---|---|---|---|---|
| **Episodic** (the ledger) | Every case, full transcript, outcome, CLV | Harness (append-only) | Context assembly (`find_similar_cases`), gate studies | Automatic; immutable; THE ground truth |
| **Semantic** (strategy playbooks) | Distilled lessons per strategy with evidence links to case_ids | POST_MORTEM proposes → **Deborah's daily review gate** merges | Analyst context (§2.2) | Lessons carry provenance and a validity horizon; contradicted lessons are retired, not edited |
| **Parametric** (config) | All θ thresholds, leader set L, g_state multipliers, calibration certs | **Gate process only** — replay-validated change sets | Detectors, model, sizing | An agent may PROPOSE a change; it applies only after passing the same replay gate as a human change. No agent writes config. Ever. |
| **Working** (case file) | The evidence bundle + agent turns of one case | Harness during the case | The case's own stages | Dies with the case (into episodic) |

**The self-improvement loop, fully stated:** settle → score (CLV/Brier) → nightly discounted batch POST_MORTEM reviews the day's cases → proposes lesson entries (semantic) and threshold nudges (parametric) → Deborah reviews proposed lessons daily (~5 minutes) → parameter proposals queue for replay validation → validated changes deploy versioned. **Nothing learned can bypass the gate.**

## 5. Scheduler, budgets, degradation

- **Priority queue** over live cases: `priority = f(expected_edge × stake_capacity, ttl_remaining)`. V1 concurrency cap is **3** concurrent INVESTIGATING cases.
- **Preemption:** a score event on a fixture instantly invalidates that fixture's in-flight cases back to TRIAGE (the world changed; the evidence is stale). This is a hook, not a model decision.
- **Token budgets:** per-case caps (triage 512 out; investigation 8,192 out), per-day controls, **$200 operating target**, and **$300 hard project ceiling**. An append-only SQLite spend ledger atomically reserves worst-case request cost before network I/O, settles measured usage afterward, and conservatively charges the reservation when billing is unknown. Degradation ladder: raise triage escalation bar → shrink K → pause lowest-CLV persona → detectors-only mode. At the hard ceiling all new model investigations stop; signals continue to be logged and no model-dependent real trade can proceed.
- **Prompt-cache discipline:** static prefix byte-stable per deploy; per-case content strictly after the cache breakpoint; cache hit rate is a monitored metric (a silent invalidator is a 10× cost bug).
- **Clock discipline:** market/book freshness is checked in canonical event time; public fee-metadata freshness is checked in processing wall time. Neither clock is rewritten to make replay pass.

## 6. Hooks — the unoverridable layer

Claude Code has hooks that fire around tool use regardless of what the model wants; Samaritan's equivalents, all pure code:

| Hook | Fires | Enforces |
|---|---|---|
| `pre_stage` | before any agent turn | budget/TTL/kill-switch/feed-health; stale case → invalidate |
| `post_thesis` | on `submit_thesis` | schema validity, evidence freshness stamps, `steelman_against` non-empty, market unchanged beyond tolerance |
| `pre_execute` | before any order | ALL deterministic risk rules re-checked at execution time (not thesis time — prices moved), venue gating (real-money = pre-match only), mapping `settlement_verified` |
| `post_fill` | after any fill | ledger completeness, exposure bucket update, anchor queue |
| `feed_watch` | continuous | Data Doctor: gaps/latency/schema drift → trading halt (resume is human-only) |

## 7. Failure containment

Every agent stage has a deterministic fallback: triage times out → case dropped (never auto-escalated); analyst times out → NO_TRADE; risk judgment pass errors → VETO (fail-closed, always); Polymarket adapter errors → position-state reconciliation before any retry (never re-fire blind); process crash → cases rebuilt from ledger + SSE resume via `Last-Event-ID` + snapshot backfill. The harness's disposition under failure is uniformly: **do less, log more, never guess.**

## 8. What this harness is NOT

- Not a chat app with market data in the prompt.
- Not a model free-running with execution tools — the model cannot place, size, or modify orders under any prompt in any state.
- Not a monolith prompt — every stage is separately versioned, separately evaluated (each has its own metric: triage precision, thesis CLV, veto quality), separately replayable against historical cases.

## Locked governance

- Deborah is the v1 lesson-review gate, approximately five minutes daily.
- INVESTIGATING concurrency is capped at 3.
- Post-mortems run nightly through the discounted batch path; they never delay live cases.
- Parameters still change only through replay validation, and any promotion to real money requires Deborah.
