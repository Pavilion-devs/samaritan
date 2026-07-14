# Semifinal Paired Capture Schedule

Confirmed by Deborah on July 12, 2026 for public-data capture only. Both mappings remain `tradeable: false`; confirmation does not authorize orders or money movement.

| Match | TXLine fixture | Polymarket events | Launch | Duration | Verification | Automation IDs |
|---|---:|---|---:|---:|---:|---|
| France vs Spain | `18237038` | `691040`, `691131` | 2026-07-14 16:00 UTC / 17:00 Lagos | 360 min | 2026-07-14 23:15 UTC / 2026-07-15 00:15 Lagos | `start-france-spain-paired-capture`, `verify-france-spain-paired-capture` |
| England vs Argentina | `18241006` | `694581`, `694786` | 2026-07-15 16:00 UTC / 17:00 Lagos | 360 min | 2026-07-15 23:15 UTC / 2026-07-16 00:15 Lagos | `start-england-argentina-paired-capture`, `verify-england-argentina-paired-capture` |

Each launch task reruns strict config validation, refuses duplicate processes, loads Node 22 through nvm, enables Corepack, records logs/PID, and verifies file growth. Each verification task checks capture completeness, canonical replay parity, source-timestamp diagnostics, kickoff close/resolution evidence, and sealed long-run handling. After verification it regenerates the fixture universe, runs persistent Claude readiness, and rewrites the ledger-derived paper report. Candidate mappings are never promoted automatically; a missing paper-verification gate produces zero Claude calls and unchanged decision ledgers.

The tasks may use existing TXLine data access and the public Polymarket market channel. If and only if a fixture is already paper-verified and admitted, the verification task may use the bounded Claude runtime through its capped spend ledger. It may not initiate Polymarket authentication, refresh or activate market tokens, access a wallet, approve, deposit, trade, place orders, or move money.
