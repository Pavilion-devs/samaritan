import { useEffect, useMemo, useRef, useState } from "react";
import { BrandMark, Icon, type IconName } from "./Shell";

type DocLink = {
  id: string;
  label: string;
  description: string;
  group: string;
  icon: IconName;
};

type DocsTheme = "light" | "dark";

const docsNavigation: Array<{ label: string; links: DocLink[] }> = [
  {
    label: "Getting started",
    links: [
      { id: "overview", label: "Overview", description: "What Samaritan is and the rule it is built around.", group: "Getting started", icon: "command" },
      { id: "how-it-works", label: "How it works", description: "The five-stage path from observation to proof.", group: "Getting started", icon: "arrow" },
      { id: "current-status", label: "Current system status", description: "Built, deployed, evidence, and roadmap boundaries.", group: "Getting started", icon: "pulse" }
    ]
  },
  {
    label: "Technical overview",
    links: [
      { id: "technical-overview", label: "Technical overview", description: "The deterministic system spine and its production boundaries.", group: "Technical overview", icon: "system" },
      { id: "txline-integration", label: "TXLine integration", description: "The official endpoints used by Samaritan and their roles.", group: "Technical overview", icon: "pulse" },
      { id: "judge-path", label: "Judge path", description: "Run the complete frozen observer and proof workflow locally.", group: "Technical overview", icon: "check" },
      { id: "production-fit", label: "Production fit", description: "How the reusable harness extends beyond one competition.", group: "Technical overview", icon: "arrow" }
    ]
  },
  {
    label: "Decision system",
    links: [
      { id: "event-model", label: "Canonical event model", description: "The shared live and replay event contract.", group: "Decision system", icon: "replay" },
      { id: "detectors", label: "Detectors", description: "Deterministic signal families and admission status.", group: "Decision system", icon: "chart" },
      { id: "judgment", label: "Bounded judgment", description: "What Haiku and Opus may—and may not—do.", group: "Decision system", icon: "spark" },
      { id: "risk-execution", label: "Risk & execution", description: "Code-owned paper gates and execution simulation.", group: "Decision system", icon: "shield" },
      { id: "decision-ledger", label: "Decision ledger", description: "Why every decision is recorded before action.", group: "Decision system", icon: "case" }
    ]
  },
  {
    label: "Evidence & proof",
    links: [
      { id: "evidence-classes", label: "Evidence classes", description: "Captured, historical, synthetic, and registered evidence.", group: "Evidence & proof", icon: "proof" },
      { id: "public-observer", label: "Public observer", description: "The derived-only boundary of the deployed product.", group: "Evidence & proof", icon: "lock" },
      { id: "local-verification", label: "Local verification", description: "Reproduce the public receipt checks offline.", group: "Evidence & proof", icon: "check" }
    ]
  },
  {
    label: "Reference",
    links: [
      { id: "http-surface", label: "Public HTTP surface", description: "Read-only routes exposed by the edge worker.", group: "Reference", icon: "system" },
      { id: "component-map", label: "Component map", description: "Where the major implementation layers live.", group: "Reference", icon: "command" },
      { id: "known-limits", label: "Known limits", description: "What remains incomplete, disabled, or intentionally absent.", group: "Reference", icon: "minus" }
    ]
  }
];

const allDocLinks = docsNavigation.flatMap((group) => group.links);

const verificationCommand = `pnpm check
pnpm demo
pnpm receipt:verify -- public/artifacts/dashboard/synthetic-decision-receipt.json
pnpm public:audit
pnpm dash:build`;

const judgeCommand = `corepack enable
pnpm install --frozen-lockfile
pnpm judge`;

const proofCommand = `pnpm demo
pnpm receipt:verify -- public/artifacts/dashboard/synthetic-decision-receipt.json
pnpm public:audit`;

function SearchIcon() {
  return <span className="docs-search-icon" aria-hidden="true" />;
}

