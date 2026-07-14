# Solana devnet Decision Receipt anchoring

Status: tooling implemented and unit-tested; **no transaction has been submitted by this implementation work**. A prepared intent is not an on-chain proof. Only a signature that passes the read-only verifier is an externally timestamped devnet anchor.

This workflow anchors one immutable Samaritan Decision Receipt without exposing private TXLine payloads. The Solana Memo commits:

- Decision Receipt schema version;
- the receipt's canonical SHA-256 hash;
- the verified decision-ledger head sequence and SHA-256 hash;
- the commitment type and the literal `devnet` network.

The canonical Memo is domain-separated as `samaritan.decision-receipt.anchor/v1` and encoded with Samaritan stable JSON. The transaction uses the official Solana Memo program, `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`.

## Safety boundary

The workflow deliberately separates three operations:

1. `anchor:prepare` is offline. It reads a receipt, runs the receipt verifier, and emits a deterministic unsigned instruction/transaction intent. It has no fee payer, blockhash, signature, signer-loading path, or RPC call.
2. `anchor:submit` is the only write-capable command. It is devnet-only and fails unless all human gates below are explicit.
3. `anchor:verify` is read-only. It checks the RPC genesis hash, fetches one supplied signature at confirmed commitment, and compares the canonical Memo with the exact receipt and ledger head. It writes and signs nothing.

The source receipt is never edited by these commands. Network verification is a separate JSON sidecar/output. `receipt:verify` remains an offline verifier and correctly continues to report `solanaNetworkVerificationPerformed: false`.

## 1. Verify and prepare offline

First verify the receipt:

```bash
pnpm receipt:verify -- path/to/decision-receipt.json
```

Then create the unsigned intent. The default network is devnet; passing mainnet is refused.

```bash
pnpm anchor:prepare -- path/to/decision-receipt.json > path/to/anchor-intent.json
```

Preparation output explicitly says:

```json
{
  "transaction": {
    "feePayer": "supplied_only_at_submit",
    "recentBlockhash": "fetched_only_at_submit",
    "signatures": "none"
  },
  "preparation": {
    "offline": true,
    "signerAccessed": false,
    "networkAccessed": false
  }
}
```

The same receipt produces the same Memo and intent hash. Inspect and record these intent fields before continuing:

- `.network` must be `devnet`;
- `.commitment.receipt.hash` must equal the receipt's `.integrity.receiptHash`;
- `.commitment.ledgerHead.hash` and `.sequence` must equal the receipt ledger head;
- `.integrity.intentHash` identifies the exact unsigned intent reviewed.

## 2. HUMAN APPROVAL REQUIRED before submission

> **STOP — DEBORAH MUST APPROVE THIS DEVNET WRITE.** Do not run `anchor:submit` as an unattended agent step. Deborah must inspect the receipt hash, ledger head, unsigned intent, signer path, and RPC network, then deliberately provide both the exact hash and `--approve-devnet-write`.

Place the devnet keypair under the repository's ignored `.wallet/` directory, or provide another path that `git check-ignore` confirms is ignored. Never paste a secret key into a command, environment variable, document, log, receipt, or intent. The environment variable contains a **path only**:

```bash
export SAMARITAN_SOLANA_ANCHOR_KEYPAIR_PATH="$PWD/.wallet/devnet-anchor.json"
```

After human approval, the explicit write command is:

```bash
pnpm anchor:submit -- \
  --receipt path/to/decision-receipt.json \
  --intent path/to/anchor-intent.json \
  --network devnet \
  --confirm-receipt-hash <EXACT_64_HEX_RECEIPT_HASH> \
  --approve-devnet-write
```

An optional devnet RPC URL may be supplied with `--rpc-url` or `SAMARITAN_SOLANA_DEVNET_RPC_URL`. Before reading the keypair, the command:

- refuses every network string except `devnet`;
- re-verifies the receipt and unsigned intent;
- compares the exact confirmation hash;
- checks that the signer path is gitignored;
- queries and verifies the devnet genesis hash.

It then creates a one-instruction legacy transaction with `@solana/web3.js`, signs locally, sends with preflight, confirms it, and immediately runs the same read-only Memo verifier. Mainnet submission is unconditionally refused in code.

## 3. Independently verify the anchor

Anyone can verify the resulting signature without a wallet:

```bash
pnpm anchor:verify -- \
  --receipt path/to/decision-receipt.json \
  --signature <SOLANA_TRANSACTION_SIGNATURE> \
  --network devnet
```

The verifier requires all of the following:

- RPC genesis hash is the canonical Solana devnet genesis hash;
- the fetched transaction exists at `confirmed` commitment and succeeded;
- the requested signature belongs to that transaction;
- exactly one Memo instruction exists under the official Memo program;
- the Memo is domain-separated, strict-schema-valid, and canonically encoded;
- network, receipt schema, receipt hash, ledger sequence, ledger hash, and commitment type all match the supplied receipt.

It only calls `getGenesisHash` and `getParsedTransaction`. It does not access a signer, send a transaction, request an airdrop, change the receipt, or persist a verification result.

## Honest proof claims

- Offline receipt verification proves disclosed schema/hash/lifecycle consistency, not network inclusion.
- An unsigned anchor intent proves only what would be submitted.
- A transaction signature by itself is not enough; it must pass `anchor:verify` against the exact public receipt.
- A successful devnet verification externally timestamps the receipt hash and its committed local ledger head. It does not prove source-payload truth or trading profitability.
- Judges require no wallet, tokens, or paid service. They only need the public receipt, signature, and read-only verifier.

## Tests

`test/solana-decision-anchor.test.ts` covers deterministic Memo canonicalization, non-canonical encoding, wrong RPC network, wrong receipt hash, wrong ledger head, missing signer, missing exact confirmation, mainnet refusal, and the rule that RPC genesis is checked before signer loading or sending.
