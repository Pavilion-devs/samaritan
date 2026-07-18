# Samaritan UI/UX Specification

*Status: Deborah approved the editorial Overview, Live Match, and Decisions direction on July 18, 2026. They establish the binding navigation and evidence language for the public observer; Performance and Proof retain their specialized layouts until their deliberate migration. Real-money gates are unchanged.*

> **July 18 governance status:** paper-study v1 is invalidated, suspended, and preserved only as zero-observation audit history. Deborah registered corrected v2 for forward paper observation only. The dashboard must show registration separately from evidence: v2 has no qualifying observation until a fresh fixture passes every admission gate, and the real-money gate remains closed.

## 1. Product position

Samaritan is a **sports-market intelligence command center**. It is not an exchange, sportsbook, tipster feed, wallet, or generic AI assistant.

The interface is optimized for this sequence:

1. **Detect:** what changed in the sports and market data?
2. **Judge:** why might the change matter?
3. **Gate:** what did deterministic risk allow or reject?
4. **Act:** what paper action was attempted, and was it filled?
5. **Measure:** did the decision earn executable closing-line value after costs?
6. **Prove:** can a user verify that the decision and result were not rewritten later?

The public product promise is not "Samaritan predicts winners." The honest promise is:

> Samaritan detects cross-market sports signals, subjects them to bounded machine judgment and deterministic risk, and produces a replayable, measurable, verifiable decision record.

The primary visual object is a **match under analysis**, not a P&L number.

## 2. Binding UX constraints

These constraints come from Samaritan's architecture, evidence protocol, and hackathon terms. They are not optional visual preferences.

1. **Read-only public access.** Judges and public observers must not need an account, wallet, token, payment, or browser wallet extension.
2. **No public order entry.** The public app never displays a trade button, wallet connection, deposit flow, approval flow, or controls that imply Samaritan holds user funds.
3. **No raw TXLine redistribution.** Public screens expose derived probabilities, signals, decisions, source labels, message references, validation status, and hashes. They do not expose or reconstruct the licensed raw feed.
4. **No fake activity.** Live, captured replay, paper, exploratory, sealed, vetoed, expired, and no-trade states must be explicit.
5. **No profitability claim before evidence.** CLV, fill rate, P&L, Brier score, costs, drawdown, and sample size appear together. Empty or sealed endpoints remain visibly empty or sealed.
6. **Every action has provenance.** A signal cannot appear as a fill without the intervening triage, thesis, deterministic risk, and execution states.
7. **Risk state is prominent.** `PAPER MODE` and `REAL-MONEY GATE CLOSED` remain persistent while those conditions are true.
8. **Replay and live share one presentation model.** Replay controls time; they do not change the meaning, ordering, or shape of decision data.
9. **Failure is visible.** Feed degradation, stale projections, unavailable books, model errors, and rejected cases are first-class states, not hidden behind blank charts.
10. **Submission framing remains compliant.** Public copy presents Deborah as the participant/project owner and Claude as a bounded component. The entry is never described as "AI-built."

## 3. Audiences and product surfaces

### Public Observer - build first

The observer is a judge, analyst, potential user, or teammate who needs to understand Samaritan without configuration or credentials.

The observer can:

- inspect live and captured matches;
- follow a case from signal to result;
- understand no-trade and risk-veto decisions;
- review paper-study progress and measured outcomes;
- inspect ledger integrity and on-chain proof links;
- replay a verified sequence deterministically.

The observer cannot mutate configuration, reveal credentials, alter the replay source, resume a halted system, or submit an order.

### Private Control - later

The operator surface belongs to Deborah and is separate from the public product. It will eventually contain feed controls, configuration, mapping confirmation, kill-switch state, and system governance. It must not be implemented by placing hidden admin controls inside public components.

### Mobile Companion

Mobile is an observation and alert surface, not a compressed desktop terminal. It prioritizes match state, the active signal, the Decision Rail, study progress, and proof links. Dense comparative analysis remains desktop-first.

