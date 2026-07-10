# Samaritan Phase 0 Capture Scripts

These scripts are only for access and ground-truth capture. They do not trade, size, or place orders.

Local-only paths:

- `phase0/.wallet/` - Solana keypair files
- `phase0/.tokens/` - TXLine JWT/API token files
- `samples/` - raw TXLine and Polymarket captures

Typical flow:

```bash
cd phase0
pnpm install
pnpm airdrop:devnet
pnpm auth:devnet
pnpm fixtures -- --network devnet

# After Deborah funds the printed public key on mainnet:
pnpm auth:mainnet
pnpm fixtures -- --network mainnet
pnpm archive -- --network mainnet --from 2026-06-11 --to 2026-07-09
pnpm sse -- --network mainnet --fixture-id <fixtureId> --duration-minutes 240
pnpm analyze
```

Polymarket market data is read-only and does not require keys:

```bash
pnpm polymarket
pnpm polymarket:history -- --run-label world-cup-2026-v1
pnpm polymarket:ws -- --duration-seconds 45 --force-reconnect-after-seconds 15
```

For the next human-confirmed match mapping, run both recorders with one label and one wall-clock interval:

```bash
pnpm capture:paired -- --network mainnet --txline-fixture-id <CONFIRMED_FIXTURE_ID> --duration-minutes 300 --run-label <RUN_LABEL>
```

The paired process waits for both recorders and does not detach either process. It remains capture-only: no Polymarket authentication, wallet, or trading calls are used.
