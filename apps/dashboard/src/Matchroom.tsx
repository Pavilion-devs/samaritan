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
import { BrandMark, EditorialNavigation, Icon } from "./Shell";

const replayOrder: ReplayStepId[] = ["pre", "goal", "post"];
const chartFrame = { left: 48, right: 610, top: 21, bottom: 240 };
const chartMinimum = 0.15;
const chartMaximum = 0.3;

function percent(value: number, digits = 2) {
  return `${(value * 100).toFixed(digits)}%`;
}

function movementBps(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toLocaleString("en-US")} bps`;
}

function points(value: number) {
  return `${(value * 100).toFixed(2)}pp spread`;
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
  return `${value.slice(0, 14)}…${value.slice(-7)}`;
}

function formatDuration(ms: number) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(3)}s` : `${ms}ms`;
}

function chartX(offset: number, minimum: number, maximum: number) {
  return chartFrame.left + ((offset - minimum) / (maximum - minimum)) * (chartFrame.right - chartFrame.left);
}

function chartY(probability: number) {
  return chartFrame.top + ((chartMaximum - probability) / (chartMaximum - chartMinimum)) * (chartFrame.bottom - chartFrame.top);
}

function linePath(pointsToDraw: PublicBookPoint[], value: (point: PublicBookPoint) => number, minimum: number, maximum: number) {
  return pointsToDraw
    .map((point, index) => `${index === 0 ? "M" : "L"}${chartX(point.offsetMs, minimum, maximum).toFixed(1)} ${chartY(value(point)).toFixed(1)}`)
    .join(" ");
}

function chartSegments(snapshot: MatchroomSnapshot) {
  const pointsToDraw = snapshot.replay.chart;
  if (snapshot.replay.availabilityGaps.length === 0) return [pointsToDraw];
  const firstSeen = Date.parse(snapshot.replay.firstSeenAt);
  const gaps = snapshot.replay.availabilityGaps.map((gap) => ({
    start: Date.parse(gap.startedAt) - firstSeen,
    end: Date.parse(gap.endedAt) - firstSeen
  }));
  const segments: PublicBookPoint[][] = [];
  let current: PublicBookPoint[] = [];
  for (const point of pointsToDraw) {
    const previous = current.at(-1);
    if (previous && gaps.some((gap) => previous.offsetMs <= gap.end && point.offsetMs >= gap.start)) {
      if (current.length > 1) segments.push(current);
      current = [];
    }
    current.push(point);
  }
  if (current.length > 1) segments.push(current);
  return segments;
}

function MatchMasthead({ snapshot }: { snapshot: MatchroomSnapshot }) {
  return (
    <section className="editorial-match-masthead" aria-labelledby="editorial-fixture-title">
      <div className="editorial-match-context">
        <span><i aria-hidden="true" />Captured replay · retrospective</span>
        <span>{snapshot.match.competition} · {snapshot.match.stage}</span>
        <span>Original match · {originalDate(snapshot.match.originalMatchDate)}</span>
      </div>
      <div className="editorial-scoreline">
        <div className="editorial-team editorial-team-home">
          <span className="editorial-team-code">{snapshot.match.home.code}</span>
          <span><b>{snapshot.match.home.name}</b><small>Home</small></span>
        </div>
        <div className="editorial-score" id="editorial-fixture-title">
          <time>{snapshot.match.clockLabel}</time>
          <span><b>{snapshot.match.scoreAtCursor.home}</b><i>—</i><b>{snapshot.match.scoreAtCursor.away}</b></span>
          <small>Goal {snapshot.match.goalOrdinal} first seen</small>
        </div>
        <div className="editorial-team editorial-team-away">
          <span><b>{snapshot.match.away.name}</b><small>Away</small></span>
          <span className="editorial-team-code">{snapshot.match.away.code}</span>
        </div>
      </div>
      <div className="editorial-market-context">
        <span><small>Exact market</small><b>{snapshot.market.label}</b></span>
        <span><small>Period</small><b>{snapshot.market.period}</b></span>
        <span><small>Lane</small><b>Research only</b></span>
      </div>
    </section>
  );
}