## 4. Information architecture

The public navigation contains five destinations.

| Destination | Job |
|---|---|
| **Overview** | Answer "what is Samaritan watching and doing now?" |
| **Live match** | Explain one fixture, its selected market, probability movement, and active decision lifecycle |
| **Decisions** | Search and inspect every signal, escalation, veto, no-trade, fill, close, and settlement |
| **Performance** | Explain the invalidated v1 audit, corrected historical signal evidence, and the human gate before any v2 paper observations |
| **Proof** | Verify ledger hashes, replay identity, source references, validation records, and the exact Solana anchor status |

There is no marketing-only landing page in v1. The root route opens **Overview**, with the product explanation integrated into the current watch, decision path, featured case, and quiet proof rail.

## 5. Global shell

Every primary screen uses the same shell:

- compact Samaritan wordmark and section navigation;
- global search for a fixture or case ID;
- persistent system strip;
- main content canvas;
- last-updated timestamp and projection freshness;
- direct access to the current demo replay when no live fixture is active.

The system strip displays, at minimum:

- mode: `LIVE`, `CAPTURED REPLAY`, or `OFFLINE ARTIFACT`;
- execution: `PAPER MODE` or an accurately gated alternative;
- feed health: TXLine, Polymarket, decision runtime, and proof writer;
- real-money gate state;
- last canonical event time;
- end-to-end signal decision latency when available;
- Claude spend state as a bounded operational metric, not as a promotional gimmick.

Status must use text and iconography in addition to color.

## 6. Signature components

### Match Masthead

Displays teams, home/away identity, competition text, scheduled kickoff or live clock, current score, market period, and selected exact market line. It must distinguish full-time Match Result from full-time totals and must never imply an extra-time market.

### Probability Field

The main chart compares derived fair consensus with the executable Polymarket market:

- TXLine-derived fair probability;
- executable best bid and ask, not only midpoint;
- optional midpoint as secondary context;
- selected signal direction and threshold;
- market gap in probability points and basis points;
- feed outages and unavailable-book intervals;
- score and material match events when licensed derived context permits;
- entry, close, and settlement markers;
- chart time and replay time locked to the same clock.

This is a probability chart, not a crypto candlestick chart.

### Decision Rail

The Decision Rail is Samaritan's signature interaction. It renders the append-only case lifecycle as an ordered, timestamped sequence:

1. `SIGNAL DETECTED`
2. `TRIAGE DROPPED` or `TRIAGE ESCALATED`
3. `THESIS SUBMITTED` or `NO TRADE`
4. `RISK VETOED`, `RISK SHRUNK`, or `RISK APPROVED`
5. `PAPER INTENT LEDGERED`
6. `FILLED`, `PARTIALLY FILLED`, `NOT FILLED`, or `EXPIRED`
7. `CLOSE CAPTURED`
8. `SETTLED`
9. `PROOF ANCHORED`

Each stage expands to show only the evidence appropriate to that stage. Claude output appears as a structured thesis with confidence, invalidation, and evidence references. It is never presented as a chatbot conversation.

### Signal Tape

A chronological tape of candidate cases across fixtures. Each row includes time, fixture, market, detector, direction, gap, disposition, and age. Repeated movements that triage deduplicated remain traceable to the surviving case.

### Evidence Stamp

A compact, high-contrast label used on cases and reports:

- `PAPER`
- `EXPLORATORY`
- `LONG-RUN SEALED`
- `VERIFIED REPLAY`
- `NO TRADE`
- `RISK VETO`
- `FEED DEGRADED`
- `REAL-MONEY GATE CLOSED`

Stamps are semantic states, not decorative badges.

### Study Meter

Shows the stopping rule without revealing sealed endpoints early:

- matches with an eligible signal vs required matches;
- signals vs required signals;
- study start time;
- lane identity: bounty or long-run;
- sealed/unsealed state;
- drawdown-stop state;
- config hash.

### Integrity Panel

