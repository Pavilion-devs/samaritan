# Samaritan Demo Script v1 — Target 4:45

> **Narrator and owner:** Deborah. She must rehearse, personally review every visible artifact, rewrite the narration in her natural voice, and submit the final video herself. Do not present Claude as the participant or builder of record.

## Recording setup

- Record one continuous 1080p browser/terminal walkthrough; target **4:45** to retain 15 seconds of screening margin below the bounty's hard 5:00 limit.
- Use the final public commit and public URL. Hide notifications, bookmarks, usernames, local private paths, credentials, wallet software, and raw capture files.
- Pre-open: Command, Matchroom, Study, a terminal at the public repo, and the frozen receipt.
- Use only derived dashboard output. Do not expose exact TXLine probability levels or raw TXLine payloads.
- Run all commands once before recording. Do not fake output or splice separate evidence into one purported live trade.

## Exact shot list and narration

| Time | Screen and action | Deborah narration |
|---|---|---|
| **0:00–0:20** | **Command** hero: “The trade Samaritan refused.” Keep the Paper and Real-money gate closed badges visible. | “I’m Deborah, and this is Samaritan: my auditable sports-market agent built with official TXLine data and captured mainnet evidence. It does not promise winning bets. It proves why it acted—or, just as importantly, why it refused. This bounty build is paper-only and the real-money gate is closed.” |
| **0:20–0:50** | Scroll through **System posture** and the integrity panel, then briefly show the architecture diagram from the technical overview. | “TXLine odds and scores become canonical probability events. Live and captured-replay adapters feed the same runPaperSession conductor, with no mode flag for the strategy. Deterministic code detects a case; Claude can return only a strict thesis; deterministic risk decides; the paper adapter simulates against executable depth; and every stage is hash-chained before the next action. This is a shared runtime contract, not a claim that the public dashboard is a live 24/7 trader.” |
| **0:50–1:40** | Open **Matchroom** for the Spain–Belgium replay. Play or scrub across the first-goal marker, book chart, decision rail, and authoritative `NO TRADE` verdict. | “This is not synthetic. It is a synchronized, read-only Spain–Belgium capture pairing TXLine mainnet SL12 delivery with public Polymarket books. Here, the public book had already repriced before the goal reached Samaritan. Across all 18 measured market-event cases in this capture, zero showed a clean post-TXLine stale window. Samaritan kept STALE_QUOTE disabled and made no order. The dashboard exposes only a 25-basis-point TXLine movement bucket; the exact licensed level stays private.” |
| **1:40–2:15** | Open **Study**. Show the invalidated v1 audit, corrected v4 Total Goals panel, and the visually separate **Synthetic full-lifecycle proving fixture** panel. Keep `engineering_candidate_unregistered`, `Performance use: Excluded`, and `Solana anchor: Not submitted` visible. | “We also caught our own bad result. The first total-line selector used future information, so I preserved and invalidated v1 instead of hiding it. After repairing causality and economic-case counting, the held-out Total Goals candidate had 38 normalized buy cases across 18 fixtures, plus 132.7 probability basis points after a 100-basis-point proxy, with a fixture-clustered 95 percent interval from plus 14.3 to plus 243.9. These are sampled-price signal results—not alpha, fills, or profitability. V2 is not registered. The green panel below is a different evidence class: synthetic wiring proof, permanently excluded from those results.” |
| **2:15–3:20** | Terminal: run `pnpm demo`. Pause on the top boundary label, then the runtime and receipt sections. Highlight `20` canonical events, `12` ledger rows, `filled_settled`, both `synthetic_stub` agent records, and all external-call counters at zero. | “Now I’ll prove the whole lifecycle without pretending it is performance evidence. This synthetic fixture sends 20 invented canonical events through the same runPaperSession conductor, with deterministic stubs at the two model boundaries: signal, triage, thesis, deterministic risk, execution intent, paper fill, kickoff close, settlement, and receipt. It produced 12 version-two ledger records. It made zero TXLine, Polymarket, Anthropic, wallet, Solana RPC, or real-order calls, and it is permanently excluded from performance results.” |
| **3:20–4:00** | Terminal: run `pnpm receipt:verify -- public/artifacts/dashboard/synthetic-decision-receipt.json`. Hold on `valid: true`, `filled_settled`, `synthetic: true`, the `synthetic_stub` invocation classes, and both Solana fields. | “A judge can verify the frozen receipt offline. This checks its strict schema, canonical hash, disclosed lifecycle relationships, disclosed agent-run records, and committed ledger head. Here both model steps are explicitly synthetic stubs. For an admitted real API run, Samaritan verifies its invocation-evidence chain locally before generating a receipt reference; the portable receipt does not independently prove membership, and no Anthropic-side attestation or signed billing proof is claimed. This receipt does not replay private source payloads or prove profitability. Solana anchor metadata and network verification are both false.” |
| **4:00–4:25** | Terminal: run `pnpm public:audit`, then return to **Command → Proof**. | “The judge bundle also passes a public-artifact audit. It contains six small derived files, no credentials or wallet controls, no raw TXLine response, and no exact TXLine probability series. Judges can open the dashboard and run the proof without a subscription, API key, or wallet.” |
| **4:25–4:45** | Keep **Proof** and the closed-gate badge visible. If useful, briefly show the devnet anchor documentation status line—do not show a fake explorer link. | “The devnet prepare, human-gated submit, and read-only verify tools are implemented, but no anchor transaction has been submitted, so this receipt is honestly unanchored. Samaritan’s edge is disciplined autonomy: fast deterministic detection, bounded judgment, code-owned risk, and evidence you can challenge. I’m Deborah, the owner and submitter. Thank you.” |

