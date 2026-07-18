import { startTransition, useEffect, useState } from "react";
import {
  BrandMark,
  EditorialNavigation,
  Icon,
  type IconName,
  formatUsdMicros
} from "./Shell";

const RECEIPT_PATH = "/artifacts/dashboard/synthetic-decision-receipt.json";
const COMMAND_PATH = "/artifacts/dashboard/command.json";
const MANIFEST_PATH = "/artifacts/dashboard/manifest.json";
const VERIFY_COMMAND = "pnpm receipt:verify -- public/artifacts/dashboard/synthetic-decision-receipt.json";
const RECEIPT_HASH_DOMAIN = "samaritan.decision-receipt/v1";

type ProofLedgerEntry = {
  atTsMs: number;
  entryHash: string;
  kind: string;
  previousHash: string;
  sequence: number;
};

type ProofSourceEvidence = {
  disclosure: string;
  evidenceRefSha256: string;
  observedAtTsMs: number;
  payloadSha256: string;
  role: string;
  source: string;
  sourceTsMs: number;
};

type ProofReceipt = {
  receiptType: string;
  receiptId: string;
  generatedAtTsMs: number;
  provenance: {
    evidenceClass: string;
    label: string;
    performanceUse: string;
    synthetic: boolean;
  };
  agents: {
    runs: Array<{
      invocationClass: string;
      model: string;
      stage: string;
      status: string;
      actualCostNanoUsd: number;
    }>;
    totalActualCostNanoUsd: number;
  };
  lifecycle: {
    finalStatus: string;
    orderedEventKinds: string[];
    triage: { decision: string; priority: string };
    thesis: { recommendation: string } | null;
    risk: {
      decision: string;
      realMoneyGate: string;
      stakeMicroUsd: number | null;
    } | null;
    execution: {
      adapter: string;
      status: string;
    } | null;
    settlement: {
      won: boolean;
    } | null;
  };
  ledger: {
    caseEntries: ProofLedgerEntry[];
    finalHeadHash: string;
    rowsAtGeneration: number;
    verificationAtGeneration: string;
  };
  build: {
    codeSha256: string;
    codeVersion: string;
    configSha256: string;
  };
  disclosure: {
    policy: string;
    rawTxlineFieldsIncluded: boolean;
  };
  sourceEvidence: ProofSourceEvidence[];
  integrity: {
    algorithm: string;
    canonicalization: string;
    domain: string;
    receiptHash: string;
  };
  solanaAnchor: unknown | null;
};

type ProofPublicContext = {
  replay: {
    canonicalEvents: number;
    replayIdentityHash: string;
    replayIdentityParity: boolean;
    pairedBookReplays: number;
  };
  bundle: {
    bundleId: string;
    bundleSha256: string;
    canonicalization: string;
  };
};

export type BrowserProofVerification = {
  valid: boolean;
  canonicalHashValid: boolean;
  disclosedChainValid: boolean;
  lifecycleOrderValid: boolean;
  syntheticBoundaryValid: boolean;
  sourceReferencesValid: boolean;
  anchorAbsent: boolean;
  issues: string[];
};