Links the visible case to ledger sequence, previous hash, record hash, replay identity, source message references, validation status, and Solana anchor when available. Long hashes truncate visually but remain copyable and fully available in the detail view.

## 7. Screen specifications

### Command

**Purpose:** establish system status and route the user to the most important fixture or case within ten seconds.

Required content:

- current system strip;
- optional live derived TXLine connectivity pulse, labelled `NOT STUDY EVIDENCE`, with a degraded state when server-side SL12 credentials are absent or invalid;
- active and upcoming verified fixtures;
- strongest recent signals, including vetoes and no-trades;
- current paper-study stopping-rule progress;
- latest verified evidence artifact;
- one sentence explaining what Samaritan does;
- one primary action: `Watch active match` or `Replay verified case`.

The Command screen must not be a grid of equal-weight KPI cards. One active match or verified replay is the visual lead.

Low-fidelity composition:

```text
+-----------------------------------------------------------------------+
| SAMARITAN | COMMAND | MODE | FEEDS | GATE | LAST EVENT                |
+-----------------------------------------------------------------------+
|                                                                       |
| ACTIVE MATCH / FEATURED VERIFIED REPLAY                               |
| France 0 - 0 Spain | 42:18 | Full-time O/U 2.5                       |
|                                                                       |
| Fair 55.2% | Ask 51.4% | Gap +3.8pp | SIGNAL UNDER REVIEW            |
| [Watch match]                                      mini probability   |
|                                                    field              |
+--------------------------------------+--------------------------------+
| RECENT CASES                         | PAPER STUDY                    |
| 12:41 CONSENSUS_MOVE  ESCALATED      | 8 / 20 matches                |
| 12:32 CONSENSUS_MOVE  NO TRADE       | 17 / 40 signals               |
| 12:08 FEED DEGRADED   HALTED         | LONG-RUN SEALED               |
| [Open Casebook]                      | [Open Study]                  |
+--------------------------------------+--------------------------------+
| LATEST PROOF | ledger head | replay identity | anchor status          |
+-----------------------------------------------------------------------+
```

### Matchroom

**Purpose:** make one autonomous decision understandable and auditable.

Desktop composition:

```text
+-----------------------------------------------------------------------+
| SAMARITAN | MODE | FEEDS | GATE | LATENCY | LAST EVENT                |
+-----------------------------------------------------------------------+
| FRANCE 0        FULL-TIME O/U 2.5        0 SPAIN        42:18         |
+---------------------------------------------+-------------------------+
|                                             | DECISION RAIL           |
| CONSENSUS VS EXECUTABLE MARKET              |                         |
|                                             | 12:40 signal detected   |
| TXLINE FAIR       55.2%                     | 12:40 triage escalated  |
| BEST ASK          51.4%                     | 12:41 thesis submitted  |
| EXECUTABLE GAP    +3.8pp                    | 12:41 risk approved     |
|                                             | 12:42 paper fill        |
+---------------------------------------------+-------------------------+
| SIGNAL TAPE                                                          |
+-----------------------------------------------------------------------+
| STUDY 8/20 MATCHES | 17/40 SIGNALS | LONG-RUN SEALED | CONFIG HASH    |
+-----------------------------------------------------------------------+
```

The chart receives the largest area. The Decision Rail remains visible while inspecting chart points or replaying the case.

Mobile composition:

```text
+--------------------------------+
| SAMARITAN | PAPER | GATE CLOSED|
+--------------------------------+
| FRANCE 0 - 0 SPAIN      42:18  |
| FULL-TIME O/U 2.5              |
+--------------------------------+
| ACTIVE SIGNAL                  |
| Fair 55.2%  Ask 51.4%  +3.8pp |
+--------------------------------+
| COMPACT PROBABILITY FIELD      |
|                                |
|                                |
+--------------------------------+
| DECISION RAIL                  |
| 12:40 Signal detected          |
| 12:40 Triage escalated         |
| 12:41 Thesis submitted         |
| 12:41 Risk approved            |
+--------------------------------+
| STUDY 8/20 | 17/40 | SEALED    |
| [Inspect proof]                |
+--------------------------------+
```

