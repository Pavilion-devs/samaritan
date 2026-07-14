# Samaritan Decision Receipt v1

The Decision Receipt is Samaritan's portable, offline-verifiable record of one completed paper-decision lifecycle. It is generated only after the local decision ledger passes a full v2 hash-chain verification. The generator rejects mixed v1/v2 ledgers, incomplete or reordered lifecycles, and filled cases without a ledgered position.

## What the receipt commits

- the versioned code and frozen-config hashes;
- SHA-256 references to private TXLine and public venue source records;
- licence-safe signal evidence: 25-bps movement buckets, aggregate z/CUSUM state, categorical relative-value direction, and hashes—never an exact TXLine fair level or reconstructive cross-market gap;
- triage and analyst model, prompt version, prompt/response commitments, token usage, and nano-USD cost evidence;
- a SHA-256 commitment to the complete private submitted thesis plus its non-price identity/status fields, and the deterministic risk verdict with its fair-value limit kept private;
- the paper intent, post-analysis/post-venue-delay book evidence, and fill or no-fill result; exact public Polymarket book/fill prices remain visible because they do not disclose a TXLine level;
- the position, closing mark, and settlement when those lifecycle stages exist;
- ordered v2 ledger-entry commitments and the full ledger head at generation time;
- optional Solana memo metadata that must commit the same ledger head.

The receipt's domain-separated canonical SHA-256 detects changes to every disclosed field. The offline verifier also recursively rejects exact fair/consensus probabilities, private deterministic limit probabilities, raw TXLine keys, and exact/reconstructive gap fields. It checks 25-bps bucketing, cross-field identity, lifecycle order, cost arithmetic, timing, fill/position state, source-reference roles, settlement order, and optional anchor consistency.

## Proof boundaries

`receipt:verify` is intentionally offline. It does not fetch private source payloads, reopen the local SQLite ledger, query Polymarket, or call Solana RPC. Its success means the strict schema, canonical receipt hash, disclosed lifecycle relationships, and committed ledger head are internally consistent. It does not independently prove that undisclosed source payloads existed, that the local ledger was honest when generated, that an anchor transaction is on-chain, or that a strategy is profitable.

An unanchored receipt hash is tamper-evident, not an external timestamp or identity signature. Even when anchor metadata is present, the v1 verifier always reports `solanaNetworkVerificationPerformed: false`. Network verification belongs in a separate RPC-backed step.

That separate offline-prepare / human-submit / read-only-verify workflow is documented in [Solana devnet Decision Receipt anchoring](solana-devnet-anchor.md). It leaves the source receipt immutable and reports network verification separately, so offline verification never overclaims an on-chain proof.

## Synthetic proving fixture

[`proof/fixtures/decision-receipt.synthetic.v1.json`](../../proof/fixtures/decision-receipt.synthetic.v1.json) is deterministic and prominently classified as synthetic. It represents no real match, feed observation, Claude invocation, order, fill, settlement, or performance. Its `performanceUse` is permanently `excluded_synthetic`.

Verify it locally:

```bash
pnpm receipt:verify -- proof/fixtures/decision-receipt.synthetic.v1.json
```

The generator lives in `src/proof/decision-receipt.ts`; the strict schema and independent verifier live in `src/proof/decision-receipt-schema.ts`.
