import { startTransition, useEffect, useState } from "react";
import {
  BrandMark,
  Icon,
  type IconName,
  MobileNavigation,
  Navigation,
  ProvenanceBadge,
  Topbar,
  formatUsdMicros
} from "./Shell";

const RECEIPT_PATH = "/artifacts/dashboard/synthetic-decision-receipt.json";
const VERIFY_COMMAND = "pnpm receipt:verify -- public/artifacts/dashboard/synthetic-decision-receipt.json";
const RECEIPT_HASH_DOMAIN = "samaritan.decision-receipt/v1";

type ProofLedgerEntry = {
  atTsMs: number;
  entryHash: string;
  kind: string;
  previousHash: string;
  sequence: number;
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
  integrity: {
    algorithm: string;
    canonicalization: string;
    domain: string;
    receiptHash: string;
  };
  solanaAnchor: unknown | null;
};

export type BrowserProofVerification = {
  valid: boolean;
  canonicalHashValid: boolean;
  disclosedChainValid: boolean;
  lifecycleOrderValid: boolean;
  syntheticBoundaryValid: boolean;
  anchorAbsent: boolean;
  issues: string[];
};

type ProofLoad = {
  receipt: ProofReceipt;
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
  if (!Array.isArray(value.agents.runs) || !Array.isArray(value.lifecycle.orderedEventKinds)) {
    throw new Error("Receipt is missing its disclosed agent or event sequence");
  }
  return value as unknown as ProofReceipt;
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
 * Recomputes the portable receipt commitment and checks only the relationships
 * disclosed in the public artifact. The CLI below remains the strict schema and
 * semantic verifier; neither verifier replays private source payloads.
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

  const anchorAbsent = receipt.solanaAnchor === null;
  if (!anchorAbsent) issues.push("This page only accepts the frozen unanchored proving receipt");

  return {
    valid: issues.length === 0,
    canonicalHashValid,
    disclosedChainValid,
    lifecycleOrderValid,
    syntheticBoundaryValid,
    anchorAbsent,
    issues
  };
}