### Casebook

**Purpose:** prove that Samaritan records unfavorable, rejected, and incomplete cases as faithfully as successful ones.

**Current evidence boundary:** the shipped offline Casebook is not yet the future operational decision ledger described below. It projects all 18 goal×market feasibility observations reported by the one verified Spain-Belgium capture replay (12 pre-trigger moves, 6 without a material 30-second move, 0 clean stale windows). A deterministic Match Result observation is the only expanded three-state detail exemplar; the UI labels that selection and does not present it as the whole corpus or as performance evidence.

Filters:

- fixture;
- market family and exact line;
- detector;
- lifecycle disposition;
- execution outcome;
- evidence lane;
- live/replay source;
- date range.

Default sorting is newest decision time. Success-only filtering is never the default. Case detail opens the complete Decision Rail, executable book evidence, costs, thesis, steelman/invalidation, risk reasons, hashes, and measured outcome.

Low-fidelity composition:

```text
+-----------------------------------------------------------------------+
| SAMARITAN | CASEBOOK | MODE | FEEDS | GATE                            |
+-----------------------------------------------------------------------+
| Search cases... | Fixture | Detector | Disposition | Lane | Date      |
+--------------------------------------+--------------------------------+
| CASE INDEX                           | SELECTED CASE                  |
|                                      |                                |
| 12:41 France-Spain                   | CASE PS-000184                 |
| O/U 2.5 | CONSENSUS_MOVE             | France-Spain | O/U 2.5         |
| ESCALATED -> RISK APPROVED           | EXECUTABLE GAP +3.8pp          |
|                                      |                                |
| 12:32 England-Argentina              | DECISION RAIL                  |
| O/U 2.5 | CONSENSUS_MOVE             | signal -> triage -> thesis     |
| NO TRADE                             | -> risk -> fill -> close       |
|                                      |                                |
| 12:08 Spain-Belgium                  | THESIS / INVALIDATION          |
| FEED DEGRADED -> HALTED              | structured public evidence     |
|                                      |                                |
| [Load older cases]                   | COSTS / RESULT / PROOF         |
+--------------------------------------+--------------------------------+
```

### Study

**Purpose:** show why v1 was withdrawn, what corrected historical evidence supports, and why no active paper protocol exists until Deborah registers v2.

Required views:

- stopping-rule progress;
- executable CLV distribution and match-clustered confidence interval;
- random-direction and no-trade baselines;
- fill rate and modeled/actual slippage;
- spread, fees, and total cost decomposition;
- per-match P&L table;
- equity and drawdown curve;
- Brier score where applicable;
- clear `ACCEPT`, `REJECT`, `INCOMPLETE`, or `SEALED` conclusion generated from deterministic protocol rules.

The page must keep sample size and lane identity visible alongside every headline result.

### Proof

**Purpose:** show that the visible history is append-only and replayable.

Required views:

- ledger head and segment identity;
- hash-chain verification status;
- replay event count and identity hash;
- source-reference validation status;
- Solana anchor status, with an explorer link only when an actual transaction has been submitted and verified;
- explicit distinction between local verification, TXLine validation, and on-chain anchoring.

The bounty release is intentionally unanchored and displays `NOT SUBMITTED`; it must not show a placeholder or fake explorer link. A future separately authorized anchor may replace that state only after network verification succeeds.

## 8. Visual direction: Editorial Intelligence

Editorial Intelligence is a polished sports-market product, not a trading terminal, sportsbook, or generic admin dashboard. The public Overview, Live Match, and Decisions routes use Samaritan's social language as their source of truth: warm paper, navy typography, an electric-blue signal path, large editorial statements, generous negative space, and progressive evidence disclosure. Live Match keeps its analytical depth through the synchronized Probability Field and Decision Rail; Decisions presents the full 18-observation corpus as an ordered journal with one explicitly marked three-state exemplar. The remaining evidence routes retain specialized composition until migrated.