## Commands to have ready

```bash
pnpm demo
pnpm receipt:verify -- public/artifacts/dashboard/synthetic-decision-receipt.json
pnpm public:audit
```

Expected proof markers on the final commit:

- `synthetic: true`
- `performanceUse: "excluded_synthetic"`
- `protocolStatus: "engineering_candidate_unregistered"`
- `realMoneyGate: "closed"`
- `canonicalEventsPublished: 20`
- `ledgerRows: 12`
- `finalLifecycleStatus: "filled_settled"`
- `valid: true`
- `solanaAnchorMetadataPresent: false`
- `solanaNetworkVerificationPerformed: false`

Re-record if any expected marker differs; do not narrate a stale number.

## Non-negotiable wording guardrails

Never say:

- “profitable,” “proof of alpha,” “winning strategy,” or “guaranteed edge”;
- “real trade,” “real fill,” or “live Polymarket execution”;
- “v2 is registered,” “the study is active,” or “preregistered”;
- “the receipt is on-chain,” “anchored,” or “externally timestamped” without a verified transaction;
- “Claude placed/approved/sized the trade”;
- “this synthetic lifecycle used live TXLine, Claude, or Polymarket”;
- “the invocation evidence is Anthropic-signed/provider-attested”; or
- “raw TXLine data is in the public replay.”

Use instead:

- “sampled-price historical signal evidence”;
- “synthetic full-lifecycle proving fixture, excluded from performance evidence”;
- “deterministic paper execution”;
- “Claude submits a bounded thesis; code owns risk and execution”;
- “v2 engineering candidate is unregistered”;
- “local invocation-evidence chain verified at generation; portable receipt carries a reference, not an offline membership proof or provider attestation”; and
- “offline receipt verified; Solana not submitted or network-verified.”

## Final recording gate

- [ ] Total runtime is 4:45–4:55 and never exceeds 5:00 after platform processing.
- [ ] Every screen comes from the final public commit or deployed public artifact.
- [ ] The captured refusal and synthetic lifecycle are visually and verbally separated.
- [ ] The v4 number is immediately limited to sampled-price signal evidence.
- [ ] The receipt visibly reports no Solana anchor/network verification.
- [ ] No secret, private path, raw TXLine record, wallet UI, or unverified link appears.
- [ ] Deborah has rewritten and delivered the narration in her own voice.
