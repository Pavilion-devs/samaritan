# Semifinal Paired Capture Schedule

Confirmed by Deborah on July 12, 2026 for public-data capture only. Both mappings remain `tradeable: false`; confirmation does not authorize orders or money movement.

| Match | TXLine fixture | Polymarket events | Absolute capture window | Verification | Current status |
|---|---:|---|---:|---:|---|
| France vs Spain | `18237038` | `691040`, `691131` | `2026-07-14T16:00:00Z`–`2026-07-14T22:00:00Z` | 2026-07-14 23:15 UTC / 2026-07-15 00:15 Lagos | **Failed closed** before kickoff; inadmissible |
| England vs Argentina | `18241006` | `694581`, `694786` | `2026-07-15T16:00:00Z`–`2026-07-15T22:00:00Z` | 2026-07-15 23:15 UTC / 2026-07-16 00:15 Lagos | **Failed closed** after a Polymarket stall; inadmissible |

The England-Argentina one-shot supervisor reruns strict config and credential-scope validation, refuses duplicate/output-colliding processes, records status/log/PID evidence, and enforces the configured absolute window. It allows 180 seconds of startup grace, rejects launch skew beyond 120 seconds, and marks the run failed if any required stream stops advancing for 300 seconds. Terminal verification requires the capture manifest and required artifacts to agree with the configured fixture, slugs, and window; nonempty files alone do not prove successful coverage.

Capture and verification are evidence-only. V2 registration does not retroactively admit either failed semifinal or permit incomplete evidence into a study. A fresh fixture must pass every admission gate before persistent Claude execution or paper observation. Capture code may not initiate Polymarket authentication, refresh or activate market tokens, access a wallet, approve, deposit, trade, place orders, or move money.

A successful England-Argentina capture would still be only a candidate input. Post-run admission requires verified paired timing, synchronized pre-cutoff overlap, explicit lifecycle evidence, exact mapping/rules review, and Deborah's prior registration of a corrected v2 protocol. Candidate mappings are never promoted automatically.

Verified July 15, 2026 00:23 UTC: the France-Spain capture failed closed. The recorded artifacts stop at `2026-07-14T18:18:03Z`, before the `2026-07-14T19:00:00Z` kickoff, the run log has no completion marker, the PID file remained behind, no public `market_resolved` event was captured, and `data/live/gamma-discovery/candidate-mappings.json` still contains zero evidence-bearing records for fixture `18237038`. The capture is not admissible for study or lifecycle replay; the later v2 registration does not retroactively admit it.

Verified July 16, 2026 00:17 UTC: the England-Argentina capture also failed closed. The supervisor launched before the `2026-07-15T18:45:00Z` signal cutoff (`startedAt` `2026-07-15T16:00:05.162Z` on the Polymarket side and `2026-07-15T16:00:07.504Z` on the TXLine side), but it marked the run failed at `2026-07-15T20:16:33.299Z` after logging `polymarket capture stream stalled for 302214.22314453125ms`. The raw symlinked files contain traffic through roughly `2026-07-15T20:16:23Z`, yet both terminal manifests remained `status: "running"` with `endedAt: null`; the Polymarket terminal manifest reported zero messages/connects/in-scope books despite a nonempty capture file, the TXLine terminal manifest never summarized its streams, no public `market_resolved` event was captured, the score stream never reached a `game_finalised` frame, and the local candidate registry still contains zero evidence-bearing records. Canonical capture-order replay remains blocked as well: the live candidate registry has zero records, and replay against the research registry fails immediately with `UnmappedPolymarketAssetError` on the captured totals assets. The ignored local analysis manifest therefore remains `failed_closed`; the later v2 registration does not retroactively admit it.

## Deterministic post-capture bridge

Run this only after the one-shot supervisor has written and verified all terminal artifacts; it is deliberately not part of the armed supervisor:

```sh
pnpm capture:analyze -- --capture-config config/captures/england-argentina-2026-07-15.json
```

The command atomically writes `data/live/paired-england-argentina-2026-07-15/analysis-manifest.json`. It hashes every input and derives only licensed-safe metadata: the exact fixture and causally selected full-time total, sorted outcome assets, selected-condition book depth, exact TXLine odds and completed score evidence, kickoff close, public resolution, and the bounded canonical ingress profile. `checkedAt` is excluded from the deterministic proof commitments.

The status layers are intentional. `verified_capture` proves completed capture/microstructure only and carries no admission authority. Only a schema-v2 `verified` record has an exact causal selected-total binding, and its `admission` still remains `failed_closed` until the mapping has Deborah's settlement review plus selected close/resolution and pre-cutoff overlap. Missing or tampered inputs produce a durable `failed_closed` manifest; capture-only confirmation never promotes a mapping.

If the protocol is later registered and all admission gates are satisfied, the real-Claude replay command must explicitly name both `--run-label` and `--fixture`. It defaults to finite causal speed `1`; speeds above `1` and `Infinity` are refused. Before environment or ledger mutation, preflight hashes the exact replay bytes while parsing them, freezes only the admitted canonical events under hard count and byte limits, and sizes a bounded queue for that finite selected-market snapshot (plus 25% headroom), failing closed above the in-process ceiling. The model-facing runtime replays that frozen snapshot without reopening mutable capture files. The allowlist passes only exact selected-market odds/books/prices/resolution, exact-fixture scores, and feed-health events.
