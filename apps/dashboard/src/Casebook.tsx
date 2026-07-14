import { startTransition, useDeferredValue, useEffect, useState } from "react";
import type { CasebookCaseSummary, CasebookSnapshot } from "../../../src/dash/public-contract";
import { loadCasebook } from "./api";
import { BrandMark, Icon, MobileNavigation, Navigation, Topbar } from "./Shell";

type Filters = {
  fixture: string;
  market: string;
  detector: string;
  disposition: string;
  outcome: string;
  lane: string;
  source: string;
  date: string;
};

const emptyFilters: Filters = {
  fixture: "",
  market: "",
  detector: "",
  disposition: "",
  outcome: "",
  lane: "",
  source: "",
  date: ""
};

function percentage(value: number, digits = 2) {
  return `${(value * 100).toFixed(digits)}%`;
}

function points(value: number) {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}pp`;
}

function movementBps(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toLocaleString("en-US")} bps`;
}

function compactHash(value: string) {
  return `${value.slice(0, 12)}…${value.slice(-8)}`;
}

function caseDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short"
  }).format(new Date(value));
}

function SelectFilter({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="casebook-filter-select">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">All</option>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
      <Icon name="chevron" />
    </label>
  );
}

function CasebookHero({ snapshot }: { snapshot: CasebookSnapshot }) {
  return (
    <section className="casebook-hero reveal r1" aria-labelledby="casebook-heading">
      <div className="casebook-hero-copy">
        <span className="casebook-kicker"><i />Append-only decision record</span>
        <h2 id="casebook-heading">Every decision.<br /><em>Especially the pass.</em></h2>
        <p>Inspect what Samaritan saw, why it refused the opportunity, and the proof that no money moved. Unfavorable and incomplete cases stay visible by default.</p>
      </div>
      <div className="casebook-stat-deck" aria-label="Casebook totals">
        <div className="casebook-primary-stat"><span>Verified record</span><b>{snapshot.statistics.totalCases.toString().padStart(2, "0")}</b><small>complete case</small></div>
        <div><span>No trade</span><b>{snapshot.statistics.noTradeCases}</b><small>capital-preserving pass</small></div>
        <div><span>Executed</span><b>{snapshot.statistics.executedCases}</b><small>no orders constructed</small></div>
        <div><span>Capital moved</span><b>$0.00</b><small>paper observer state</small></div>
        <div className="casebook-verified-stat"><Icon name="proof" /><span><b>100% verified</b><small>Replay identity parity</small></span></div>
      </div>
    </section>
  );
}

function CaseFilters({ snapshot, search, onSearch, filters, onFilter, onClear }: {
  snapshot: CasebookSnapshot;
  search: string;
  onSearch: (value: string) => void;
  filters: Filters;
  onFilter: (key: keyof Filters, value: string) => void;
  onClear: () => void;
}) {
  const dateOption = snapshot.cases[0]?.occurredAt.slice(0, 10) ?? "";
  const hasFilters = Boolean(search || Object.values(filters).some(Boolean));
  return (
    <section className="casebook-filters surface reveal r2" aria-label="Casebook filters">
      <label className="casebook-search">
        <Icon name="case" />
        <span>Search cases</span>
        <input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Case, fixture, market, reason…" />
        <kbd>⌘ K</kbd>
      </label>
      <div className="casebook-filter-grid">
        <SelectFilter label="Fixture" value={filters.fixture} options={snapshot.filterOptions.fixtures} onChange={(value) => onFilter("fixture", value)} />
        <SelectFilter label="Market" value={filters.market} options={snapshot.filterOptions.marketFamilies} onChange={(value) => onFilter("market", value)} />
        <SelectFilter label="Detector" value={filters.detector} options={snapshot.filterOptions.detectors} onChange={(value) => onFilter("detector", value)} />
        <SelectFilter label="Disposition" value={filters.disposition} options={snapshot.filterOptions.dispositions} onChange={(value) => onFilter("disposition", value)} />
        <SelectFilter label="Outcome" value={filters.outcome} options={snapshot.filterOptions.executionOutcomes} onChange={(value) => onFilter("outcome", value)} />
        <SelectFilter label="Lane" value={filters.lane} options={snapshot.filterOptions.evidenceLanes} onChange={(value) => onFilter("lane", value)} />
        <SelectFilter label="Source" value={filters.source} options={snapshot.filterOptions.sources} onChange={(value) => onFilter("source", value)} />
        <SelectFilter label="Date" value={filters.date} options={dateOption ? [dateOption] : []} onChange={(value) => onFilter("date", value)} />
      </div>
      <button className="casebook-clear" type="button" disabled={!hasFilters} onClick={onClear}>Clear filters</button>
    </section>
  );
}