The two layers remain one product. Overview establishes the match, market, signal, decision, and trust hierarchy in seconds; deeper routes expose the complete Decision Rail, replay identity, provenance, study state, and deterministic risk boundaries.

The interface should feel composed, disciplined, football-native, and evidence-led. It must not resemble a casino, crypto exchange, generic admin template, or faux command center. Overview, Live Match, and Decisions may use oversized editorial typography and a warm grid canvas, but never decorative data claims, fake live activity, photographic spectacle, or market theatrics.

### Color tokens

| Token | Value | Use |
|---|---:|---|
| `navy-1000` | `#050716` | Sidebar and deepest application surface |
| `navy-950` | `#080B20` | Global workspace |
| `navy-900` | `#0D112B` | Primary cards and analytical surfaces |
| `navy-750` | `#1B244B` | Selected tabs and raised controls |
| `text` | `#F7F8FC` | Primary text and score data |
| `text-soft` | `#BBC2DD` | Secondary headings and table values |
| `muted` | `#7D87AA` | Labels, timestamps, and explanations |
| `signal` | `#98F244` | Active navigation, verified replay, TXLine fair series |
| `market` | `#927FF2` | Polymarket ask series and spread region |
| `context` | `#5B86FF` | Supporting metrics and selected evidence |
| `risk` | `#FF6B74` | Veto, invalidity, closed execution, or failure |
| `degraded` | `#FFAF58` | Delayed, partial, outage, or observational warning |

Color meanings are fixed. Green must not mean "profitable" in one view and "feed healthy" in another without an accompanying label. Red is reserved for real risk, failure, invalidity, or veto.

All foreground/background combinations must pass WCAG AA contrast before the palette is frozen in code.

### Typography

- **Manrope:** navigation, scores, teams, probabilities, headings, controls, and explanatory text.
- **IBM Plex Mono:** timestamps, case IDs, prices, basis points, latency, ledger sequence, and hashes.

Fonts should be self-hosted or packaged with the deployment. Numeric data uses tabular figures. Large score and probability typography may be expressive; evidence text remains restrained.

### Geometry and density

- 12-column desktop grid with a fluid content width up to approximately 1600 px;
- 20-24 px desktop gutters, 12-16 px compact gutters;
- 4 px base spacing rhythm;
- 14-18 px default panel radius;
- quiet one-pixel blue-gray borders with shallow panel shadows;
- one dominant analytical panel per screen;
- limited use of pills, reserved for filters and compact states;
- no glassmorphism, floating orbs, excessive glow, decorative 3D assets, or editorial poster composition.

### Iconography

Use a consistent outlined icon family for navigation and state. Do not use team or FIFA trademarks without clear rights. Flags, generic team initials, and plain text remain acceptable fallbacks.

## 9. Data visualization rules

1. Probability is the universal display currency and is shown as a percentage at the edge of the UI.
2. The y-axis never truncates in a way that exaggerates small probability moves without an explicit visual break.
3. Best bid and ask are visually distinct from midpoint and fair consensus.
4. Executable CLV is primary; midpoint CLV is secondary and labeled.
5. Feed outages are gaps or shaded unavailable intervals, never interpolated as unchanged prices.
6. Entry, close, and settlement markers are tied to ledger timestamps.
7. Charts expose exact values through keyboard-accessible focus or a data table alternative.
8. Series use both color and line treatment, marker, or label so color vision is not required.
9. Confidence intervals show the estimate, lower and upper bound, bootstrap unit, and sample size.
10. No decorative chart is permitted. Every visual must answer a named product question.

## 10. Motion

Motion communicates state transitions rather than decoration.

Allowed motion:

- probability lines updating with restrained interpolation;
- a new signal entering the Signal Tape;
- a case advancing along the Decision Rail;
- replay cursor movement and event markers;
- a short page-load reveal that establishes hierarchy.