function DocsHeader({ onMenu, theme, onTheme }: { onMenu: () => void; theme: DocsTheme; onTheme: () => void }) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];
    return allDocLinks.filter((item) => `${item.label} ${item.description} ${item.group}`.toLowerCase().includes(normalized)).slice(0, 7);
  }, [query]);

  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  function closeSearch() {
    setQuery("");
    searchRef.current?.blur();
  }

  return (
    <header className="docs-header">
      <button className="docs-menu-button" type="button" onClick={onMenu} aria-label="Open documentation navigation"><i /><i /><i /></button>
      <a className="docs-brand" href="/docs" aria-label="Samaritan documentation home"><BrandMark /><span><b>Samaritan</b><small>Docs</small></span></a>
      <div className="docs-search-wrap">
        <SearchIcon />
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search documentation..."
          aria-label="Search documentation"
          aria-expanded={query.length > 0}
          aria-controls="docs-search-results"
        />
        <kbd>⌘ K</kbd>
        {query ? (
          <div className="docs-search-results" id="docs-search-results" role="listbox" aria-label="Documentation search results">
            <header><span>{results.length} result{results.length === 1 ? "" : "s"}</span><button type="button" onClick={closeSearch}>Close</button></header>
            {results.length ? results.map((result) => (
              <a href={`#${result.id}`} onClick={closeSearch} role="option" aria-selected="false" key={result.id}>
                <span><Icon name={result.icon} /></span>
                <div><small>{result.group}</small><b>{result.label}</b><p>{result.description}</p></div>
                <Icon name="arrow" />
              </a>
            )) : <p className="docs-search-empty">No documentation section matches “{query}”.</p>}
          </div>
        ) : null}
      </div>
      <button
        className="docs-theme-toggle"
        type="button"
        onClick={onTheme}
        aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
        title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
      >
        <span className={`docs-theme-icon ${theme}`} aria-hidden="true"><i /><b /></span>
        <em>{theme === "light" ? "Dark" : "Light"}</em>
      </button>
      <nav className="docs-header-links" aria-label="Documentation shortcuts">
        <a href="/architecture">Architecture</a>
        <a href="/proof">Proof</a>
        <a className="primary" href="/command">Open observer <Icon name="arrow" /></a>
      </nav>
    </header>
  );
}

function DocsSidebar({ activeId, open, onClose }: { activeId: string; open: boolean; onClose: () => void }) {
  return (
    <aside className={`docs-sidebar${open ? " open" : ""}`} aria-label="Documentation navigation">
      <div className="docs-sidebar-mobile-head"><b>Documentation</b><button type="button" onClick={onClose} aria-label="Close documentation navigation">×</button></div>
      <a className="docs-observer-link" href="/command"><Icon name="arrow" /><span><small>Return to product</small><b>Observer workspace</b></span></a>
      <nav>
        {docsNavigation.map((group) => (
          <section key={group.label}>
            <h2>{group.label}</h2>
            {group.links.map((link) => (
              <a className={activeId === link.id ? "active" : undefined} href={`#${link.id}`} onClick={onClose} aria-current={activeId === link.id ? "location" : undefined} key={link.id}>
                <Icon name={link.icon} /><span>{link.label}</span>
              </a>
            ))}
          </section>
        ))}
      </nav>
      <footer><span><i />Current docs</span><small>Reconciled July 19, 2026</small></footer>
    </aside>
  );
}

function DocsToc({ activeId }: { activeId: string }) {
  return (
    <aside className="docs-toc" aria-label="On this page">
      <h2>On this page</h2>
      <nav>
        {allDocLinks.map((link) => <a className={activeId === link.id ? "active" : undefined} href={`#${link.id}`} key={link.id}>{link.label}</a>)}
      </nav>
      <div className="docs-toc-boundary"><Icon name="shield" /><span><small>Execution</small><b>Paper only</b></span></div>
    </aside>
  );
}

function StatusLabel({ state, tone }: { state: string; tone: "built" | "deployed" | "evidence" | "roadmap" }) {
  return <span className={`docs-status-label ${tone}`}><i />{state}</span>;
}

function SectionHeading({ eyebrow, title, children }: { eyebrow: string; title: string; children?: React.ReactNode }) {
  return <header className="docs-section-heading"><span>{eyebrow}</span><h2>{title}</h2>{children ? <p>{children}</p> : null}</header>;
}

function CodeBlock({ children, copyText }: { children: React.ReactNode; copyText?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!copyText) return;
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="docs-code-block">
      <header><span>Terminal</span>{copyText ? <button type="button" onClick={copy}>{copied ? "Copied" : "Copy"}</button> : null}</header>
      <pre><code>{children}</code></pre>
    </div>
  );
}