function ProbabilityChart({ snapshot, state }: { snapshot: MatchroomSnapshot; state: ReplayState }) {
  const minimum = Math.min(...snapshot.replay.chart.map((point) => point.offsetMs));
  const maximum = Math.max(...snapshot.replay.chart.map((point) => point.offsetMs));
  const segments = chartSegments(snapshot);
  const cursorX = chartX(state.offsetMs, minimum, maximum);
  const goalX = chartX(0, minimum, maximum);
  const ticks = [
    { offset: minimum, label: "T−5s" },
    { offset: 0, label: "Goal" },
    { offset: 5000, label: "+5s" },
    { offset: 15000, label: "+15s" },
    { offset: maximum, label: "+30s" }
  ];

  return (
    <figure className="editorial-probability-chart">
      <svg viewBox="0 0 640 284" role="img" aria-labelledby="editorial-chart-title editorial-chart-description">
        <title id="editorial-chart-title">Public {snapshot.market.outcome} order book around goal {snapshot.match.goalOrdinal}</title>
        <desc id="editorial-chart-description">The public executable bid and ask repriced before the goal reached Samaritan. Exact TXLine probability levels are withheld.</desc>
        <defs>
          <linearGradient id="editorial-spread-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#086cf3" stopOpacity=".16" />
            <stop offset="1" stopColor="#086cf3" stopOpacity=".025" />
          </linearGradient>
        </defs>
        <g className="editorial-chart-grid" aria-hidden="true">
          {[0.3, 0.27, 0.24, 0.21, 0.18, 0.15].map((value) => (
            <g key={value}>
              <line x1={chartFrame.left} y1={chartY(value)} x2={chartFrame.right} y2={chartY(value)} />
              <text x="2" y={chartY(value) + 4}>{Math.round(value * 100)}%</text>
            </g>
          ))}
        </g>
        {segments.map((segment, index) => {
          const ask = linePath(segment, (point) => point.bestAsk, minimum, maximum);
          const bidReverse = [...segment]
            .reverse()
            .map((point) => `L${chartX(point.offsetMs, minimum, maximum).toFixed(1)} ${chartY(point.bestBid).toFixed(1)}`)
            .join(" ");
          return <path className="editorial-spread-area" d={`${ask} ${bidReverse} Z`} key={`area-${index}`} />;
        })}
        {segments.map((segment, index) => (
          <path className="editorial-bid-path" d={linePath(segment, (point) => point.bestBid, minimum, maximum)} key={`bid-${index}`} />
        ))}
        {segments.map((segment, index) => (
          <path className="editorial-ask-path" d={linePath(segment, (point) => point.bestAsk, minimum, maximum)} key={`ask-${index}`} />
        ))}
        <g className="editorial-goal-marker" aria-hidden="true">
          <line x1={goalX} y1="14" x2={goalX} y2={chartFrame.bottom} />
          <rect x={goalX - 35} y="7" width="70" height="21" rx="10.5" />
          <text x={goalX} y="21" textAnchor="middle">GOAL</text>
        </g>
        <g className="editorial-chart-cursor" transform={`translate(${cursorX} 0)`} aria-hidden="true">
          <line x1="0" y1="31" x2="0" y2={chartFrame.bottom} />
          <circle className="editorial-bid-dot" cy={chartY(state.bestBid)} r="4.5" />
          <circle className="editorial-ask-dot" cy={chartY(state.bestAsk)} r="5.5" />
        </g>
        <g className="editorial-chart-axis" aria-hidden="true">
          {ticks.map((tick) => <text x={chartX(tick.offset, minimum, maximum)} y="272" textAnchor="middle" key={tick.label}>{tick.label}</text>)}
        </g>
      </svg>
      <figcaption><span>{utcTime(state.observedAt)}</span><span>Derived summaries only · feed gaps remain visible</span></figcaption>
    </figure>
  );
}

