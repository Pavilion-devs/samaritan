import {
  startTransition,
  useEffect,
  useEffectEvent,
  useState
} from "react";
import type {
  MatchroomSnapshot,
  PublicBookPoint,
  ReplayState,
  ReplayStepId
} from "../../../src/dash/public-contract";
import { loadMatchroom } from "./api";
import { BrandMark, Icon, MobileNavigation, Navigation, ProvenanceBadge, Topbar } from "./Shell";

const replayOrder: ReplayStepId[] = ["pre", "goal", "post"];

function percent(value: number, digits = 2) {
  return `${(value * 100).toFixed(digits)}%`;
}

function points(value: number) {
  const amount = value * 100;
  return `${amount >= 0 ? "+" : ""}${amount.toFixed(2)}pp`;
}

function movementBps(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toLocaleString("en-US")} bps`;
}

function utcTime(value: string) {
  return `${new Date(value).toISOString().slice(11, 23)} UTC`;
}

function originalDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(`${value}T00:00:00Z`));
}

function compactHash(value: string) {
  return `${value.slice(0, 18)}…${value.slice(-7)}`;
}

function formatDuration(ms: number) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(3)}s` : `${ms}ms`;
}

function ContextBar({ snapshot }: { snapshot: MatchroomSnapshot }) {
  return (
    <section className="context-bar" aria-label="Match context and sections">
      <div className="fixture-select">
        <span className="cup-mark"><Icon name="cup" /></span>
        <span><small>{snapshot.match.competition} · {snapshot.match.stage}</small><b>{snapshot.match.home.name} vs {snapshot.match.away.name}</b></span>
        <Icon name="chevron" className="chevron" />
      </div>
      <nav className="view-tabs" aria-label="Matchroom sections">
        <a className="active" href="#overview" aria-current="page">Overview</a>
        <a href="#probability">Markets</a>
        <a href="#decision">Decision</a>
        <a href="#evidence">Evidence</a>
      </nav>
      <div className="original-date">
        <Icon name="case" />
        <span><small>Original match date</small><b>{originalDate(snapshot.match.originalMatchDate)}</b></span>
      </div>
    </section>
  );
}

function MatchMasthead({ snapshot }: { snapshot: MatchroomSnapshot }) {
  return (
    <section className="match-masthead surface reveal r1" aria-labelledby="fixture-heading">
      <div className="match-meta">
        <ProvenanceBadge tone="capture" label="Real capture · retrospective" />
        <span className="fixture-number">Fixture {snapshot.match.fixtureId}</span>
      </div>
      <div className="team home-team">
        <span className={`crest ${snapshot.match.home.code.toLowerCase()}`}>{snapshot.match.home.code}</span>
        <span><small>{snapshot.match.home.name}</small><b>{snapshot.match.home.code}</b></span>
      </div>
      <div className="score-block">
        <span className="clock">{snapshot.match.clockLabel}</span>
        <div><strong>{snapshot.match.scoreAtCursor.home}</strong><i>:</i><strong>{snapshot.match.scoreAtCursor.away}</strong></div>
        <small>Goal {snapshot.match.goalOrdinal} first seen</small>
      </div>
      <div className="team away-team">
        <span><small>{snapshot.match.away.name}</small><b>{snapshot.match.away.code}</b></span>
        <span className={`crest ${snapshot.match.away.code.toLowerCase()}`}>{snapshot.match.away.code}</span>
      </div>
      <div className="market-meta">
        <small>Exact market</small>
        <b>{snapshot.market.label}</b>
        <span>{snapshot.market.period} · research-only mapping</span>
      </div>
    </section>
  );
}

const chartFrame = { left: 62, right: 830, top: 27, bottom: 282 };
const chartMinimum = 0.15;
const chartMaximum = 0.3;

function chartX(offset: number, minimum: number, maximum: number) {
  return chartFrame.left + ((offset - minimum) / (maximum - minimum)) * (chartFrame.right - chartFrame.left);
}

