# Final-Weekend Paired Capture Schedule

Prepared and authorized for **capture only** by Deborah on July 18, 2026. Every mapping remains `tradeable: false`; v2 registration does not bypass evidence or settlement review.

| Match | TXLine fixture | Polymarket events | Absolute capture window | Current status |
|---|---:|---|---|---|
| France vs England | `18257865` | `708596`, `708643` | `2026-07-18T18:00:00Z`–`2026-07-19T00:00:00Z` | **Supervisor armed; scheduled** |
| Spain vs Argentina | `18257739` | `708597`, `708641` | `2026-07-19T16:00:00Z`–`2026-07-19T22:00:00Z` | **Backup supervisor armed; scheduled** |

The public Gamma identities are `fifwc-fra-eng-2026-07-18` and `fifwc-fra-eng-2026-07-18-more-markets`. Exact teams and the `2026-07-18T21:00:00Z` kickoff matched the refreshed official TXLine fixture snapshot and the public market metadata before scheduling. Full-time totals descriptions still specify the first 90 minutes plus stoppage time.

The persistent launchd jobs `dev.samaritan.capture.france-england` and `dev.samaritan.capture.spain-argentina` started Node 22 supervisors at `2026-07-18T07:16:05Z` and `2026-07-18T07:23:19Z`. Their initial states are `scheduled`; each supervisor will preflight exact event identity and credential validity again at its absolute start before launching the paired recorder.

Success requires completed Polymarket and TXLine terminal manifests, synchronized odds/scores/books coverage, usable exact-fixture odds, completed score state, public resolution, immutable input hashes, a causal total line, and later exact mapping/rules review. Nonempty files alone are insufficient. Any watchdog failure, identity change, feed stall, missing lifecycle stage, or unresolved mapping makes the capture inadmissible.

No Polymarket authentication, wallet, token approval, deposit, real order, money movement, or Solana submission is authorized by this schedule.
