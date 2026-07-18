import { startTransition, useDeferredValue, useEffect, useState } from "react";
import type { CasebookCaseSummary, CasebookSnapshot } from "../../../src/dash/public-contract";
import { loadCasebook } from "./api";
import { BrandMark, EditorialNavigation, Icon } from "./Shell";

type DecisionFilters = {
  market: string;
  reason: string;
};

const emptyFilters: DecisionFilters = { market: "", reason: "" };

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
  return `${value.slice(0, 14)}…${value.slice(-7)}`;
}

function goalClock(value: number) {
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

function SelectFilter({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="editorial-decisions-filter-select">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">All</option>
        {options.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
      </select>
      <Icon name="chevron" />
    </label>
  );
}

function DecisionHero({ snapshot }: { snapshot: CasebookSnapshot }) {
  return (
    <section className="editorial-decisions-hero" aria-labelledby="editorial-decisions-title">
      <div className="editorial-decisions-hero-copy">
        <span className="editorial-decisions-kicker"><i aria-hidden="true" />Verified retrospective corpus</span>
        <h1 id="editorial-decisions-title">Discipline,<br />recorded.</h1>
        <p>Every reported goal×market observation from one verified capture, ordered so the reason comes before the numbers.</p>
      </div>
      <div className="editorial-decisions-stats" aria-label="Decision corpus totals">
        <div className="primary"><small>Goal×market observations</small><b>{snapshot.statistics.totalCases}</b><span>{snapshot.corpus.goalEvents} goals · {snapshot.corpus.captureReplays} paired capture</span></div>
        <div><small>No trades</small><b>{snapshot.statistics.noTradeCases}</b><span>Execution never entered</span></div>
        <div><small>Market moved first</small><b>{snapshot.corpus.movedBeforeTxlineCases}</b><span>Pre-trigger repricing</span></div>
        <div><small>No material move</small><b>{snapshot.corpus.noMaterialRepriceCases}</b><span>Inside 30 seconds</span></div>
      </div>
    </section>
  );
}

function DecisionFiltersBar({ search, filters, onSearch, onFilter, onClear }: {
  search: string;
  filters: DecisionFilters;
  onSearch: (value: string) => void;
  onFilter: (key: keyof DecisionFilters, value: string) => void;
  onClear: () => void;
}) {
  const hasFilters = Boolean(search || filters.market || filters.reason);
  return (
    <section className="editorial-decisions-filters" aria-label="Decision filters">
      <label className="editorial-decisions-search">
        <span>Search decisions</span>
        <span><Icon name="case" /><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Case, market, or reason" /></span>
      </label>
      <SelectFilter
        label="Market"
        value={filters.market}
        options={[
          { value: "Match result", label: "Match result" },
          { value: "Full-time total", label: "Full-time total" }
        ]}
        onChange={(value) => onFilter("market", value)}
      />
      <SelectFilter
        label="Timing result"
        value={filters.reason}
        options={[
          { value: "Market moved before TXLine", label: "Market moved first" },
          { value: "No material move within 30s", label: "No material move" }
        ]}
        onChange={(value) => onFilter("reason", value)}
      />
      <button type="button" onClick={onClear} disabled={!hasFilters}>Clear</button>
    </section>
  );
}

function DecisionIndex({ cases, total, selectedCaseId, showAll, onShowAll, onSelect, nextEvidence }: {
  cases: CasebookCaseSummary[];
  total: number;
  selectedCaseId: string | null;
  showAll: boolean;
  onShowAll: () => void;
  onSelect: (caseId: string) => void;
  nextEvidence: CasebookSnapshot["nextEvidence"];
}) {
  const displayed = showAll ? cases : cases.slice(0, 6);
  return (
    <section className="editorial-decisions-index" aria-labelledby="editorial-decision-index-title">
      <header className="editorial-decisions-section-heading">
        <span><small>Complete captured corpus</small><h2 id="editorial-decision-index-title">Decision journal</h2></span>
        <em>{cases.length === total ? `${total} observations` : `${cases.length} of ${total}`}</em>
      </header>
      {cases.length === 0 ? (
        <div className="editorial-decisions-empty"><span><Icon name="case" /></span><b>No observation matches</b><small>Change or clear a filter. Samaritan will not fabricate a result.</small></div>
      ) : (
        <>
          <div className="editorial-decisions-index-head" aria-hidden="true"><span>Case</span><span>Market</span><span>Pre-trigger</span><span>Decision</span></div>
          <div className="editorial-decisions-list">
            {displayed.map((item) => (
              <button
                className={item.caseId === selectedCaseId ? "selected" : undefined}
                type="button"
                aria-pressed={item.caseId === selectedCaseId}
                onClick={() => onSelect(item.caseId)}
                key={item.caseId}
              >
                <span><b>Goal {item.goalOrdinal} · {goalClock(item.goalClockSeconds)}</b><small>{item.selectedExemplar ? "Detail exemplar" : item.caseId}</small></span>
                <span>{item.marketLabel}</span>
                <span>{movementBps(item.preTriggerMarketMoveBps)}</span>
                <span><i><Icon name="minus" /></i>{item.disposition}</span>
              </button>
            ))}
          </div>
          {cases.length > 6 ? <button className="editorial-decisions-show-all" type="button" onClick={onShowAll}>{showAll ? "Show the first 6 observations" : `Show all ${cases.length} observations`}</button> : null}
        </>
      )}
      <footer className="editorial-decisions-index-foot"><Icon name="clock" /><span><b>{nextEvidence.label}</b><small>{nextEvidence.detail}</small></span></footer>
    </section>
  );
}

function MatchLine({ snapshot }: { snapshot: CasebookSnapshot }) {
  const selected = snapshot.selectedCase;
  return (
    <div className="editorial-decisions-matchline">
      <span><i>{selected.match.home.code}</i><b>{selected.match.home.name}</b></span>
      <span><small>{selected.match.clockLabel}</small><strong>{selected.match.scoreAtCursor.home} — {selected.match.scoreAtCursor.away}</strong><em>Goal {selected.summary.goalOrdinal} first seen</em></span>
      <span><b>{selected.match.away.name}</b><i>{selected.match.away.code}</i></span>
    </div>
  );
}

function DecisionPath({ snapshot }: { snapshot: CasebookSnapshot }) {
  return (
    <section className="editorial-decisions-path" aria-labelledby="editorial-decisions-path-title">
      <header className="editorial-decisions-section-heading">
        <span><small>Decision path</small><h3 id="editorial-decisions-path-title">Why nothing happened</h3></span>
        <span>{snapshot.selectedCase.decision.ordersPlaced} orders · $0 moved</span>
      </header>
      <ol>
        {snapshot.selectedCase.lifecycle.map((stage) => (
          <li className={stage.status} key={stage.id}>
            <i><Icon name={stage.status === "complete" ? "check" : stage.status === "passed" ? "minus" : "lock"} /></i>
            <span><b>{stage.label}</b><small>{stage.detail}</small></span>
            <time>{stage.timingLabel}</time>
          </li>
        ))}
      </ol>
    </section>
  );
}

function EvidenceTable({ snapshot }: { snapshot: CasebookSnapshot }) {
  return (
    <section className="editorial-decisions-evidence" aria-labelledby="editorial-decisions-evidence-title">
      <header className="editorial-decisions-section-heading">
        <span><small>Captured evidence</small><h3 id="editorial-decisions-evidence-title">Three moments explain the decline</h3></span>
        <em>Derived only</em>
      </header>
      <div role="region" aria-label="Captured evidence sequence" tabIndex={0}>
        <table>
          <thead><tr><th>Moment</th><th>Source</th><th>Observation</th><th>Ask</th><th>Assessment</th></tr></thead>
          <tbody>
            {snapshot.selectedCase.evidence.map((row) => (
              <tr key={row.replayStateId}>
                <td>{row.offsetLabel}</td>
                <td><i className={row.source.toLowerCase()}>{row.source === "Polymarket" ? "P" : row.source === "TXLine" ? "TX" : "S"}</i>{row.source}</td>
                <td>{row.observation}</td>
                <td><b>{percentage(row.bestAsk)}</b></td>
                <td><em className={row.assessment === "Moved first" ? "watch" : undefined}>{row.assessment}</em></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ExemplarDetail({ snapshot }: { snapshot: CasebookSnapshot }) {
  const selected = snapshot.selectedCase;
  return (
    <article className="editorial-decisions-detail" aria-labelledby="editorial-selected-decision-title">
      <div className="editorial-decisions-detail-topline"><code>{selected.summary.caseId}</code><em>Detail exemplar</em></div>
      <MatchLine snapshot={snapshot} />
      <section className="editorial-decisions-verdict">
        <span><Icon name="shield" /></span>
        <span><small>Retrospective feasibility verdict</small><h2 id="editorial-selected-decision-title">{selected.summary.reason}.</h2><p>{selected.decision.explanation}</p></span>
      </section>
      <div className="editorial-decisions-readout" aria-label="Selected decision market evidence">
        <span><small>Pre-trigger move</small><b>{movementBps(selected.evidenceReadout.preTriggerMarketMoveBps)}</b></span>
        <span><small>Executable bid / ask</small><b>{percentage(selected.evidenceReadout.bestBid)} / {percentage(selected.evidenceReadout.bestAsk)}</b></span>
        <span><small>Measured spread</small><b>{points(selected.evidenceReadout.spread)}</b></span>
      </div>
      <DecisionPath snapshot={snapshot} />
      <EvidenceTable snapshot={snapshot} />
      <section className="editorial-decisions-boundaries" aria-label="Analysis and execution boundaries">
        <div><span><Icon name="spark" /></span><span><small>Analyst boundary</small><b>No operational thesis requested</b><p>{selected.analysis.thesisReason}</p></span></div>
        <div><span><Icon name="lock" /></span><span><small>Execution boundary</small><b>Operational cost not applicable</b><p>{selected.analysis.costReason}</p></span></div>
      </section>
      <DecisionProof snapshot={snapshot} />
    </article>
  );
}

function CorpusDetail({ item, snapshot, onOpenExemplar }: { item: CasebookCaseSummary; snapshot: CasebookSnapshot; onOpenExemplar: () => void }) {
  const movedFirst = item.reason === "Market moved before TXLine";
  return (
    <article className="editorial-decisions-detail editorial-decisions-corpus-detail" aria-labelledby="editorial-selected-corpus-title">
      <div className="editorial-decisions-detail-topline"><code>{item.caseId}</code><em>Corpus row</em></div>
      <div className="editorial-decisions-corpus-match">
        <span><i>{item.homeCode}</i><b>{item.fixtureLabel}</b><i>{item.awayCode}</i></span>
        <span>Goal {item.goalOrdinal} · {goalClock(item.goalClockSeconds)}</span>
      </div>
      <section className="editorial-decisions-verdict">
        <span><Icon name="shield" /></span>
        <span><small>Retrospective feasibility verdict</small><h2 id="editorial-selected-corpus-title">{item.reason}.</h2><p>{movedFirst ? "The public market had already repriced before the TXLine event arrived. The observation ended without a trade." : "No material repricing appeared inside the measured 30-second window. That absence was recorded without turning it into a trade claim."}</p></span>
      </section>
      <div className="editorial-decisions-readout" aria-label="Selected corpus observation">
        <span><small>Market</small><b>{item.marketLabel}</b></span>
        <span><small>Pre-trigger move</small><b>{movementBps(item.preTriggerMarketMoveBps)}</b></span>
        <span><small>Decision</small><b>{item.disposition}</b></span>
      </div>
      <div className="editorial-decisions-corpus-note">
        <span><Icon name="case" /></span>
        <span><b>One reconciled corpus observation</b><p>Only the explicitly marked Match Result exemplar has the complete three-state evidence detail. This row remains inspectable without invented lifecycle data.</p></span>
      </div>
      <button className="editorial-decisions-open-exemplar" type="button" onClick={onOpenExemplar}>Open the detail exemplar <Icon name="arrow" /></button>
      <DecisionProof snapshot={snapshot} />
    </article>
  );
}

function DecisionProof({ snapshot }: { snapshot: CasebookSnapshot }) {
  const proof = snapshot.selectedCase.proof;
  return (
    <footer className="editorial-decisions-proof">
      <span><i><Icon name="check" /></i><span><small>Capture record</small><b>{snapshot.statistics.reconciledCases} of {snapshot.statistics.totalCases} internally reconciled</b></span></span>
      <span><small>Replay identity</small><code title={proof.identityHash}>{compactHash(proof.identityHash)}</code></span>
      <span><small>Corpus SHA-256</small><code title={proof.corpusCommitment}>{compactHash(proof.corpusCommitment)}</code></span>
      <a href="/proof"><small>Money gate</small><b>Closed</b><Icon name="arrow" /></a>
    </footer>
  );
}

function matchesFilters(item: CasebookCaseSummary, search: string, filters: DecisionFilters) {
  const haystack = [item.caseId, item.fixtureLabel, item.marketLabel, item.reason, `goal ${item.goalOrdinal}`].join(" ").toLowerCase();
  return (!search || haystack.includes(search.toLowerCase())) &&
    (!filters.market || item.marketFamily === filters.market) &&
    (!filters.reason || item.reason === filters.reason);
}

function CasebookView({ snapshot }: { snapshot: CasebookSnapshot }) {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const [filters, setFilters] = useState<DecisionFilters>(emptyFilters);
  const [selectedCaseId, setSelectedCaseId] = useState(snapshot.corpus.selectedExemplar.caseId);
  const [showAll, setShowAll] = useState(false);
  const visibleCases = snapshot.cases.filter((item) => matchesFilters(item, deferredSearch, filters));
  const selectedVisible = visibleCases.find((item) => item.caseId === selectedCaseId) ?? visibleCases[0] ?? null;
  const clear = () => { setSearch(""); setFilters(emptyFilters); setShowAll(false); };
  const updateFilter = (key: keyof DecisionFilters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setShowAll(false);
  };

  return (
    <div className="editorial-casebook">
      <div className="editorial-page editorial-decisions-page">
        <EditorialNavigation active="casebook" modeLabel="Offline evidence · no real orders" />
        <main>
          <DecisionHero snapshot={snapshot} />
          <DecisionFiltersBar search={search} filters={filters} onSearch={(value) => { setSearch(value); setShowAll(false); }} onFilter={updateFilter} onClear={clear} />
          <div className="editorial-decisions-workbench">
            <DecisionIndex
              cases={visibleCases}
              total={snapshot.cases.length}
              selectedCaseId={selectedVisible?.caseId ?? null}
              showAll={showAll}
              onShowAll={() => setShowAll((value) => !value)}
              onSelect={setSelectedCaseId}
              nextEvidence={snapshot.nextEvidence}
            />
            {selectedVisible === null ? (
              <section className="editorial-decisions-detail-empty"><span><Icon name="case" /></span><h2>No observation matches</h2><p>The current filters exclude every reported observation. Clear them to restore the verified corpus.</p><button type="button" onClick={clear}>Clear all filters</button></section>
            ) : selectedVisible.caseId === snapshot.corpus.selectedExemplar.caseId ? (
              <ExemplarDetail snapshot={snapshot} />
            ) : (
              <CorpusDetail item={selectedVisible} snapshot={snapshot} onOpenExemplar={() => { setSelectedCaseId(snapshot.corpus.selectedExemplar.caseId); clear(); }} />
            )}
          </div>
        </main>
        <footer className="editorial-footer">
          <span>Derived evidence only · exact TXLine probability levels withheld</span>
          <span>Deborah · participant and project owner</span>
        </footer>
      </div>
    </div>
  );
}

function CasebookLoading() {
  return <main className="editorial-load"><BrandMark /><span>Samaritan / Decisions</span><h1>Checking the captured corpus</h1><div><i /></div><p>Projecting every reported observation and reconciling it with the verified local evidence.</p></main>;
}

function CasebookError({ retry }: { retry: () => void }) {
  return <main className="editorial-load editorial-load-error"><span><Icon name="shield" /></span><small>Fail-closed boundary</small><h1>Decision evidence unavailable</h1><p>Samaritan will not display a partial or fabricated decision journal.</p><button type="button" onClick={retry}>Retry captured record</button></main>;
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
