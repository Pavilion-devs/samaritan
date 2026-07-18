# Historical Detector Gate Study

Generated: 2026-07-14T10:34:05.545Z
Protocol: `historical-gate-causal-economic-v4-2026-07-14`
Configuration SHA-256: `9a4eeff928f697fc55ab5147a4dc07f611c40bb749501fc3bd92b211f24b2e54`

> Research evidence only. Historical Polymarket points are sampled prices without bid/ask or depth. Results below are signal research, not executable-fill proof. The real-money gate remains closed.
> Audit status: the causal selector and binary Total Goals economic-case normalization are repaired. The result still requires Deborah's human gate review and must not be described as executable alpha.
> Source SHA-256: archive `eb6b09d339cca91e64a99730be352e4b1860db52af40b0d3d749372c1e09dc40`; mappings `39e2c8e3b4eccd463d5c4994db27054c0ac9285ce4480e813cc7c79c3b51e673`; causal selector evidence `228105f1f857b11ed0c7685652fd40483ae311f0f6191e5f574127fa2651064a`.

## Design

- Chronological train/test split: 68 / 30 fixtures
- Training range: 2026-06-11T19:05:00.000Z to 2026-06-27T21:00:00.000Z
- Held-out range: 2026-06-27T23:31:00.000Z to 2026-07-12T01:00:00.000Z
- Split cutoff: 2026-06-27T21:00:00.000Z; identical kickoff timestamps never cross partitions
- Replay window: final 3.0 hours through kickoff; in-running TXLine rows excluded
- Forward label: 15 minutes with 25.0 bps minimum gap closure
- Historical cost proxy: 100.0 probability bps per signal
- Training selection: labeled snapshot F1, guarded by at least 30 normalized economic cases; raw emissions cannot satisfy the minimum-n gate
- Uncertainty: 10,000 fixture-clustered bootstrap iterations, seed 20260714
- Model operating cost: $0.00 (0 model calls; deterministic historical replay only)

## Coverage

- Training groups with both sources: 136/136; 164,542 events; 227,142 snapshots
- Held-out groups with both sources: 52/60; 60,092 events; 77,445 snapshots
- Causal diagnostics across 590 selector rows: 0 future probabilities; 0 future coverage rows; 0 late selector cutoffs; 0 nonzero untimestamped liquidity/volume rows
- Held-out missing groups: `18209181:match_result:full_time:none`, `18209181:total_goals:full_time:2500`, `18218149:match_result:full_time:none`, `18218149:total_goals:full_time:2500`, `18213979:match_result:full_time:none`, `18213979:total_goals:full_time:2500`, `18222446:match_result:full_time:none`, `18222446:total_goals:full_time:2500`

## Dynamic Total Candidate

The candidate rule freezes each exact mapped full-time total 3.0 hours before TXLine kickoff—before the first detector snapshot—then selects the line closest to 50/50. Both probability and coverage are bounded by that same as-of timestamp. It requires at least 1,000 as-of history points and fails closed beyond 1500.0 bps from even. It selected 98 fixtures with 0 failures. Distribution: O/U 2.5: 75, O/U 4.5: 1, O/U 1.5: 5, O/U 3.5: 17.

Status: `candidate_pending_human_gate_review`. Volume and liquidity are zeroed and forbidden as selector inputs because no timestamped historical as-of evidence exists for them.

## Forward Paper Candidate Assessment

The prespecified paper family is **Total Goals only**. Its frozen `CONSENSUS_MOVE` configuration was chosen from training data before held-out Total Goals results were inspected. A family-specific training audit found 135 normalized Total Goals cases, so the training minimum was not borrowed from Match Result.

Held-out Total Goals: 38 normalized buy cases across 18 fixtures; mean after the 100.0 bps cost proxy 132.7 bps; fixture-clustered 95% CI [14.3, 243.9] bps.

Status at generation: `historical_signal_candidate_for_forward_paper_review`. This is **historical signal evidence**, not alpha, profitability, or executable-fill evidence. Inputs are sampled Polymarket prices without bid/ask depth. Deborah subsequently registered the exact v2 candidate for forward paper observation only on July 18; this historical artifact remains unchanged evidence and does not itself count as a v2 observation.

## Held-Out Results

| Detector | Train-selected parameters | Train raw emissions | Train normalized cases | Train snapshot precision | Train snapshot recall | Test raw emissions | Test normalized cases | Test CLV n | Fixtures | Test snapshot precision | Test snapshot recall | Mean signal CLV bps | Mean after-cost bps | Fixture-clustered 95% CI bps | Match Result net bps | Total net bps | Necessary evidence status |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|---|
| XMARKET_DIVERGENCE | gap=100.0bps, persist=0s, stableZ=1 | 1762 | 934 | 65.9% | 2.2% | 372 | 331 | 331 | 25 | 50.0% | 1.9% | 92.4 | -7.6 | [-44.1, 27.8] | -15.2 | 45.0 | nonpositive_net_signal_clv |
| CONSENSUS_MOVE | z=1, cusum=10.0bps, gap=100.0bps, updates=5 | 702 | 301 | 62.8% | 0.7% | 107 | 72 | 72 | 23 | 50.5% | 0.6% | 138.4 | 38.4 | [-67.1, 120.8] | -67.0 | 132.7 | clustered_interval_not_positive |
| FADER_CANDIDATE | pmZ=1, gap=100.0bps, persist=0s, stableZ=1 | 412 | 268 | 6.1% | 0.1% | 72 | 56 | 56 | 16 | 5.6% | 0.1% | 54.5 | -45.5 | [-109.1, 35.9] | -50.3 | -32.2 | nonpositive_net_signal_clv |

