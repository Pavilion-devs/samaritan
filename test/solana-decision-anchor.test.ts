import {
  PublicKey,
  type ParsedTransactionWithMeta,
  type Signer
} from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import { stableJson } from "../src/domain/json.js";
import { buildSyntheticDecisionReceipt } from "../src/proof/synthetic-decision-receipt.js";
import {
  DECISION_ANCHOR_MEMO_DOMAIN,
  SOLANA_DEVNET_GENESIS_HASH,
  SOLANA_MAINNET_BETA_GENESIS_HASH,
  SOLANA_MEMO_PROGRAM_ID,
  buildDecisionAnchorIntent,
  buildDecisionAnchorMemoPayload,
  canonicalDecisionAnchorMemo,
  parseCanonicalDecisionAnchorMemo,
  verifyDecisionAnchorOnChain,
  type DecisionAnchorMemoPayload,
  type DecisionAnchorReadRpc
} from "../src/chain/decision-anchor.js";
import {
  submitDecisionAnchor,
  type DecisionAnchorSubmitDependencies,
  type DecisionAnchorSubmitRequest,
  type DecisionAnchorSubmitRpc
} from "../src/chain/decision-anchor-submit.js";

const SIGNATURE = "1".repeat(64);

function parsedTransaction(memo: string): ParsedTransactionWithMeta {
  return {
    slot: 987_654,
    blockTime: 1_800_000_000,
    version: "legacy",
    transaction: {
      signatures: [SIGNATURE],
      message: {
        accountKeys: [],
        recentBlockhash: "11111111111111111111111111111111",
        instructions: [{
          program: "spl-memo",
          programId: new PublicKey(SOLANA_MEMO_PROGRAM_ID),
          parsed: memo
        }]
      }
    },
    meta: {
      err: null,
      fee: 5_000,
      preBalances: [],
      postBalances: []
    }
  };
}

function readRpc(input: {
  memo: string;
  genesisHash?: string;
}): DecisionAnchorReadRpc {
  return {
    getGenesisHash: vi.fn(async () => input.genesisHash ?? SOLANA_DEVNET_GENESIS_HASH),
    getParsedTransaction: vi.fn(async () => parsedTransaction(input.memo))
  };
}

function submitRequest(overrides: Partial<DecisionAnchorSubmitRequest> = {}): DecisionAnchorSubmitRequest {
  const receipt = buildSyntheticDecisionReceipt();
  return {
    receipt,
    intent: buildDecisionAnchorIntent(receipt),
    network: "devnet",
    confirmedReceiptHash: receipt.integrity.receiptHash,
    signerPath: ".wallet/anchor-devnet.json",
    humanApproved: true,
    ...overrides
  };
}

function submitMocks(): {
  dependencies: DecisionAnchorSubmitDependencies;
  assertSignerPathIgnored: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  loadSigner: ReturnType<typeof vi.fn>;
  signAndSend: ReturnType<typeof vi.fn>;
} {
  const receipt = buildSyntheticDecisionReceipt();
  const memo = canonicalDecisionAnchorMemo(buildDecisionAnchorMemoPayload(receipt));
  const rpc: DecisionAnchorSubmitRpc = {
    ...readRpc({ memo }),
    getLatestBlockhash: vi.fn(async () => ({
      blockhash: "11111111111111111111111111111111",
      lastValidBlockHeight: 1
    })),
    sendRawTransaction: vi.fn(async () => SIGNATURE),
    confirmTransaction: vi.fn(async () => ({ value: { err: null } }))
  };
  const assertSignerPathIgnored = vi.fn();
  const connect = vi.fn(() => rpc);
  const dummySigner: Signer = {
    publicKey: new PublicKey("11111111111111111111111111111111"),
    secretKey: new Uint8Array(64)
  };
  const loadSigner = vi.fn(async () => dummySigner);
  const signAndSend = vi.fn(async () => SIGNATURE);
  return {
    dependencies: { assertSignerPathIgnored, connect, loadSigner, signAndSend },
    assertSignerPathIgnored,
    connect,
    loadSigner,
    signAndSend
  };
}

