# Historical Gate Study V1 — Invalidation Record

**Declared:** July 14, 2026<br>
**Affected protocol:** historical dynamic-total selector and paper-study v1 upstream evidence<br>
**Decision:** Invalidated for strategy promotion, profitability claims, and paper admission<br>
**Real-money gate:** **CLOSED**

## Summary

An independent causal audit found that the v1 historical study chose each fixture's “main” full-time total using Polymarket information that was not available during the eligible signal window.

The selector used the latest price up to kickoff minus five minutes. Historical signals were eligible only through kickoff minus fifteen minutes. In the frozen v1 artifact:

- 95 of 98 selected lines used a selector observation later than the last eligible signal;
- 81 of 98 selected lines used an observation within approximately six minutes of kickoff;
- `coverage_points` counted history without applying the selector cutoff;
- the totals CLV sample contained 38 buys and 35 sells, while the current paper executor cannot open sell positions without inventory;
- 58 emissions were 29 same-timestamp complementary Over/Under expressions of the same economic move.

The defect does not prove that `CONSENSUS_MOVE` has no edge. It means the reported positive v1 result cannot establish one.

## Why this is invalid

A live system cannot ask a future market observation which line it should have monitored earlier. Choosing the line at T−5 minutes and evaluating decisions that ended at T−15 minutes leaks future market state into the test universe.

Chronological train/test separation does not cure this defect because the look-ahead occurs independently inside every fixture in both partitions.

The unbounded coverage count creates a second admission leak: observations after the selector time can make a line appear sufficiently covered when it was not sufficiently covered at decision time.

Finally, raw detector emissions are not necessarily executable or independent economic decisions. Unsupported sells and complementary token expressions must not inflate the primary sample.

## Affected claims

The following v1 claims are withdrawn:

- that the dynamic-total result is valid held-out edge evidence;
- that its positive probability-bps estimate supports paper promotion;
- that 73 detector emissions represent 73 executable opportunities;
- that paper-study v1 may admit new cases under the old selector.

The original machine-readable and Markdown artifacts remain preserved for audit traceability. Their numbers must be labelled invalidated wherever displayed.

## Unaffected evidence

The synchronized Spain-Belgium stale-quote feasibility study does not use the historical dynamic-total selector. Its narrow conclusion remains: that one captured match produced no clean post-TXLine stale window in the measured cases. It does not establish a universal absence of stale quotes.

The system's architectural boundaries, normalization tests, replay/live canonical contracts, strict Claude schemas, and real-money gate are also unaffected by this methodological correction.

## Required v2 repair

Before any detector can be promoted again:

1. Freeze one deterministic selector time no later than detector evaluation start.
2. Apply that same as-of cutoff to probability, coverage, volume, liquidity, and market availability.
3. Fail closed when no line was eligible at that time.
4. Prove that changing all post-cutoff data cannot change selection.
5. Define unique economic cases rather than counting raw complementary emissions.
6. Convert sells into verified complementary-token buys or exclude them from executable results.
7. Rerun training and held-out evaluation under a new protocol/config hash.
8. Report model cost separately from probability CLV.
9. Create and sign a new paper preregistration only if the corrected result merits it.

No repair may rewrite or retroactively validate paper-study v1.