function chartY(probability: number) {
  return chartFrame.top + ((chartMaximum - probability) / (chartMaximum - chartMinimum)) * (chartFrame.bottom - chartFrame.top);
}

function linePath(pointsToDraw: PublicBookPoint[], value: (point: PublicBookPoint) => number, minimum: number, maximum: number) {
  return pointsToDraw.map((point, index) => `${index === 0 ? "M" : "L"}${chartX(point.offsetMs, minimum, maximum).toFixed(1)} ${chartY(value(point)).toFixed(1)}`).join(" ");
}

function chartSegments(snapshot: MatchroomSnapshot) {
  const pointsToDraw = snapshot.replay.chart;
  if (snapshot.replay.availabilityGaps.length === 0) return [pointsToDraw];
  const firstSeen = Date.parse(snapshot.replay.firstSeenAt);
  const gapOffsets = snapshot.replay.availabilityGaps.map((gap) => ({
    start: Date.parse(gap.startedAt) - firstSeen,
    end: Date.parse(gap.endedAt) - firstSeen
  }));
  const segments: PublicBookPoint[][] = [];
  let current: PublicBookPoint[] = [];
  for (const point of pointsToDraw) {
    const previous = current.at(-1);
    if (previous && gapOffsets.some((gap) => previous.offsetMs <= gap.end && point.offsetMs >= gap.start)) {
      if (current.length > 1) segments.push(current);
      current = [];
    }
    current.push(point);
  }
  if (current.length > 1) segments.push(current);
  return segments;
}

function ProbabilityChart({ snapshot, state }: { snapshot: MatchroomSnapshot; state: ReplayState }) {
  const minimum = Math.min(...snapshot.replay.chart.map((point) => point.offsetMs));
  const maximum = Math.max(...snapshot.replay.chart.map((point) => point.offsetMs));
  const segments = chartSegments(snapshot);
  const cursorX = chartX(state.offsetMs, minimum, maximum);
  const goalX = chartX(0, minimum, maximum);

  return (
    <figure className="chart-wrap">
      <svg viewBox="0 0 860 320" role="img" aria-labelledby="chart-title chart-description">
        <title id="chart-title">Public {snapshot.market.outcome} order book around selected goal {snapshot.match.goalOrdinal}</title>
        <desc id="chart-description">The public executable bid and ask repriced before the goal reached Samaritan. Exact TXLine probability levels are withheld.</desc>
        <defs><linearGradient id="spread-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#8779d9" stopOpacity=".22" /><stop offset="1" stopColor="#8779d9" stopOpacity=".02" /></linearGradient></defs>
        <g className="chart-grid" aria-hidden="true">
          {[27, 78, 129, 180, 231, 282].map((y) => <line key={y} x1="62" y1={y} x2="830" y2={y} />)}
        </g>
        <g className="chart-axis" aria-hidden="true">
          {[30, 27, 24, 21, 18, 15].map((value, index) => <text key={value} x="9" y={32 + index * 51}>{value}%</text>)}
          <text x="62" y="311" textAnchor="middle">T−5s</text><text x={goalX} y="311" textAnchor="middle">Goal</text><text x={chartX(5000, minimum, maximum)} y="311" textAnchor="middle">+5s</text><text x={chartX(15000, minimum, maximum)} y="311" textAnchor="middle">+15s</text><text x={chartX(25000, minimum, maximum)} y="311" textAnchor="middle">+25s</text><text x="830" y="311" textAnchor="middle">+30s</text>
        </g>
        {segments.map((segment, index) => {
          const ask = linePath(segment, (point) => point.bestAsk, minimum, maximum);
          const bidReverse = [...segment].reverse().map((point) => `L${chartX(point.offsetMs, minimum, maximum).toFixed(1)} ${chartY(point.bestBid).toFixed(1)}`).join(" ");
          return <path key={`area-${index}`} className="spread-area" d={`${ask} ${bidReverse} Z`} />;
        })}
        {segments.map((segment, index) => <path key={`bid-${index}`} className="bid-path" d={linePath(segment, (point) => point.bestBid, minimum, maximum)} />)}
        {segments.map((segment, index) => <path key={`ask-${index}`} className="ask-path" d={linePath(segment, (point) => point.bestAsk, minimum, maximum)} />)}
        <g className="goal-event" aria-hidden="true"><line x1={goalX} y1="19" x2={goalX} y2="282" /><rect x={goalX - 41} y="8" width="82" height="26" rx="13" /><text x={goalX} y="25" textAnchor="middle">GOAL · {snapshot.match.clockLabel}</text></g>
        <g className="cursor" transform={`translate(${cursorX} 0)`} aria-hidden="true"><line x1="0" y1="40" x2="0" y2="282" /><circle className="bid-dot" cy={chartY(state.bestBid)} r="5" /><circle className="ask-dot" cy={chartY(state.bestAsk)} r="6" /></g>
      </svg>
      <figcaption><span>{utcTime(state.observedAt)}</span><span>Derived summaries only · unavailable feed intervals render as gaps</span></figcaption>
    </figure>
  );
}