describe("Solana decision receipt anchor", () => {
  it("canonicalizes the memo deterministically and rejects non-canonical JSON", () => {
    const receipt = buildSyntheticDecisionReceipt();
    const payload = buildDecisionAnchorMemoPayload(receipt);
    const reordered = {
      ledgerHead: payload.ledgerHead,
      receipt: payload.receipt,
      commitmentType: payload.commitmentType,
      network: payload.network,
      anchorType: payload.anchorType,
      schemaVersion: payload.schemaVersion
    };
    const memo = canonicalDecisionAnchorMemo(payload);

    expect(canonicalDecisionAnchorMemo(reordered)).toBe(memo);
    expect(parseCanonicalDecisionAnchorMemo(memo)).toEqual(payload);
    expect(Buffer.byteLength(memo, "utf8")).toBeLessThanOrEqual(566);
    const pretty = `${DECISION_ANCHOR_MEMO_DOMAIN}\n${JSON.stringify(payload, null, 2)}`;
    expect(() => parseCanonicalDecisionAnchorMemo(pretty)).toThrow(/not canonically encoded/);
  });

  it("prepares a deterministic unsigned intent without payer, blockhash, signature, or access claims", () => {
    const receipt = buildSyntheticDecisionReceipt();
    const first = buildDecisionAnchorIntent(receipt);
    const second = buildDecisionAnchorIntent(receipt);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      network: "devnet",
      transaction: {
        feePayer: "supplied_only_at_submit",
        recentBlockhash: "fetched_only_at_submit",
        signatures: "none"
      },
      preparation: {
        offline: true,
        signerAccessed: false,
        networkAccessed: false
      }
    });
    expect(first.instruction.keys).toEqual([]);
  });

  it("verifies a canonical devnet memo against the exact receipt and ledger head using reads only", async () => {
    const receipt = buildSyntheticDecisionReceipt();
    const memo = canonicalDecisionAnchorMemo(buildDecisionAnchorMemoPayload(receipt));
    const rpc = readRpc({ memo });

    await expect(verifyDecisionAnchorOnChain({
      receipt,
      signature: SIGNATURE,
      network: "devnet",
      rpc
    })).resolves.toMatchObject({
      network: "devnet",
      transactionSignature: SIGNATURE,
      receiptHash: receipt.integrity.receiptHash,
      ledgerHeadHash: receipt.ledger.finalHeadHash,
      rpcCommitment: "confirmed"
    });
    expect(rpc.getGenesisHash).toHaveBeenCalledTimes(1);
    expect(rpc.getParsedTransaction).toHaveBeenCalledWith(SIGNATURE);
  });

  it("rejects an RPC connected to the wrong Solana network before fetching a transaction", async () => {
    const receipt = buildSyntheticDecisionReceipt();
    const memo = canonicalDecisionAnchorMemo(buildDecisionAnchorMemoPayload(receipt));
    const rpc = readRpc({ memo, genesisHash: SOLANA_MAINNET_BETA_GENESIS_HASH });

    await expect(verifyDecisionAnchorOnChain({
      receipt,
      signature: SIGNATURE,
      network: "devnet",
      rpc
    })).rejects.toThrow(/network mismatch/);
    expect(rpc.getParsedTransaction).not.toHaveBeenCalled();
  });

  it("rejects a canonical memo that commits the wrong receipt hash", async () => {
    const receipt = buildSyntheticDecisionReceipt();
    const payload: DecisionAnchorMemoPayload = structuredClone(
      buildDecisionAnchorMemoPayload(receipt)
    );
    payload.receipt.hash = "a".repeat(64);

    await expect(verifyDecisionAnchorOnChain({
      receipt,
      signature: SIGNATURE,
      network: "devnet",
      rpc: readRpc({ memo: canonicalDecisionAnchorMemo(payload) })
    })).rejects.toThrow(/receipt hash does not match/);
  });

  it("rejects a canonical memo that commits the wrong ledger head", async () => {
    const receipt = buildSyntheticDecisionReceipt();
    const payload: DecisionAnchorMemoPayload = structuredClone(
      buildDecisionAnchorMemoPayload(receipt)
    );
    payload.ledgerHead.hash = "b".repeat(64);

    await expect(verifyDecisionAnchorOnChain({
      receipt,
      signature: SIGNATURE,
      network: "devnet",
      rpc: readRpc({ memo: canonicalDecisionAnchorMemo(payload) })
    })).rejects.toThrow(/ledger head does not match/);
  });

  it("rejects a memo with any other commitment type", async () => {
    const receipt = buildSyntheticDecisionReceipt();
    const payload = {
      ...buildDecisionAnchorMemoPayload(receipt),
      commitmentType: "ledger_head_only"
    };
    const memo = `${DECISION_ANCHOR_MEMO_DOMAIN}\n${stableJson(payload)}`;

    await expect(verifyDecisionAnchorOnChain({
      receipt,
      signature: SIGNATURE,
      network: "devnet",
      rpc: readRpc({ memo })
    })).rejects.toThrow();
  });

  it("rejects a missing signer before any ignored-path, RPC, signer, or send dependency runs", async () => {
    const mocks = submitMocks();
    const request = submitRequest();
    delete request.signerPath;

    await expect(submitDecisionAnchor(request, mocks.dependencies)).rejects.toThrow(
      /signer path is required/
    );
    expect(mocks.assertSignerPathIgnored).not.toHaveBeenCalled();
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.loadSigner).not.toHaveBeenCalled();
    expect(mocks.signAndSend).not.toHaveBeenCalled();
  });

  it("refuses mainnet before any signer or network dependency runs", async () => {
    const mocks = submitMocks();

    await expect(submitDecisionAnchor(
      submitRequest({ network: "mainnet-beta" }),
      mocks.dependencies
    )).rejects.toThrow(/mainnet-beta is forbidden/);
    expect(mocks.assertSignerPathIgnored).not.toHaveBeenCalled();
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.loadSigner).not.toHaveBeenCalled();
    expect(mocks.signAndSend).not.toHaveBeenCalled();
  });

  it("requires the explicit human write-approval flag before dependencies run", async () => {
    const mocks = submitMocks();

    await expect(submitDecisionAnchor(
      submitRequest({ humanApproved: false }),
      mocks.dependencies
    )).rejects.toThrow(/Human approval is required/);
    expect(mocks.assertSignerPathIgnored).not.toHaveBeenCalled();
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.loadSigner).not.toHaveBeenCalled();
    expect(mocks.signAndSend).not.toHaveBeenCalled();
  });

  it("refuses an inexact receipt-hash confirmation before dependencies run", async () => {
    const mocks = submitMocks();

    await expect(submitDecisionAnchor(
      submitRequest({ confirmedReceiptHash: "c".repeat(64) }),
      mocks.dependencies
    )).rejects.toThrow(/Exact receipt-hash confirmation/);
    expect(mocks.assertSignerPathIgnored).not.toHaveBeenCalled();
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.loadSigner).not.toHaveBeenCalled();
    expect(mocks.signAndSend).not.toHaveBeenCalled();
  });

  it("checks the RPC genesis before loading a signer or sending", async () => {
    const mocks = submitMocks();
    const wrongRpc: DecisionAnchorSubmitRpc = {
      ...readRpc({
        memo: canonicalDecisionAnchorMemo(
          buildDecisionAnchorMemoPayload(buildSyntheticDecisionReceipt())
        ),
        genesisHash: SOLANA_MAINNET_BETA_GENESIS_HASH
      }),
      getLatestBlockhash: vi.fn(),
      sendRawTransaction: vi.fn(),
      confirmTransaction: vi.fn()
    };
    mocks.connect.mockReturnValue(wrongRpc);

    await expect(submitDecisionAnchor(
      submitRequest(),
      mocks.dependencies
    )).rejects.toThrow(/submission refuses genesis/);
    expect(mocks.assertSignerPathIgnored).toHaveBeenCalledTimes(1);
    expect(mocks.loadSigner).not.toHaveBeenCalled();
    expect(mocks.signAndSend).not.toHaveBeenCalled();
  });

  it("refuses a non-ignored signer path before connecting or loading it", async () => {
    const mocks = submitMocks();
    mocks.assertSignerPathIgnored.mockImplementation(() => {
      throw new Error("not ignored");
    });

    await expect(submitDecisionAnchor(
      submitRequest({ signerPath: "unsafe-keypair.json" }),
      mocks.dependencies
    )).rejects.toThrow(/not ignored/);
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.loadSigner).not.toHaveBeenCalled();
    expect(mocks.signAndSend).not.toHaveBeenCalled();
  });

  it("runs the fully authorized path through mocked sign/send and then read-only verification", async () => {
    const mocks = submitMocks();
    const receipt = buildSyntheticDecisionReceipt();

    await expect(submitDecisionAnchor(
      submitRequest({ receipt, intent: buildDecisionAnchorIntent(receipt) }),
      mocks.dependencies
    )).resolves.toMatchObject({
      receiptHash: receipt.integrity.receiptHash,
      ledgerHeadHash: receipt.ledger.finalHeadHash,
      transactionSignature: SIGNATURE
    });
    expect(mocks.assertSignerPathIgnored).toHaveBeenCalledTimes(1);
    expect(mocks.connect).toHaveBeenCalledTimes(1);
    expect(mocks.loadSigner).toHaveBeenCalledTimes(1);
    expect(mocks.signAndSend).toHaveBeenCalledTimes(1);
  });
});