function CaseIndex({ cases, total, nextEvidence }: {
  cases: CasebookCaseSummary[];
  total: number;
  nextEvidence: CasebookSnapshot["nextEvidence"];
}) {
  return (
    <aside className="casebook-index surface reveal r3" aria-labelledby="case-index-title">
      <header className="casebook-panel-head"><div><span>Case index</span><h2 id="case-index-title">Decision history</h2></div><em>{cases.length} of {total}</em></header>
      {cases.length > 0 ? cases.map((item) => (
        <article className="casebook-index-row selected" key={item.caseId} aria-label={`${item.caseId} ${item.fixtureLabel}`}>
          <div className="casebook-index-time"><time dateTime={item.occurredAt}>{caseDate(item.occurredAt)}</time><span><i />{item.verificationStatus}</span></div>
          <div className="casebook-index-match"><span className="casebook-pair"><i className="command-crest esp">{item.homeCode}</i><i className="command-crest bel">{item.awayCode}</i></span><span><b>{item.fixtureLabel}</b><small>{item.marketLabel}</small></span></div>
          <div className="casebook-index-tags"><span>{item.detector}</span><span>{item.evidenceLane}</span></div>
          <div className="casebook-index-outcome"><span><Icon name="minus" /></span><span><b>{item.disposition}</b><small>{item.reason}</small></span><Icon name="arrow" /></div>
        </article>
      )) : (
        <div className="casebook-no-results"><span><Icon name="case" /></span><b>No verified case matches</b><small>Clear one or more filters. Casebook will not fabricate a result.</small></div>
      )}
      <div className="casebook-index-foot"><Icon name="clock" /><span><b>{nextEvidence.label}</b><small>{nextEvidence.detail}</small></span></div>
    </aside>
  );
}

function DecisionRail({ lifecycle }: { lifecycle: CasebookSnapshot["selectedCase"]["lifecycle"] }) {
  return (
    <section className="casebook-decision-rail" aria-labelledby="decision-rail-title">
      <header className="casebook-section-head"><div><span>Lifecycle audit</span><h3 id="decision-rail-title">Decision rail</h3></div><span className="casebook-final-state"><Icon name="shield" />No trade</span></header>
      <div className="casebook-rail-stages">
        {lifecycle.map((stage, index) => (
          <div className={`casebook-rail-stage ${stage.status}`} key={stage.id}>
            <span className="rail-index">{String(index + 1).padStart(2, "0")}</span>
            <i><Icon name={stage.status === "locked" ? "lock" : "check"} /></i>
            <span><b>{stage.label}</b><small>{stage.detail}</small></span>
            <em>{stage.timingLabel}</em>
          </div>
        ))}
      </div>
    </section>
  );
}

function EvidenceReadout({ selected }: { selected: CasebookSnapshot["selectedCase"] }) {
  const readout = selected.evidenceReadout;
  return (
    <section className="casebook-readout" aria-labelledby="market-readout-title">
      <header className="casebook-section-head"><div><span>Executable market evidence</span><h3 id="market-readout-title">What Samaritan actually saw</h3></div><span className="casebook-move-label"><i />Moved first</span></header>
      <div className="casebook-readout-grid">
        <div><span>TXLine movement</span><b>{movementBps(readout.consensusMoveFromBaselineBps)}</b><small>25-bps bucket · level withheld</small></div>
        <div><span>Best bid</span><b>{percentage(readout.bestBid)}</b><small>Executable book</small></div>
        <div><span>Best ask</span><b>{percentage(readout.bestAsk)}</b><small>Executable entry</small></div>
        <div><span>Spread</span><b>{points(readout.spread)}</b><small>At signal observation</small></div>
        <div className="consensus-move"><span>Public-data boundary</span><b>Relative only</b><small>No exact TXLine level or series</small></div>
        <div className="pre-move"><span>Pre-trigger market move</span><b>{movementBps(readout.preTriggerMarketMoveBps)}</b><small>Before TXLine first seen</small></div>
      </div>
      <div className="casebook-market-verdict"><span><Icon name="pulse" /></span><span><small>Timing conclusion</small><b>{readout.movementConclusion}</b></span><p>The public book was already repriced. The timing sequence did not support a tradeable stale quote.</p></div>
    </section>
  );
}

