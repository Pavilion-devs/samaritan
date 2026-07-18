import { startTransition, useEffect, useState } from "react";
import type { StudyGuardrails, StudySnapshot } from "../../../src/dash/public-contract";
import { loadStudy } from "./api";
import { BrandMark, Icon, MobileNavigation, Navigation, ProvenanceBadge, Topbar } from "./Shell";

function money(microUsd: number) {
  return `$${(microUsd / 1_000_000).toFixed(2)}`;
}

function percentage(value: number, digits = 0) {
  return `${(value * 100).toFixed(digits)}%`;
}

function bps(value: number | null) {
  return value === null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(1)} bps`;
}

function compactHash(value: string) {
  return `${value.slice(0, 12)}…${value.slice(-8)}`;
}

function ProgressMeter({ value, target, label }: { value: number; target: number; label: string }) {
  const progress = Math.min(100, target === 0 ? 0 : value / target * 100);
  return (
    <div className="study-progress-meter">
      <div><span><b>{value}</b> / {target}</span><small>{label}</small></div>
      <i><em style={{ width: `${progress}%` }} /></i>
    </div>
  );
}

function StudyHero({ snapshot }: { snapshot: StudySnapshot }) {
  const protocol = snapshot.protocol;
  const evaluation = protocol.evaluation;
  const counts = protocol.qualifyingCounts;
  return (
    <section className="study-hero reveal r1" aria-labelledby="study-heading">
      <div className="study-hero-copy">
        <ProvenanceBadge tone="configured" label="Registered protocol · forward paper" />
        <h2 id="study-heading">V2 is registered.<br /><em>Evidence starts fresh.</em></h2>
        <p>Deborah activated the corrected protocol for forward paper observation only. Historical, retrospective, and synthetic cases remain excluded; zero observations currently qualify.</p>
        <div className="study-primary-question"><span><Icon name="chart" /></span><span><small>Registered primary endpoint</small><b>{evaluation.primaryEndpoint}</b></span></div>
      </div>
      <div className="study-clock">
        <header><span><i />Registered · active forward paper</span><em>Since {new Date(protocol.registeredAt).toISOString().slice(0, 10)}</em></header>
        <div className="study-clock-main">
          <span className="study-clock-lock"><Icon name="lock" /></span>
          <div><small>Fresh observations</small><strong><b>{counts.filledMatches}</b><em>/</em>{evaluation.minimumFilledMatches}</strong><span>qualifying matches</span></div>
          <div><small>Fresh fills</small><strong><b>{counts.fills}</b><em>/</em>{evaluation.minimumFills}</strong><span>qualifying fills</span></div>
        </div>
        <div className="study-clock-progress">
          <ProgressMeter value={counts.filledMatches} target={evaluation.minimumFilledMatches} label="Filled-match threshold" />
          <ProgressMeter value={counts.fills} target={evaluation.minimumFills} label="Fill threshold" />
        </div>
        <footer><span>Status <b>registered</b></span><span>Evidence <b>fresh only</b></span><span><Icon name="shield" />Real money closed</span></footer>
      </div>
    </section>
  );
}

function LaneStrip({ snapshot }: { snapshot: StudySnapshot }) {
  const bounty = snapshot.historicalV1.lanes.bounty;
  const longRun = snapshot.historicalV1.lanes.longRun;
  return (
    <section className="study-lanes surface reveal r2" aria-label="Preserved v1 paper-study audit">
      <div className="study-lane long-run"><span className="lane-mark"><Icon name="lock" /></span><span><small>Historical decision lane</small><b>{longRun.label}</b><em>{longRun.reason}</em></span><strong>{longRun.statusLabel}</strong></div>
      <div className="study-lane bounty"><span className="lane-mark"><Icon name="spark" /></span><span><small>Historical demo lane</small><b>{bounty.label}</b><em>{bounty.reason}</em></span><strong>{bounty.statusLabel}</strong></div>
      <div className="lane-boundary"><Icon name="shield" /><span><b>V1 remains invalidated audit history</b><small>Both zero-observation chains are preserved and can never satisfy registered v2.</small></span></div>
    </section>
  );
}

function CorrectedHistoricalEvidence({ snapshot }: { snapshot: StudySnapshot }) {
  const candidate = snapshot.correctedHistoricalCandidate;
  return (
    <section className="study-corrected-evidence surface reveal r3" aria-labelledby="corrected-evidence-title">
      <header className="study-panel-head">
        <div><span>Historical derived · not performance</span><h2 id="corrected-evidence-title">Historical signal candidate</h2></div>
        <span className="study-unregistered-chip"><Icon name="lock" />Historical v4 artifact · predates v2 registration</span>
      </header>
      <div className="corrected-evidence-grid">
        <div className="corrected-evidence-primary"><small>Held-out mean after {candidate.costProxyBps} bps proxy</small><b>{bps(candidate.meanNetAfterCostProxyBps)}</b><em>95% fixture-clustered CI {bps(candidate.matchClustered95Bps.low)} to {bps(candidate.matchClustered95Bps.high)}</em></div>
        <div><small>Training cases</small><b>{candidate.trainingNormalizedCases}</b><em>Normalized before held-out review</em></div>
        <div><small>Held-out cases</small><b>{candidate.heldoutNormalizedCases}</b><em>Across {candidate.heldoutFixtures} fixtures</em></div>
        <div><small>Evidence class</small><b>Sampled prices</b><em>No historical bid, ask, depth, or fill proof</em></div>
      </div>
      <div className="corrected-evidence-boundary"><Icon name="shield" /><span><b>Historical source status preserved</b><small>{candidate.claimBoundary}</small></span></div>
      <footer><span>Protocol <code>{candidate.protocolId}</code></span><span>Configuration <code title={candidate.configurationHash}>{compactHash(candidate.configurationHash)}</code></span></footer>
    </section>
  );
}

function SyntheticReceiptProof({ snapshot }: { snapshot: StudySnapshot }) {
  const proof = snapshot.syntheticProof;
  const steps = ["Signal", "Triage stub", "Thesis stub", "Hard risk", "Paper fill", "Close", "Settlement"];
  return (
    <section className="study-synthetic-proof surface reveal r4" aria-labelledby="synthetic-proof-title">
      <header className="study-panel-head">
        <div><span>Synthetic · engineering proof</span><h2 id="synthetic-proof-title">One case. Every boundary. Verifiable offline.</h2></div>
        <ProvenanceBadge tone="synthetic" label="Synthetic · zero external calls" />
      </header>
      <div className="synthetic-proof-body">
        <div className="synthetic-proof-story">
          <span className="synthetic-proof-mark"><Icon name="proof" /></span>
          <div><small>Closed-world proving fixture</small><b>{proof.label}</b><p>{proof.explanation} Deterministic agent stubs replace external model calls.</p></div>
        </div>
        <div className="synthetic-proof-facts">
          <span><small>Lifecycle</small><b>Filled + settled</b></span>
          <span><small>External calls</small><b>{proof.externalCalls}</b></span>
          <span><small>Performance use</small><b>Excluded</b></span>
          <span><small>Solana anchor</small><b>Not submitted</b></span>
        </div>
      </div>
      <div className="synthetic-proof-flow" aria-label="Synthetic proving lifecycle">
        {steps.map((step, index) => <span key={step}><b>{step}</b>{index < steps.length - 1 ? <i><Icon name="arrow" /></i> : null}</span>)}
      </div>
      <footer><span><Icon name="lock" /><b>Synthetic and permanently excluded from historical, forward-study, and profitability/performance claims.</b></span><a href={proof.path}>Open synthetic receipt · JSON <Icon name="arrow" /></a></footer>
    </section>
  );
}

function SealedEndpoint({ snapshot }: { snapshot: StudySnapshot }) {
  const evaluation = snapshot.protocol.evaluation;
  const counts = snapshot.protocol.qualifyingCounts;
  const countLabel = `${counts.signals} qualifying signal${counts.signals === 1 ? "" : "s"}`;
  return (
    <section className="study-endpoint surface reveal r3" aria-labelledby="endpoint-title">
      <header className="study-panel-head"><div><span>Registered endpoint · sealed</span><h2 id="endpoint-title">Awaiting the registered stopping rule</h2></div><span className="study-sealed-chip"><Icon name="lock" />{countLabel}</span></header>
      <div className="sealed-endpoint-stage">
        <div className="endpoint-axis-labels"><span>Reject zone</span><span>0 bps</span><span>Accept zone</span></div>
        <div className="endpoint-axis"><i /><em /><span /></div>
        <div className="endpoint-vault"><span><Icon name="lock" /></span><div><small>No current endpoint</small><b>{counts.filledMatches} / {evaluation.minimumFilledMatches} filled matches · {counts.fills} / {evaluation.minimumFills} fills</b><p>Only fresh post-registration evidence may open the registered endpoint; old research, v1 rows, and synthetic proof are excluded.</p></div></div>
        <div className="endpoint-method"><span><small>Bootstrap</small><b>{evaluation.bootstrapIterations.toLocaleString("en-US")} iterations</b></span><span><small>Resampling block</small><b>Whole matches</b></span><span><small>Control</small><b>{evaluation.randomDirectionControl}</b></span></div>
      </div>
      <div className="study-accept-criteria">
        {snapshot.decisionRules.accept.map((rule, index) => <div key={rule}><span>{String(index + 1).padStart(2, "0")}</span><i><Icon name="lock" /></i><p>{rule}</p></div>)}
      </div>
    </section>
  );
}

function OpenEndpoint({ snapshot }: { snapshot: StudySnapshot }) {
  if (snapshot.results.visibility !== "open") return null;
  const endpoints = snapshot.results.endpoints;
  return (
    <section className="study-endpoint surface reveal r3" aria-labelledby="endpoint-title">
      <header className="study-panel-head"><div><span>Gating endpoint</span><h2 id="endpoint-title">Executable CLV decision</h2></div><span className="study-result-chip registered">Registered v2</span></header>
      {endpoints ? <div className="study-open-endpoints">
        <div className="study-endpoint-primary"><span>Mean net executable CLV</span><b>{bps(endpoints.meanNetClvBps)}</b><small>95% CI [{bps(endpoints.netClvInterval.low)}, {bps(endpoints.netClvInterval.high)}]</small></div>
        <div><span>Settlement P&amp;L</span><b>{money(endpoints.meanSettlementPnlMicroUsd)}</b><small>Mean resolved result</small></div>
        <div><span>Random control</span><b>{bps(endpoints.randomDirectionControlClvBps)}</b><small>Matched observed costs</small></div>
        <div><span>Positive matches</span><b>{percentage(endpoints.fractionSettledMatchesNetPositive)}</b><small>Settled match fraction</small></div>
      </div> : <div className="study-incomplete-endpoint"><Icon name="clock" /><span><b>Endpoint evidence incomplete</b><small>The minimum sample opened the rows, but complete close or settlement evidence is still required.</small></span></div>}
    </section>
  );
}

function guardrailState(guardrails: StudyGuardrails | null, key: keyof StudyGuardrails): "pass" | "fail" | "waiting" {
  if (!guardrails) return "waiting";
  const value = guardrails[key];
  return value === true ? "pass" : "fail";
}

function GuardrailsPanel({ snapshot }: { snapshot: StudySnapshot }) {
  const thresholds = snapshot.protocol.guardrailThresholds;
  const observed = snapshot.results.visibility === "open" ? snapshot.results.guardrails : null;
  const items = [
    { label: "Fill rate", threshold: `≥ ${percentage(thresholds.minimumFillRate)}`, value: observed ? percentage(observed.fillRate, 1) : "Awaiting fills", state: guardrailState(observed, "fillRatePassed") },
    { label: "Mean slippage", threshold: `≤ ${thresholds.maximumMeanSlippageBps} bps`, value: observed ? bps(observed.meanSlippageBps) : "Awaiting fills", state: guardrailState(observed, "slippagePassed") },
    { label: "Max drawdown", threshold: `≤ ${money(thresholds.maximumDrawdownMicroUsd)}`, value: observed ? money(observed.maxDrawdownMicroUsd) : "No observations", state: guardrailState(observed, "drawdownPassed") },
    { label: "Selected depth", threshold: "Every trade", value: observed ? (observed.selectedDepthComplete ? "Complete" : "Incomplete") : "Awaiting fills", state: guardrailState(observed, "selectedDepthComplete") }
  ];
  return (
    <aside className="study-guardrails surface reveal r4" aria-labelledby="guardrails-title">
      <header className="study-panel-head"><div><span>Hard constraints</span><h2 id="guardrails-title">Acceptance guardrails</h2></div><Icon name="shield" /></header>
      <p>Positive CLV cannot rescue a study that fails execution quality or risk control.</p>
      <div className="study-guardrail-list">
        {items.map((item) => <div className={item.state} key={item.label}><span><i>{item.state === "waiting" ? <Icon name="clock" /> : <Icon name={item.state === "pass" ? "check" : "minus"} />}</i><span><b>{item.label}</b><small>{item.value}</small></span></span><em>{item.threshold}</em></div>)}
      </div>
      <footer><Icon name="lock" /><span><b>Runtime market metadata required</b><small>Missing depth, fee, tick, or close evidence fails closed.</small></span></footer>
    </aside>
  );
}

function CandidatePanel({ snapshot }: { snapshot: StudySnapshot }) {
  const candidate = snapshot.protocol.candidate;
  return (
    <section className="study-candidate surface reveal r5" aria-labelledby="candidate-title">
      <header className="study-panel-head"><div><span>Registered configuration</span><h2 id="candidate-title">Forward-paper v2</h2></div><span className="config-frozen"><i />Frozen</span></header>
      <div className="candidate-lead"><span><Icon name="pulse" /></span><span><small>Enabled detector</small><b>{candidate.detector}</b><em>{candidate.marketFamily}</em></span></div>
      <div className="candidate-parameters">
        <span><small>Move Z</small><b>{candidate.moveAbsZ.toFixed(1)}</b></span>
        <span><small>CUSUM</small><b>{candidate.cusumThresholdBps.toFixed(0)} bps</b></span>
        <span><small>Minimum gap</small><b>{candidate.minimumGapBps.toFixed(0)} bps</b></span>
        <span><small>Updates</small><b>{candidate.minimumUpdates}</b></span>
      </div>
      <div className="candidate-selector"><span><Icon name="chart" /></span><span><small>Dynamic total selector</small><b>{candidate.selector}</b><em>≥ {candidate.minimumCoveragePoints.toLocaleString("en-US")} points · within {percentage(candidate.maximumDistanceFromEven)} of even</em></span></div>
      <div className="candidate-hash"><span>Registered at</span><code>{snapshot.protocol.registeredAt}</code></div>
      <div className="candidate-hash"><span>Configuration identity</span><code title={snapshot.protocol.configHash}>{compactHash(snapshot.protocol.configHash)}</code></div>
    </section>
  );
}

function RiskPanel({ snapshot }: { snapshot: StudySnapshot }) {
  const risk = snapshot.protocol.risk;
  return (
    <section className="study-risk surface reveal r6" aria-labelledby="risk-title">
      <header className="study-panel-head"><div><span>Paper limits</span><h2 id="risk-title">Risk envelope</h2></div><span className="paper-only">Simulated USD</span></header>
      <div className="risk-orbit">
        <div className="risk-bankroll"><span>Bankroll</span><b>{money(risk.bankrollMicroUsd)}</b><small>Paper notional</small></div>
        <span className="risk-ring one" /><span className="risk-ring two" />
      </div>
      <div className="risk-grid"><span><small>Per trade</small><b>{money(risk.perTradeStakeMicroUsd)}</b></span><span><small>Max exposure</small><b>{money(risk.aggregateExposureMicroUsd)}</b></span><span><small>Drawdown stop</small><b>{money(risk.drawdownStopMicroUsd)}</b></span></div>
      <footer><Icon name="shield" /><span><b>Deterministic limits</b><small>No agent can increase stake or exposure, or override the drawdown stop.</small></span></footer>
    </section>
  );
}

function EvidenceQueue({ snapshot }: { snapshot: StudySnapshot }) {
  const universe = snapshot.fixtureUniverse;
  return (
    <section className="study-queue surface reveal r7" aria-labelledby="queue-title">
      <header className="study-panel-head"><div><span>Fresh-forward admission boundary</span><h2 id="queue-title">Evidence queue</h2></div><span>{snapshot.protocol.qualifyingCounts.matches} qualified</span></header>
      <div className="queue-flow">
        <div><b>{universe.evidenceFixtures}</b><span>Historical evidence fixtures</span></div><i><Icon name="arrow" /></i><div><b>{universe.pairedBookReplays}</b><span>Retrospective paired replay</span></div><i><Icon name="arrow" /></i><div className="eligible"><b>{snapshot.protocol.qualifyingCounts.matches}</b><span>V2 qualifying</span></div>
      </div>
      <div className="queue-rejection"><span><Icon name="minus" /></span><span><b>{universe.signalResearchOnly} sampled-history fixtures remain research-only</b><small>They lack synchronized executable depth and cannot count toward the long-run gate.</small></span></div>
      <a href="/command"><span>Inspect fresh capture status</span><Icon name="arrow" /></a>
    </section>
  );
}

function DecisionRules({ snapshot }: { snapshot: StudySnapshot }) {
  const groups = [
    { label: "Accept", className: "accept", icon: "check" as const, rules: snapshot.decisionRules.accept },
    { label: "Reject", className: "reject", icon: "minus" as const, rules: snapshot.decisionRules.reject },
    { label: "Inconclusive", className: "inconclusive", icon: "clock" as const, rules: snapshot.decisionRules.inconclusive }
  ];
  return (
    <section className="study-rules surface reveal r8" aria-labelledby="rules-title">
      <header className="study-panel-head"><div><span>Registered rules · active</span><h2 id="rules-title">How v2 will reach a verdict</h2></div><span className="rules-note">Fresh evidence only</span></header>
      <div className="study-rule-grid">{groups.map((group) => <div className={group.className} key={group.label}><header><span><Icon name={group.icon} /></span><b>{group.label}</b></header>{group.rules.map((rule) => <p key={rule}>{rule}</p>)}</div>)}</div>
      <footer><Icon name="shield" /><b>Registration authorizes forward paper observation only. No study result can unlock real money without a separate future decision.</b></footer>
    </section>
  );
}

function StudyProof({ snapshot }: { snapshot: StudySnapshot }) {
  return (
    <footer className="study-proof reveal r9">
      <span className="study-proof-status"><Icon name="proof" /><span><b>Both preserved v1 chains verify</b><small>Local append-only audit history · not an external anchor</small></span></span>
      <span><small>V1 long-run head</small><code title={snapshot.historicalV1.lanes.longRun.chain.headHash}>{compactHash(snapshot.historicalV1.lanes.longRun.chain.headHash)}</code></span>
      <span><small>V1 bounty head</small><code title={snapshot.historicalV1.lanes.bounty.chain.headHash}>{compactHash(snapshot.historicalV1.lanes.bounty.chain.headHash)}</code></span>
      <span><small>Current protocol</small><code>{snapshot.protocol.version}</code></span>
      <span className="study-proof-boundary"><Icon name="lock" />Derived evidence only</span>
    </footer>
  );
}

function StudyRows({ snapshot }: { snapshot: StudySnapshot }) {
  if (snapshot.results.visibility !== "open") return null;
  return (
    <section className="study-rows surface" aria-labelledby="study-rows-title">
      <header className="study-panel-head"><div><span>Opened after stopping rule</span><h2 id="study-rows-title">Per-match evidence</h2></div><span>{snapshot.results.rows.length} rows</span></header>
      <div className="study-row-table"><div className="study-row-head"><span>Fixture</span><span>Total</span><span>Signals</span><span>Fills</span><span>Fill rate</span><span>Slippage</span><span>Net CLV</span><span>P&amp;L</span></div>{snapshot.results.rows.map((row) => <div className="study-row" key={`${row.fixtureRef}:${row.kickoffUtc}`}><span><b>{row.fixtureRef}</b><small>{row.kickoffUtc.slice(0, 10)}</small></span><span>{row.selectedLine.toFixed(1)}</span><span>{row.signals}</span><span>{row.fills}</span><span>{percentage(row.fillRate, 1)}</span><span>{bps(row.meanSlippageBps)}</span><span>{bps(row.netClvBps)}</span><span>{row.settlementPnlMicroUsd === null ? "—" : money(row.settlementPnlMicroUsd)}</span></div>)}</div>
    </section>
  );
}

function StudyView({ snapshot }: { snapshot: StudySnapshot }) {
  return (
    <div className="app-shell study-shell">
      <Navigation active="study" />
      <main className="workspace" id="study">
        <Topbar title="Study" modeLabel="Offline snapshot" modeClass="offline" />
        <div className="study-content">
          <StudyHero snapshot={snapshot} />
          <LaneStrip snapshot={snapshot} />
          <CorrectedHistoricalEvidence snapshot={snapshot} />
          <SyntheticReceiptProof snapshot={snapshot} />
          <div className="study-primary-grid">{snapshot.results.visibility === "sealed" ? <SealedEndpoint snapshot={snapshot} /> : <OpenEndpoint snapshot={snapshot} />}<GuardrailsPanel snapshot={snapshot} /></div>
          <div className="study-secondary-grid"><CandidatePanel snapshot={snapshot} /><RiskPanel snapshot={snapshot} /><EvidenceQueue snapshot={snapshot} /></div>
          <DecisionRules snapshot={snapshot} />
          <StudyRows snapshot={snapshot} />
          <StudyProof snapshot={snapshot} />
        </div>
        <MobileNavigation active="study" />
      </main>
    </div>
  );
}

function StudyLoading() {
  return <main className="load-screen"><BrandMark /><span className="load-kicker">Samaritan / Study</span><h1>Reconstructing study governance</h1><div className="load-line"><i /></div><p>Verifying current v2 registration and the separate preserved zero-observation v1 audit.</p></main>;
}

function StudyError({ retry }: { retry: () => void }) {
  return <main className="load-screen error-screen"><span className="error-mark"><Icon name="shield" /></span><span className="load-kicker">Fail-closed boundary</span><h1>Study evidence unavailable</h1><p>The protocol identity, ledger chain, or sealing state could not be reconciled. Samaritan will not expose a partial profitability result.</p><button type="button" onClick={retry}>Retry verified load</button></main>;
}

export function StudyApp() {
  const [snapshot, setSnapshot] = useState<StudySnapshot | null>(null);
  const [failure, setFailure] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setFailure(false);
    loadStudy(controller.signal)
      .then((nextSnapshot) => startTransition(() => setSnapshot(nextSnapshot)))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setFailure(true);
      });
    return () => controller.abort();
  }, [attempt]);

  if (failure) return <StudyError retry={() => { setSnapshot(null); setAttempt((value) => value + 1); }} />;
  if (!snapshot) return <StudyLoading />;
  return <StudyView snapshot={snapshot} />;
}
