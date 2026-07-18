import { startTransition, useDeferredValue, useEffect, useState } from "react";
import type { CasebookCaseSummary, CasebookSnapshot } from "../../../src/dash/public-contract";
import { loadCasebook } from "./api";
import { BrandMark, Icon, MobileNavigation, Navigation, ProvenanceBadge, Topbar } from "./Shell";

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
        <ProvenanceBadge tone="capture" label="Real capture · retrospective" />
        <h2 id="casebook-heading">Every measured observation.<br /><em>One honest exemplar.</em></h2>
        <p>The index contains all {snapshot.corpus.marketEventCases} goal×market observations reported by this one verified capture replay. The detail pane is a deterministic exemplar, not the whole corpus or a performance sample.</p>
      </div>
      <div className="casebook-stat-deck" aria-label="Casebook totals">
        <div className="casebook-primary-stat"><span>Goal×market observations</span><b>{snapshot.statistics.totalCases.toString().padStart(2, "0")}</b><small>{snapshot.corpus.goalEvents} goals · one captured fixture</small></div>
        <div><span>Moved before TXLine</span><b>{snapshot.corpus.movedBeforeTxlineCases}</b><small>pre-trigger repricing observed</small></div>
        <div><span>No material reprice</span><b>{snapshot.corpus.noMaterialRepriceCases}</b><small>inside the 30-second window</small></div>
        <div><span>Executed</span><b>{snapshot.statistics.executedCases}</b><small>operational execution not reached</small></div>
        <div><span>Execution runtime</span><b>Not entered</b><small>retrospective research only</small></div>
        <div className="casebook-verified-stat"><Icon name="proof" /><span><b>Full reported corpus projected</b><small>{snapshot.statistics.reconciledCases} observations internally reconciled · capture identity checked separately</small></span></div>
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
  const dateOptions = [...new Set(snapshot.cases.map((item) => item.occurredAt.slice(0, 10)))].sort();
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
        <SelectFilter label="Date" value={filters.date} options={dateOptions} onChange={(value) => onFilter("date", value)} />
      </div>
      <button className="casebook-clear" type="button" disabled={!hasFilters} onClick={onClear}>Clear filters</button>
    </section>
  );
}

function CaseIndex({ cases, total, nextEvidence, selectedCaseId }: {
  cases: CasebookCaseSummary[];
  total: number;
  nextEvidence: CasebookSnapshot["nextEvidence"];
  selectedCaseId: string;
}) {
  return (
    <aside className="casebook-index surface reveal r3" aria-labelledby="case-index-title">
      <header className="casebook-panel-head"><div><span>Complete captured corpus</span><h2 id="case-index-title">Goal×market observations</h2></div><em>{cases.length} of {total}</em></header>
      {cases.length > 0 ? cases.map((item) => (
        <article className={`casebook-index-row${item.caseId === selectedCaseId ? " selected" : ""}`} key={item.caseId} aria-label={`${item.caseId} ${item.fixtureLabel}`}>
          <div className="casebook-index-time"><time dateTime={item.occurredAt}>{caseDate(item.occurredAt)}</time><span><i />{item.selectedExemplar ? "Detail exemplar" : "Corpus row"}</span></div>
          <div className="casebook-index-match"><span className="casebook-pair"><i className={`command-crest ${item.homeCode.toLowerCase()}`}>{item.homeCode}</i><i className={`command-crest ${item.awayCode.toLowerCase()}`}>{item.awayCode}</i></span><span><b>{item.fixtureLabel}</b><small>{item.marketLabel}</small></span></div>
          <div className="casebook-index-tags"><span>{item.detector}</span><span>{item.evidenceLane}</span></div>
          <div className="casebook-index-outcome"><span><Icon name="minus" /></span><span><b>{item.disposition}</b><small>{item.reason}</small></span><Icon name="arrow" /></div>
        </article>
      )) : (
        <div className="casebook-no-results"><span><Icon name="case" /></span><b>No captured case matches</b><small>Clear one or more filters. Casebook will not fabricate a result.</small></div>
      )}
      <div className="casebook-index-foot"><Icon name="clock" /><span><b>{nextEvidence.label}</b><small>{nextEvidence.detail}</small></span></div>
    </aside>
  );
}