type ProofLoad = {
  receipt: ProofReceipt;
  context: ProofPublicContext;
  verification: BrowserProofVerification;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseProofReceipt(value: unknown): ProofReceipt {
  if (!isRecord(value)) throw new Error("Receipt is not an object");
  if (!isRecord(value.provenance) || !isRecord(value.agents) || !isRecord(value.lifecycle)) {
    throw new Error("Receipt is missing its provenance or lifecycle envelope");
  }
  if (!isRecord(value.ledger) || !isRecord(value.integrity) || !Array.isArray(value.ledger.caseEntries)) {
    throw new Error("Receipt is missing its integrity or ledger envelope");
  }
  if (!isRecord(value.build) || !isRecord(value.disclosure) || !Array.isArray(value.sourceEvidence)) {
    throw new Error("Receipt is missing its build, disclosure, or source-reference envelope");
  }
  if (!Array.isArray(value.agents.runs) || !Array.isArray(value.lifecycle.orderedEventKinds)) {
    throw new Error("Receipt is missing its disclosed agent or event sequence");
  }
  return value as unknown as ProofReceipt;
}

function parsePublicContext(commandValue: unknown, manifestValue: unknown): ProofPublicContext {
  if (!isRecord(commandValue) || !isRecord(commandValue.data) || !isRecord(commandValue.data.proof)) {
    throw new Error("Public replay proof is missing");
  }
  if (!isRecord(manifestValue)) throw new Error("Public bundle manifest is missing");
  const proof = commandValue.data.proof;
  const canonicalEvents = proof.canonicalEvents;
  const replayIdentityHash = proof.replayIdentityHash;
  const replayIdentityParity = proof.replayIdentityParity;
  const pairedBookReplays = proof.pairedBookReplays;
  if (
    typeof canonicalEvents !== "number" ||
    typeof replayIdentityHash !== "string" ||
    typeof replayIdentityParity !== "boolean" ||
    typeof pairedBookReplays !== "number" ||
    typeof manifestValue.bundleId !== "string" ||
    typeof manifestValue.bundleSha256 !== "string" ||
    typeof manifestValue.canonicalization !== "string"
  ) {
    throw new Error("Public proof context is malformed");
  }
  return {
    replay: { canonicalEvents, replayIdentityHash, replayIdentityParity, pairedBookReplays },
    bundle: {
      bundleId: manifestValue.bundleId,
      bundleSha256: manifestValue.bundleSha256,
      canonicalization: manifestValue.canonicalization
    }
  };
}

function stableJson(value: unknown): string {
  const sort = (child: unknown): unknown => {
    if (Array.isArray(child)) return child.map(sort);
    if (isRecord(child)) {
      return Object.fromEntries(
        Object.entries(child)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, nested]) => [key, sort(nested)])
      );
    }
    return child;
  };
  return JSON.stringify(sort(value));
}

async function sha256Hex(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("Browser SHA-256 is unavailable");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Recomputes the portable receipt commitment and checks only relationships
 * disclosed in the public artifact. It does not replay private source data.
 */
export async function verifyBrowserProof(value: unknown): Promise<BrowserProofVerification> {
  const receipt = parseProofReceipt(value);
  const issues: string[] = [];
  const entries = receipt.ledger.caseEntries;
  const body = Object.fromEntries(Object.entries(receipt).filter(([key]) => key !== "integrity"));
  const expectedReceiptHash = await sha256Hex(`${RECEIPT_HASH_DOMAIN}\n${stableJson(body)}`);
  const canonicalHashValid =
    receipt.integrity.algorithm === "sha256" &&
    receipt.integrity.domain === RECEIPT_HASH_DOMAIN &&
    receipt.integrity.canonicalization === "samaritan-stable-json-v1" &&
    receipt.integrity.receiptHash === expectedReceiptHash;
  if (!canonicalHashValid) issues.push("Canonical receipt hash mismatch");

  const disclosedChainValid = entries.length > 0 && entries.every((entry, index) => {
    if (index === 0) return Number.isSafeInteger(entry.sequence) && entry.sequence > 0;
    const previous = entries[index - 1];
    return previous !== undefined &&
      entry.sequence === previous.sequence + 1 &&
      entry.previousHash === previous.entryHash;
  }) && entries.at(-1)?.entryHash === receipt.ledger.finalHeadHash;
  if (!disclosedChainValid) issues.push("Disclosed ledger links or head do not reconcile");

  const lifecycleOrderValid =
    receipt.lifecycle.orderedEventKinds.length === entries.length &&
    receipt.lifecycle.orderedEventKinds.every((kind, index) => entries[index]?.kind === kind);
  if (!lifecycleOrderValid) issues.push("Lifecycle ordering does not match ledger ordering");

  const syntheticBoundaryValid =
    receipt.provenance.synthetic === true &&
    receipt.provenance.evidenceClass === "synthetic_proving_fixture" &&
    receipt.provenance.performanceUse === "excluded_synthetic" &&
    receipt.agents.totalActualCostNanoUsd === 0 &&
    receipt.agents.runs.every((run) => run.invocationClass === "synthetic_stub" && run.actualCostNanoUsd === 0);
  if (!syntheticBoundaryValid) issues.push("Synthetic or zero-external-model-call boundary changed");

  const sha256Pattern = /^[a-f0-9]{64}$/u;
  const sourceReferencesValid =
    receipt.sourceEvidence.length > 0 &&
    receipt.sourceEvidence.every((reference) =>
      reference.disclosure === "hash_only" &&
      sha256Pattern.test(reference.evidenceRefSha256) &&
      sha256Pattern.test(reference.payloadSha256) &&
      Number.isSafeInteger(reference.observedAtTsMs) &&
      Number.isSafeInteger(reference.sourceTsMs)
    ) &&
    receipt.disclosure.policy === "hashes_and_derived_signals_only" &&
    receipt.disclosure.rawTxlineFieldsIncluded === false;
  if (!sourceReferencesValid) issues.push("Source-reference disclosure boundary changed");

  const anchorAbsent = receipt.solanaAnchor === null;
  if (!anchorAbsent) issues.push("This page only accepts the frozen unanchored proving receipt");

  return {
    valid: issues.length === 0,
    canonicalHashValid,
    disclosedChainValid,
    lifecycleOrderValid,
    syntheticBoundaryValid,
    sourceReferencesValid,
    anchorAbsent,
    issues
  };
}

function compactHash(value: string) {
  return `${value.slice(0, 13)}…${value.slice(-9)}`;
}

function formatTime(value: number) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
    timeZone: "UTC"
  }).format(new Date(value));
}

