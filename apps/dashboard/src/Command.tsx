import { startTransition, useEffect, useState } from "react";
import type {
  CommandFixture,
  CommandSnapshot,
  PublicBookPoint
} from "../../../src/dash/public-contract";
import { loadCommand } from "./api";
import { BrandMark, Icon, MobileNavigation, Navigation, ProvenanceBadge, Topbar } from "./Shell";

function percent(value: number, digits = 2) {
  return `${(value * 100).toFixed(digits)}%`;
}

function movementBps(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toLocaleString("en-US")} bps`;
}

function compactHash(value: string) {
  return `${value.slice(0, 10)}…${value.slice(-7)}`;
}

function dateParts(value: string) {
  const date = new Date(value);
  return {
    day: new Intl.DateTimeFormat("en-GB", { day: "2-digit", timeZone: "UTC" }).format(date),
    month: new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(date).toUpperCase(),
    time: new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(date)
  };
}

function relativeStart(target: string, generatedAt: string) {
  const difference = Date.parse(target) - Date.parse(generatedAt);
  if (difference <= 0) return "Window reached";
  const hours = Math.floor(difference / 3_600_000);
  const days = Math.floor(hours / 24);
  return days > 0 ? `Starts in ${days}d ${hours % 24}h` : `Starts in ${hours}h`;
}

function MiniProbabilityChart({ featured }: { featured: CommandSnapshot["featuredCase"] }) {
  const points: PublicBookPoint[] = featured.chart;
  const frame = { left: 28, right: 624, top: 24, bottom: 194 };
  const minimumOffset = Math.min(...points.map((point) => point.offsetMs));
  const maximumOffset = Math.max(...points.map((point) => point.offsetMs));
  const goalPoint = points.find((point) => point.offsetMs === 0);
  if (!goalPoint || minimumOffset === maximumOffset) {
    throw new Error("Featured capture chart is missing its trigger-aligned evidence window");
  }
  const x = (offset: number) => frame.left + ((offset - minimumOffset) / (maximumOffset - minimumOffset)) * (frame.right - frame.left);
  const y = (probability: number) => frame.top + ((0.3 - probability) / 0.15) * (frame.bottom - frame.top);
  const path = (value: (point: PublicBookPoint) => number) => points.map((point, index) => `${index === 0 ? "M" : "L"}${x(point.offsetMs).toFixed(1)} ${y(value(point)).toFixed(1)}`).join(" ");
  const bid = path((point) => point.bestBid);
  const ask = path((point) => point.bestAsk);
  const bidReverse = [...points].reverse().map((point) => `L${x(point.offsetMs).toFixed(1)} ${y(point.bestBid).toFixed(1)}`).join(" ");
  const goalX = x(0);
  return (
    <figure className="command-chart">
      <div className="command-chart-head"><span>Public executable book</span><span><i className="chart-bid-dot" />Best bid <i className="chart-ask-dot" />Best ask</span></div>
      <svg viewBox="0 0 652 226" role="img" aria-labelledby="command-chart-title command-chart-desc">
        <title id="command-chart-title">{featured.home.name}–{featured.away.name} public {featured.marketOutcomeLabel} book around the first goal</title>
        <desc id="command-chart-desc">The public executable bid and ask repriced before the goal reached Samaritan. Exact TXLine probability levels are withheld.</desc>
        <defs><linearGradient id="command-spread" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#9183e5" stopOpacity=".26" /><stop offset="1" stopColor="#9183e5" stopOpacity=".015" /></linearGradient></defs>
        <g className="command-chart-grid"><line x1="28" x2="624" y1="58" y2="58" /><line x1="28" x2="624" y1="126" y2="126" /><line x1="28" x2="624" y1="194" y2="194" /></g>
        <path className="command-spread-area" d={`${ask} ${bidReverse} Z`} />
        <path className="command-bid-line" d={bid} />
        <path className="command-ask-line" d={ask} />
        <g className="command-goal"><line x1={goalX} x2={goalX} y1="18" y2="194" /><circle cx={goalX} cy={y(goalPoint.bestAsk)} r="5" /><text x={goalX + 9} y="35">GOAL FIRST SEEN</text></g>
        <g className="command-chart-axis"><text x="28" y="216">T−5s</text><text x={goalX} y="216" textAnchor="middle">{featured.clockLabel}</text><text x="624" y="216" textAnchor="end">T+30s</text></g>
      </svg>
    </figure>
  );
}

function SystemDeck({ snapshot }: { snapshot: CommandSnapshot }) {
  return (
    <section className="command-system-deck" id="system" aria-labelledby="system-deck-title">
      <div className="system-posture">
        <span className="posture-icon"><Icon name="pulse" /></span>
        <span><small>Snapshot posture</small><b id="system-deck-title">{snapshot.system.label}</b><em>{snapshot.system.detail}</em></span>
      </div>
      <div className="feed-deck">
        {snapshot.system.feeds.map((feed) => (
          <div className={`feed-state ${feed.status}`} key={feed.id}>
            <span><i />{feed.statusLabel}</span><b>{feed.label}</b><small>{feed.detail}</small>
          </div>
        ))}
      </div>
      <div className="deck-time"><small>Offline snapshot</small><time dateTime={snapshot.generatedAt}>{new Date(snapshot.generatedAt).toISOString().slice(11, 16)} UTC</time><span>Generated artifact · read only</span></div>
    </section>
  );
}

function FeaturedCase({ snapshot }: { snapshot: CommandSnapshot }) {
  const featured = snapshot.featuredCase;
  const minutes = Math.floor(featured.clockSeconds / 60);
  const seconds = featured.clockSeconds % 60;
  const orderLabel = featured.ordersPlaced === 0 ? "Execution runtime not entered" : `${featured.ordersPlaced} orders placed`;
  return (
    <section className="command-feature surface reveal r1" aria-labelledby="featured-title">
      <div className="feature-copy">
        <div className="feature-eyebrow"><ProvenanceBadge tone="capture" label="Real capture · retrospective" /><em>Case {featured.caseId}</em></div>
        <div className="feature-scoreline" aria-label={`${featured.home.name} ${featured.scoreAtCursor.home}, ${featured.away.name} ${featured.scoreAtCursor.away} at ${minutes} minutes ${seconds} seconds`}>
          <span className="feature-team"><i className={`command-crest ${featured.home.code.toLowerCase()}`}>{featured.home.code}</i><b>{featured.home.name}</b></span>
          <span className="feature-score"><small>{featured.clockLabel}</small><strong>{featured.scoreLabel}</strong><em>first goal seen</em></span>
          <span className="feature-team away"><b>{featured.away.name}</b><i className={`command-crest ${featured.away.code.toLowerCase()}`}>{featured.away.code}</i></span>
        </div>
        <span className="feature-kicker">Retrospective opportunity review</span>
        <h2 id="featured-title">The market had already moved.</h2>
        <p>{featured.conclusion}</p>
        <div className="feature-metrics">
          <div><span>TXLine movement</span><b>{movementBps(featured.consensusMoveFromBaselineBps)}</b><small>25-bps bucket · level withheld</small></div>
          <div><span>Executable ask</span><b>{percent(featured.bestAsk)}</b></div>
          <div className="gap"><span>Pre-trigger market move</span><b>{movementBps(featured.preTriggerMarketMoveBps)}</b></div>
        </div>
        <div className="feature-verdict"><span><Icon name="shield" /></span><span><small>Retrospective feasibility verdict</small><b>{orderLabel} · research only</b></span></div>
        <a className="command-primary-action" href="/matchroom"><Icon name="play" /><span>Open captured case replay</span><Icon name="arrow" /></a>
      </div>
      <div className="feature-visual">
        <MiniProbabilityChart featured={featured} />
        <div className="chart-conclusion"><span>Market repriced first</span><b>{movementBps(featured.preTriggerMarketMoveBps)}</b><small>public {featured.marketOutcomeLabel} book move before TXLine first seen</small></div>
      </div>
    </section>
  );
}

function FixtureCard({ fixture, generatedAt, lead }: { fixture: CommandFixture; generatedAt: string; lead: boolean }) {
  const kickoff = dateParts(fixture.kickoffUtc);
  const capture = dateParts(fixture.captureStartUtc);
  return (
    <article className={`fixture-card ${fixture.phase} ${lead ? "lead" : ""}`}>
      <div className="fixture-date"><b>{kickoff.day}</b><span>{kickoff.month}</span></div>
      <div className="fixture-card-main">
        <div className="fixture-status"><span><i />{fixture.statusLabel}</span><em>{fixture.phase === "scheduled" ? relativeStart(fixture.captureStartUtc, generatedAt) : fixture.statusDetail}</em></div>
        <div className="fixture-versus"><span><i className={`mini-crest ${fixture.home.code.toLowerCase()}`}>{fixture.home.code}</i><b>{fixture.home.name}</b></span><em>vs</em><span><b>{fixture.away.name}</b><i className={`mini-crest ${fixture.away.code.toLowerCase()}`}>{fixture.away.code}</i></span></div>
        <div className="fixture-times"><span><small>Capture begins</small><b>{capture.time} UTC</b></span><span><small>Kickoff</small><b>{kickoff.time} UTC</b></span></div>
        <div className="fixture-boundary"><Icon name="lock" /><span><b>Capture only</b><small>Exact identity confirmed · non-tradeable</small></span></div>
      </div>
    </article>
  );
}

function CaptureSchedule({ snapshot }: { snapshot: CommandSnapshot }) {
  return (
    <aside className="capture-schedule surface reveal r2" aria-labelledby="capture-title">
      <header className="command-panel-head"><div><span>Fixture watch</span><h2 id="capture-title">Capture schedule</h2></div><ProvenanceBadge tone="configured" label={`${snapshot.fixtureSchedule.length} configured · not live`} /></header>
      <p className="schedule-intro">The next evidence enters only through exact, human-confirmed public-data captures.</p>
      <div className="fixture-stack">
        {snapshot.fixtureSchedule.map((fixture, index) => <FixtureCard key={fixture.fixtureId} fixture={fixture} generatedAt={snapshot.generatedAt} lead={index === 0} />)}
      </div>
      <div className="schedule-rule"><Icon name="shield" /><span><b>Admission stays fail-closed</b><small>Capture does not authorize a trade. Replay and paper-study gates still apply.</small></span></div>
    </aside>
  );
}

function RecentCases({ snapshot }: { snapshot: CommandSnapshot }) {
  return (
    <section className="command-cases surface reveal r3" aria-labelledby="cases-title">
      <header className="command-panel-head"><div><span>Captured case record</span><h2 id="cases-title">Replay-checked captured cases</h2></div><a href="/casebook">Open Casebook <Icon name="arrow" /></a></header>
      <div className="case-table-head"><span>Case</span><span>Market read</span><span>Evidence</span><span>Outcome</span></div>
      {snapshot.recentCases.map((item) => (
        <a className="command-case-row" href="/casebook" key={item.caseId}>
          <span className="case-identity"><i>{item.home.code}</i><span><b>{item.fixtureLabel}</b><small>{item.caseId} · retrospective feasibility</small></span></span>
          <span className="case-market"><b>{item.marketLabel}</b><small>{movementBps(item.preTriggerMarketMoveBps)} before signal</small></span>
          <span className="case-evidence"><i /><span><b>Real capture · retrospective</b><small>{item.canonicalEvents.toLocaleString("en-US")} events</small></span></span>
          <span className="case-outcome"><b>{item.dispositionLabel}</b><small>{item.reason}</small><Icon name="arrow" /></span>
        </a>
      ))}
      <div className="case-empty"><span><Icon name="clock" /></span><span><b>{snapshot.additionalCaseState.label}</b><small>{snapshot.additionalCaseState.detail}</small></span></div>
    </section>
  );
}

function StudyPanel({ snapshot }: { snapshot: CommandSnapshot }) {
  const study = snapshot.study;
  return (
    <section className="command-study surface reveal r4" id="study" aria-labelledby="study-title">
      <header className="command-panel-head"><div><span>Evidence governance</span><h2 id="study-title">Paper protocol audit</h2></div><span className="sealed-label"><Icon name="lock" />{study.statusLabel}</span></header>
      <div className="study-message"><span className="study-lock"><Icon name="shield" /></span><span><b>V1 was invalidated before any observation.</b><small>The zero-row ledgers are preserved; corrected v2 awaits Deborah's registration.</small></span></div>
      <div className="study-progress">
        <div><span><b>{study.filledMatches}</b> / {study.requiredFilledMatches}</span><small>filled matches</small><i><em style={{ width: `${Math.min(100, study.filledMatches / study.requiredFilledMatches * 100)}%` }} /></i></div>
        <div><span><b>{study.fills}</b> / {study.requiredFills}</span><small>fills</small><i><em style={{ width: `${Math.min(100, study.fills / study.requiredFills * 100)}%` }} /></i></div>
      </div>
      <div className="study-meta"><span><small>Protocol status</small><b>Suspended audit history</b></span><span><small>Config hash</small><code title={study.configHash}>{compactHash(study.configHash)}</code></span></div>
    </section>
  );
}

function CommandProof({ snapshot }: { snapshot: CommandSnapshot }) {
  const validLedgerChains = [snapshot.proof.bountyLedgerValid, snapshot.proof.longRunLedgerValid].filter(Boolean).length;
  return (
    <aside className="command-proof surface reveal r5" id="proof" aria-labelledby="command-proof-title">
      <header className="command-panel-head"><div><span>Integrity spine</span><h2 id="command-proof-title">Offline integrity checks</h2></div><ProvenanceBadge tone="offline" label="Local replay check" /></header>
      <div className="command-proof-hero"><span>{snapshot.proof.replayIdentityParity ? "PASS" : "FAIL"}</span><div><b>Replay identity parity</b><small>{snapshot.proof.replayIdentityParity ? "Deterministic replay matched twice" : "Local replay check failed"}</small></div></div>
      <div className="command-proof-grid"><span><small>Canonical events</small><b>{snapshot.proof.canonicalEvents.toLocaleString("en-US")}</b></span><span><small>Evidence fixtures</small><b>{snapshot.proof.evidenceFixtures}</b></span><span><small>Local ledger chains</small><b>{validLedgerChains} valid</b></span><span><small>Paired replays</small><b>{snapshot.proof.pairedBookReplays}</b></span></div>
      <div className="command-hash"><span>Replay identity</span><code title={snapshot.proof.replayIdentityHash}>{compactHash(snapshot.proof.replayIdentityHash)}</code></div>
      <div className="proof-policy"><Icon name="lock" /><span><b>Public observer boundary</b><small>Derived evidence only · no wallet or raw feed access</small></span></div>
    </aside>
  );
}

function CommandView({ snapshot }: { snapshot: CommandSnapshot }) {
  return (
    <div className="app-shell command-shell">
      <Navigation active="command" caseCount={snapshot.recentCases.length} />
      <main className="workspace" id="command">
        <Topbar title="Command" modeLabel="Offline snapshot" modeClass="offline" />
        <SystemDeck snapshot={snapshot} />
        <div className="command-content">
          <div className="command-lead-grid"><FeaturedCase snapshot={snapshot} /><CaptureSchedule snapshot={snapshot} /></div>
          <div className="command-evidence-grid"><RecentCases snapshot={snapshot} /><div className="command-side-stack"><StudyPanel snapshot={snapshot} /><CommandProof snapshot={snapshot} /></div></div>
        </div>
        <MobileNavigation active="command" />
      </main>
    </div>
  );
}

function CommandLoading() {
  return <main className="load-screen"><BrandMark /><span className="load-kicker">Samaritan / Command</span><h1>Assembling the evidence desk</h1><div className="load-line"><i /></div><p>Revalidating configured fixtures, offline ledger state, and the captured replay before anything is shown.</p></main>;
}

function CommandError({ retry }: { retry: () => void }) {
  return <main className="load-screen error-screen"><span className="error-mark"><Icon name="shield" /></span><span className="load-kicker">Fail-closed boundary</span><h1>Command evidence unavailable</h1><p>A fixture or evidence identity could not be verified. Samaritan will not substitute stale or fabricated artifact state.</p><button type="button" onClick={retry}>Retry offline load</button></main>;
}

export function CommandApp() {
  const [snapshot, setSnapshot] = useState<CommandSnapshot | null>(null);
  const [failure, setFailure] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setFailure(false);
    loadCommand(controller.signal)
      .then((nextSnapshot) => startTransition(() => setSnapshot(nextSnapshot)))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setFailure(true);
      });
    return () => controller.abort();
  }, [attempt]);

  if (failure) return <CommandError retry={() => { setSnapshot(null); setAttempt((value) => value + 1); }} />;
  if (!snapshot) return <CommandLoading />;
  return <CommandView snapshot={snapshot} />;
}