function ProbabilityPanel({
  snapshot,
  state,
  activeId,
  playing,
  onSelect,
  onTogglePlay
}: {
  snapshot: MatchroomSnapshot;
  state: ReplayState;
  activeId: ReplayStepId;
  playing: boolean;
  onSelect: (id: ReplayStepId) => void;
  onTogglePlay: () => void;
}) {
  return (
    <section className="editorial-probability-panel" aria-labelledby="editorial-probability-title">
      <header className="editorial-panel-heading">
        <span>Licence-safe market evidence</span>
        <div className="editorial-chart-legend" aria-label="Chart legend"><span><i className="bid" />Best bid</span><span><i className="ask" />Best ask</span></div>
      </header>
      <h1 id="editorial-probability-title">The market moved before the signal.</h1>
      <p className="editorial-panel-intro">A verified replay of the public Draw book around Spain’s first goal. The executable market had already repriced before TXLine delivered the event.</p>
      <div className="editorial-replay-metrics" aria-live="polite">
        <span><small>TXLine movement</small><b>{movementBps(state.consensusMoveFromBaselineBps)}</b><em>25-bps bucket</em></span>
        <span><small>Executable bid / ask</small><b>{percent(state.bestBid)} / {percent(state.bestAsk)}</b><em>{points(state.spread)}</em></span>
        <span><small>Pre-trigger move</small><b>{movementBps(snapshot.replay.preTriggerMarketMoveBps)}</b><em>Public market</em></span>
      </div>
      <div className="editorial-replay-conclusion" aria-live="polite">
        <span><Icon name="minus" /></span>
        <p><b>{state.conclusionTitle}</b><small>{state.conclusionBody}</small></p>
        <em>Retrospective pass</em>
      </div>
      <ProbabilityChart snapshot={snapshot} state={state} />
      <div className="editorial-replay-controls">
        <button className="editorial-play-button" type="button" aria-pressed={playing} onClick={onTogglePlay}>
          <Icon name={playing ? "pause" : "play"} />
          {playing ? "Pause replay" : "Play replay"}
        </button>
        <div className="editorial-replay-steps" role="group" aria-label="Replay state">
          {snapshot.replay.states.map((item) => (
            <button
              className={item.id === activeId ? "active" : undefined}
              type="button"
              aria-pressed={item.id === activeId}
              onClick={() => onSelect(item.id)}
              key={item.id}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function DecisionRail({ snapshot, state }: { snapshot: MatchroomSnapshot; state: ReplayState }) {
  return (
    <aside className="editorial-decision-rail" aria-labelledby="editorial-decision-title">
      <header className="editorial-panel-heading"><span>Decision rail</span><em>Execution not entered</em></header>
      <div className="editorial-decision-verdict">
        <span><Icon name="proof" /></span>
        <small>Feasibility verdict</small>
        <h2 id="editorial-decision-title">{snapshot.decision.label}</h2>
        <p>{state.decisionExplanation}</p>
      </div>
      <div className="editorial-primary-reason">
        <small>Primary reason</small>
        <b>{snapshot.decision.primaryReason}</b>
        <span>Pre-trigger repricing · {movementBps(snapshot.replay.preTriggerMarketMoveBps)}</span>
      </div>
      <ol className="editorial-decision-stages">
        {snapshot.decision.stages.map((stage) => (
          <li className={stage.status} key={stage.id}>
            <span><Icon name={stage.status === "complete" ? "check" : stage.status === "passed" ? "minus" : "lock"} /></span>
            <span><b>{stage.label}</b><small>{stage.detail}</small></span>
            <time>{stage.timingLabel}</time>
          </li>
        ))}
      </ol>
      <div className="editorial-runtime-boundary">
        <span><Icon name="shield" /></span>
        <span><b>Real money disabled</b><small>Paper-only bounty build · no order credential connected</small></span>
      </div>
    </aside>
  );
}

function EvidencePanel({ snapshot, activeId }: { snapshot: MatchroomSnapshot; activeId: ReplayStepId }) {
  const sourceMark = { Polymarket: "P", TXLine: "TX", Samaritan: "S" } as const;
  return (
    <section className="editorial-match-evidence" aria-labelledby="editorial-evidence-title">
      <header className="editorial-evidence-heading">
        <span><small>Evidence sequence</small><h2 id="editorial-evidence-title">Three moments explain the decision.</h2></span>
        <code>Case · {snapshot.caseId}</code>
      </header>
      <div className="editorial-match-table" role="region" aria-label="Evidence around the goal" tabIndex={0}>
        <table>
          <thead><tr><th>Moment</th><th>Source</th><th>Captured observation</th><th>Executable ask</th><th>Assessment</th></tr></thead>
          <tbody>
            {snapshot.evidence.map((row) => (
              <tr className={row.replayStateId === activeId ? "active" : undefined} key={row.replayStateId}>
                <td><b>{row.offsetLabel}</b><small>{new Date(row.observedAt).toISOString().slice(11, 23)} UTC</small></td>
                <td><span className={`editorial-source-mark ${row.source.toLowerCase()}`}>{sourceMark[row.source]}</span>{row.source}</td>
                <td>{row.observation}</td>
                <td><b>{percent(row.bestAsk)}</b><small>Best ask</small></td>
                <td><em className={row.assessment === "Moved first" ? "watch" : "pass"}>{row.assessment}</em></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MatchProof({ snapshot }: { snapshot: MatchroomSnapshot }) {
  return (
    <aside className="editorial-match-proof" aria-labelledby="editorial-match-proof-title">
      <div>
        <span className="editorial-proof-pass"><Icon name="check" /></span>
        <span><small>Replay integrity</small><b id="editorial-match-proof-title">{snapshot.proof.identityParity ? "Identity parity passed" : "Identity parity failed"}</b></span>
      </div>
      <dl>
        <div><dt>Canonical events</dt><dd>{snapshot.proof.canonicalEvents.toLocaleString("en-US")}</dd></div>
        <div><dt>First seen</dt><dd>{snapshot.replay.firstSeenLatencyMs} ms</dd></div>
        <div><dt>Unavailable feed</dt><dd>{snapshot.proof.feedOutageCount} gaps · {formatDuration(snapshot.proof.feedDowntimeMs)}</dd></div>
        <div><dt>Orders placed</dt><dd>{snapshot.decision.ordersPlaced}</dd></div>
      </dl>
      <a href="/proof"><span><small>Replay identity</small><code title={snapshot.proof.identityHash}>{compactHash(snapshot.proof.identityHash)}</code></span><Icon name="arrow" /></a>
    </aside>
  );
}

function LoadingScreen() {
  return <main className="editorial-load"><BrandMark /><span>Samaritan / Live match</span><h1>Assembling the captured replay</h1><div><i /></div><p>The match appears only after its licence-safe evidence and replay identity have loaded.</p></main>;
}

function ErrorScreen({ retry }: { retry: () => void }) {
  return <main className="editorial-load editorial-load-error"><span><Icon name="shield" /></span><small>Fail-closed boundary</small><h1>Replay evidence unavailable</h1><p>Samaritan will not present a partial or fabricated match record.</p><button type="button" onClick={retry}>Retry captured replay</button></main>;
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
    <div className="editorial-matchroom">
      <div className="editorial-page editorial-match-page">
        <EditorialNavigation active="matchroom" modeLabel="Captured replay · no real orders" />
        <main>
          <MatchMasthead snapshot={snapshot} />
          <div className="editorial-match-analysis">
            <ProbabilityPanel
              snapshot={snapshot}
              state={state}
              activeId={activeId}
              playing={playing}
              onSelect={selectState}
              onTogglePlay={togglePlay}
            />
            <DecisionRail snapshot={snapshot} state={state} />
          </div>
          <EvidencePanel snapshot={snapshot} activeId={activeId} />
          <MatchProof snapshot={snapshot} />
        </main>
        <footer className="editorial-footer">
          <span>Derived evidence only · exact TXLine levels withheld</span>
          <span>Research replay · no capital or wallet access</span>
        </footer>
      </div>
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
