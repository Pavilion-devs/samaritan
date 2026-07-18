import { startTransition, useEffect, useState } from "react";
import type { StudyGuardrails, StudySnapshot } from "../../../src/dash/public-contract";
import { loadStudy } from "./api";
import { BrandMark, EditorialNavigation, Icon } from "./Shell";

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
  return `${value.slice(0, 14)}…${value.slice(-7)}`;
}

function registrationDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(value));
}

function ProgressLine({ value, target, label }: { value: number; target: number; label: string }) {
  const progress = Math.min(100, target === 0 ? 0 : value / target * 100);
  return (
    <div className="editorial-performance-progress-line">
      <span><small>{label}</small><b>{value} / {target}</b></span>
      <i><em style={{ width: `${progress}%` }} /></i>
    </div>
  );
}

function PerformanceHero({ snapshot }: { snapshot: StudySnapshot }) {
  const counts = snapshot.protocol.qualifyingCounts;
  const evaluation = snapshot.protocol.evaluation;
  return (
    <section className="editorial-performance-hero" aria-labelledby="editorial-performance-title">
      <div className="editorial-performance-hero-copy">
        <span className="editorial-performance-kicker"><i aria-hidden="true" />Registered forward paper · fresh evidence only</span>
        <h1 id="editorial-performance-title">Performance<br />waits for proof.</h1>
        <p>Samaritan will not turn promising research, a synthetic demo, or an empty ledger into a performance claim. The registered v2 study opens only after fresh evidence satisfies its stopping rule.</p>
        <div className="editorial-performance-endpoint-label">
          <span><Icon name="chart" /></span>
          <span><small>Registered primary endpoint</small><b>{evaluation.primaryEndpoint}</b></span>
        </div>
      </div>
      <div className="editorial-performance-clock">
        <header><span><i aria-hidden="true" />V2 registered · active</span><time>{registrationDate(snapshot.protocol.registeredAt)}</time></header>
        <div className="editorial-performance-clock-counts">
          <div><small>Fresh filled matches</small><strong><b>{counts.filledMatches}</b><i>/</i>{evaluation.minimumFilledMatches}</strong><span>required before decision</span></div>
          <div><small>Fresh fills</small><strong><b>{counts.fills}</b><i>/</i>{evaluation.minimumFills}</strong><span>required before decision</span></div>
        </div>
        <div className="editorial-performance-clock-progress">
          <ProgressLine value={counts.filledMatches} target={evaluation.minimumFilledMatches} label="Filled-match threshold" />
          <ProgressLine value={counts.fills} target={evaluation.minimumFills} label="Fill threshold" />
        </div>
        <footer><span>Status <b>Registered</b></span><span>Result <b>{snapshot.results.visibility === "sealed" ? "Sealed" : "Open"}</b></span><span><Icon name="shield" />Real money closed</span></footer>
      </div>
    </section>
  );
}

function EvidenceBoundary({ snapshot }: { snapshot: StudySnapshot }) {
  const steps = [
    { icon: "pulse" as const, label: "Fresh capture", detail: "Post-registration only" },
    { icon: "spark" as const, label: "Registered signal", detail: snapshot.protocol.candidate.detector },
    { icon: "check" as const, label: "Paper fill", detail: "Executable evidence" },
    { icon: "chart" as const, label: "V2 count", detail: `${snapshot.protocol.qualifyingCounts.matches} qualified` }
  ];
  return (
    <section className="editorial-performance-boundary" aria-labelledby="editorial-performance-boundary-title">
      <header className="editorial-performance-section-heading">
        <span><small>Admission boundary</small><h2 id="editorial-performance-boundary-title">Only one path can become performance.</h2></span>
        <em>Fresh forward evidence</em>
      </header>
      <div className="editorial-performance-admission-path">
        {steps.map((step) => <div key={step.label}><i><Icon name={step.icon} /></i><span><b>{step.label}</b><small>{step.detail}</small></span></div>)}
      </div>
      <div className="editorial-performance-exclusions">
        <span><Icon name="minus" /><b>Historical research</b><small>Context only · not executable performance</small></span>
        <span><Icon name="minus" /><b>Synthetic receipt</b><small>Engineering proof · permanently excluded</small></span>
        <span><Icon name="minus" /><b>Invalidated v1</b><small>Audit history · cannot satisfy v2</small></span>
      </div>
    </section>
  );
}