function AnalysisBoundary({ selected }: { selected: CasebookSnapshot["selectedCase"] }) {
  return (
    <div className="casebook-analysis-grid">
      <section className="casebook-analysis-card">
        <span className="analysis-icon"><Icon name="spark" /></span>
        <div><span>Analyst boundary</span><h3>Thesis not requested</h3><p>{selected.analysis.thesisReason}</p><small><b>Invalidation:</b> {selected.analysis.invalidation}</small></div>
      </section>
      <section className="casebook-analysis-card execution">
        <span className="analysis-icon"><Icon name="lock" /></span>
        <div><span>Execution boundary</span><h3>$0.00 total cost</h3><p>{selected.analysis.costReason}</p><small><b>{selected.decision.ordersPlaced}</b> orders · wallet untouched · gate closed</small></div>
      </section>
    </div>
  );
}

function EvidenceSequence({ selected }: { selected: CasebookSnapshot["selectedCase"] }) {
  return (
    <section className="casebook-evidence-sequence" aria-labelledby="case-evidence-title">
      <header className="casebook-section-head"><div><span>Derived observation sequence</span><h3 id="case-evidence-title">Evidence ledger</h3></div><span>{selected.evidence.length} observations</span></header>
      <div className="casebook-evidence-head"><span>Moment</span><span>Source</span><span>Observation</span><span>Best ask</span><span>Assessment</span></div>
      {selected.evidence.map((row) => (
        <div className="casebook-evidence-row" key={row.replayStateId}>
          <span><b>{row.offsetLabel}</b><small>{row.observedAt.slice(11, 23)} UTC</small></span>
          <span><i className={row.source.toLowerCase()} />{row.source}</span>
          <span>{row.observation}</span>
          <span><b>{percentage(row.bestAsk)}</b></span>
          <span className={row.assessment === "No trade" ? "no-trade" : ""}>{row.assessment}</span>
        </div>
      ))}
    </section>
  );
}

function CaseDetail({ snapshot }: { snapshot: CasebookSnapshot }) {
  const selected = snapshot.selectedCase;
  return (
    <article className="casebook-detail surface reveal r4" aria-labelledby="selected-case-title">
      <header className="casebook-detail-masthead">
        <div className="casebook-detail-id"><span>Selected case</span><b>{selected.summary.caseId}</b><small>{caseDate(selected.summary.occurredAt)}</small></div>
        <div className="casebook-detail-match">
          <span><i className="command-crest esp">ESP</i><b>Spain</b></span>
          <em><small>{selected.match.clockLabel}</small><strong>{selected.match.scoreAtCursor.home}–{selected.match.scoreAtCursor.away}</strong><i>first goal seen</i></em>
          <span className="away"><b>Belgium</b><i className="command-crest bel">BEL</i></span>
        </div>
        <div className="casebook-detail-verdict"><span><Icon name="shield" /></span><span><small>Authoritative disposition</small><h2 id="selected-case-title">Market moved before signal.</h2><p>{selected.decision.explanation}</p></span></div>
        <a className="casebook-matchroom-link" href="/matchroom"><Icon name="play" /><span>Open full Matchroom replay</span><Icon name="arrow" /></a>
      </header>
      <DecisionRail lifecycle={selected.lifecycle} />
      <EvidenceReadout selected={selected} />
      <AnalysisBoundary selected={selected} />
      <EvidenceSequence selected={selected} />
      <footer className="casebook-proof-line">
        <span className="casebook-proof-status"><Icon name="proof" /><span><b>Replay identity verified</b><small>{selected.proof.canonicalEvents.toLocaleString("en-US")} canonical events</small></span></span>
        <span><small>Identity hash</small><code title={selected.proof.identityHash}>{compactHash(selected.proof.identityHash)}</code></span>
        <span><small>Replay journal head</small><code title={selected.proof.headHash}>{compactHash(selected.proof.headHash)}</code></span>
        <span className="casebook-policy"><Icon name="lock" />Derived evidence only</span>
      </footer>
    </article>
  );
}