Avoid constant pulsing, animated gradients, card hover theatrics, confetti, fake terminal typing, and ambient chart motion. Respect `prefers-reduced-motion`; replay must remain usable with motion reduced.

## 11. Content design

Copy is concise, factual, and evidence-led.

Preferred:

- `No executable book was available after decision latency.`
- `Risk veto: aggregate fixture exposure would exceed $15.`
- `Long-run endpoints remain sealed until the stopping rule is met.`
- `Captured replay from July 10, 2026. Not live.`

Avoid:

- `AI found a guaranteed winner.`
- `High-confidence profit opportunity.`
- `The model knows Spain will win.`
- `Connect wallet to continue.`

Claude should be named only where its bounded role matters: `Haiku triage` and `Opus analysis`. Product copy emphasizes the system and evidence, not model personality.

## 12. Responsive behavior

### Desktop

Desktop is the full analytical environment. Matchroom keeps the Probability Field and Decision Rail visible together. Wide tables may use sticky identity columns and horizontal scrolling inside their own region.

### Tablet

The chart remains first. The Decision Rail becomes a fixed-width adjacent panel in landscape and a full-width section below the chart in portrait. Global system health collapses into a labeled summary that expands on demand.

### Mobile

Mobile order:

1. system mode and gate;
2. match masthead;
3. active signal summary;
4. compact probability chart;
5. Decision Rail;
6. study progress;
7. proof link.

The complete signal table and dense study tables may switch to grouped rows, but no evidence field may disappear solely because of viewport size.

## 13. Accessibility

- Target WCAG 2.2 AA.
- Every interactive element is keyboard reachable with visible focus.
- Status never depends on color alone.
- Live updates use restrained, appropriately scoped announcements rather than reading every tick.
- Replay controls expose play/pause, speed, step backward, step forward, current time, and event list.
- Charts provide summaries and tabular alternatives.
- Touch targets are at least 44 by 44 CSS pixels on compact layouts.
- User-selected zoom to 200% must preserve core workflows.

## 14. Public data and technical boundary

The browser consumes **derived, read-only projections**, never raw ledger files, raw TXLine captures, server credentials, wallet material, or execution adapters.

The server-side projection layer should expose five conceptual view models:

- `SystemProjection`: mode, health, gate, freshness, latency, and spend status;
- `MatchProjection`: fixture identity, derived match state, selected market, and probability series;
- `DecisionCaseProjection`: ordered lifecycle stages and public evidence;
- `StudyProjection`: stopping rule, sealed status, metrics, guardrails, and per-match rows;
- `ProofProjection`: public hashes, verification results, anchor status, and an explorer link only for a verified submitted transaction.

These names describe frontend contracts; they do not freeze route names or storage schemas.

Rules:

1. Projection generation is deterministic from append-only artifacts.
2. Secrets remain server-side.
3. Raw TXLine payloads and reconstructable raw series are never serialized to public clients.
4. Live updates carry derived projection deltas over a read-only stream.
5. Replay emits the same projection shapes and lifecycle semantics as live.
6. The client cannot mutate execution, risk, mapping, study, ledger, or anchor state.
7. The UI displays server event time and projection-generation time separately when freshness matters.
8. Unknown enum values fail visibly as `UNKNOWN STATE`; they are not silently mapped to success.

## 15. Replay and demo mode

The replay player is a core product capability because judges may review Samaritan after a match has ended.

Required controls:

- play and pause;
- 0.5x, 1x, 2x, 5x, and 10x speed where the event density permits;
- step to previous or next material event;
- restart;
- timestamp and original match date;
- visible `CAPTURED REPLAY` label at all times.

The demo sequence must use real captured or ledger-derived artifacts. A case may demonstrate a no-trade or veto when that is what the evidence produced. Spain-Belgium may honestly demonstrate synchronized capture, feed outages, and rejection of the stale-quote hypothesis; it must not be edited into a winning trade.

Golden demo flow:

1. Command establishes paper mode, evidence class, feed health, and the closed real-money gate.
2. Matchroom shows the real Spain–Belgium capture and its justified no-trade result; it does not claim Claude or execution ran for that case.
3. The separate, unmistakably synthetic proof panel emits one invented detector signal through deterministic Haiku-shaped and Opus-shaped stubs.
4. Deterministic risk authorizes the paper-only synthetic intent after its ledger records are written.
5. The paper adapter records the synthetic fill, close, settlement, and receipt; the case remains excluded from performance evidence.
6. Study and Proof distinguish the real research result from the synthetic integrity demonstration.

## 16. Design and implementation sequence

The v1 and v2 comparison checkpoints remain in the private, gitignored `design/` workspace and are intentionally excluded from the public repository. Their approved dark-hybrid direction is implemented in the production dashboard; this public document does not link to unavailable private assets.

The editorial light Overview, Live Match, and Decisions now share the production shell. Performance and Proof retain their darker analytical treatment until they are deliberately migrated to the same editorial system; semantic-state and information-boundary parity are mandatory throughout that migration.

Both checkpoints use the verified Spain-Belgium capture and deliberately end in `NO TRADE`: the live-lane study found that Polymarket moved before TXLine and produced no clean stale-quote window. They are design prototypes, not production frontend code.

### Production implementation status

The five primary observer routes are implemented in [`apps/dashboard/`](../apps/dashboard/) and served by the read-only projection layer in [`src/dash/`](../src/dash/). Command, Matchroom, and Casebook use the approved warm editorial shell. Matchroom renders one deterministic exemplar from the verified Spain-Belgium replay, Command derives the operating posture and capture schedule, Casebook projects all 18 reported goal×market feasibility observations from that replay, Study separates registered v2 from preserved v1 audit history, and Proof verifies the synthetic receipt's portable commitments without claiming an external anchor.

Implemented in this slice:

- fail-closed fixture and replay identity validation;
- derived-only public API with no raw TXLine payloads, asset IDs, source paths, credentials, or wallet controls;
- responsive Match Masthead, Probability Field, Decision Rail, evidence sequence, and replay proof;
- manual replay states and deterministic autoplay across `T-5 seconds`, `Goal first seen`, and `T+30 seconds`;
- explicit captured-replay, paper, no-trade, and real-money-gate-closed states;
- root-level Command surface with current system state, exact confirmed capture fixtures, the strongest verified case, and direct Matchroom entry;
- server-side-only TXLine connectivity pulse with a strict seven-field derived response, four-second timeout, response-size cap, malformed-row rejection, GET/HEAD-only API, and explicit exclusion from v2 evidence;
- fail-closed Command fixture admission against exact TXLine fixture and Polymarket event evidence;
- searchable Casebook index over the complete current 18-observation feasibility corpus, with fixture, market, detector, disposition, execution, lane, source, and date filters;
- explicitly selected Casebook exemplar detail with lifecycle, executable evidence, analyst/execution boundaries, observation sequence, and replay hashes;
- honest no-result behavior and verified-capture admission that prevents scheduled fixtures or empty ledgers from appearing as cases;
- sealed long-run study progress and compact integrity proof without exposing frozen-protocol profitability endpoints;
- standalone Study with dual-lane separation, frozen candidate, sample clock, CLV decision rule, guardrails, risk caps, evidence admission, and ledger proof;
- fail-closed Study result opening that requires the stopping rule, per-match rows, and reconciled guardrails before any long-run endpoint can enter the public contract;
- deterministic validation against the frozen positive-CI, baseline, settlement, and guardrail requirements, while any unregistered candidate remains visibly non-admissible and the real-money gate remains closed;
- packaged Manrope and IBM Plex Mono fonts, reduced-motion behavior, keyboard focus, and mobile evidence cards;
- honest loading and fail-closed error surfaces.