function SealedEndpoint({ snapshot }: { snapshot: StudySnapshot }) {
  const evaluation = snapshot.protocol.evaluation;
  const counts = snapshot.protocol.qualifyingCounts;
  return (
    <section className="editorial-performance-endpoint" aria-labelledby="editorial-performance-endpoint-title">
      <header className="editorial-performance-section-heading">
        <span><small>Registered endpoint · sealed</small><h2 id="editorial-performance-endpoint-title">No result yet.</h2></span>
        <em><Icon name="lock" />Stopping rule unmet</em>
      </header>
      <div className="editorial-performance-vault">
        <span><Icon name="lock" /></span>
        <span><small>Current endpoint</small><b>Withheld by design</b><p>{counts.filledMatches} of {evaluation.minimumFilledMatches} filled matches and {counts.fills} of {evaluation.minimumFills} fills qualify. Old research and synthetic proof cannot open this result.</p></span>
      </div>
      <div className="editorial-performance-method">
        <span><small>Unit of analysis</small><b>{evaluation.unitOfAnalysis}</b></span>
        <span><small>Bootstrap</small><b>{evaluation.bootstrapIterations.toLocaleString("en-US")} iterations</b></span>
        <span><small>Control</small><b>{evaluation.randomDirectionControl}</b></span>
      </div>
      <div className="editorial-performance-zero-axis" aria-label="Decision axis remains sealed">
        <span>Reject</span><i><em /></i><b>0 bps</b><i><em /></i><span>Accept</span>
      </div>
    </section>
  );
}

function OpenEndpoint({ snapshot }: { snapshot: StudySnapshot }) {
  if (snapshot.results.visibility !== "open") return null;
  const endpoints = snapshot.results.endpoints;
  return (
    <section className="editorial-performance-endpoint" aria-labelledby="editorial-performance-endpoint-title">
      <header className="editorial-performance-section-heading"><span><small>Registered v2 endpoint</small><h2 id="editorial-performance-endpoint-title">Executable evidence result</h2></span><em>Stopping rule met</em></header>
      {endpoints ? (
        <div className="editorial-performance-open-result">
          <div className="primary"><small>Mean net executable CLV</small><b>{bps(endpoints.meanNetClvBps)}</b><span>95% CI {bps(endpoints.netClvInterval.low)} to {bps(endpoints.netClvInterval.high)}</span></div>
          <div><small>Settlement P&amp;L</small><b>{money(endpoints.meanSettlementPnlMicroUsd)}</b><span>Mean resolved result</span></div>
          <div><small>Random control</small><b>{bps(endpoints.randomDirectionControlClvBps)}</b><span>Matched observed costs</span></div>
          <div><small>Positive matches</small><b>{percentage(endpoints.fractionSettledMatchesNetPositive)}</b><span>Settled fraction</span></div>
        </div>
      ) : <div className="editorial-performance-incomplete"><Icon name="clock" /><span><b>Endpoint evidence incomplete</b><small>The minimum sample opened the rows, but complete close or settlement evidence is still required.</small></span></div>}
    </section>
  );
}

function guardrailState(guardrails: StudyGuardrails | null, key: keyof StudyGuardrails): "pass" | "fail" | "waiting" {
  if (!guardrails) return "waiting";
  return guardrails[key] === true ? "pass" : "fail";
}