const eventPresentation: Record<string, { label: string; eyebrow: string; icon: IconName }> = {
  signal_received: { label: "Signal detected", eyebrow: "Deterministic detector", icon: "pulse" },
  triage_decision: { label: "Triage escalated", eyebrow: "Haiku-shaped boundary", icon: "spark" },
  thesis_submitted: { label: "Thesis submitted", eyebrow: "Opus-shaped boundary", icon: "case" },
  analysis_completed: { label: "Analysis locked", eyebrow: "Strict schema exit", icon: "check" },
  risk_verdict: { label: "Paper allowed. Money refused.", eyebrow: "Deterministic risk authority", icon: "shield" },
  execution_intent: { label: "Paper intent ledgered", eyebrow: "Before action", icon: "lock" },
  paper_execution: { label: "Paper adapter acted", eyebrow: "No venue order", icon: "play" },
  case_terminal: { label: "Case terminal", eyebrow: "Runtime outcome", icon: "check" },
  position_opened: { label: "Paper position opened", eyebrow: "Accounting", icon: "chart" },
  position_closed: { label: "Paper position marked", eyebrow: "Pre-kickoff close", icon: "clock" },
  position_settled: { label: "Paper position settled", eyebrow: "Synthetic resolution", icon: "proof" }
};

function eventDetail(receipt: ProofReceipt, kind: string) {
  if (kind === "triage_decision") return `${receipt.lifecycle.triage.decision} · ${receipt.lifecycle.triage.priority}`;
  if (kind === "thesis_submitted") return receipt.lifecycle.thesis?.recommendation ?? "No thesis";
  if (kind === "risk_verdict") {
    const risk = receipt.lifecycle.risk;
    if (!risk) return "No risk verdict";
    const stake = risk.stakeMicroUsd === null ? "no stake" : `${formatUsdMicros(risk.stakeMicroUsd)} paper stake`;
    return `${risk.decision} paper · ${stake} · real money ${risk.realMoneyGate}`;
  }
  if (kind === "paper_execution") {
    return `${receipt.lifecycle.execution?.status ?? "unknown"} · ${receipt.lifecycle.execution?.adapter ?? "paper"} adapter`;
  }
  if (kind === "case_terminal") return receipt.lifecycle.finalStatus.replaceAll("_", " ");
  if (kind === "position_settled") return receipt.lifecycle.settlement?.won ? "synthetic outcome: won" : "synthetic outcome: lost";
  return kind.replaceAll("_", " ");
}