Expanded Proof is a standalone route over the frozen synthetic receipt. It labels the paper approval and settlement separately from the refused real-money path, recomputes the portable receipt commitment in-browser, and provides the exact offline verification command while keeping Solana visibly unsubmitted.

Frontend work follows this order:

1. **Annotated reference board:** capture the exact pattern taken and rejected from each source below.
2. **Low-fidelity wireframes:** Command, Matchroom, and Casebook on desktop; Matchroom on mobile.
3. **High-fidelity checkpoint:** one Matchroom with realistic Samaritan data and all major lifecycle states. V2 dark hybrid is approved and unlocks production dashboard implementation. Full paper-signal states follow after eligible ledgers contain evidence; light mode follows later without blocking launch.
4. **State inventory:** loading, empty, sealed, no-signal, no-trade, veto, partial fill, degraded feed, stale projection, offline artifact, and anchor-not-submitted.
5. **Clickable replay prototype:** one honest captured sequence using the final information hierarchy.
6. **Comprehension test:** a new viewer explains what moved, what Samaritan decided, and whether money moved within 30 seconds.
7. **Implementation:** shared shell, derived projection layer, replay, responsive states, and accessibility.
8. **Visual QA:** desktop and mobile screenshots, reduced motion, keyboard flow, contrast, long labels, and real empty states.

No implementation should invent placeholder profits, winning percentages, fabricated Claude explanations, or fake live matches for visual completeness.

## 17. Acceptance criteria

The v1 public UI is complete only when:

- a new viewer can state what Samaritan does within 30 seconds;
- the viewer can trace one case from signal to proof within three minutes;
- live, captured replay, and offline artifact modes cannot be confused;
- paper status and real-money gate state are persistent and correct;
- no account or wallet is required;
- no raw TXLine data or secret reaches the browser;
- every case disposition, including no-trade and veto, is inspectable;
- the Study screen preserves sealing and stopping-rule behavior;
- the Proof screen verifies ledger/replay identity from generated artifacts;
- the desktop and mobile golden paths are keyboard and touch usable;
- the interface passes WCAG AA contrast checks;
- the bounty demo can run from a verified replay if no match is live;
- public copy makes no unsupported prediction or profitability claim.

## 18. Reference board

| Reference | Take | Reject |
|---|---|---|
| [Polymarket Sports](https://polymarket.com/sports/live) | Match scanning, league grouping, compact probabilities, score/time prominence | Order-entry emphasis and exchange identity |
| [Nomos Discover](https://pro.nomos.trade/discover) | Persistent search, multi-source discovery, briefing rail, dense navigation | Generic black/blue treatment and excessive filter pills |
| [Hudl StatsBomb IQ Live](https://statsbomb.com/what-we-do/iq-live/) | Match timeline, race chart, analytical drill-down, meaningful widgets | Professional complexity on the first screen |
| [Hue & Machine sports dashboard](https://dribbble.com/shots/23905032-Sports-Analytics-Dashboard) | Hard-edged editorial grid and numerical hierarchy | Purple accent and tiny labels |
| [Dynamic Sports Analytics](https://dribbble.com/shots/25514823-Dynamic-Sports-Analytics-Dashboard) | Controlled acid energy and strong contrast | Bubble cards, pie-chart prominence, and gamified casino tone |
| [Live Matches & Stats](https://dribbble.com/shots/26818920-Sports-dashboard-Live-Matches-Stats) | **30% sporting-energy reference:** deep-navy character, luminous lime selection, score-first composition, and compact match tension | Betting economics, widget density, and decorative athlete tile |
| [SportsTensor](https://dribbble.com/shots/26056873-Sportstensor-Sports-Analytics-Dashboard-Design-Betting-Liv) | **70% spatial reference:** analytical hierarchy, clean chart proportions, table organization, modular calm, and breathing room | Washed lavender as the primary skin, low-contrast labels, and generic prediction leaderboard |

Dribbble references are visual inspiration only. Product architecture, error handling, evidence states, and accessibility come from Samaritan's real workflow and artifacts.
