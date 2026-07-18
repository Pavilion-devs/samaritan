import { startTransition, useEffect, useMemo, useState } from "react";
import type { CommandFixture, CommandSnapshot } from "../../../src/dash/public-contract";
import { loadCommand, loadTxlinePulse, type TxlinePulse } from "./api";
import { BrandMark, EditorialNavigation, Icon } from "./Shell";

function percent(value: number, digits = 2) {
  return `${(value * 100).toFixed(digits)}%`;
}

function movementBps(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toLocaleString("en-US")} bps`;
}

function compactHash(value: string) {
  return `${value.slice(0, 10)}…${value.slice(-7)}`;
}

function utcTime(value: string) {
  return `${new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC"
  }).format(new Date(value))} UTC`;
}

function chooseFocusFixture(fixtures: CommandFixture[], nowMs: number) {
  const eligible = fixtures
    .filter((fixture) => fixture.identityStatus === "exact_match_confirmed" && fixture.phase !== "failed")
    .sort((left, right) => Date.parse(left.captureStartUtc) - Date.parse(right.captureStartUtc));
  return eligible.find((fixture) => nowMs >= Date.parse(fixture.captureStartUtc) && nowMs <= Date.parse(fixture.captureEndUtc))
    ?? eligible.find((fixture) => Date.parse(fixture.captureStartUtc) > nowMs)
    ?? eligible.at(-1)
    ?? fixtures[0];
}

function fixturePosture(fixture: CommandFixture, nowMs: number) {
  if (nowMs >= Date.parse(fixture.captureStartUtc) && nowMs <= Date.parse(fixture.captureEndUtc)) {
    return "Capture window active";
  }
  if (nowMs < Date.parse(fixture.captureStartUtc)) return "Capture window scheduled";
  return "Frozen capture window";
}

function useLivePulse() {
  const [pulse, setPulse] = useState<TxlinePulse | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setFailed(false);
    loadTxlinePulse(controller.signal)
      .then((next) => startTransition(() => setPulse(next)))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setFailed(true);
      });
    const refresh = window.setTimeout(() => setAttempt((value) => value + 1), 60_000);
    return () => {
      controller.abort();
      window.clearTimeout(refresh);
    };
  }, [attempt]);

  return { pulse, failed, refresh: () => setAttempt((value) => value + 1) };
}

function SignalPath() {
  return (
    <figure className="editorial-signal-path" aria-labelledby="editorial-path-title editorial-path-description">
      <figcaption>
        <span>Derived signal path</span>
        <b>no active edge</b>
      </figcaption>
      <svg viewBox="0 0 520 420" role="img">
        <title id="editorial-path-title">Match-to-market signal path</title>
        <desc id="editorial-path-description">An illustrative probability path reaches the watched match. No eligible trading signal is active.</desc>
        <line className="editorial-path-axis" x1="402" y1="38" x2="402" y2="382" />
        <path className="editorial-path-glow" d="M10 338 C108 340 158 320 220 270 C277 224 326 246 383 187 C424 144 456 109 492 64" />
        <path className="editorial-path-line" d="M10 338 C108 340 158 320 220 270 C277 224 326 246 383 187 C424 144 456 109 492 64" />
        <path className="editorial-path-future" d="M405 185 C450 158 486 166 510 218" />
        <circle className="editorial-path-point" cx="220" cy="270" r="8" />
        <circle className="editorial-ball-shell" cx="402" cy="183" r="49" />
        <polygon className="editorial-ball-mark" points="402,160 417,171 411,189 393,189 387,171" />
        <path className="editorial-ball-seams" d="M402 160 L398 142 M417 171 L438 166 M411 189 L423 207 M393 189 L380 207 M387 171 L366 165 M398 142 L381 133 M398 142 L420 134 M438 166 L443 187 M423 207 L402 220 M380 207 L361 190 M366 165 L381 133" />
      </svg>
      <div className="editorial-gate-note"><Icon name="shield" /><span>Risk gate closed</span></div>
    </figure>
  );
}

function DecisionPath({ fixture }: { fixture: CommandFixture }) {
  const steps = [
    { icon: "replay" as const, label: "Match", value: `${fixture.home.name} vs ${fixture.away.name}` },
    { icon: "chart" as const, label: "Market", value: "Paired observation" },
    { icon: "spark" as const, label: "Signal", value: "Awaiting eligible edge" },
    { icon: "shield" as const, label: "Decision", value: "No action" }
  ];
  return (
    <section className="editorial-decision-path" aria-label="Samaritan decision path">
      {steps.map((step) => (
        <div className="editorial-path-step" key={step.label}>
          <span className="editorial-step-icon"><Icon name={step.icon} /></span>
          <span><b>{step.label}</b><small>{step.value}</small></span>
        </div>
      ))}
    </section>
  );
}

function FeaturedDecision({ snapshot }: { snapshot: CommandSnapshot }) {
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const featured = snapshot.featuredCase;
  return (
    <section className="editorial-feature" aria-labelledby="editorial-feature-title">
      <div className="editorial-feature-heading">
        <span>Featured decision · {featured.home.name} {featured.scoreAtCursor.home}–{featured.scoreAtCursor.away} {featured.away.name} · {featured.clockLabel}</span>
        <em><Icon name="check" /> Correct decline</em>
      </div>
      <h2 id="editorial-feature-title">The market had already moved. Samaritan stood down.</h2>
      <p>The candidate arrived after the public executable book repriced. Samaritan preserved the observation and kept the execution runtime closed.</p>
      <div className="editorial-feature-metrics">
        <span><small>Market moved first</small><b>{movementBps(featured.preTriggerMarketMoveBps)}</b></span>
        <span><small>Executable ask</small><b>{percent(featured.bestAsk)}</b></span>
        <span><small>Orders placed</small><b>{featured.ordersPlaced}</b></span>
      </div>
      <div className="editorial-feature-actions">
        <button type="button" onClick={() => setEvidenceOpen((open) => !open)} aria-expanded={evidenceOpen} aria-controls="editorial-evidence">
          {evidenceOpen ? "Hide the evidence" : "View the evidence"}
        </button>
        <a href="/casebook">Open decisions <Icon name="arrow" /></a>
      </div>
      <div className={`editorial-evidence ${evidenceOpen ? "open" : ""}`} id="editorial-evidence">
        <h3>Decision trail</h3>
        <div className="editorial-evidence-table" role="region" aria-label="Featured decision evidence" tabIndex={0}>
          <table>
            <thead><tr><th>Stage</th><th>Observation</th><th>Result</th></tr></thead>
            <tbody>
              <tr><td>Candidate</td><td>TXLine movement entered the disclosed 25-bps bucket</td><td>Recorded</td></tr>
              <tr><td>Market check</td><td>Public {featured.marketOutcomeLabel} book had moved {movementBps(featured.preTriggerMarketMoveBps)}</td><td>Too late</td></tr>
              <tr><td>Runtime boundary</td><td>{featured.conclusion}</td><td>No trade</td></tr>
              <tr><td>Replay</td><td>{featured.canonicalEvents.toLocaleString("en-US")} canonical events</td><td>Verified</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function QuietProof({ snapshot }: { snapshot: CommandSnapshot }) {
  const ledgerValid = snapshot.proof.bountyLedgerValid && snapshot.proof.longRunLedgerValid;
  return (
    <aside className="editorial-proof" aria-labelledby="editorial-proof-title">
      <h3 id="editorial-proof-title">Trust, kept quiet.</h3>
      <p>The proof is present without competing with the decision.</p>
      <a href="/proof">
        <i aria-hidden="true" />
        <Icon name="replay" />
        <span><b>Replay verified</b><small>{snapshot.proof.canonicalEvents.toLocaleString("en-US")} canonical events</small></span>
      </a>
      <a href="/proof">
        <i aria-hidden="true" />
        <Icon name="lock" />
        <span><b>{ledgerValid ? "Ledger intact" : "Ledger check failed"}</b><small>Append-only decision trail</small></span>
      </a>
      <a href="/study">
        <i aria-hidden="true" />
        <Icon name="chart" />
        <span><b>V2 study · {snapshot.study.qualifyingCounts.filledMatches}/{snapshot.study.requiredFilledMatches} matches</b><small>{snapshot.study.qualifyingCounts.fills}/{snapshot.study.requiredFills} qualifying fills</small></span>
      </a>
      <a href="/proof">
        <i aria-hidden="true" />
        <Icon name="shield" />
        <span><b>Money gate closed</b><small>Observer build · read only</small></span>
      </a>
      <code title={snapshot.proof.replayIdentityHash}>Replay {compactHash(snapshot.proof.replayIdentityHash)}</code>
    </aside>
  );
}

function CommandView({ snapshot }: { snapshot: CommandSnapshot }) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const { pulse, failed, refresh } = useLivePulse();
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const fixture = useMemo(() => chooseFocusFixture(snapshot.fixtureSchedule, nowMs), [snapshot.fixtureSchedule, nowMs]);
  if (!fixture) throw new Error("Command snapshot has no displayable fixture");
  const pulseConnected = !failed && pulse?.status === "connected";
  const pulseCopy = pulseConnected
    ? `TXLine mainnet · SL12${pulse.latencyMsRounded === null ? "" : ` · ≤ ${pulse.latencyMsRounded} ms`}`
    : "Live pulse unavailable · frozen evidence remains available";

  return (
    <div className="editorial-command">
      <div className="editorial-page">
        <EditorialNavigation active="command" modeLabel="Observer mode · no real orders" />
        <main>
          <section className="editorial-hero" aria-labelledby="editorial-hero-title">
            <div className="editorial-hero-copy">
              <span className="editorial-capture-state"><i aria-hidden="true" />{fixturePosture(fixture, nowMs)}</span>
              <h1 id="editorial-hero-title">Watching {fixture.home.name} vs {fixture.away.name}.</h1>
              <p>Samaritan follows the match, measures the market, and acts only when the evidence survives every risk gate.</p>
              <div className="editorial-watch-meta">
                <span><Icon name="pulse" /></span>
                <span><b>Kickoff · {utcTime(fixture.kickoffUtc)}</b><small>{pulseCopy} · exact event family confirmed</small></span>
                <button type="button" onClick={refresh} aria-label="Refresh TXLine connectivity">Refresh</button>
              </div>
            </div>
            <SignalPath />
          </section>
          <DecisionPath fixture={fixture} />
          <div className="editorial-content-grid">
            <FeaturedDecision snapshot={snapshot} />
            <QuietProof snapshot={snapshot} />
          </div>
        </main>
        <footer className="editorial-footer">
          <span>Derived evidence only · no raw feed or wallet access</span>
          <span>Deborah · participant and project owner</span>
        </footer>
      </div>
    </div>
  );
}

function CommandLoading() {
  return <main className="editorial-load"><BrandMark /><span>Samaritan / Overview</span><h1>Assembling the evidence view</h1><div><i /></div><p>Revalidating the frozen replay and public observer boundaries.</p></main>;
}

function CommandError({ retry }: { retry: () => void }) {
  return <main className="editorial-load editorial-load-error"><span><Icon name="shield" /></span><small>Fail-closed boundary</small><h1>Overview evidence unavailable</h1><p>Samaritan will not substitute stale or fabricated artifact state.</p><button type="button" onClick={retry}>Retry evidence load</button></main>;
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
