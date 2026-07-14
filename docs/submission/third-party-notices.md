# Samaritan Third-Party Notices

This file covers the judge-facing bounty repository and dashboard. Local ignored design/video experiments are outside the public release scope.

## Data and services

- **TXLine / TxODDS:** official fixture, odds, score, and validation APIs are used under the World Cup Hackathon terms. The public bundle contains only Samaritan-derived, non-reconstructive signals, decisions, aggregates, and hashes; it does not redistribute raw TXLine data. Continued post-hackathon operation requires the appropriate TxODDS licence.
- **Polymarket:** public market metadata, sampled prices, and public order-book data are used for research and paper simulation. Samaritan places no real order in the bounty build and does not require a judge wallet or account.
- **Anthropic Claude:** Haiku and Opus are constrained runtime components. The zero-network public proving fixture uses deterministic stubs at those two boundaries and does not call Anthropic.
- **Solana:** `@solana/web3.js` and the public Memo program are used for offline devnet anchor preparation and human-gated submission/verification tooling. No anchor transaction has been submitted for the current receipt.

## Fonts and visual assets

- **Manrope**, distributed through `@fontsource/manrope`, is licensed under SIL Open Font License 1.1.
- **IBM Plex Mono**, distributed through `@fontsource/ibm-plex-mono`, is licensed under SIL Open Font License 1.1.
- The Samaritan wordmark/logo and dashboard interface artwork in the public repository are project-owned assets. No FIFA logo, team crest, tournament emblem, or endorsement mark is used.

## Software

Runtime and development dependencies are declared in `package.json`, with exact resolved versions and integrity hashes in `pnpm-lock.yaml`. Their respective licences remain with their authors. The public judge graph is checked with `pnpm security:audit`; the separately installed Phase 0 graph and its known upstream advisory are documented in `public-release-scope.md`.
