# Samaritan Public Release Scope

**Status:** release-candidate allowlist, July 14, 2026<br>
**Owner and final approver:** Deborah<br>
**Purpose:** prevent private licensed data, credentials, local creative exports, and unreviewed utilities from entering the bounty repository or hosted judge surface.

This is an inclusion allowlist, not a claim that the current dirty working tree is already a public release. The final public commit must be assembled deliberately and rerun through every gate below.

## Include in the public submission

- Root product metadata and instructions: `AGENTS.md`, `README.md`, `plan.md`, `.nvmrc`, `package.json`, `pnpm-lock.yaml`, and `pnpm-workspace.yaml`.
- CI: `.github/workflows/ci.yml`.
- Product code: `src/`, including canonical ingestion contracts, replay, features, detectors, bounded agent harness, deterministic paper risk/execution, ledger, receipt, dashboard server, public audit, and devnet anchor tooling.
- Judge UI: `apps/dashboard/` source and build configuration, excluding generated `dist/`.
- Tests: `test/` and the Phase 0 deadline test under `phase0/test/`.
- Licence-safe frozen proof: `public/artifacts/dashboard/` and the synthetic receipt fixture under `proof/fixtures/`.
- Documentation: architecture, research methodology and limitations, invalidation record, submission package, proof contracts, and API feedback under `docs/`.
- Capture-only configuration: reviewed JSON files under `config/captures/`; every public copy must remain `tradeable: false`.
- Phase 0 source and examples needed to explain official TXLine integration, but never its local secrets, tokens, wallets, captured output, or logs.

## Exclude from the public submission

The following are enforced by `.gitignore` and must remain absent from both Git history and the deployed image:

- `.env`, `.env.*`, wallet/keypair directories, session tokens, JWTs, and credentials;
- `data/`, SQLite/DuckDB files, `samples/`, raw SSE frames, captured replay archives, logs, and PID files;
- `content/` social-video projects and renders, which are not part of the judge runtime or final bounty video;
- `design/` explorations and screenshots, some of which predate the derived-only public data contract;
- one-off `.spain-belgium-verify*.ts` local verification helpers;
- `node_modules/`, `dist/`, coverage output, OS metadata, and local collaboration notes.

The public artifact auditor is the second line of defence. It rejects raw/reconstructive TXLine field names, likely secrets, private filesystem paths, unsafe links, and oversized artifacts inside the frozen bundle.

## Dependency isolation and open advisory

The judge/runtime workspace and the Phase 0 subscription utility are intentionally separate install graphs:

- Root `pnpm install --frozen-lockfile` does not install `phase0` dependencies.
- `pnpm security:audit` currently passes the high/critical threshold for the root judge/runtime graph; one moderate transitive `uuid` advisory remains through the latest `@solana/web3.js` → `jayson` dependency chain.
- Phase 0 still carries `@solana/spl-token` → `bigint-buffer@1.1.5`, which has the high-severity availability advisory [GHSA-3gc7-fjrx-p6mg](https://github.com/advisories/GHSA-3gc7-fjrx-p6mg) and no patched package release.

The affected Phase 0 module is a local, human-invoked TXLine token-account/subscription helper. It is not imported by the dashboard, frozen demo, receipt verifier, capture process, or hosted read-only API. Do not expose its auth/subscription commands in the hosted image. Replacing its associated-token helpers changes a wallet/token path and therefore requires Deborah's explicit review and authorization under `AGENTS.md`; until then, this is an isolated and disclosed release exception, not a silently accepted production claim.

## Final public-commit gate

Run from a clean clone of the intended public commit:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm security:audit
pnpm judge:check
pnpm --dir phase0 install --frozen-lockfile --ignore-workspace
pnpm --dir phase0 exec tsc -p tsconfig.json --noEmit
pnpm --dir phase0 test
```

Then verify all of the following before pushing or deploying:

- `git status --short` is empty after the intentional commit.
- `git ls-files` contains no path excluded above.
- The public bundle hash and receipt hash match the video and submission text.
- The dashboard works signed out on desktop and mobile without a wallet, credential, subscription, or private archive.
- No exact TXLine probability series or raw response is visible.
- The receipt says unanchored unless Deborah has authorized a devnet submission and the final network verifier passes.
- Deborah has reviewed every public claim and submits the entry herself.

## Authority-gated actions still open

1. Deborah provides or approves the public Git remote and hosted deployment target.
2. Deborah decides whether the frozen receipt commitment may be submitted to Solana devnet.
3. Deborah sends and retains the sponsor clarification request.
4. Deborah rewrites/rehearses the narration, records the final video, verifies every public URL, and submits through Superteam Earn.