function ProofHero({ receipt, verification }: ProofLoad) {
  const passedChecks = [
    verification.canonicalHashValid,
    verification.disclosedChainValid,
    verification.lifecycleOrderValid,
    verification.syntheticBoundaryValid,
    verification.sourceReferencesValid,
    verification.anchorAbsent
  ].filter(Boolean).length;
  return (
    <section className="editorial-proof-hero" aria-labelledby="editorial-proof-title">
      <div className="editorial-proof-hero-copy">
        <span className="editorial-proof-kicker"><i aria-hidden="true" />Portable receipt · recomputed in this browser</span>
        <h1 id="editorial-proof-title">Proof survives<br />the page.</h1>
        <p>Samaritan does not ask a judge to trust a polished screen. It exposes a frozen receipt, an ordered decision chain, and the exact boundary of every verification claim.</p>
        <div className="editorial-proof-hero-note"><Icon name="shield" /><span><b>Synthetic engineering proof.</b><small>Permanently excluded from performance, profitability, and real-fill evidence.</small></span></div>
      </div>
      <div className={`editorial-proof-seal${verification.valid ? " valid" : " invalid"}`}>
        <header><span>Portable evidence check</span><em>{verification.valid ? "Complete" : "Failed closed"}</em></header>
        <div className="editorial-proof-seal-mark"><Icon name={verification.valid ? "proof" : "minus"} /><strong>{verification.valid ? "RECONCILED" : "INVALID"}</strong><small>{passedChecks} / 6 disclosed checks</small></div>
        <div className="editorial-proof-seal-hash"><span>Receipt commitment</span><code title={receipt.integrity.receiptHash}>{compactHash(receipt.integrity.receiptHash)}</code></div>
        <footer><span><i />Local SHA-256 verification</span><span>Generated {new Date(receipt.generatedAtTsMs).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })}</span></footer>
      </div>
    </section>
  );
}

function AssuranceLadder({ receipt, context, verification }: ProofLoad) {
  return (
    <section className="editorial-proof-assurance" aria-labelledby="editorial-proof-assurance-title">
      <header className="editorial-proof-section-heading">
        <span><small>Assurance ladder</small><h2 id="editorial-proof-assurance-title">Three truths. Three different guarantees.</h2></span>
        <em>Claims stay separate</em>
      </header>
      <div className="editorial-proof-assurance-grid">
        <article className="verified">
          <span className="editorial-proof-assurance-index">01</span>
          <div><small>Portable receipt</small><h3>Verified locally</h3><p>The browser recomputed the canonical receipt and reconciled its disclosed ledger links.</p></div>
          <footer><Icon name="check" /><b>{verification.valid ? "All disclosed checks passed" : "Verification failed"}</b></footer>
        </article>
        <article className="captured">
          <span className="editorial-proof-assurance-index">02</span>
          <div><small>Separate captured replay</small><h3>{context.replay.replayIdentityParity ? "Identity matched" : "Identity mismatch"}</h3><p>{context.replay.canonicalEvents.toLocaleString("en-US")} canonical events preserve the real Spain–Belgium replay identity.</p></div>
          <footer><Icon name="replay" /><b>{context.replay.pairedBookReplays} paired-book replay</b></footer>
        </article>
        <article className="unsubmitted">
          <span className="editorial-proof-assurance-index">03</span>
          <div><small>External timestamp</small><h3>{receipt.solanaAnchor === null ? "Not submitted" : "Unexpected anchor"}</h3><p>No Solana transaction exists for this receipt. There is no explorer link and no network-verification claim.</p></div>
          <footer><Icon name="lock" /><b>Human-gated roadmap item</b></footer>
        </article>
      </div>
      <footer className="editorial-proof-assurance-boundary"><Icon name="shield" /><p><b>Guarantee boundary:</b> local verification is not a Solana timestamp. Replay identity is not TXLine on-chain validation. Neither is evidence of profitability.</p></footer>
    </section>
  );
}