function DecisionRail({ selected }: { selected: CasebookSnapshot["selectedCase"] }) {
  const finalState = selected.decision.ordersPlaced === 0 ? "Execution not entered" : `${selected.decision.ordersPlaced} orders placed`;
  return (
    <section className="casebook-decision-rail" aria-labelledby="decision-rail-title">
      <header className="casebook-section-head"><div><span>Retrospective lifecycle</span><h3 id="decision-rail-title">Feasibility rail</h3></div><span className="casebook-final-state"><Icon name="shield" />{finalState}</span></header>
      <div className="casebook-rail-stages">
        {selected.lifecycle.map((stage, index) => (
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
      <header className="casebook-section-head"><div><span>Captured executable-book evidence</span><h3 id="market-readout-title">What the capture contained</h3></div><span className="casebook-move-label"><i />Moved first</span></header>
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
        <div><span>Analyst boundary</span><h3>No operational thesis requested</h3><p>Retrospective feasibility ended before the analyst stage; no Claude thesis ran for this captured case.</p><small><b>Invalidation:</b> {selected.analysis.invalidation}</small></div>
      </section>
      <section className="casebook-analysis-card execution">
        <span className="analysis-icon"><Icon name="lock" /></span>
        <div><span>Execution boundary</span><h3>Operational cost not applicable</h3><p>{selected.analysis.costReason}</p><small>Research-only path · execution and wallet layers were not entered</small></div>
      </section>
    </div>
  );
}

function EvidenceSequence({ selected }: { selected: CasebookSnapshot["selectedCase"] }) {
  return (
    <section className="casebook-evidence-sequence" aria-labelledby="case-evidence-title">
      <header className="casebook-section-head"><div><span>Derived captured sequence</span><h3 id="case-evidence-title">Captured evidence timeline</h3></div><span>{selected.evidence.length} observations</span></header>
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
        <div className="casebook-detail-id"><span>Deterministic detail exemplar</span><b>{selected.summary.caseId}</b><small>{caseDate(selected.summary.occurredAt)}</small></div>
        <div className="casebook-detail-match">
          <span><i className={`command-crest ${selected.match.home.code.toLowerCase()}`}>{selected.match.home.code}</i><b>{selected.match.home.name}</b></span>
          <em><small>{selected.match.clockLabel}</small><strong>{selected.match.scoreAtCursor.home}–{selected.match.scoreAtCursor.away}</strong><i>goal {selected.summary.goalOrdinal} first seen</i></em>
          <span className="away"><b>{selected.match.away.name}</b><i className={`command-crest ${selected.match.away.code.toLowerCase()}`}>{selected.match.away.code}</i></span>
        </div>
        <div className="casebook-detail-verdict"><span><Icon name="shield" /></span><span><small>Retrospective feasibility verdict</small><h2 id="selected-case-title">{selected.summary.reason}.</h2><p>{selected.decision.explanation}</p></span></div>
        <a className="casebook-matchroom-link" href="/matchroom"><Icon name="play" /><span>Open captured Matchroom replay</span><Icon name="arrow" /></a>
      </header>
      <DecisionRail selected={selected} />
      <EvidenceReadout selected={selected} />
      <AnalysisBoundary selected={selected} />
      <EvidenceSequence selected={selected} />
      <footer className="casebook-proof-line">
        <span className="casebook-proof-status"><Icon name="proof" /><span><b>Underlying capture identity checked</b><small>Corpus is locally committed, not a member of the replay identity hash</small></span></span>
        <span><small>Identity hash</small><code title={selected.proof.identityHash}>{compactHash(selected.proof.identityHash)}</code></span>
        <span><small>Corpus SHA-256</small><code title={selected.proof.corpusCommitment}>{compactHash(selected.proof.corpusCommitment)}</code></span>
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
  const selectedExemplarVisible = visibleCases.some((item) => item.caseId === snapshot.corpus.selectedExemplar.caseId);
  const updateFilter = (key: keyof Filters, value: string) => setFilters((current) => ({ ...current, [key]: value }));
  const clear = () => { setSearch(""); setFilters(emptyFilters); };
  return (
    <div className="app-shell casebook-shell">
      <Navigation active="casebook" caseCount={snapshot.statistics.totalCases} />
      <main className="workspace" id="casebook">
        <Topbar title="Casebook" modeLabel="Offline snapshot" modeClass="offline" />
        <div className="casebook-content">
          <CasebookHero snapshot={snapshot} />
          <CaseFilters snapshot={snapshot} search={search} onSearch={setSearch} filters={filters} onFilter={updateFilter} onClear={clear} />
          <div className="casebook-workbench">
            <CaseIndex cases={visibleCases} total={snapshot.cases.length} nextEvidence={snapshot.nextEvidence} selectedCaseId={snapshot.corpus.selectedExemplar.caseId} />
            {selectedExemplarVisible ? <CaseDetail snapshot={snapshot} /> : <section className="casebook-detail-empty surface"><span><Icon name="case" /></span><h2>{visibleCases.length === 0 ? "No observation matches" : "Detail exemplar filtered out"}</h2><p>{visibleCases.length === 0 ? "The current filters exclude every reported observation." : "The visible rows remain part of the complete corpus, but only the explicitly marked exemplar has the three-state Matchroom detail."} Clear filters to reopen the selected exemplar.</p><button type="button" onClick={clear}>Clear all filters</button></section>}
          </div>
        </div>
        <MobileNavigation active="casebook" />
      </main>
    </div>
  );
}

function CasebookLoading() {
  return <main className="load-screen"><BrandMark /><span className="load-kicker">Samaritan / Casebook</span><h1>Checking the captured corpus</h1><div className="load-line"><i /></div><p>Projecting every reported goal×market observation and reconciling it with the local replay evidence.</p></main>;
}

function CasebookError({ retry }: { retry: () => void }) {
  return <main className="load-screen error-screen"><span className="error-mark"><Icon name="shield" /></span><span className="load-kicker">Fail-closed boundary</span><h1>Casebook evidence unavailable</h1><p>The captured replay record changed or could not be reconstructed. Samaritan will not display a partial or fabricated case.</p><button type="button" onClick={retry}>Retry captured record</button></main>;
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