function StudyContract({ snapshot }: { snapshot: StudySnapshot }) {
  const candidate = snapshot.protocol.candidate;
  const thresholds = snapshot.protocol.guardrailThresholds;
  const observed = snapshot.results.visibility === "open" ? snapshot.results.guardrails : null;
  const guardrails = [
    { label: "Fill rate", threshold: `≥ ${percentage(thresholds.minimumFillRate)}`, observed: observed ? percentage(observed.fillRate, 1) : "Awaiting fills", state: guardrailState(observed, "fillRatePassed") },
    { label: "Mean slippage", threshold: `≤ ${thresholds.maximumMeanSlippageBps} bps`, observed: observed ? bps(observed.meanSlippageBps) : "Awaiting fills", state: guardrailState(observed, "slippagePassed") },
    { label: "Max drawdown", threshold: `≤ ${money(thresholds.maximumDrawdownMicroUsd)}`, observed: observed ? money(observed.maxDrawdownMicroUsd) : "No observations", state: guardrailState(observed, "drawdownPassed") },
    { label: "Selected depth", threshold: "Every fill", observed: observed ? (observed.selectedDepthComplete ? "Complete" : "Incomplete") : "Awaiting fills", state: guardrailState(observed, "selectedDepthComplete") }
  ];
  return (
    <aside className="editorial-performance-contract" aria-labelledby="editorial-performance-contract-title">
      <header className="editorial-performance-section-heading"><span><small>Frozen study contract</small><h2 id="editorial-performance-contract-title">What is being tested</h2></span><em><i />Frozen</em></header>
      <div className="editorial-performance-candidate">
        <span><Icon name="pulse" /></span>
        <span><small>Enabled detector</small><b>{candidate.detector}</b><em>{candidate.marketFamily}</em></span>
      </div>
      <div className="editorial-performance-parameters">
        <span><small>Move Z</small><b>{candidate.moveAbsZ.toFixed(1)}</b></span>
        <span><small>CUSUM</small><b>{candidate.cusumThresholdBps.toFixed(0)} bps</b></span>
        <span><small>Minimum gap</small><b>{candidate.minimumGapBps.toFixed(0)} bps</b></span>
        <span><small>Updates</small><b>{candidate.minimumUpdates}</b></span>
      </div>
      <div className="editorial-performance-selector"><Icon name="chart" /><span><small>Market selector</small><b>{candidate.selector}</b><em>≥ {candidate.minimumCoveragePoints.toLocaleString("en-US")} points · within {percentage(candidate.maximumDistanceFromEven)} of even</em></span></div>
      <div className="editorial-performance-guardrails">
        <h3>Acceptance guardrails</h3>
        {guardrails.map((item) => (
          <div className={item.state} key={item.label}>
            <span><i><Icon name={item.state === "waiting" ? "clock" : item.state === "pass" ? "check" : "minus"} /></i><span><b>{item.label}</b><small>{item.observed}</small></span></span>
            <em>{item.threshold}</em>
          </div>
        ))}
      </div>
      <div className="editorial-performance-contract-hash"><span>Configuration identity</span><code title={snapshot.protocol.configHash}>{compactHash(snapshot.protocol.configHash)}</code></div>
    </aside>
  );
}

function RiskEnvelope({ snapshot }: { snapshot: StudySnapshot }) {
  const risk = snapshot.protocol.risk;
  return (
    <section className="editorial-performance-risk" aria-labelledby="editorial-performance-risk-title">
      <header className="editorial-performance-section-heading"><span><small>Paper-only risk</small><h2 id="editorial-performance-risk-title">Limits before outcomes</h2></span><em>Simulated USD</em></header>
      <div className="editorial-performance-risk-grid">
        <div className="primary"><small>Paper bankroll</small><b>{money(risk.bankrollMicroUsd)}</b><span>Not real capital</span></div>
        <div><small>Per trade</small><b>{money(risk.perTradeStakeMicroUsd)}</b><span>Fixed stake ceiling</span></div>
        <div><small>Max exposure</small><b>{money(risk.aggregateExposureMicroUsd)}</b><span>Aggregate cap</span></div>
        <div><small>Drawdown stop</small><b>{money(risk.drawdownStopMicroUsd)}</b><span>Deterministic breaker</span></div>
      </div>
      <footer><Icon name="shield" /><span><b>No agent can enlarge these limits</b><small>Stake, exposure, and drawdown rules remain deterministic.</small></span></footer>
    </section>
  );
}