function DecisionBoundary({ receipt }: { receipt: ProofReceipt }) {
  const risk = receipt.lifecycle.risk;
  return (
    <section className="editorial-proof-decision" aria-labelledby="editorial-proof-decision-title">
      <header className="editorial-proof-section-heading">
        <span><small>Decision boundary</small><h2 id="editorial-proof-decision-title">The recommendation stops before money.</h2></span>
        <em>Zero real orders</em>
      </header>
      <div className="editorial-proof-decision-path">
        <article><span>01</span><small>Agent-shaped thesis</small><h3>{receipt.lifecycle.thesis?.recommendation.replaceAll("_", " ") ?? "No thesis"}</h3><p>May recommend. Cannot size or execute.</p></article>
        <i><Icon name="arrow" /></i>
        <article className="authority"><span>02</span><small>Deterministic authority</small><h3>{risk?.decision ?? "closed"} paper</h3><p>{risk?.stakeMicroUsd ? formatUsdMicros(risk.stakeMicroUsd) : "$0.00"} fixed · code owns limits.</p></article>
        <i><Icon name="arrow" /></i>
        <article className="refused"><span>03</span><small>Real-money path</small><h3>Refused</h3><p>Paper adapter only. No wallet or venue order.</p></article>
      </div>
      <footer><Icon name="lock" /><span><b>An LLM never touches money here.</b><small>The synthetic lifecycle continues only to prove paper execution, close, settlement, and receipt wiring.</small></span></footer>
    </section>
  );
}

function VerificationPanel({ receipt, verification }: ProofLoad) {
  const checks = [
    { label: "Canonical receipt hash", detail: "Recomputed in this browser", pass: verification.canonicalHashValid },
    { label: "Disclosed ledger links", detail: "Sequences, links, and final head reconcile", pass: verification.disclosedChainValid },
    { label: "Lifecycle ordering", detail: "Event kinds match committed row order", pass: verification.lifecycleOrderValid },
    { label: "Synthetic boundary", detail: "Stubs, zero model cost, performance excluded", pass: verification.syntheticBoundaryValid },
    { label: "Source references", detail: `${receipt.sourceEvidence.length} hash-only commitments · no raw TXLine`, pass: verification.sourceReferencesValid },
    { label: "External anchor", detail: "Absent; no network verification claimed", pass: verification.anchorAbsent }
  ];
  return (
    <section className="editorial-proof-verification" aria-labelledby="editorial-proof-verification-title">
      <header className="editorial-proof-section-heading">
        <span><small>Browser verification</small><h2 id="editorial-proof-verification-title">Every visible check has a boundary.</h2></span>
        <em className={verification.valid ? "pass" : "fail"}><Icon name={verification.valid ? "check" : "minus"} />{verification.valid ? "Reconciled" : "Failed"}</em>
      </header>
      <div className="editorial-proof-check-grid">
        {checks.map((check, index) => (
          <div className={check.pass ? "pass" : "fail"} key={check.label}>
            <span>{String(index + 1).padStart(2, "0")}</span><i><Icon name={check.pass ? "check" : "minus"} /></i><span><b>{check.label}</b><small>{check.detail}</small></span>
          </div>
        ))}
      </div>
      <footer><Icon name="proof" /><span><small>Ledger state at receipt generation</small><b>{receipt.ledger.verificationAtGeneration.replaceAll("_", " ")}</b></span></footer>
    </section>
  );
}