function DocsArticle() {
  return (
    <main className="docs-content" id="docs-content">
      <article>
        <div className="docs-breadcrumb"><a href="/docs">Docs</a><span>/</span><b>Getting started</b></div>

        <section className="docs-intro docs-anchor" id="overview">
          <span className="docs-eyebrow">Getting started</span>
          <h1>Samaritan</h1>
          <p className="docs-lead">A governed sports-market decision system that detects deterministic signals, gives Claude a bounded judgment role, applies non-overridable paper risk, and preserves the complete decision trail as verifiable evidence.</p>
          <div className="docs-intro-status">
            <StatusLabel state="Paper only" tone="built" />
            <StatusLabel state="Observer deployed" tone="deployed" />
            <StatusLabel state="Real-money closed" tone="roadmap" />
          </div>
          <aside className="docs-rule-callout">
            <span><Icon name="shield" /></span>
            <div><small>The one rule</small><b>Claude may judge. Deterministic code must authorize.</b><p>No model output can size an order, override a veto, access a wallet, or move money directly.</p></div>
          </aside>
          <div className="docs-start-grid">
            <a href="#technical-overview"><span><Icon name="system" /></span><small>Technical overview</small><b>Read the system spine</b><p>See the exact source, judgment, risk, execution, and proof boundaries.</p></a>
            <a href="#evidence-classes"><span><Icon name="case" /></span><small>Evidence</small><b>Understand the proof lanes</b><p>Keep captured, historical, synthetic, and registered evidence separate.</p></a>
            <a href="#local-verification"><span><Icon name="proof" /></span><small>Verification</small><b>Reproduce the checks</b><p>Verify the disclosed synthetic receipt locally without a wallet.</p></a>
          </div>
        </section>

        <section className="docs-section docs-anchor" id="how-it-works">
          <SectionHeading eyebrow="System path" title="How Samaritan works">The runtime keeps fast deterministic attention, slower bounded judgment, risk authority, and proof generation in separate layers.</SectionHeading>
          <ol className="docs-process">
            <li><span>01</span><div><b>Observe</b><p>Official TXLine snapshots/SSE and Polymarket Gamma/CLOB context enter the private runtime.</p></div></li>
            <li><span>02</span><div><b>Detect</b><p>Rolling features feed deterministic detectors that surface rare, typed signals.</p></div></li>
            <li><span>03</span><div><b>Judge</b><p>Haiku may drop or escalate. Opus may submit a strict, schema-validated thesis.</p></div></li>
            <li><span>04</span><div><b>Gate</b><p>Code checks identity, evidence, freshness, edge, exposure, and drawdown before paper execution.</p></div></li>
            <li><span>05</span><div><b>Prove</b><p>Every lifecycle event enters the append-only ledger and can be projected into a portable receipt.</p></div></li>
          </ol>
          <aside className="docs-note info"><Icon name="replay" /><div><b>Live and replay share one code path.</b><p>Both emit the same canonical event union. Detectors cannot branch merely because an event came from a replay adapter.</p></div></aside>
        </section>

        <section className="docs-section docs-anchor" id="current-status">
          <SectionHeading eyebrow="Current system" title="Status means something here.">The documentation uses four labels consistently. “Built” describes verified code; “deployed” describes the public surface; “evidence” qualifies a bounded artifact; “roadmap” is not a current product claim.</SectionHeading>
          <div className="docs-table-wrap">
            <table>
              <thead><tr><th>Capability</th><th>Status</th><th>Current boundary</th></tr></thead>
              <tbody>
                <tr><td>TXLine + Polymarket ingestion</td><td><StatusLabel state="Built" tone="built" /></td><td>Official interfaces only; credentials remain private.</td></tr>
                <tr><td>Canonical live/replay path</td><td><StatusLabel state="Built" tone="built" /></td><td>One event union and one paper-session conductor.</td></tr>
                <tr><td>Claude triage + analyst</td><td><StatusLabel state="Built" tone="built" /></td><td>Strict outputs; no sizing, wallet, or execution access.</td></tr>
                <tr><td>Paper risk + execution</td><td><StatusLabel state="Built" tone="built" /></td><td>Fixed stake and hard gates; no production order adapter.</td></tr>
                <tr><td>Public observer</td><td><StatusLabel state="Deployed" tone="deployed" /></td><td>Frozen derived projections and one separate aggregate pulse.</td></tr>
                <tr><td>Registered v2 study</td><td><StatusLabel state="Evidence" tone="evidence" /></td><td>Protocol registered; zero qualifying observations.</td></tr>
                <tr><td>Real-money execution + submitted anchor</td><td><StatusLabel state="Roadmap" tone="roadmap" /></td><td>No connected wallet, signer, order adapter, or submitted transaction.</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="docs-section docs-anchor" id="technical-overview">
          <SectionHeading eyebrow="Technical overview" title="A deterministic spine with one bounded judgment layer.">Samaritan ingests official market data, turns it into one canonical event stream, raises typed signals in code, invokes Claude only for eligible judgment, and keeps final risk, paper execution, and proof under deterministic control.</SectionHeading>
          <div className="docs-technical-spine" aria-label="Samaritan technical system flow">
            <article><span>01</span><Icon name="pulse" /><div><small>Official inputs</small><b>TXLine + Polymarket</b><p>Odds, scores, metadata, books, and resolutions enter through supported interfaces.</p></div></article>
            <i><Icon name="arrow" /></i>
            <article><span>02</span><Icon name="replay" /><div><small>Canonical path</small><b>Normalize + serialize</b><p>Live and captured replay produce the same typed event contract.</p></div></article>
            <i><Icon name="arrow" /></i>
            <article><span>03</span><Icon name="chart" /><div><small>Deterministic attention</small><b>Features + detectors</b><p>Probability-space features raise rare, structured candidate signals.</p></div></article>
            <i><Icon name="arrow" /></i>
            <article><span>04</span><Icon name="spark" /><div><small>Bounded judgment</small><b>Haiku → Opus thesis</b><p>Only eligible cases reach strict model contracts; no model can trade.</p></div></article>
            <i><Icon name="arrow" /></i>
            <article><span>05</span><Icon name="shield" /><div><small>Code-owned authority</small><b>Risk → paper → proof</b><p>Hard gates, depth-aware simulation, and the ledger complete the lifecycle.</p></div></article>
          </div>
          <div className="docs-technical-truths">
            <article><small>High-frequency path</small><b>Deterministic TypeScript</b><p>The model never runs per tick and never becomes the source of a signal.</p></article>
            <article><small>Model exit</small><b><code>submit_thesis</code> only</b><p>The analyst schema contains no stake, order, credential, or wallet field.</p></article>
            <article><small>Execution class</small><b>Paper simulation only</b><p>Validated tick, fee, minimum-size, depth, and latency evidence are reapplied in code.</p></article>
            <article><small>Evidence order</small><b>Ledger before action</b><p>Every signal, decision, intent, and result is appended in lifecycle order.</p></article>
          </div>
          <aside className="docs-note info"><Icon name="shield" /><div><b>Submission boundary</b><p>Samaritan is Deborah’s project and submission. Claude is a constrained product component—not the participant, submitter, or autonomous owner.</p></div></aside>
        </section>

        <section className="docs-section docs-anchor" id="txline-integration">
          <SectionHeading eyebrow="Technical overview" title="TXLine integration">Samaritan uses official TXLine authentication, snapshot, historical, and SSE surfaces. Raw responses and reconstructive probability series never enter the public bundle.</SectionHeading>
          <div className="docs-endpoint-table">
            <div className="head"><span>Method</span><span>Endpoint</span><span>Purpose</span></div>
            <div><code>POST</code><b>/auth/guest/start</b><span>Start the documented guest-authentication flow.</span></div>
            <div><code>POST</code><b>/api/token/activate</b><span>Activate the wallet-backed subscription; the token remains server-side.</span></div>
            <div><code>GET</code><b>/api/fixtures/snapshot</b><span>Discover exact fixture and kickoff identities.</span></div>
            <div><code>GET</code><b>/api/odds/stream</b><span>Consume live odds SSE with gzip and resumable event identity.</span></div>
            <div><code>GET</code><b>/api/scores/stream</b><span>Consume live score/action SSE on the same canonical bus.</span></div>
            <div><code>GET</code><b>/api/odds/snapshot/:fixtureId</b><span>Reconstruct current odds state during reconnect and backfill.</span></div>
            <div><code>GET</code><b>/api/scores/snapshot/:fixtureId</b><span>Reconstruct the current score state after a gap.</span></div>
            <div><code>GET</code><b>/api/odds/updates/:day/:hour/:interval</b><span>Build the five-minute historical detector-research archive.</span></div>
            <div><code>GET</code><b>/api/scores/updates/:day/:hour/:interval</b><span>Build the aligned historical score archive.</span></div>
            <div><code>GET</code><b>/api/scores/historical/:fixtureId</b><span>Recover retained score/action sequences for replay context.</span></div>
          </div>
          <div className="docs-normalization-band">
            <span><small>TXLine Pct</small><b>Divide by 100</b></span>
            <span><small>Prices</small><b>Integer odds ×1,000</b></span>
            <span><small>Empty transitions</small><b>Never normalized to zero</b></span>
            <span><small>Public output</small><b>Derived, non-reconstructive</b></span>
          </div>
          <aside className="docs-note warning"><Icon name="pulse" /><div><b>The aggregate connectivity pulse is operational metadata only.</b><p>It is not a trading signal, v2 observation, raw-feed view, or uptime guarantee.</p></div></aside>
        </section>

        <section className="docs-section docs-anchor" id="judge-path">
          <SectionHeading eyebrow="Technical overview" title="Run the judge path locally">The frozen observer requires Node 22 and pnpm 11, but no TXLine credential, Anthropic key, wallet, RPC write access, paid subscription, or private capture archive.</SectionHeading>
          <div className="docs-command-pair">
            <div><h3>Start the verified observer</h3><p>The judge command runs the clean-clone verification gate before serving the dashboard locally.</p><CodeBlock copyText={judgeCommand}>{judgeCommand}</CodeBlock><small>Then open http://127.0.0.1:4173</small></div>
            <div><h3>Reproduce the proof path</h3><p>Run the synthetic lifecycle, independently verify its receipt, and audit the public bundle.</p><CodeBlock copyText={proofCommand}>{proofCommand}</CodeBlock><small>Zero wallet, RPC, model, or real-order calls</small></div>
          </div>
          <aside className="docs-note info"><Icon name="check" /><div><b>The public audit fails closed.</b><p>It rejects raw or reconstructive TXLine fields, secret patterns, unsafe links, private source paths, and oversized public artifacts.</p></div></aside>
        </section>

        <section className="docs-section docs-anchor" id="production-fit">
          <SectionHeading eyebrow="Technical overview" title="Designed as a reusable decision-control layer.">Samaritan is not a tip generator. Its durable product is the harness: normalized evidence, identical replay behavior, bounded judgment, deterministic authorization, failure-safe paper execution, and portable receipts.</SectionHeading>
          <div className="docs-production-grid">
            <article><span><Icon name="replay" /></span><small>Adapter boundary</small><h3>New competitions can reuse the same core.</h3><p>Source and venue adapters may change while canonical events, risk authority, and proof contracts remain stable.</p></article>
            <article><span><Icon name="shield" /></span><small>Professional control</small><h3>Governance is the product.</h3><p>Trading teams and B2B intermediaries get an inspectable decision system rather than an unsupported prediction feed.</p></article>
            <article><span><Icon name="proof" /></span><small>Portable evidence</small><h3>The record outlives the interface.</h3><p>Receipts preserve the decision lifecycle across model, venue, competition, and frontend changes.</p></article>
          </div>
          <aside className="docs-note warning"><Icon name="lock" /><div><b>Continued operation needs the appropriate licences and approvals.</b><p>Post-hackathon TXLine use, any venue execution, and all jurisdictional requirements remain separate operating decisions.</p></div></aside>
        </section>

        <section className="docs-section docs-anchor" id="event-model">
          <SectionHeading eyebrow="Core concept" title="Canonical event model">Probabilities are the universal internal currency. Source time and local observation time stay separate so replay cannot erase latency evidence.</SectionHeading>
          <CodeBlock>{`type CanonicalEvent =
  | OddsQuoteEvent
  | ScoreUpdateEvent
  | PolymarketPriceEvent
  | PolymarketBookEvent
  | PolymarketResolutionEvent
  | FeedHeartbeatEvent
  | FeedStatusEvent;`}</CodeBlock>
          <div className="docs-definition-grid">
            <div><small>TXLine Pct</small><b>0–100 → 0–1</b><p>Captured fair-probability strings are divided by 100 at ingestion.</p></div>
            <div><small>TXLine Prices</small><b>Odds × 1,000</b><p>Raw source odds arrive as scaled integers and are converted only at the edge.</p></div>
            <div><small>Money</small><b>Integer micro-USD</b><p>Risk and portfolio accounting never rely on floating-point money values.</p></div>
            <div><small>Market identity</small><b>Exact + evidence-bearing</b><p>Fixture, family, period, line, and mapping status are explicit.</p></div>
          </div>
        </section>

        <section className="docs-section docs-anchor" id="detectors">
          <SectionHeading eyebrow="Deterministic attention" title="Detectors">Detectors decide when a situation deserves judgment. Their existence in code does not automatically grant paper-study authority.</SectionHeading>
          <div className="docs-detector-list">
            <article><span><Icon name="pulse" /></span><div><h3>CONSENSUS_MOVE</h3><p>Tracks meaningful changes in the TXLine consensus probability. The locked full-time totals lane may enter registered v2 review only after every admission gate passes.</p></div><StatusLabel state="Built · admitted lane" tone="built" /></article>
            <article><span><Icon name="chart" /></span><div><h3>XMARKET_DIVERGENCE</h3><p>Measures divergence between derived consensus and Polymarket context. Current public use is research only.</p></div><StatusLabel state="Built · research" tone="evidence" /></article>
            <article><span><Icon name="replay" /></span><div><h3>FADER_CANDIDATE</h3><p>Surfaces candidate reversals after consensus movement. It is implemented but not admitted to registered v2.</p></div><StatusLabel state="Built · research" tone="evidence" /></article>
            <article className="disabled"><span><Icon name="minus" /></span><div><h3>STALE_QUOTE</h3><p>Not promoted. Spain–Belgium produced zero clean post-TXLine stale windows across the explored cases.</p></div><StatusLabel state="Disabled" tone="roadmap" /></article>
            <article className="disabled"><span><Icon name="clock" /></span><div><h3>MODEL_MARKET_GAP</h3><p>The planned in-play probability-model detector is not implemented in the bounty release.</p></div><StatusLabel state="Roadmap" tone="roadmap" /></article>
          </div>
        </section>

        <section className="docs-section docs-anchor" id="judgment">
          <SectionHeading eyebrow="Bounded intelligence" title="Claude is judgment, not authority.">The reasoning layer is invoked only after deterministic attention identifies a candidate. Each model has one narrow contract.</SectionHeading>
          <div className="docs-authority-grid">
            <article><header><Icon name="spark" /><span><small>Haiku triage</small><b>Drop or escalate</b></span></header><p>Classifies and deduplicates an admitted signal, then returns a one-line rationale. It cannot trade.</p><footer>Strict schema · fail closed</footer></article>
            <article><header><Icon name="case" /><span><small>Opus analyst</small><b>Submit one thesis</b></span></header><p>Reviews a bounded, code-assembled evidence bundle. Its only exit is the schema-validated thesis contract.</p><footer>No stake · no order · no wallet</footer></article>
            <article className="code"><header><Icon name="shield" /><span><small>Deterministic layer</small><b>Veto or approve paper</b></span></header><p>Owns eligibility, sizing, exposure, freshness, drawdown, execution intent, and the closed money gate.</p><footer>Cannot be overridden by a prompt</footer></article>
          </div>
        </section>

        <section className="docs-section docs-anchor" id="risk-execution">
          <SectionHeading eyebrow="Code-owned authority" title="Risk & paper execution">The shipped policy is intentionally smaller than the planned Kelly/correlation system. It uses fixed paper stakes and hard rejection rules.</SectionHeading>
          <div className="docs-risk-layout">
            <dl>
              <div><dt>Paper bankroll</dt><dd>$50.00</dd></div>
              <div><dt>Fixed stake</dt><dd>$3.00</dd></div>
              <div><dt>Open exposure cap</dt><dd>$15.00</dd></div>
              <div><dt>Drawdown stop</dt><dd>$20.00</dd></div>
              <div><dt>Real-money gate</dt><dd>Closed</dd></div>
            </dl>
            <div><h3>Execution is simulated against the book available after measured decision latency.</h3><p>The paper adapter applies tick size, fees, depth, placement delay, partial fills, no fills, and integer micro-unit accounting. A replay cannot pretend it executed against information that arrived later.</p><a href="/architecture">See the authority map <Icon name="arrow" /></a></div>
          </div>
          <aside className="docs-note warning"><Icon name="lock" /><div><b>There is no production Polymarket execution adapter.</b><p>No credential, signer, wallet, or real order path is connected to the bounty build.</p></div></aside>
        </section>

        <section className="docs-section docs-anchor" id="decision-ledger">
          <SectionHeading eyebrow="Append-only lifecycle" title="The ledger precedes action.">A visible fill cannot exist without the signal, triage, thesis, risk verdict, and execution intent that came before it.</SectionHeading>
          <div className="docs-ledger-sequence" aria-label="Decision ledger sequence">
            {["signal_received", "triage_decision", "thesis_submitted", "risk_verdict", "execution_intent", "paper_execution", "position_settled"].map((event, index) => <span key={event}><i>{String(index + 1).padStart(2, "0")}</i><code>{event}</code></span>)}
          </div>
          <p>No trade, vetoed, no fill, and expired are valid terminal outcomes. They are evidence of discipline, not missing UI states.</p>
        </section>

        <section className="docs-section docs-anchor" id="evidence-classes">
          <SectionHeading eyebrow="Evidence model" title="Different evidence. Never blended.">Every artifact carries a provenance boundary. A verified hash can prove integrity without proving market performance, model usage, or an external timestamp.</SectionHeading>
          <div className="docs-evidence-grid">
            <article><StatusLabel state="Captured replay" tone="evidence" /><h3>Authentic synchronized observations</h3><p><b>Proves:</b> source observations can be normalized, replayed, and reconciled.</p><p><b>Does not prove:</b> Claude usage, execution, or profitability.</p></article>
            <article><StatusLabel state="Historical research" tone="evidence" /><h3>Sampled-price candidate evidence</h3><p><b>Proves:</b> a corrected candidate justified forward paper review.</p><p><b>Does not prove:</b> bid/ask execution, fills, CLV, or alpha.</p></article>
            <article><StatusLabel state="Synthetic proof" tone="evidence" /><h3>Full engineering lifecycle</h3><p><b>Proves:</b> shared components complete signal-to-settlement deterministically.</p><p><b>Does not prove:</b> a real match, model call, order, or performance observation.</p></article>
            <article><StatusLabel state="Registered v2" tone="evidence" /><h3>Fresh-forward protocol</h3><p><b>Proves:</b> the study rules were frozen before observations.</p><p><b>Does not prove:</b> a result. The qualifying count is currently zero.</p></article>
            <article><StatusLabel state="Local verification" tone="built" /><h3>Portable receipt integrity</h3><p><b>Proves:</b> disclosed receipt fields and hash-linked rows reconcile locally.</p><p><b>Does not prove:</b> provider attestation, independent time, or a Solana anchor.</p></article>
          </div>
        </section>

        <section className="docs-section docs-anchor" id="public-observer">
          <SectionHeading eyebrow="Deployment boundary" title="The public observer is a projection, not the runtime.">The deployed React application reads allowlisted, derived artifacts through a read-only edge worker. It does not query private stores or start the paper conductor.</SectionHeading>
          <div className="docs-public-flow">
            <span><Icon name="case" /><b>Private evidence</b><small>Licensed + credentialed</small></span>
            <i><Icon name="arrow" /></i>
            <span><Icon name="check" /><b>Validated projection</b><small>Derived + allowlisted</small></span>
            <i><Icon name="arrow" /></i>
            <span><Icon name="proof" /><b>Public observer</b><small>Read only</small></span>
          </div>
          <aside className="docs-note info"><Icon name="shield" /><div><b>What never crosses the boundary</b><p>Raw TXLine payloads, source credentials, private ledgers, wallet material, order controls, and mutable risk configuration.</p></div></aside>
        </section>

        <section className="docs-section docs-anchor" id="local-verification">
          <SectionHeading eyebrow="Proof workflow" title="Verify, don’t trust the screenshot.">The frozen synthetic receipt can be verified offline. This checks the strict schema, canonical receipt hash, disclosed lifecycle order, source references, and ledger relationships.</SectionHeading>
          <CodeBlock copyText={verificationCommand}>{verificationCommand}</CodeBlock>
          <aside className="docs-note warning"><Icon name="proof" /><div><b>Local verification is not a blockchain timestamp.</b><p>The current public receipt has no submitted Solana transaction and no explorer link.</p></div></aside>
        </section>

        <section className="docs-section docs-anchor" id="http-surface">
          <SectionHeading eyebrow="Reference" title="Public HTTP surface">Only GET and HEAD are accepted. Mutations return 405, and unknown API routes return 404.</SectionHeading>
          <div className="docs-api-list">
            <div><code>GET</code><b>/api/v1/command</b><span>Overview projection</span></div>
            <div><code>GET</code><b>/api/v1/matchroom/paired-spain-belgium-2026-07-10</b><span>Captured replay projection</span></div>
            <div><code>GET</code><b>/api/v1/casebook</b><span>Decision corpus</span></div>
            <div><code>GET</code><b>/api/v1/study</b><span>Study and evidence summary</span></div>
            <div><code>GET</code><b>/api/judge/evidence</b><span>Fail-closed judge summary</span></div>
            <div><code>GET</code><b>/api/v1/txline/pulse</b><span>Separate derived aggregate pulse</span></div>
            <div><code>GET</code><b>/api/v1/health</b><span>Read-only service health</span></div>
          </div>
        </section>

        <section className="docs-section docs-anchor" id="component-map">
          <SectionHeading eyebrow="Repository reference" title="Component map">The public interface is deliberately separated from the private runtime and evidence stores.</SectionHeading>
          <div className="docs-component-map">
            <div><code>src/ingest/</code><span><b>Official source adapters</b><small>TXLine + Polymarket</small></span></div>
            <div><code>src/bus/</code><span><b>Canonical event contract</b><small>Shared live + replay path</small></span></div>
            <div><code>src/features/</code><span><b>Rolling feature engine</b><small>Probability-space features</small></span></div>
            <div><code>src/detectors/</code><span><b>Deterministic attention</b><small>Three built signal families</small></span></div>
            <div><code>src/agents/</code><span><b>Bounded judgment</b><small>Strict Haiku + Opus schemas</small></span></div>
            <div><code>src/risk/</code><span><b>Final paper authority</b><small>Non-overridable code gates</small></span></div>
            <div><code>src/store/</code><span><b>Append-only evidence</b><small>Journals + decision ledger</small></span></div>
            <div><code>src/proof/</code><span><b>Portable verification</b><small>Receipt + offline verifier</small></span></div>
            <div><code>src/dash/</code><span><b>Public projection boundary</b><small>Allowlisted derived contracts</small></span></div>
            <div><code>apps/dashboard/</code><span><b>Read-only observer</b><small>React + edge worker</small></span></div>
          </div>
        </section>

        <section className="docs-section docs-anchor" id="known-limits">
          <SectionHeading eyebrow="Honest boundary" title="Known limits">These are product boundaries, not footnotes. They must remain visible until evidence or implementation genuinely changes.</SectionHeading>
          <ul className="docs-limits">
            <li><Icon name="minus" /><div><b>No qualifying registered v2 observations.</b><p>The study is registered, but registration is not a performance result.</p></div></li>
            <li><Icon name="minus" /><div><b>No production real-money adapter.</b><p>The bounty release has no wallet, signer, Polymarket credential, or order route.</p></div></li>
            <li><Icon name="minus" /><div><b>No submitted Solana anchor.</b><p>Preparation and verification tooling exists; the public receipt remains unanchored.</p></div></li>
            <li><Icon name="minus" /><div><b>STALE_QUOTE remains disabled.</b><p>The synchronized Spain–Belgium evidence did not support promotion.</p></div></li>
            <li><Icon name="minus" /><div><b>MODELER, tournament, Head Trader, and Data Doctor are roadmap.</b><p>None may appear as a currently operating agent.</p></div></li>
            <li><Icon name="minus" /><div><b>The public UI is not a continuously hosted trading runtime.</b><p>It serves frozen projections plus one separate aggregate connectivity pulse.</p></div></li>
          </ul>
        </section>

        <nav className="docs-next" aria-label="Next documentation destinations">
          <a href="/architecture"><span><small>Visual system map</small><b>Architecture</b></span><Icon name="arrow" /></a>
          <a href="/proof"><span><small>Inspect the evidence</small><b>Proof</b></span><Icon name="arrow" /></a>
        </nav>
        <footer className="docs-article-footer"><span><BrandMark /><b>Samaritan Docs</b></span><p>Current-system documentation · July 19, 2026</p></footer>
      </article>
    </main>
  );
}

