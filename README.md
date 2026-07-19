![Samaritan product banner](docs/assets/samaritan-product-banner.png)

# Samaritan — Governed sports-market intelligence

> Samaritan turns TXLine sports data and public prediction-market prices into
> deterministic signals, sends only qualified cases through bounded Claude
> judgment, and keeps risk, paper execution, and evidence under deterministic
> control. Claude cannot size or place trades. Every decision is ledgered before
> the system acts.

Built for the **TxODDS Trading Tools and Agents bounty** in the 2026 World Cup
Hackathon. The public release is intentionally **paper-only**, read-only for
judges, and honest about what is captured, researched, synthetic, or still
unimplemented.

---

## Live

- 🌐 **Dashboard** — [getsamaritan.xyz](https://getsamaritan.xyz/)
- 📖 **Docs** — [getsamaritan.xyz/docs](https://getsamaritan.xyz/docs)
- 🗺️ **Architecture** — [getsamaritan.xyz/architecture](https://getsamaritan.xyz/architecture)
- 🔎 **Judge evidence** — [getsamaritan.xyz/api/judge/evidence](https://getsamaritan.xyz/api/judge/evidence)

---

## Table of contents

- [Quick path](#quick-path)
- [Why it stands out](#why-it-stands-out)
- [What it does](#what-it-does)
- [Evidence status](#evidence-status)
- [Architecture](#architecture)
- [Requirements](#requirements)
- [Setup](#setup)
- [Useful commands](#useful-commands)
- [Project layout](#project-layout)
- [Safety and data boundary](#safety-and-data-boundary)
- [Documentation](#documentation)

---

## Quick path

The shortest judge path needs no TXLine credential, Anthropic key, wallet,
private archive, or paid service:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm judge
```

Then open `http://127.0.0.1:4173`.

`pnpm judge` runs the clean-clone verification gate before serving the read-only
dashboard. The hosted app exposes the same licence-safe frozen evidence plus an
optional coarse TXLine connectivity pulse.

## Why it stands out

- **Deterministic authority.** Claude can return only a strict trade thesis. It
  cannot choose a stake, access credentials, place an order, or override a risk
  rule.
- **One live/replay path.** Live and replay sources emit the same canonical
  event types into the same conductor. Strategies receive no transport-mode
  flag.
- **Evidence before action.** Signal, triage, thesis, veto, intent, fill, close,
  and settlement records form an append-only hash-linked ledger.
- **No-trade is a valid result.** Incomplete evidence, stale books, mapping
  uncertainty, or a failed risk rule ends in a visible refusal—not a forced
  position.
- **Claims stay separated.** Captured observations, sampled-price research,
  synthetic engineering proof, and forward paper registration are never
  blended into one performance story.

## What it does

- Ingests TXLine odds and score streams with resumable SSE, reconnect backfill,
  normalization, and append-only journals.
- Maps only evidence-backed Polymarket market candidates; automatic discovery
  never makes a market tradeable.
- Computes rolling consensus movement, cross-market divergence, and retail-fade
  features in probability space.
- Escalates admitted signals through bounded Haiku triage and an Opus analyst
  that can exit only through the strict `submit_thesis` contract.
- Applies deterministic paper-risk rules, delay-, fee-, tick-, and depth-aware
  execution simulation, settlement, portfolio reconstruction, and drawdown
  accounting.
- Produces portable decision receipts and a derived-only public dashboard that
  never redistributes raw TXLine data.

## Evidence status

| Evidence lane | Current result | Boundary |
|---|---|---|
| Captured replay | Spain–Belgium produced 18 synchronized goal/market observations and zero clean post-TXLine stale-quote windows | Authentic captured evidence; no Claude or execution claim |
| Historical research | Corrected totals `CONSENSUS_MOVE`: 38 held-out normalized buy cases across 18 fixtures; mean +132.7 probability bps after the documented 100 bps proxy | Sampled prices, not executable books, fills, alpha, or profitability |
| Synthetic lifecycle | Deterministic case completes signal → judgment stubs → risk → paper fill → settlement → receipt | Engineering proof only; permanently excluded from performance evidence |
| Forward paper v2 | Protocol registered with a $50 reference bankroll, $3 fixed stake, $15 exposure cap, and $20 drawdown stop | Zero qualifying forward observations at registration |
| Real-money execution | Disabled; no production order adapter or trading credential is connected | Gate closed |
| Receipt anchoring | Local receipt and hash-chain tooling verify offline | No Solana transaction has been submitted; the release is unanchored |

## Architecture

```text
TXLine odds + scores       Polymarket public market data
          │                         │
          └──────────┬──────────────┘
                     ▼
        Canonical event bus + append-only stores
                     ▼
          Features + deterministic detectors
                     ▼ qualified signals only
              Haiku triage → Opus thesis
                     ▼ strict schema only
            Deterministic paper risk rules
                     ▼
          Paper execution + portfolio state
                     ▼
        Append-only ledger → portable receipt
```

The full built-versus-roadmap boundary is documented in
[`ARCHITECTURE.md`](ARCHITECTURE.md). The live interactive version is available
at [getsamaritan.xyz/architecture](https://getsamaritan.xyz/architecture).

## Requirements

- Node.js `22.x` (the release was validated on `22.23.1`)
- pnpm `11.x` via Corepack
- macOS or Linux for the documented local judge path

The frozen judge path is offline-safe after dependencies are installed. Private
capture and live-agent workflows require separate credentials and are not needed
to evaluate the public release.

## Setup

```bash
git clone https://github.com/Pavilion-devs/samaritan.git
cd samaritan
corepack enable
pnpm install --frozen-lockfile
pnpm judge
```

Optional hosted TXLine pulse configuration is server-side only:

```text
TXLINE_JWT
TXLINE_API_TOKEN
TXLINE_SERVICE_LEVEL_ID=12
```

If those values are absent or invalid, the pulse truthfully degrades while the
frozen judge evidence remains available.

## Useful commands

```bash
# Full project typecheck and tests
pnpm check

# Deterministic full-lifecycle engineering proof
pnpm demo

# Independently verify the published receipt
pnpm receipt:verify -- public/artifacts/dashboard/synthetic-decision-receipt.json

# Audit public artifacts for raw data, secrets, and unsafe paths
pnpm public:audit

# Run the complete clean-clone judge gate
pnpm judge:check
```

## Project layout

```text
apps/dashboard/   React judge UI and Sites edge worker
config/captures/  Reviewed, non-tradeable capture configuration
docs/             Architecture, strategy, research, proof, and release docs
phase0/           Isolated TXLine access and capture utilities
proof/            Portable receipt fixtures
public/           Licence-safe frozen dashboard and edge artifacts
src/              Runtime, agents, risk, replay, proof, and projection code
test/             Release and invariant test suite
```

## Safety and data boundary

- Raw TXLine payloads, archives, odds series, fixture identities, credentials,
  wallets, databases, and local captures are excluded from Git and public
  surfaces.
- Public TXLine information is derived, bucketed, or aggregate-only.
- The bounty build uses deterministic **paper execution only**. There is no
  production Polymarket order route.
- The analyst's only exit is `submit_thesis`; free text never becomes an order.
- Deterministic caps and vetoes cannot be overridden by any model response.
- Deborah is the participant, product owner, reviewer, narrator, and submitter;
  Claude is a constrained product component.

## Documentation

- [Canonical system architecture](ARCHITECTURE.md)
- [Technical overview](docs/submission/technical-overview.md)
- [Strategy playbook](docs/03-strategy-playbook.md)
- [Gate study](docs/06-gate-study.md)
- [Forward paper v2 registration](docs/10-paper-study-v2-registration.md)
- [Decision receipt specification](docs/proof/decision-receipt.md)
- [Public release scope](docs/submission/public-release-scope.md)
- [Third-party notices](docs/submission/third-party-notices.md)

---

Samaritan is research and demonstration software. Nothing in this repository is
financial or betting advice.
