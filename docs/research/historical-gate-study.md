# Historical Detector Gate Study — Invalidated V1 Audit Record

Generated: 2026-07-11T06:57:14.119Z

> **Invalidated July 14, 2026:** this generated v1 artifact selected the dynamic total with information later than the eligible signal window for 95 of 98 fixtures, counted coverage without the same as-of cutoff, and mixed unsupported sells with complementary expressions of the same economic move. Preserve these values for traceability only. They are not valid evidence of held-out edge, alpha, or executable opportunities. The real-money gate remains closed. See `historical-gate-study-v1-invalidation.md`.

## Design

- Chronological train/test split: 68 / 30 fixtures
- Training range: 2026-06-11T19:05:00.000Z to 2026-06-27T21:00:00.000Z
- Held-out range: 2026-06-27T23:31:00.000Z to 2026-07-12T01:00:00.000Z
- Split cutoff: 2026-06-27T21:00:00.000Z; identical kickoff timestamps never cross partitions
- Replay window: final 3.0 hours through kickoff; in-running TXLine rows excluded
- Forward label: 15 minutes with 25.0 bps minimum gap closure
- Historical cost proxy: 100.0 probability bps per signal
- Training selection: labeled F1, guarded by at least 30 predicted-positive cases

## Coverage

- Training groups with both sources: 136/136; 164,655 events; 227,368 snapshots
- Held-out groups with both sources: 52/60; 60,092 events; 77,445 snapshots
- Held-out missing groups: `18209181:match_result:full_time:none`, `18209181:total_goals:full_time:2500`, `18218149:match_result:full_time:none`, `18218149:total_goals:full_time:2500`, `18213979:match_result:full_time:none`, `18213979:total_goals:full_time:2500`, `18222446:match_result:full_time:none`, `18222446:total_goals:full_time:2500`

## Dynamic Total Candidate

The candidate rule selects the exact mapped full-time total closest to 50/50 at least five minutes before kickoff, requires at least 1,000 history points, and fails closed beyond 1500.0 bps from even. It selected 98 fixtures with 0 failures. Distribution: O/U 2.5: 77, O/U 4.5: 1, O/U 1.5: 5, O/U 3.5: 15.

Status: `candidate_pending_human_gate_review`. Volume and liquidity are not weighted because captured Gamma liquidity is post-close and zero for most lines.

## Held-Out Results

| Detector | Train-selected parameters | Train signals | Train precision | Train recall | Test CLV n | Fixtures | Test precision | Test recall | Mean signal CLV bps | Mean after-cost bps | Match Result net bps | Total net bps | Necessary evidence status |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| XMARKET_DIVERGENCE | gap=100.0bps, persist=0s, stableZ=1 | 1226 | 65.4% | 2.2% | 372 | 25 | 50.0% | 1.9% | 97.9 | -2.1 | -15.2 | 43.6 | nonpositive_net_signal_clv |
| CONSENSUS_MOVE | z=1, cusum=10.0bps, gap=100.0bps, updates=5 | 450 | 62.2% | 0.7% | 107 | 23 | 50.5% | 0.6% | 159.9 | 59.9 | -67.0 | 119.0 | human_review_required |
| FADER_CANDIDATE | pmZ=1, gap=100.0bps, persist=0s, stableZ=1 | 314 | 6.1% | 0.1% | 72 | 16 | 5.6% | 0.1% | 54.0 | -46.0 | -50.3 | -40.2 | nonpositive_net_signal_clv |

`human_review_required` means only that the predeclared necessary sample/after-cost checks passed. It is not permission to trade and does not substitute for Deborah's gate decision, settlement verification, risk caps, or executable-book evidence.

## Cost Sensitivity