function ProbabilityPanel({ snapshot, state, activeId, playing, onSelect, onTogglePlay }: {
  snapshot: MatchroomSnapshot;
  state: ReplayState;
  activeId: ReplayStepId;
  playing: boolean;
  onSelect: (id: ReplayStepId) => void;
  onTogglePlay: () => void;
}) {
  return (
    <section className="probability-panel surface reveal r2" id="probability" aria-labelledby="probability-title">
      <header className="panel-heading">
        <div><span>Licence-safe market evidence</span><h2 id="probability-title">Relative TXLine movement &amp; public book</h2></div>
        <div className="legend"><span><i className="legend-bid" />Best bid</span><span><i className="legend-ask" />Best ask</span><span><i className="legend-spread" />Bid–ask spread</span></div>
      </header>
      <div className="comparison-strip" aria-live="polite">
        <div><span>TXLine movement</span><strong>{movementBps(state.consensusMoveFromBaselineBps)}</strong><small>25-bps bucket from case baseline · absolute level withheld</small></div>
        <div><span>Executable bid / ask</span><strong><span>{(state.bestBid * 100).toFixed(2)}</span><i>/</i><span>{(state.bestAsk * 100).toFixed(2)}</span>%</strong><small>{points(state.spread)} measured spread</small></div>
        <div><span>Pre-trigger market move</span><strong>{movementBps(snapshot.replay.preTriggerMarketMoveBps)}</strong><small>Public executable market · no TXLine level disclosed</small></div>
      </div>
      <div className="plain-conclusion">
        <span className="conclusion-mark"><Icon name="minus" /></span>
        <p><strong>{state.conclusionTitle}</strong> <span>{state.conclusionBody}</span></p>
        <span className="discipline-chip">Retrospective pass</span>
      </div>
      <ProbabilityChart snapshot={snapshot} state={state} />
      <div className="replay-bar">
        <button className="play-button" type="button" aria-pressed={playing} onClick={onTogglePlay}>
          <Icon name={playing ? "pause" : "play"} />
          <span>{playing ? "Pause replay" : "Play replay"}</span>
        </button>
        <div className="replay-steps" role="group" aria-label="Replay state">
          {snapshot.replay.states.map((item) => <button key={item.id} className={item.id === activeId ? "active" : undefined} type="button" onClick={() => onSelect(item.id)}>{item.label}</button>)}
        </div>
        <span className="speed">1×</span>
      </div>
    </section>
  );
}