function ProofLedger({ receipt }: { receipt: ProofReceipt }) {
  return (
    <section className="editorial-proof-ledger" aria-labelledby="editorial-proof-ledger-title">
      <header className="editorial-proof-section-heading">
        <span><small>Append-only · ordered before action</small><h2 id="editorial-proof-ledger-title">The decision ledger</h2></span>
        <em>{receipt.ledger.caseEntries.length} disclosed events</em>
      </header>
      <div className="editorial-proof-ledger-table">
        <div className="editorial-proof-ledger-head"><span>Seq.</span><span>Boundary</span><span>Committed event</span><span>UTC</span><span>Entry hash</span></div>
        {receipt.ledger.caseEntries.map((entry) => {
          const presentation = eventPresentation[entry.kind] ?? { label: entry.kind, eyebrow: "Committed event", icon: "proof" as const };
          return (
            <div className={`editorial-proof-ledger-row${entry.kind === "risk_verdict" ? " risk" : ""}`} key={entry.entryHash}>
              <span className="editorial-proof-sequence">{String(entry.sequence).padStart(2, "0")}</span>
              <span className="editorial-proof-event-icon"><Icon name={presentation.icon} /></span>
              <span className="editorial-proof-event-copy"><small>{presentation.eyebrow}</small><b>{presentation.label}</b><em>{eventDetail(receipt, entry.kind)}</em></span>
              <time dateTime={new Date(entry.atTsMs).toISOString()}>{formatTime(entry.atTsMs)}</time>
              <code title={entry.entryHash}>{compactHash(entry.entryHash)}</code>
            </div>
          );
        })}
      </div>
      <footer><Icon name="lock" /><span><b>{receipt.ledger.rowsAtGeneration} total ledger rows at generation</b><small>Each disclosed row points to the previous committed hash. The final row resolves to the displayed ledger head.</small></span></footer>
    </section>
  );
}

function CommitmentRegistry({ receipt, context }: ProofLoad) {
  const commitments = [
    { label: "Receipt hash", value: receipt.integrity.receiptHash, note: "Recomputed locally" },
    { label: "Ledger head", value: receipt.ledger.finalHeadHash, note: "Disclosed chain head" },
    { label: "Replay identity", value: context.replay.replayIdentityHash, note: "Separate captured replay" },
    { label: "Public bundle", value: context.bundle.bundleSha256, note: context.bundle.bundleId },
    { label: "Frozen config", value: receipt.build.configSha256, note: receipt.build.codeVersion },
    { label: "Build code", value: receipt.build.codeSha256, note: "Synthetic fixture build" }
  ];
  return (
    <section className="editorial-proof-commitments" aria-labelledby="editorial-proof-commitments-title">
      <header className="editorial-proof-section-heading">
        <span><small>Portable commitments</small><h2 id="editorial-proof-commitments-title">What can be carried away.</h2></span>
        <em>SHA-256 · stable JSON</em>
      </header>
      <div className="editorial-proof-commitment-grid">
        {commitments.map((commitment) => <div key={commitment.label}><small>{commitment.label}</small><code title={commitment.value}>{commitment.value}</code><span>{commitment.note}</span></div>)}
      </div>
      <div className="editorial-proof-sources">
        <header><span><small>Source-reference registry</small><h3>Hash-only by design</h3></span><em>{receipt.sourceEvidence.length} references</em></header>
        {receipt.sourceEvidence.map((reference, index) => (
          <div key={reference.evidenceRefSha256}>
            <span>{String(index + 1).padStart(2, "0")}</span><span><small>{reference.source} · {reference.role}</small><b>{new Date(reference.observedAtTsMs).toISOString()}</b></span><code title={reference.evidenceRefSha256}>{compactHash(reference.evidenceRefSha256)}</code><em>{reference.disclosure.replaceAll("_", " ")}</em>
          </div>
        ))}
        <footer><Icon name="shield" /><p>Raw TXLine fields are not included. These references prove commitment consistency inside the synthetic receipt; they do not expose or independently validate private source payloads.</p></footer>
      </div>
    </section>
  );
}