function HistoricalResearch({ snapshot }: { snapshot: StudySnapshot }) {
  const candidate = snapshot.correctedHistoricalCandidate;
  return (
    <section className="editorial-performance-history" aria-labelledby="editorial-performance-history-title">
      <header className="editorial-performance-section-heading"><span><small>Historical derived research · excluded from v2</small><h2 id="editorial-performance-history-title">Promising research is not performance.</h2></span><em><Icon name="lock" />Predates registration</em></header>
      <div className="editorial-performance-history-grid">
        <div className="primary"><small>Held-out mean after {candidate.costProxyBps} bps proxy</small><b>{bps(candidate.meanNetAfterCostProxyBps)}</b><span>95% fixture-clustered CI {bps(candidate.matchClustered95Bps.low)} to {bps(candidate.matchClustered95Bps.high)}</span></div>
        <div><small>Training cases</small><b>{candidate.trainingNormalizedCases}</b><span>Normalized research cases</span></div>
        <div><small>Held-out cases</small><b>{candidate.heldoutNormalizedCases}</b><span>Across {candidate.heldoutFixtures} fixtures</span></div>
        <div><small>Execution evidence</small><b>Not established</b><span>No historical bid, ask, depth, or fills</span></div>
      </div>
      <div className="editorial-performance-history-boundary"><Icon name="shield" /><p>{candidate.claimBoundary}</p></div>
      <footer><span>Protocol <code>{candidate.protocolId}</code></span><span>Configuration <code title={candidate.configurationHash}>{compactHash(candidate.configurationHash)}</code></span></footer>
    </section>
  );
}

function ExcludedContext({ snapshot }: { snapshot: StudySnapshot }) {
  const longRun = snapshot.historicalV1.lanes.longRun;
  const bounty = snapshot.historicalV1.lanes.bounty;
  const synthetic = snapshot.syntheticProof;
  return (
    <section className="editorial-performance-context" aria-labelledby="editorial-performance-context-title">
      <header className="editorial-performance-section-heading"><span><small>Preserved context</small><h2 id="editorial-performance-context-title">Useful for audit. Excluded from results.</h2></span><em>Boundaries intact</em></header>
      <div className="editorial-performance-context-rows">
        <div><span><i><Icon name="lock" /></i><span><small>Invalidated v1 audit</small><b>Two zero-observation chains preserved</b><p>{longRun.reason}. {bounty.reason}.</p></span></span><span><small>Chain state</small><b>{longRun.chain.valid && bounty.chain.valid ? "Both valid" : "Check failed"}</b></span></div>
        <div><span><i><Icon name="proof" /></i><span><small>Synthetic engineering proof</small><b>{synthetic.label}</b><p>{synthetic.explanation}</p></span></span><span><small>Performance use</small><b>Excluded</b></span></div>
      </div>
      <a href={synthetic.path}>Open synthetic receipt <Icon name="arrow" /></a>
    </section>
  );
}

function DecisionRules({ snapshot }: { snapshot: StudySnapshot }) {
  const groups = [
    { label: "Accept", icon: "check" as const, rules: snapshot.decisionRules.accept },
    { label: "Reject", icon: "minus" as const, rules: snapshot.decisionRules.reject },
    { label: "Inconclusive", icon: "clock" as const, rules: snapshot.decisionRules.inconclusive }
  ];
  return (
    <section className="editorial-performance-rules" aria-labelledby="editorial-performance-rules-title">
      <header className="editorial-performance-section-heading"><span><small>Registered decision rules</small><h2 id="editorial-performance-rules-title">The verdict is predetermined.</h2></span><em>Fresh evidence only</em></header>
      <div>
        {groups.map((group) => (
          <article key={group.label}>
            <header><i><Icon name={group.icon} /></i><h3>{group.label}</h3></header>
            {group.rules.map((rule) => <p key={rule}>{rule}</p>)}
          </article>
        ))}
      </div>
      <footer><Icon name="shield" /><b>Registration authorizes forward paper observation only. A study result cannot unlock real money without a separate future decision.</b></footer>
    </section>
  );
}

