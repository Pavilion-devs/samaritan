# 01 — Research: The Bounty, The Data, The Battlefield

*Research conducted July 3–4 and updated from Phase 0/0.5 captures through July 10, 2026. Captured samples override documentation when they disagree.*

---

## 1. The bounty

| Fact | Detail |
|---|---|
| Listing | [Trading Tools and Agents](https://superteam.fun/earn/listing/trading-tools-and-agents/) on Superteam Earn |
| Sponsor | TxODDS (sports data company), part of the [$50K World Cup Hackathon](https://superteam.fun/earn/hackathon/world-cup/) with Solana |
| Track prize | **16,000 USDT** — 10,000 / 4,000 / 2,000 |
| Hackathon window | June 24 – **July 19, 2026** (submission deadline; final match day) |
| Winners announced | July 29, 2026 |
| Competition | **51 submissions shown on the live track page as of July 14**; the number is volatile and must be rechecked before submission |
| Eligibility | Global listing; the brief mentions AI agents, while the binding terms restrict participation/submission to natural persons. Deborah is the sole participant and owner. |
| Other tracks | Prediction Markets & Settlement; Consumer & Fan Experiences (not ours) |
| Contact | Telegram: TxLINEChat |
| Hackathon pitch | "Real products powered by TxODDS live football API on Solana" — real-time World Cup data wired into on-chain products. TxODDS is waiving data fees and the token payment requirement for the World Cup tier. |

**Reading the judges:** this is a TxODDS + Solana event, but the brief is more specific than that shorthand. It scores core ingestion, autonomous operation, defensible logic/architecture, novelty, and production readiness, and says the demo video is weighted heavily because live match activity may be absent during review. Samaritan must therefore show a working strategy lifecycle, not merely architecture, while distinguishing local hash-chain verification from any Solana anchor that has actually been submitted and verified.

### 1.1 Hackathon legal terms — VERIFIED ([terms page](https://txline.txodds.com/documentation/legal/hackathon-terms))

These are binding and shape the build:

| Rule | Exact/near-exact language | Consequence for Samaritan |
|---|---|---|
| Originality | "Original work created during the Hackathon period"; open-source components OK with attribution; "significant portions … developed during the Hackathon" | We start clean July 4 — fully compliant |
| **AI clause** | "Entries must be created, developed and submitted by **human participants**"; TxODDS may disqualify an entry materially controlled by a bot or autonomous process | **Deborah must remain the participant, product decision-maker, narrator, reviewer, and submitter.** Claude is a bounded runtime component and development assistant, never the entrant or autonomous submitter. The listing's broader “AI agents” language does not erase the stricter legal terms; retain written sponsor clarification before relying on any interpretation. |
| **Judge access** | TxODDS "shall not be required to purchase any software, subscription, licence, token, cryptocurrency, digital asset or third-party service, **nor establish any blockchain wallet or account**" | Demo must be a **hosted app with our credentials server-side** + bundled replay dataset. Judges never touch a wallet. Non-compliance = disqualification. |
| Data license | No redistribution/publishing/sublicensing of Data; no reconstructing competing data products; hackathon data license **terminates when the hackathon ends** | Public-facing surfaces must not re-serve raw TXLine feeds. Post-hackathon we operate under the normal free/paid tier terms (which explicitly allow commercial use) — separate license from the hackathon one. |
| Compliance | Must comply with all gambling/gambling-tech laws; restricted jurisdictions may be excluded | Real-money leg (Polymarket) is our own account/jurisdiction responsibility, separate from the submission itself |
| Branding | No FIFA marks; no implied affiliation | Name/copy says "World Cup data" via TxODDS, no FIFA logos |
| IP | We keep ownership; TxODDS gets a promo/evaluation license | Fine |

---

## 2. TXLine — the data platform

TXLine = "cryptographically verifiable sports data through a hybrid Solana on-chain and TxODDS off-chain system." Docs: [quickstart](https://txline.txodds.com/documentation/quickstart) · [full docs index](https://txline-docs.txodds.com/llms.txt) · [OpenAPI spec](https://txline.txodds.com/docs/docs.yaml).

### 2.1 Access & auth (two-token system)

1. `POST /auth/guest/start` → **guest JWT**
2. Execute free on-chain Solana subscription transaction (wallet on matching network)
3. Sign activation message with wallet → `POST /api/token/activate` (params: txSig, walletSignature, leagues) → **API token**
4. Every data request carries both: `Authorization: Bearer ${jwt}` + `X-Api-Token: ${apiToken}`

- **Mainnet base:** `https://txline.txodds.com/api/` · **Devnet base:** `https://txline-dev.txodds.com/api/`
- Network choice must be consistent across RPC URL, program ID, token mint, API origin.
- Subscriptions run in 28-day multiples; free-tier renewal costs nothing.
- Paid tiers: TxL tokens bought with USDT (1 USDT = 1,000 tokens), quote endpoint `POST /api/guest/purchase/quote`.

### 2.2 Free World Cup tier — the critical detail

| Service Level | Data | Latency | Networks |
|---|---|---|---|
| **SL1 mainnet** | World Cup + Int'l Friendlies | **60-second delay** | mainnet |
| **SL1 devnet** | World Cup + Int'l Friendlies | Current on-chain row reports `samplingIntervalSec = 0`; re-read the pricing matrix at subscription time | devnet |
| **SL12** | World Cup + Int'l Friendlies | **Real-time** | **mainnet only** |

Both include **full historical replay access**. Free tier is explicitly allowed for commercial use.

**Implication:** mainnet SL1's 60-second delay is unsuitable for time-sensitive decisions. We run **SL12 on mainnet** for authoritative real-time evidence and use devnet SL1 for integration/on-chain validation. The official July 12 page now reports devnet SL1 `samplingIntervalSec = 0`, contradicting the earlier blanket 60-second description; code must inspect the current on-chain pricing row rather than infer devnet latency from the service-level number.

### 2.3 Endpoints (from the OpenAPI spec)

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/guest/start` | Guest JWT |
| POST | `/api/token/activate` | Activate subscription → API token |
| POST | `/api/guest/purchase/quote` | Solana tx for paid-tier purchase |
| GET | `/api/fixtures/snapshot` | Latest fixtures (params: `startEpochDay`, `competitionId`) |
| GET | `/api/fixtures/updates/{epochDay}/{hourOfDay}` | Fixture updates by hour |
| GET | `/api/odds/snapshot/{fixtureId}` | Latest odds per market line (`asOf` must be an epoch-millisecond value in practice; omitting it returned only a partial snapshot in the July 10 Phase-1 smoke) |
| GET | `/api/odds/updates/{fixtureId}` | Current live odds updates |
| GET | `/api/odds/updates/{epochDay}/{hourOfDay}/{interval}` | **Historical 5-min-interval odds** (backtest fuel) |
| GET | `/api/odds/stream` | **Real-time SSE odds stream** (params: `fixtureId`, `Last-Event-ID`) |
| GET | `/api/scores/snapshot/{fixtureId}` | Latest score events |
| GET | `/api/scores/updates/{fixtureId}` | Current score updates |
| GET | `/api/scores/updates/{epochDay}/{hourOfDay}/{interval}` | Historical 5-min-interval scores |
| GET | `/api/scores/historical/{fixtureId}` | **Full score sequence for a fixture** (2-week → 6-hour window) |
| GET | `/api/scores/stream` | **Real-time SSE scores stream** |
| GET | `/api/fixtures/validation`, `/api/odds/validation`, `/api/scores/stat-validation`, `/api/fixtures/batch-validation` | **Merkle proofs** — validate any data point on-chain |

SSE notes: standard `id`/`event`/`data`/`retry` format; heartbeat events; resumable via `Last-Event-ID`; `Accept-Encoding: gzip` cuts bandwidth 70–80%.

### 2.4 Data models

**Fixture:** `FixtureId` (int64), `Participant1/2` (+ IDs), `Participant1IsHome`, `StartTime`, `Competition`, `CompetitionId`, `FixtureGroupId`, `Ts`.

**OddsPayload — the money object:**

| Field | Meaning | Why we care |
|---|---|---|
| `FixtureId`, `MessageId`, `Ts` | Identity + timestamp | Time-series keying |
| `BookmakerId`, `Bookmaker` | Book/source attribution when populated | Leader-lag / steam detection needs to know WHO moved, but Phase 0 devnet + mainnet SL12 free World Cup captures only exposed `10021:TXLineStablePriceDemargined` consensus rows, not multiple books. |
| `SuperOddsType` | Market: Match Result, Over/Under, Handicap | The liquid core markets |
| `MarketParameters` | e.g. the O/U line or handicap value | Line-move vs price-move distinction |
| `MarketPeriod` | Full Time, Half Time, … | Period-specific markets |
| `PriceNames`, `Prices` | Outcome labels + raw odds (int32, ×1000) | Price stream. The Spain-Belgium synchronized SSE capture also contained mapped market rows with intact `PriceNames` but both `Prices: []` and `Pct: []`; these are no-quote transitions and are skipped rather than normalized as zero prices. Partially populated/misaligned arrays still fail validation. |
| `Pct` | **De-vigged implied probabilities** as 3dp strings on a 0–100 percent scale | The margin removal is DONE FOR US, but ingest must divide by 100 for Samaritan's internal 0–1 probability convention. Phase 0 devnet + mainnet rows summed near 100, not near 1. |
| `InRunning` | Live-market flag | Pre-match vs in-play routing |
| `GameState` | Match state at time of odds | Context for every tick when populated. Phase 0 devnet + mainnet historical odds rows had this blank on all scanned rows. |

**StablePrice feed:** TxODDS' consensus pricing engine — aggregates "lines across global operators, **including sharp books absent from standard Western feeds**," filters outliers/stale lines, publishes to Solana. Build tier = 60s batches; Scale tier = sub-second streams.

**Scores (soccer):** stat key encoding `(period * 1000) + base_key`. Base keys 1–8 confirmed in Phase 0 devnet + mainnet: goals P1/P2, yellows P1/P2, reds P1/P2, corners P1/P2. Captured `Stats` keys used period prefixes 0–7, so do not hard-code only prefixes 1–5. Captured score rows also include a rich action envelope beyond counters: `Clock`, possession fields, `Score`, `PossibleEvent`, `Kickoff`, `PlayerStats`, `Lineups`, and `Action` values including `shot`, `var`, `penalty`, `penalty_outcome`, `goal`, `corner`, `yellow_card`, and `red_card`. Match states observed include IDs 1–13 plus 100; docs list 1–19, so keep the parser open.

**Phase 0 retention observations (July 9, 2026):** odds interval endpoints returned data back to June 11 on both devnet and mainnet with no 404/error cutoff in the capture. Mainnet score interval endpoints had data June 11–July 7 and empty 200s July 8–9 at capture time; devnet score intervals were empty June 11–17, had data June 18–July 7, and were empty July 8–9. `/api/scores/historical/{fixtureId}` returned 200s for checked fixtures, but data-bearing bodies started at June 25 fixture start dates and older fixtures were empty 200s on both networks.

---

## 3. Polymarket — the execution venue

- [World Cup hub](https://polymarket.com/fifa-world-cup): **188 markets** in the category — every match (moneyline, spreads, totals), group advancement, knockout rounds, outright winner.
- Scale: **$3.7B traded on the winner market**; combined Polymarket+Kalshi June volume **$45B** amid "World Cup fever" ([The Block](https://www.theblock.co/post/406983/kalshi-polymarket-volume-45-billion)).
- Microstructure: Polymarket's changelog says selected World Cup to-advance/moneyline/spread/total markets support **0.25¢ tick size**, but Phase 0 capture found the France vs Morocco moneyline market reporting **0.01** in both Gamma metadata and CLOB `/tick-size`. **Do not assume tick size by category; fetch it per token before quoting.**
- **CLOB V2 is live on production** at `https://clob.polymarket.com` as of Apr 28, 2026; legacy V1 SDKs/V1-signed orders are no longer production-compatible. Build against `@polymarket/clob-client-v2` / V2 REST only ([changelog](https://docs.polymarket.com/changelog)).
- **Public historical prices are recoverable by outcome token ID:** `GET https://clob.polymarket.com/prices-history?market=<TOKEN_ID>&startTs=<unix-seconds>&endTs=<unix-seconds>&fidelity=1` returns `history: [{t,p}]`. Despite the parameter name, `market` is the CLOB asset/token ID. Absolute `startTs`/`endTs` must not be combined with `interval`. Phase 0.5 captured official HTTP 400 responses for multi-week requests (`interval is too long`), so the rescue archive uses atomic five-day segments and timestamp de-duplication. The response has no bid, ask, size, or spread fields and must not be treated as an executable quote archive.
- **Public live order books require no authentication:** subscribe asset IDs at `wss://ws-subscriptions-clob.polymarket.com/ws/market`, set `custom_feature_enabled: true` for `best_bid_ask`, `new_market`, and `market_resolved`, and send `PING` every 10 seconds. Initial `book`, `price_change`, `last_trade_price`, and tick-size events are recorded separately from TXLine until the shared Phase 1 bus exists.
- **Public V2 execution metadata requires no authentication:** `GET /clob-markets/{condition_id}` returns compact condition/token identity plus `mos` minimum order size, `mts` tick size, and `fd = {r,e,to}` fee-curve details. A July 12 smoke returned sports rate `0.05`, exponent `1`, taker-only, and minimum size `5`. The OpenAPI lists a staging hostname, but it returned 503 during validation and no official test-funds workflow was documented; do not treat it as a Polymarket devnet.
- **Phase 0.5 archive scale:** 799 match-family Gamma records representing 100 unique matches; 300 Match Result and 861 full-time totals conditions; 2,320 non-empty outcome-token histories containing 90,795,313 points. Two tokens for one Morocco–Haiti O/U 8.5 condition returned empty HTTP 200 histories. Candidate mapping covers 98/102 captured TXLine fixtures and is research-only.
- Live in-play markets exist across matches. The July 10 synchronized Spain-Belgium capture tested the proposed post-goal repricing lag with executable books: across three goals and six exact market groups, 12/18 exploratory cases had already moved at least 50 probability bps before TXLine first delivery, 6/18 had no material 30-second move, and 0/18 showed a clean post-TXLine stale window. One match is not a fitted distribution, but it does not support STALE_QUOTE; the detector remains disabled and paper-only.

---

## 4. Competitive landscape

- **SportyClaw** (sportyclawai.site) — the example the bounty scene points at: a Telegram AI assistant for Nigerian bettors. Ticket management, booking-code conversion across 12+ bookies (1Xbet, SportyBet, Bet9ja...), AI predictions with probability/EV scores, tip extraction from Twitter/screenshots. Tiered pricing in Naira (₦200–2,000/day). **Read:** it's a consumer convenience product — an assistant, not a trading system. No signal engine, no execution, no verifiable track record. That's the bar to clear, and it's clearable.
- Telegram build chatter shows real competition, not only thin chatbots: PrivateDAO claims a live ZK/Merkle settlement product; KickProof and others are working on proof-backed settlement; one Trading Tools entrant publicly claims sharp-odds-vs-Polymarket, de-vig, Kelly, and CLV; another has opposing AI agents creating on-chain intents but is blocked by solver access. These are participant claims, not audited products, but they invalidate any assumption that basic cross-market comparison alone differentiates us. Samaritan's moat must be the shared live/replay code path, measured case pipeline, deterministic risk boundary, strategy tournament, and append-only/on-chain evidence.

---

## 5. Constraints & risks (honest list)

1. **Latency reality.** SSE real-time (SL12) is table stakes for in-play work; anything downstream adds latency. Phase 0 observed fast steady-state medians but reconnect/catch-up bursts and a long outage. The deterministic layer must decide in milliseconds; Claude only enters where minutes-scale windows exist (pre-match consensus moves, persistent divergences) or where the thesis outlives the latency.
2. **Market fields verified but constrained.** Phase 0 confirmed Match Result / Over-Under / Handicap coverage in the free World Cup capture, but also confirmed the free tier exposes consensus `TXLineStablePriceDemargined` rows rather than multiple bookmaker feeds. SSE score payloads are richer than the original docs summary; keep parsers open around actions and state fields.
3. **Thin remaining schedule.** Live demo material is scarce. The rescued TXLine + Polymarket archive carries the pre-match study; remaining fixtures supply synchronized live microstructure evidence. Fixture/market discovery must roll because later matches are published over time.
4. **Polymarket V2 is already live, but market metadata still needs per-market verification.** Mitigation: isolate execution behind an adapter interface; paper adapter is the fallback that always works; fetch tick size/fees/rules per token before any mapping is tradeable.
5. **Real-money risk.** We ARE wiring real execution (decision locked), so bankroll limits, kill switches, and the risk-manager veto are not optional features — they're the difference between a trading system and a donation.
6. **World Cup ends July 19.** Post-hackathon, the system must retarget to club football (TXLine paid tiers, USDT-priced) — architecture must be competition-agnostic from day one.

---

## Sources

[Bounty listing](https://superteam.fun/earn/listing/trading-tools-and-agents/) · [World Cup Hackathon](https://superteam.fun/earn/hackathon/world-cup/) · [AGB hackathon announcement](https://agbrief.com/news/world/25/06/2026/txodds-and-solana-introduce-world-cup-hackathon-to-reshape-sports-data-ecosystems/) · [TXLine quickstart](https://txline.txodds.com/documentation/quickstart) · [TXLine docs index](https://txline-docs.txodds.com/llms.txt) · [TXLine OpenAPI](https://txline.txodds.com/docs/docs.yaml) · [World Cup free tier](https://txline.txodds.com/documentation/worldcup) · [Streaming examples](https://txline.txodds.com/documentation/examples/streaming-data) · [StablePrice overview](https://txline.txodds.com/documentation/odds/overview) · [Soccer feed encodings](https://txline.txodds.com/documentation/scores/soccer-feed) · [Polymarket WC hub](https://polymarket.com/fifa-world-cup) · [Polymarket changelog](https://docs.polymarket.com/changelog) · [The Block volume report](https://www.theblock.co/post/406983/kalshi-polymarket-volume-45-billion) · [Deadspin $3.7B report](https://deadspin.com/prediction-markets/trending/3-7-billion-traded-for-2026-world-cup-winner-on-polymarket/) · [SportyClaw](https://sportyclawai.site/)
