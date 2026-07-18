# Paper Study V2 Candidate — Deborah Review Draft

> **Resolved July 18, 2026:** Deborah registered this exact frozen candidate for forward paper observation only. The immutable decision record is [`10-paper-study-v2-registration.md`](10-paper-study-v2-registration.md). This draft remains preserved as the pre-decision review artifact; it is not the current operational status.

**Draft status at preparation:** `engineering_candidate_unregistered`<br>
**Code protocol:** `paper-study-v2-candidate-2026-07-14`<br>
**Frozen candidate config SHA-256:** `93e61c1903d0a13bbeb1dbbd3ad9b11af0335b96c82bd2ca7aa9ddedeeabf3ce`<br>
**Prepared:** July 14, 2026<br>
**Real-money gate:** **closed**

This is a review draft, not a registration. It cannot admit a qualifying observation, spend Claude tokens through the operational study command, initialize replacement ledgers, authorize a paper candidate, or unlock real money until Deborah explicitly signs the final protocol. The invalidated v1 ledgers remain preserved and must never be relabelled.

## Why a fresh protocol is justified

The corrected historical study is:

- protocol `historical-gate-causal-economic-v4-2026-07-14`;
- configuration SHA-256 `9a4eeff928f697fc55ab5147a4dc07f611c40bb749501fc3bd92b211f24b2e54`;
- 68 training fixtures / 30 held-out fixtures with an unchanged chronological boundary;
- zero future-probability, future-coverage, late-cutoff, or untimestamped-liquidity selector violations across 590 evidence rows;
- normalized into executor-expressible Total Goals buys, with complementary expressions collapsed and sell-only cases excluded.

The aggregate `CONSENSUS_MOVE` detector did not pass its fixture-clustered interval. The **prespecified Total Goals–only family** did meet the historical signal criteria under the training-selected configuration:

- 135 normalized Total Goals training cases;
- 38 held-out normalized buy cases across 18 fixtures;
- mean `+132.7` probability bps after the 100 bps historical cost proxy;
- fixture-clustered 95% interval `+14.3` to `+243.9` bps.

This is not alpha, profitability, or fill evidence. Historical Polymarket observations are sampled prices without executable bid/ask depth. It supports only a fresh forward paper study using real observed books, measured costs, and no endpoint peeking.

## Frozen candidate

### Market and detector

- Full-time `total_goals` only.
- `CONSENSUS_MOVE` only.
- Move absolute z-score ≥ `1`.
- CUSUM threshold `0.001` probability (`10` bps).
- Minimum raw consensus/market gap `0.01` probability (`100` bps).
- Minimum consensus updates `5`.
- Every other detector and Match Result remain disabled for this study.

### Causal total-line selection

- Exact line frozen at kickoff minus `180` minutes, before the first detector snapshot.
- Probability and coverage both require `source_ts_ms <= selector_cutoff_ts_ms`.
- At least `1,000` as-of coverage points.
- Closest-to-even balance rule, within `0.15` probability of 50/50.
- Historical volume and liquidity are zero-weighted and forbidden because no timestamped as-of values exist.
- Missing or late selector evidence fails closed.

### Economic-case identity

- Retain only an actual Total Goals `buy` the paper executor can express.
- `buy Over + sell Under` is one Over case; `buy Under + sell Over` is one Under case.
- Collapse duplicate buys and complementary sell expressions in the same detector/fixture/market/source-time/observation-time/economic-outcome case.
- Drop sell-only cases unless a future protocol version can prove the complementary token's executable ask. This version cannot synthesize that proof.
- Match Result is outside the candidate and is never treated as a binary complement.

### Execution timing

- `detectedAtTsMs` records source market time.
- `observedAtTsMs` records Samaritan's knowledge time.
- Model readiness begins at observation time and uses the greater of measured wall latency or the configured minimum.
- A fixed `1,000 ms` Polymarket sports placement delay is then added.
- Only the first canonical book observed after readiness **and** placement delay can fill.
- Small negative source/observation skew remains diagnostic; impossible or regressing knowledge time fails closed.

### Paper risk proposal carried from v1 — requires Deborah's renewed approval

- Simulated bankroll: `$50` (`50,000,000` micro-USD).
- Fixed paper stake: `$3` (`3,000,000` micro-USD).
- Aggregate open exposure cap: `$15` (`15,000,000` micro-USD).
- Drawdown rejection stop: `$20` (`20,000,000` micro-USD).
- No LLM can create, enlarge, or override these values.
- Real-money gate remains closed regardless of outcome.

### Stopping and evaluation proposal

- Minimum `20` filled matches and `40` fills; target `30` matches.
- Unit of uncertainty is the match, not the signal.
- Primary endpoint: executable kickoff CLV net of measured entry cost.
- `10,000` whole-match bootstrap iterations, seed `20260714`.
- Minimum fill rate `60%`.
- Mean slippage no greater than `100` bps.
- Every selected depth, close, and settlement field complete.
- Max drawdown within the proposed `$20` stop.
- Bounty/demo output remains exploratory; qualifying long-run endpoints remain sealed until both stopping thresholds are met.

## Operational gates before registration

- [x] Causal selector repaired and independently diagnosed.
- [x] Economic cases normalized and sample gates changed from emissions to cases.
- [x] Observation-time readiness and venue delay implemented.
- [x] Restart rehydration implemented for dedupe, pending cases, positions, exposure, P&L, peak, and drawdown.
- [x] Full v2 decision hash envelope and tamper tests implemented.
- [x] Deborah confirmed the proposed paper risk values above on July 18, 2026.
- [x] Deborah confirmed the stopping/decision rules above on July 18, 2026.
- [x] Deborah confirmed that the corrected historical result is sufficient only to begin forward paper observation—not to claim alpha or unlock money.
- [x] Fresh v2 bounty and long-run ledgers were initialized after registration; preserved v1 ledgers remain untouched.
- [x] The operational protocol status changed from `engineering_candidate_unregistered` to `paper-study-v2-2026-07-18` in code and current-status documentation.

## Deborah decision — resolved by the registration record

- [x] **REGISTER V2 FOR FORWARD PAPER ONLY** under the exact config hash above.
- [ ] **DO NOT REGISTER**; revise or shelve the candidate.

Name: Deborah<br>
Decision date/time (UTC): `2026-07-18T07:03:55Z`<br>
Signature/confirmation reference: explicit written authorization retained in [`10-paper-study-v2-registration.md`](10-paper-study-v2-registration.md)

Registration, if granted, authorizes only a paper study and bounded model spend under existing project controls. It does not authorize Polymarket authentication, a wallet, token approval, deposit, order placement, real-money trading, or any risk-limit change.