function StudyRows({ snapshot }: { snapshot: StudySnapshot }) {
  if (snapshot.results.visibility !== "open") return null;
  return (
    <section className="editorial-performance-rows" aria-labelledby="editorial-performance-rows-title">
      <header className="editorial-performance-section-heading"><span><small>Opened after stopping rule</small><h2 id="editorial-performance-rows-title">Per-match evidence</h2></span><em>{snapshot.results.rows.length} rows</em></header>
      <div role="region" aria-label="Per-match performance evidence" tabIndex={0}>
        <table><thead><tr><th>Fixture</th><th>Total</th><th>Signals</th><th>Fills</th><th>Fill rate</th><th>Slippage</th><th>Net CLV</th><th>P&amp;L</th></tr></thead><tbody>{snapshot.results.rows.map((row) => <tr key={`${row.fixtureRef}:${row.kickoffUtc}`}><td><b>{row.fixtureRef}</b><small>{row.kickoffUtc.slice(0, 10)}</small></td><td>{row.selectedLine.toFixed(1)}</td><td>{row.signals}</td><td>{row.fills}</td><td>{percentage(row.fillRate, 1)}</td><td>{bps(row.meanSlippageBps)}</td><td>{bps(row.netClvBps)}</td><td>{row.settlementPnlMicroUsd === null ? "—" : money(row.settlementPnlMicroUsd)}</td></tr>)}</tbody></table>
      </div>
    </section>
  );
}

function PerformanceProof({ snapshot }: { snapshot: StudySnapshot }) {
  return (
    <aside className="editorial-performance-proof">
      <span><i><Icon name="check" /></i><span><small>Protocol state</small><b>V2 registration verified</b></span></span>
      <span><small>Current protocol</small><code>{snapshot.protocol.version}</code></span>
      <span><small>V1 long-run head</small><code title={snapshot.historicalV1.lanes.longRun.chain.headHash}>{compactHash(snapshot.historicalV1.lanes.longRun.chain.headHash)}</code></span>
      <span><small>V1 bounty head</small><code title={snapshot.historicalV1.lanes.bounty.chain.headHash}>{compactHash(snapshot.historicalV1.lanes.bounty.chain.headHash)}</code></span>
      <a href="/proof"><small>Public boundary</small><b>Derived only</b><Icon name="arrow" /></a>
    </aside>
  );
}

function StudyView({ snapshot }: { snapshot: StudySnapshot }) {
  return (
    <div className="editorial-performance">
      <div className="editorial-page editorial-performance-page">
        <EditorialNavigation active="study" modeLabel="Registered study · real money closed" />
        <main>
          <PerformanceHero snapshot={snapshot} />
          <EvidenceBoundary snapshot={snapshot} />
          <div className="editorial-performance-primary-grid">
            {snapshot.results.visibility === "sealed" ? <SealedEndpoint snapshot={snapshot} /> : <OpenEndpoint snapshot={snapshot} />}
            <StudyContract snapshot={snapshot} />
          </div>
          <RiskEnvelope snapshot={snapshot} />
          <HistoricalResearch snapshot={snapshot} />
          <ExcludedContext snapshot={snapshot} />
          <DecisionRules snapshot={snapshot} />
          <StudyRows snapshot={snapshot} />
          <PerformanceProof snapshot={snapshot} />
        </main>
        <footer className="editorial-footer"><span>Forward paper only · no profitability claim before the stopping rule</span><span>Real-money gate closed</span></footer>
      </div>
    </div>
  );
}

function StudyLoading() {
  return <main className="editorial-load"><BrandMark /><span>Samaritan / Performance</span><h1>Reconstructing study governance</h1><div><i /></div><p>Verifying current v2 registration and the separate preserved audit history.</p></main>;
}

function StudyError({ retry }: { retry: () => void }) {
  return <main className="editorial-load editorial-load-error"><span><Icon name="shield" /></span><small>Fail-closed boundary</small><h1>Performance evidence unavailable</h1><p>Samaritan will not expose a partial or unreconciled result.</p><button type="button" onClick={retry}>Retry verified load</button></main>;
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
