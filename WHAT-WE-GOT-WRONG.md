# What We Got Wrong

Generated during Phase 0 on July 9-10, 2026.

## Polymarket CLOB V2 status

`docs/01-research.md` described Polymarket as mid-migration to CLOB V2. Current Polymarket changelog says V2 went live on production on April 28, 2026 at `https://clob.polymarket.com`, with no production compatibility for V1-signed orders.

Correction applied to `docs/01-research.md`.

## World Cup tick size assumption

`docs/01-research.md` treated the 0.25 cent World Cup tick size as broadly true for moneyline/spread/total markets. Phase 0 Polymarket capture found the France vs Morocco moneyline market (`conditionId` `0xc09537a0976d0927901432859fbb6dfe5d23d1d69bb4e8355253e7b142a44e83`) reporting `0.01` in Gamma metadata and CLOB `/tick-size`.

Correction applied: fetch tick size per token before quoting; do not assume from market category.

## TXLine bookmaker attribution

`docs/01-research.md` treated `BookmakerId` / `Bookmaker` as per-bookmaker attribution usable for leader-lag and steam detection. Phase 0 devnet + mainnet SL12 free World Cup odds capture found exactly one source key across 14,408,706 rows: `10021:TXLineStablePriceDemargined`.

Correction applied: free-tier World Cup samples are consensus/stable-price rows only on both checked networks. STEAM/leader-lag cannot depend on per-bookmaker attribution from this tier unless a different endpoint or paid tier exposes it.

## TXLine Pct scale

`docs/01-research.md` correctly described `Pct` as de-vigged probabilities, but the original plan implied direct 0-1 probability use. Phase 0 devnet + mainnet rows are 3-decimal strings on a 0-100 scale: captured outcome groups summed near 100 and never near 1.

Correction applied: ingest must divide `Pct` by 100 before using Samaritan's internal probability convention.

## TXLine odds GameState

`docs/01-research.md` assumed odds rows carry match-state context via `GameState`. Phase 0 devnet + mainnet historical odds rows had `GameState` blank in every scanned row.

Correction applied: treat odds `GameState` as optional and join score state by fixture/time when needed.

## TXLine score payload richness

`docs/01-research.md` emphasized the soccer stat-key encoding and did not capture the richer action envelope. Phase 0 devnet + mainnet score samples include `Clock`, possession, `Score`, `PossibleEvent`, `Kickoff`, `PlayerStats`, `Lineups`, and action rows for `shot`, `var`, `penalty`, `penalty_outcome`, `goal`, `corner`, `yellow_card`, and `red_card`.

Correction applied: scores parsing must handle both numeric `Stats` counters and action-event payloads. Stat base keys 1-8 were confirmed, but period prefixes 0-7 were observed, so do not hard-code only prefixes 1-5.

## TXLine retention

The docs claim `/api/scores/historical/{fixtureId}` has a 2-week-to-6-hour window. Phase 0 mostly supports that shape, but the exact observed boundary was data-bearing historical bodies starting at June 25 fixture dates when probed on July 9; older checked fixtures returned empty `200` responses. Mainnet score intervals had data June 11-July 7, devnet score intervals had data June 18-July 7, and odds intervals returned data back to June 11 with no error cutoff on both networks.

Correction applied: added observed retention notes for both networks.

## Live SSE capture completed

The France vs Morocco mainnet SL12 live capture completed on July 9, 2026. It captured 22,026 odds frames, 2,099 score frames, and 44 reconnect log rows. The original 21,500-frame aggregate mixed ordinary delivery with reconnect/backfill bursts. The revised `samples/LATENCY.md` classifies 19,377 steady-state unique first deliveries, 2,122 connection bootstrap/reconnect catch-up frames, and one duplicate/replayed frame; it also measures 21 completed reconnect outages, including one roughly 15-minute outage per stream. Small negative steady-state values are clock skew, not negative latency.

## Polymarket history and stale-quote evidence

Phase 0 stopped after one Gamma snapshot and one CLOB book, leaving the impression that the planned cross-market replay study had enough ground truth. It did not. Official one-minute outcome-token history is recoverable from `/prices-history`, including closed and in-play periods, but long multi-week requests are rejected and must be segmented.

More importantly, the historical response contains only timestamp and price. It does not contain bids, asks, depth, spread, or order lifetime. It can support coarse XMARKET/FADER price-path research and cross-market CLV candidates, but it cannot prove a seconds-level STALE_QUOTE edge or that a historical price was executable. That claim now requires synchronized live TXLine and Polymarket order-book capture.

Correction applied to `docs/01-research.md`; Phase 3 remains the measurement gate.