function compactHash(value: string) {
  return `${value.slice(0, 14)}…${value.slice(-10)}`;
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

function ProofHero({ receipt }: { receipt: ProofReceipt }) {
  const risk = receipt.lifecycle.risk;
  return (
    <section className="judge-proof-hero reveal r1" aria-labelledby="proof-heading">
      <div className="judge-proof-hero-copy">
        <ProvenanceBadge tone="synthetic" label="Synthetic proving fixture · performance excluded" />
        <span className="judge-proof-kicker">A decision boundary, made inspectable</span>
        <h2 id="proof-heading">THE MONEY PATH<br /><em>SAMARITAN REFUSED.</em></h2>
        <p><strong>What was refused:</strong> every path from an agent recommendation to real money. A deterministic Opus-shaped stub recommended a paper trade; code-owned risk kept the money gate closed and exercised only the synthetic paper lifecycle.</p>
      </div>
      <div className="judge-proof-refusal" aria-label="Agent recommendation and deterministic decision">
        <header><span><i />Decision boundary</span><em>Zero real orders</em></header>
        <div className="judge-proof-refusal-flow">
          <div><small>01 · Agent-shaped thesis</small><b>{receipt.lifecycle.thesis?.recommendation.replaceAll("_", " ") ?? "No thesis"}</b><span>May recommend. Cannot size or execute.</span></div>
          <i><Icon name="arrow" /></i>
          <div className="authority"><small>02 · Deterministic authority</small><b>{risk?.decision ?? "closed"} paper</b><span>{risk?.stakeMicroUsd ? formatUsdMicros(risk.stakeMicroUsd) : "$0.00"} fixed · real money {risk?.realMoneyGate ?? "closed"}</span></div>
          <i><Icon name="arrow" /></i>
          <div className="refused"><small>03 · Money boundary</small><b>REFUSED</b><span>Paper adapter only · no wallet or venue order</span></div>
        </div>
        <footer><Icon name="shield" /><span><b>An LLM never touches money here.</b><small>The synthetic case continues after the refusal solely to prove paper execution, close, settlement, and receipt wiring.</small></span></footer>
      </div>
    </section>
  );
}

function ProofTruthStrip({ receipt }: { receipt: ProofReceipt }) {
  return (
    <section className="judge-proof-truth surface reveal r2" aria-label="Proof claim boundary">
      <div><span>Evidence class</span><b>Synthetic proving fixture</b><small>No real match or licensed feed record</small></div>
      <div><span>Models</span><b>{receipt.agents.runs.length} deterministic stubs</b><small>Zero Anthropic API cost or calls</small></div>
      <div><span>Performance use</span><b>Excluded</b><small>Not alpha, P&amp;L, or fill evidence</small></div>
      <div><span>Execution</span><b>Paper only</b><small>Zero real orders · gate closed</small></div>
      <div><span>Solana</span><b>Not submitted</b><small>No anchor or network verification</small></div>
    </section>
  );
}

function ProofLedger({ receipt }: { receipt: ProofReceipt }) {
  return (
    <section className="judge-proof-ledger surface reveal r3" aria-labelledby="proof-ledger-heading">
      <header className="judge-proof-panel-head">
        <div><span>Append-only · ordered before action</span><h2 id="proof-ledger-heading">Decision ledger</h2></div>
        <span>{receipt.ledger.caseEntries.length} disclosed case events</span>
      </header>
      <div className="judge-proof-ledger-head"><span>Seq.</span><span>Boundary</span><span>Committed event</span><span>UTC</span><span>Entry hash</span></div>
      <div className="judge-proof-ledger-rows">
        {receipt.ledger.caseEntries.map((entry) => {
          const presentation = eventPresentation[entry.kind] ?? { label: entry.kind, eyebrow: "Committed event", icon: "proof" as const };
          return (
            <div className={`judge-proof-ledger-row${entry.kind === "risk_verdict" ? " risk" : ""}`} key={entry.entryHash}>
              <span className="judge-proof-sequence">{String(entry.sequence).padStart(2, "0")}</span>
              <span className="judge-proof-event-icon"><Icon name={presentation.icon} /></span>
              <span className="judge-proof-event-copy"><small>{presentation.eyebrow}</small><b>{presentation.label}</b><em>{eventDetail(receipt, entry.kind)}</em></span>
              <time dateTime={new Date(entry.atTsMs).toISOString()}>{formatTime(entry.atTsMs)}</time>
              <code title={entry.entryHash}>{compactHash(entry.entryHash)}</code>
            </div>
          );
        })}
      </div>
      <footer><Icon name="lock" /><span><b>{receipt.ledger.rowsAtGeneration} total ledger rows at generation</b><small>The case events above follow the study-initialization commitment; each row links to the previous disclosed hash.</small></span></footer>
    </section>
  );
}

function VerificationInspector({ receipt, verification }: ProofLoad) {
  const checks = [
    { label: "Canonical receipt hash", detail: "Recomputed in this browser", pass: verification.canonicalHashValid },
    { label: "Disclosed ledger links", detail: "Sequences, links, and final head reconcile", pass: verification.disclosedChainValid },
    { label: "Lifecycle ordering", detail: "Event kinds match committed row order", pass: verification.lifecycleOrderValid },
    { label: "Synthetic boundary", detail: "Stubs, zero model cost, performance excluded", pass: verification.syntheticBoundaryValid },
    { label: "External anchor", detail: "Absent; no network verification claimed", pass: verification.anchorAbsent }
  ];
  return (
    <aside className="judge-proof-inspector reveal r4" aria-labelledby="proof-inspector-heading">
      <section className="judge-proof-verify surface">
        <header><span className={verification.valid ? "valid" : "invalid"}><Icon name={verification.valid ? "proof" : "minus"} /></span><div><small>Portable evidence check</small><h2 id="proof-inspector-heading">{verification.valid ? "Receipt reconciled" : "Verification failed"}</h2><p>{verification.valid ? "The frozen commitment and disclosed chain match in this browser." : verification.issues.join(" · ")}</p></div></header>
        <div className="judge-proof-checks">
          {checks.map((check) => <div key={check.label}><span className={check.pass ? "pass" : "fail"}><Icon name={check.pass ? "check" : "minus"} /></span><span><b>{check.label}</b><small>{check.detail}</small></span></div>)}
        </div>
        <div className="judge-proof-generation-status"><Icon name="proof" /><span><small>Ledger verification at generation</small><b>{receipt.ledger.verificationAtGeneration.replaceAll("_", " ")}</b></span></div>
      </section>
      <section className="judge-proof-hashes surface">
        <header><span>Portable commitments</span><Icon name="lock" /></header>
        <div><small>Receipt hash</small><code title={receipt.integrity.receiptHash}>{receipt.integrity.receiptHash}</code></div>
        <div><small>Committed ledger head</small><code title={receipt.ledger.finalHeadHash}>{receipt.ledger.finalHeadHash}</code></div>
        <div><small>Receipt ID</small><code title={receipt.receiptId}>{receipt.receiptId}</code></div>
        <footer><span><b>SHA-256</b><small>{receipt.integrity.canonicalization}</small></span><span><b>Local</b><small>not externally timestamped</small></span></footer>
      </section>
      <a className="judge-proof-download" href={RECEIPT_PATH} download>
        <span><Icon name="case" /><span><small>Licence-safe public artifact</small><b>Download receipt JSON</b></span></span><Icon name="arrow" />
      </a>
    </aside>
  );
}

function ReproduceProof() {
  return (
    <section className="judge-proof-reproduce surface reveal r5" aria-labelledby="proof-reproduce-heading">
      <div className="judge-proof-reproduce-copy"><span><Icon name="system" /></span><div><small>Do not trust the screenshot</small><h2 id="proof-reproduce-heading">Verify the frozen receipt offline.</h2><p>The repository verifier enforces the strict schema, recomputes the canonical receipt hash, and checks disclosed lifecycle relationships. It does not query TXLine, Polymarket, Anthropic, a wallet, or Solana.</p></div></div>
      <div className="judge-proof-command"><span>Exact command · repository root</span><code>{VERIFY_COMMAND}</code><a href={RECEIPT_PATH}>Open evidence JSON <Icon name="arrow" /></a></div>
      <footer><Icon name="shield" /><p><b>Assurance boundary:</b> this verifies portable commitments and disclosed relationships. It does not replay private source payloads, prove a real model invocation, establish profitability, or claim an external timestamp.</p></footer>
    </section>
  );
}

function ProofView({ receipt, verification }: ProofLoad) {
  return (
    <div className="app-shell judge-proof-shell">
      <Navigation active="proof" />
      <main className="workspace" id="proof">
        <Topbar title="Proof" modeLabel="Offline artifact" modeClass="offline" />
        <div className="judge-proof-content">
          <ProofHero receipt={receipt} />
          <ProofTruthStrip receipt={receipt} />
          <div className="judge-proof-workbench"><ProofLedger receipt={receipt} /><VerificationInspector receipt={receipt} verification={verification} /></div>
          <ReproduceProof />
          <footer className="judge-proof-final-boundary reveal r5"><Icon name="lock" /><span><b>Synthetic engineering proof. Permanently excluded from every performance claim.</b><small>No external model call · no real order · no wallet · no submitted Solana anchor.</small></span></footer>
        </div>
        <MobileNavigation active="proof" />
      </main>
    </div>
  );
}

function ProofLoading() {
  return <main className="load-screen"><BrandMark /><span className="load-kicker">Samaritan / Proof</span><h1>Recomputing the receipt</h1><div className="load-line"><i /></div><p>Checking the frozen canonical commitment, disclosed ledger links, event order, provenance, and anchor boundary.</p></main>;
}

function ProofError({ retry }: { retry: () => void }) {
  return <main className="load-screen error-screen"><span className="error-mark"><Icon name="shield" /></span><span className="load-kicker">Fail-closed evidence boundary</span><h1>Proof did not reconcile</h1><p>The frozen receipt could not be loaded or its public commitments changed. Samaritan will not show a partial verification result.</p><button type="button" onClick={retry}>Retry proof load</button></main>;
}

export function ProofApp() {
  const [loaded, setLoaded] = useState<ProofLoad | null>(null);
  const [failure, setFailure] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setFailure(false);
    fetch(RECEIPT_PATH, { headers: { accept: "application/json" }, signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Receipt request failed with status ${response.status}`);
        const value = await response.json() as unknown;
        const receipt = parseProofReceipt(value);
        const verification = await verifyBrowserProof(receipt);
        if (!verification.valid) throw new Error(verification.issues.join("; "));
        return { receipt, verification };
      })
      .then((next) => startTransition(() => setLoaded(next)))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setFailure(true);
      });
    return () => controller.abort();
  }, [attempt]);

  if (failure) return <ProofError retry={() => { setLoaded(null); setAttempt((value) => value + 1); }} />;
  if (!loaded) return <ProofLoading />;
  return <ProofView {...loaded} />;
}