function DecisionRail({ snapshot, state }: { snapshot: MatchroomSnapshot; state: ReplayState }) {
  const executionLabel = snapshot.decision.ordersPlaced === 0 ? "Execution not entered" : `${snapshot.decision.ordersPlaced} orders placed`;
  return (
    <aside className="decision-rail surface reveal r3" id="decision" aria-labelledby="decision-title">
      <header className="panel-heading rail-heading"><div><span>Retrospective feasibility</span><h2 id="decision-title">Decision Rail</h2></div><ProvenanceBadge tone="capture" label={executionLabel} /></header>
      <div className="decision-outcome">
        <span className="outcome-icon"><Icon name="proof" /></span>
        <span>Feasibility verdict</span><strong>{snapshot.decision.label}</strong><p>{state.decisionExplanation}</p>
      </div>
      <div className="reason-block"><span>Primary reason</span><b>{snapshot.decision.primaryReason}</b><p>Pre-trigger {snapshot.market.outcome} repricing: <strong>{movementBps(snapshot.replay.preTriggerMarketMoveBps)}</strong></p></div>
      <ol className="decision-stages">
        {snapshot.decision.stages.map((stage) => (
          <li key={stage.id} className={stage.status}>
            <span className="stage-icon"><Icon name={stage.status === "complete" ? "check" : stage.status === "passed" ? "minus" : "shield"} /></span>
            <span><b>{stage.label}</b><small>{stage.detail}</small></span><time>{stage.timingLabel}</time>
          </li>
        ))}
      </ol>
      <div className="boundary-grid">
        <div><span>Execution runtime</span><b>Not entered</b></div>
        <div><span>Order result</span><b>Not applicable</b></div>
        <div><span>Wallet path</span><b>Unavailable to this research lane</b></div>
      </div>
      <div className="protective-gate"><span className="shield-lock"><Icon name="shield" /></span><span><b>Real money disabled in bounty build</b><small>Paper-only architecture · no order credential connected</small></span></div>
    </aside>
  );
}