function matchesFilters(item: CasebookCaseSummary, search: string, filters: Filters) {
  const haystack = [item.caseId, item.fixtureLabel, item.marketLabel, item.detector, item.reason, item.disposition].join(" ").toLowerCase();
  return (!search || haystack.includes(search.toLowerCase())) &&
    (!filters.fixture || item.fixtureLabel === filters.fixture) &&
    (!filters.market || item.marketFamily === filters.market) &&
    (!filters.detector || item.detector === filters.detector) &&
    (!filters.disposition || item.disposition === filters.disposition) &&
    (!filters.outcome || item.executionOutcome === filters.outcome) &&
    (!filters.lane || item.evidenceLane === filters.lane) &&
    (!filters.source || item.source === filters.source) &&
    (!filters.date || item.occurredAt.startsWith(filters.date));
}

function CasebookView({ snapshot }: { snapshot: CasebookSnapshot }) {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const visibleCases = snapshot.cases.filter((item) => matchesFilters(item, deferredSearch, filters));
  const updateFilter = (key: keyof Filters, value: string) => setFilters((current) => ({ ...current, [key]: value }));
  const clear = () => { setSearch(""); setFilters(emptyFilters); };
  return (
    <div className="app-shell casebook-shell">
      <Navigation active="casebook" caseCount={snapshot.statistics.totalCases} />
      <main className="workspace" id="casebook">
        <Topbar title="Casebook" modeLabel="Offline artifact" modeClass="offline" />
        <div className="casebook-content">
          <CasebookHero snapshot={snapshot} />
          <CaseFilters snapshot={snapshot} search={search} onSearch={setSearch} filters={filters} onFilter={updateFilter} onClear={clear} />
          <div className="casebook-workbench">
            <CaseIndex cases={visibleCases} total={snapshot.cases.length} nextEvidence={snapshot.nextEvidence} />
            {visibleCases.length > 0 ? <CaseDetail snapshot={snapshot} /> : <section className="casebook-detail-empty surface"><span><Icon name="case" /></span><h2>No verified case selected</h2><p>The current filters exclude every recorded case. Clear filters to reopen the complete Spain–Belgium refusal record.</p><button type="button" onClick={clear}>Clear all filters</button></section>}
          </div>
        </div>
        <MobileNavigation active="casebook" />
      </main>
    </div>
  );
}

function CasebookLoading() {
  return <main className="load-screen"><BrandMark /><span className="load-kicker">Samaritan / Casebook</span><h1>Verifying the decision record</h1><div className="load-line"><i /></div><p>Rebuilding the public case index from replay proof and append-only decision evidence.</p></main>;
}

function CasebookError({ retry }: { retry: () => void }) {
  return <main className="load-screen error-screen"><span className="error-mark"><Icon name="shield" /></span><span className="load-kicker">Fail-closed boundary</span><h1>Casebook evidence unavailable</h1><p>The verified replay record changed or could not be reconstructed. Samaritan will not display a partial or fabricated case.</p><button type="button" onClick={retry}>Retry verified load</button></main>;
}

export function CasebookApp() {
  const [snapshot, setSnapshot] = useState<CasebookSnapshot | null>(null);
  const [failure, setFailure] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setFailure(false);
    loadCasebook(controller.signal)
      .then((nextSnapshot) => startTransition(() => setSnapshot(nextSnapshot)))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setFailure(true);
      });
    return () => controller.abort();
  }, [attempt]);

  if (failure) return <CasebookError retry={() => { setSnapshot(null); setAttempt((value) => value + 1); }} />;
  if (!snapshot) return <CasebookLoading />;
  return <CasebookView snapshot={snapshot} />;
}