function ReproduceProof() {
  return (
    <section className="editorial-proof-reproduce" aria-labelledby="editorial-proof-reproduce-title">
      <div className="editorial-proof-reproduce-copy"><span><Icon name="system" /></span><div><small>Do not trust the screenshot</small><h2 id="editorial-proof-reproduce-title">Verify the frozen receipt offline.</h2><p>The repository verifier enforces the strict schema, recomputes the canonical receipt hash, and checks disclosed lifecycle relationships without contacting a feed, model provider, wallet, or blockchain.</p></div></div>
      <div className="editorial-proof-command"><span>Exact command · repository root</span><code>{VERIFY_COMMAND}</code><a href={RECEIPT_PATH} download>Download evidence JSON <Icon name="arrow" /></a></div>
      <footer><Icon name="shield" /><p><b>Assurance boundary:</b> this verifies portable commitments and disclosed relationships. It does not replay private source payloads, prove a real model invocation, establish profitability, or claim an external timestamp.</p></footer>
    </section>
  );
}

function ProofView(load: ProofLoad) {
  return (
    <div className="editorial-proof">
      <div className="editorial-page editorial-proof-page">
        <EditorialNavigation active="proof" modeLabel="Offline receipt · local verification" />
        <main id="proof">
          <ProofHero {...load} />
          <AssuranceLadder {...load} />
          <DecisionBoundary receipt={load.receipt} />
          <VerificationPanel {...load} />
          <ProofLedger receipt={load.receipt} />
          <CommitmentRegistry {...load} />
          <ReproduceProof />
          <footer className="editorial-proof-final"><Icon name="lock" /><span><b>Synthetic engineering proof. Permanently excluded from every performance claim.</b><small>No external model call · no real order · no wallet · no submitted Solana anchor.</small></span></footer>
        </main>
      </div>
    </div>
  );
}

function ProofLoading() {
  return <main className="editorial-proof-state"><BrandMark /><span>Proof / local verification</span><h1>Recomputing the receipt.</h1><div><i /></div><p>Checking the frozen commitment, disclosed ledger links, source references, provenance, and anchor boundary.</p></main>;
}

function ProofError({ retry }: { retry: () => void }) {
  return <main className="editorial-proof-state error"><span className="editorial-proof-state-icon"><Icon name="shield" /></span><span>Fail-closed evidence boundary</span><h1>Proof did not reconcile.</h1><p>The frozen public evidence could not be loaded or one of its commitments changed. Samaritan will not show a partial success state.</p><button type="button" onClick={retry}>Retry proof load</button></main>;
}

async function fetchJson(path: string, signal: AbortSignal) {
  const response = await fetch(path, { headers: { accept: "application/json" }, signal });
  if (!response.ok) throw new Error(`Evidence request failed with status ${response.status}`);
  return response.json() as Promise<unknown>;
}

export function ProofApp() {
  const [loaded, setLoaded] = useState<ProofLoad | null>(null);
  const [failure, setFailure] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setFailure(false);
    Promise.all([
      fetchJson(RECEIPT_PATH, controller.signal),
      fetchJson(COMMAND_PATH, controller.signal),
      fetchJson(MANIFEST_PATH, controller.signal)
    ])
      .then(async ([receiptValue, commandValue, manifestValue]) => {
        const receipt = parseProofReceipt(receiptValue);
        const verification = await verifyBrowserProof(receipt);
        if (!verification.valid) throw new Error(verification.issues.join("; "));
        const context = parsePublicContext(commandValue, manifestValue);
        if (!context.replay.replayIdentityParity) throw new Error("Captured replay identity did not reconcile");
        return { receipt, verification, context };
      })
      .then((next) => startTransition(() => setLoaded(next)))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error(error);
        setFailure(true);
      });
    return () => controller.abort();
  }, [attempt]);

  if (failure) return <ProofError retry={() => { setLoaded(null); setAttempt((value) => value + 1); }} />;
  if (!loaded) return <ProofLoading />;
  return <ProofView {...loaded} />;
}