function EvidencePanel({ snapshot, activeId }: { snapshot: MatchroomSnapshot; activeId: ReplayStepId }) {
  const sourceClass = { Polymarket: "poly", TXLine: "tx", Samaritan: "sam" } as const;
  const sourceMark = { Polymarket: "P", TXLine: "TX", Samaritan: "S" } as const;
  return (
    <section className="evidence-panel surface reveal r4" id="evidence" aria-labelledby="evidence-title">
      <header className="panel-heading"><div><span>Evidence provenance</span><h2 id="evidence-title">Sequence around the goal</h2></div><span className="case-id">Case · {snapshot.caseId}</span></header>
      <div className="evidence-table-wrap">
        <table className="evidence-table">
          <thead><tr><th>Moment</th><th>Source</th><th>Captured observation</th><th>Executable ask</th><th>Assessment</th></tr></thead>
          <tbody>
            {snapshot.evidence.map((row) => (
              <tr key={row.replayStateId} className={row.replayStateId === activeId ? "active" : undefined}>
                <td><time dateTime={row.observedAt}>{new Date(row.observedAt).toISOString().slice(11, 23)}</time><small>{row.offsetLabel}</small></td>
                <td><span className={`source ${sourceClass[row.source]}`}>{sourceMark[row.source]}</span>{row.source}</td>
                <td>{row.observation}</td>
                <td><b>{percent(row.bestAsk)}</b><small>Best ask</small></td>
                <td><span className={`assessment ${row.assessment === "Moved first" ? "watch" : "pass"}`}>{row.assessment}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ProofPanel({ snapshot }: { snapshot: MatchroomSnapshot }) {
  return (
    <aside className="proof-panel surface reveal r5" id="proof" aria-labelledby="proof-title">
      <header className="panel-heading"><div><span>Capture integrity</span><h2 id="proof-title">Offline replay integrity</h2></div><ProvenanceBadge tone="offline" label="Local check" /></header>
      <div className="proof-primary"><span className="proof-ring">{snapshot.proof.identityParity ? "PASS" : "FAIL"}</span><span><b>Replay identity parity</b><small>{snapshot.proof.identityParity ? "Replay matched twice" : "Verification failed"}</small></span></div>
      <dl className="proof-stats">
        <div><dt>Canonical events</dt><dd>{snapshot.proof.canonicalEvents.toLocaleString("en-US")}</dd></div>
        <div><dt>First-seen latency</dt><dd>{snapshot.replay.firstSeenLatencyMs} ms</dd></div>
        <div className="outage"><dt>Unavailable feed</dt><dd>{snapshot.proof.feedOutageCount} gaps · {formatDuration(snapshot.proof.feedDowntimeMs)}</dd></div>
      </dl>
      <div className="hash"><span>Replay identity hash</span><code title={snapshot.proof.identityHash}>{compactHash(snapshot.proof.identityHash)}</code></div>
      <div className="public-policy"><span>Public surface</span><b>Derived summaries only</b><small>No credentials, wallet controls, or raw feed redistribution</small></div>
    </aside>
  );
}

function LoadingScreen() {
  return <main className="load-screen"><BrandMark /><span className="load-kicker">Samaritan / Matchroom</span><h1>Loading captured replay</h1><div className="load-line"><i /></div><p>Assembling licence-safe derived evidence. The retrospective case is shown only after local replay checks pass.</p></main>;
}

function ErrorScreen({ retry }: { retry: () => void }) {
  return <main className="load-screen error-screen"><span className="error-mark"><Icon name="shield" /></span><span className="load-kicker">Fail-closed boundary</span><h1>Evidence unavailable</h1><p>The captured replay could not be checked, so Samaritan is not presenting partial or fabricated match evidence.</p><button type="button" onClick={retry}>Retry captured replay</button></main>;
}

function Matchroom({ snapshot }: { snapshot: MatchroomSnapshot }) {
  const [activeId, setActiveId] = useState<ReplayStepId>(snapshot.replay.activeStateId);
  const [playing, setPlaying] = useState(false);
  const state = snapshot.replay.states.find((item) => item.id === activeId) ?? snapshot.replay.states[1]!;

  const advanceReplay = useEffectEvent(() => {
    const currentIndex = replayOrder.indexOf(activeId);
    if (currentIndex >= replayOrder.length - 1) {
      setPlaying(false);
      return;
    }
    startTransition(() => setActiveId(replayOrder[currentIndex + 1]!));
  });

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(advanceReplay, 1400);
    return () => window.clearInterval(timer);
  }, [playing]);

  function selectState(id: ReplayStepId) {
    setPlaying(false);
    startTransition(() => setActiveId(id));
  }

  function togglePlay() {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (activeId === "post") setActiveId("pre");
    setPlaying(true);
  }

  return (
    <div className="app-shell">
      <Navigation active="matchroom" caseCount={snapshot.casebookCaseCount} />
      <main className="workspace" id="matchroom">
        <Topbar title="Matchroom" modeLabel="Retrospective replay" modeClass="replay" />
        <ContextBar snapshot={snapshot} />
        <div className="content" id="overview">
          <MatchMasthead snapshot={snapshot} />
          <div className="analysis-grid">
            <ProbabilityPanel snapshot={snapshot} state={state} activeId={activeId} playing={playing} onSelect={selectState} onTogglePlay={togglePlay} />
            <DecisionRail snapshot={snapshot} state={state} />
          </div>
          <div className="support-grid">
            <EvidencePanel snapshot={snapshot} activeId={activeId} />
            <ProofPanel snapshot={snapshot} />
          </div>
        </div>
        <MobileNavigation active="matchroom" />
      </main>
    </div>
  );
}

export function MatchroomApp() {
  const [snapshot, setSnapshot] = useState<MatchroomSnapshot | null>(null);
  const [failure, setFailure] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setFailure(false);
    loadMatchroom(controller.signal)
      .then((nextSnapshot) => startTransition(() => setSnapshot(nextSnapshot)))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setFailure(true);
      });
    return () => controller.abort();
  }, [attempt]);

  if (failure) return <ErrorScreen retry={() => { setSnapshot(null); setAttempt((value) => value + 1); }} />;
  if (!snapshot) return <LoadingScreen />;
  return <Matchroom snapshot={snapshot} />;
}