| Detector | 50 bps proxy | 100 bps proxy | 150 bps proxy | 200 bps proxy |
|---|---:|---:|---:|---:|
| XMARKET_DIVERGENCE | 47.9 | -2.1 | -52.1 | -102.1 |
| CONSENSUS_MOVE | 109.9 | 59.9 | 9.9 | -40.1 |
| FADER_CANDIDATE | 4.0 | -46.0 | -96.0 | -146.0 |

Values are mean directional signal CLV after subtracting each proxy. This is a sensitivity check, not a claim about actual historical execution costs.

## Training Leaderboard

| Detector | Rank | Parameters | Signals | Precision | Recall | F1 | Minimum n met | Cost floor met |
|---|---:|---|---:|---:|---:|---:|---|---|
| XMARKET_DIVERGENCE | 1 | gap=100.0bps, persist=0s, stableZ=1 | 1226 | 65.4% | 2.2% | 0.042 | yes | yes |
| XMARKET_DIVERGENCE | 2 | gap=100.0bps, persist=0s, stableZ=0.5 | 858 | 64.5% | 1.5% | 0.029 | yes | yes |
| XMARKET_DIVERGENCE | 3 | gap=100.0bps, persist=60s, stableZ=1 | 322 | 59.0% | 0.5% | 0.010 | yes | yes |
| XMARKET_DIVERGENCE | 4 | gap=150.0bps, persist=0s, stableZ=1 | 195 | 85.1% | 0.4% | 0.009 | yes | yes |
| XMARKET_DIVERGENCE | 5 | gap=150.0bps, persist=0s, stableZ=0.5 | 158 | 83.5% | 0.4% | 0.007 | yes | yes |
| CONSENSUS_MOVE | 1 | z=1, cusum=10.0bps, gap=100.0bps, updates=5 | 450 | 62.2% | 0.7% | 0.014 | yes | yes |
| CONSENSUS_MOVE | 2 | z=1, cusum=10.0bps, gap=100.0bps, updates=3 | 450 | 62.2% | 0.7% | 0.014 | yes | yes |
| CONSENSUS_MOVE | 3 | z=1.5, cusum=10.0bps, gap=100.0bps, updates=3 | 398 | 62.3% | 0.6% | 0.012 | yes | yes |
| CONSENSUS_MOVE | 4 | z=1.5, cusum=10.0bps, gap=100.0bps, updates=5 | 398 | 62.3% | 0.6% | 0.012 | yes | yes |
| CONSENSUS_MOVE | 5 | z=2, cusum=10.0bps, gap=100.0bps, updates=5 | 348 | 64.4% | 0.5% | 0.011 | yes | yes |
| FADER_CANDIDATE | 1 | pmZ=1, gap=100.0bps, persist=0s, stableZ=1 | 314 | 6.1% | 0.1% | 0.003 | yes | yes |
| FADER_CANDIDATE | 2 | pmZ=1, gap=100.0bps, persist=0s, stableZ=0.5 | 196 | 8.7% | 0.1% | 0.002 | yes | yes |
| FADER_CANDIDATE | 3 | pmZ=1.5, gap=100.0bps, persist=0s, stableZ=1 | 276 | 5.4% | 0.1% | 0.002 | yes | yes |
| FADER_CANDIDATE | 4 | pmZ=1.5, gap=100.0bps, persist=0s, stableZ=0.5 | 168 | 6.5% | 0.1% | 0.002 | yes | yes |
| FADER_CANDIDATE | 5 | pmZ=2, gap=150.0bps, persist=0s, stableZ=0.5 | 36 | 22.2% | 0.1% | 0.001 | yes | yes |

## Guardrails

- No held-out result influenced configuration selection.
- Sampled Polymarket history cannot establish executable spread, slippage, or fill probability; the cost proxy is deliberately conservative but remains a proxy.
- Candidate mappings remain non-tradeable and no settlement review is inferred from research alignment.
- Thresholds in this report are exploratory until the human gate review explicitly freezes or rejects them.
- STALE_QUOTE remains disabled based on the synchronized live-lane result; this historical study does not evaluate it.