`human_review_required` means only that the predeclared sample, after-cost point estimate, and fixture-clustered interval checks passed. `clustered_interval_not_positive` means the point estimate was not strong enough to exclude zero after fixture clustering. Neither status is permission to trade or a substitute for Deborah's gate decision, settlement verification, risk caps, or executable-book evidence.

For binary totals, `buy Over + sell Under` is one Over exposure and `buy Under + sell Over` is one Under exposure. An actual BUY is retained; duplicates and complementary sell expressions collapse into it. Sell-only totals are excluded because detector inputs do not prove an executable complementary-token ask. Three-way Match Result signals are not economically normalized.

### Held-Out Normalization Audit

| Detector | Raw | Normalized | Executable total buys | Match Result pass-through | Complementary sells collapsed | Duplicate buys collapsed | Sell-only totals dropped | Invalid total outcomes dropped |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| XMARKET_DIVERGENCE | 372 | 331 | 42 | 289 | 35 | 0 | 6 | 0 |
| CONSENSUS_MOVE | 107 | 72 | 38 | 34 | 29 | 0 | 6 | 0 |
| FADER_CANDIDATE | 72 | 56 | 15 | 41 | 9 | 0 | 7 | 0 |

## Cost Sensitivity

| Detector | 50 bps proxy | 100 bps proxy | 150 bps proxy | 200 bps proxy |
|---|---:|---:|---:|---:|
| XMARKET_DIVERGENCE | 42.4 | -7.6 | -57.6 | -107.6 |
| CONSENSUS_MOVE | 88.4 | 38.4 | -11.6 | -61.6 |
| FADER_CANDIDATE | 4.5 | -45.5 | -95.5 | -145.5 |

Values are mean directional signal CLV after subtracting each proxy. This is a sensitivity check, not a claim about actual historical execution costs.

## Training Leaderboard

| Detector | Rank | Parameters | Raw emissions | Normalized cases | Snapshot precision | Snapshot recall | F1 | Minimum n met | Cost floor met |
|---|---:|---|---:|---:|---:|---:|---:|---|---|
| XMARKET_DIVERGENCE | 1 | gap=100.0bps, persist=0s, stableZ=1 | 1762 | 934 | 65.9% | 2.2% | 0.042 | yes | yes |
| XMARKET_DIVERGENCE | 2 | gap=100.0bps, persist=0s, stableZ=0.5 | 1522 | 674 | 65.9% | 1.5% | 0.030 | yes | yes |
| XMARKET_DIVERGENCE | 3 | gap=100.0bps, persist=60s, stableZ=1 | 434 | 263 | 60.2% | 0.5% | 0.010 | yes | yes |
| XMARKET_DIVERGENCE | 4 | gap=150.0bps, persist=0s, stableZ=1 | 355 | 132 | 85.5% | 0.5% | 0.009 | yes | yes |
| XMARKET_DIVERGENCE | 5 | gap=150.0bps, persist=0s, stableZ=0.5 | 285 | 116 | 84.0% | 0.4% | 0.007 | yes | yes |
| CONSENSUS_MOVE | 1 | z=1, cusum=10.0bps, gap=100.0bps, updates=5 | 702 | 301 | 62.8% | 0.7% | 0.013 | yes | yes |
| CONSENSUS_MOVE | 2 | z=1, cusum=10.0bps, gap=100.0bps, updates=3 | 702 | 301 | 62.8% | 0.7% | 0.013 | yes | yes |
| CONSENSUS_MOVE | 3 | z=1.5, cusum=10.0bps, gap=100.0bps, updates=3 | 596 | 259 | 63.2% | 0.6% | 0.012 | yes | yes |
| CONSENSUS_MOVE | 4 | z=1.5, cusum=10.0bps, gap=100.0bps, updates=5 | 596 | 259 | 63.2% | 0.6% | 0.012 | yes | yes |
| CONSENSUS_MOVE | 5 | z=2, cusum=10.0bps, gap=100.0bps, updates=5 | 478 | 228 | 65.5% | 0.5% | 0.011 | yes | yes |
| FADER_CANDIDATE | 1 | pmZ=1, gap=100.0bps, persist=0s, stableZ=1 | 412 | 268 | 6.1% | 0.1% | 0.003 | yes | yes |
| FADER_CANDIDATE | 2 | pmZ=1, gap=100.0bps, persist=0s, stableZ=0.5 | 319 | 163 | 8.9% | 0.1% | 0.002 | yes | yes |
| FADER_CANDIDATE | 3 | pmZ=1.5, gap=100.0bps, persist=0s, stableZ=1 | 359 | 238 | 5.4% | 0.1% | 0.002 | yes | yes |
| FADER_CANDIDATE | 4 | pmZ=1.5, gap=100.0bps, persist=0s, stableZ=0.5 | 281 | 142 | 6.6% | 0.1% | 0.002 | yes | yes |
| FADER_CANDIDATE | 5 | pmZ=1.5, gap=150.0bps, persist=0s, stableZ=0.5 | 65 | 30 | 18.6% | 0.1% | 0.001 | yes | yes |

## Guardrails

- No held-out result influenced configuration selection.
- Total-line selection uses only prices and coverage observable no later than the first detector snapshot.
- Training and held-out minimum-sample checks use normalized economic cases, never raw detector emissions.
- Sell-only Total Goals cases fail closed; sampled history cannot prove a complementary token was buyable at that moment.
- Sampled Polymarket history cannot establish executable spread, slippage, or fill probability; the cost proxy is deliberately conservative but remains a proxy.
- Candidate mappings remain non-tradeable and no settlement review is inferred from research alignment.
- Thresholds in this report are exploratory until the human gate review explicitly freezes or rejects them.
- STALE_QUOTE remains disabled based on the synchronized live-lane result; this historical study does not evaluate it.