export function DocsApp() {
  const [activeId, setActiveId] = useState("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [theme, setTheme] = useState<DocsTheme>(() => {
    try {
      const saved = window.localStorage.getItem("samaritan-docs-theme");
      if (saved === "light" || saved === "dark") return saved;
    } catch {
      // Storage is optional; the system preference remains a safe default.
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  useEffect(() => {
    document.title = "Samaritan Docs · Governed sports-market intelligence";
    const sections = allDocLinks.map((link) => document.getElementById(link.id)).filter((section): section is HTMLElement => section !== null);
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]?.target.id) setActiveId(visible[0].target.id);
    }, { rootMargin: "-15% 0px -72% 0px", threshold: [0, 0.1] });
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem("samaritan-docs-theme", theme);
    } catch {
      // The toggle still works for the current visit when storage is unavailable.
    }
    const themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (themeMeta) themeMeta.content = theme === "dark" ? "#080b12" : "#f4f1e9";
    document.documentElement.style.colorScheme = theme;
    return () => {
      document.documentElement.style.colorScheme = "";
    };
  }, [theme]);

  return (
    <div className="docs-app" data-theme={theme}>
      <DocsHeader onMenu={() => setSidebarOpen(true)} theme={theme} onTheme={() => setTheme((current) => current === "light" ? "dark" : "light")} />
      <div className="docs-shell">
        <DocsSidebar activeId={activeId} open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        {sidebarOpen ? <button className="docs-sidebar-scrim" type="button" onClick={() => setSidebarOpen(false)} aria-label="Close documentation navigation" /> : null}
        <DocsArticle />
        <DocsToc activeId={activeId} />
      </div>
    </div>
  );
}
