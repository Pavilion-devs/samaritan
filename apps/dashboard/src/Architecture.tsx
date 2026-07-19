import { EditorialNavigation, Icon, type IconName } from "./Shell";

const operatingPath: Array<{ index: string; label: string; detail: string }> = [
  { index: "01", label: "Observe", detail: "Official market inputs" },
  { index: "02", label: "Detect", detail: "Deterministic signals" },
  { index: "03", label: "Judge", detail: "Bounded thesis" },
  { index: "04", label: "Gate", detail: "Code-owned risk" },
  { index: "05", label: "Prove", detail: "Ledger before action" }
];

const runtimeModules: Array<{ index: string; eyebrow: string; title: string; detail: string; icon: IconName }> = [
  {
    index: "A",
    eyebrow: "Market context",
    title: "Ingest + normalize",
    detail: "Official snapshots, streams, market mapping, and one canonical event shape.",
    icon: "pulse"
  },
  {
    index: "B",
    eyebrow: "Deterministic attention",
    title: "Features + detectors",
    detail: "Rolling features surface consensus moves, cross-market divergence, and stale quotes.",
    icon: "chart"
  },
  {
    index: "C",
    eyebrow: "Bounded judgment",
    title: "Triage + thesis",
    detail: "Haiku may drop or escalate. Opus may submit a strict thesis. Neither can place a trade.",
    icon: "spark"
  },
  {
    index: "D",
    eyebrow: "Code-owned authority",
    title: "Risk + paper execution",
    detail: "Hard caps, correlation rules, drawdown stops, and the closed money gate remain deterministic.",
    icon: "shield"
  }
];

const authorityCards: Array<{ index: string; eyebrow: string; title: string; detail: string; icon: IconName; tone: string }> = [
  {
    index: "01",
    eyebrow: "Claude may recommend",
    title: "Judgment has a narrow exit.",
    detail: "Triage returns drop or escalate. The analyst returns one schema-checked thesis. No model output is parsed into an order.",
    icon: "spark",
    tone: "judgment"
  },
  {
    index: "02",
    eyebrow: "Code must authorize",
    title: "Risk cannot be persuaded.",
    detail: "The deterministic layer owns eligibility, sizing, exposure, correlation, drawdown breakers, and the manual kill switch.",
    icon: "shield",
    tone: "authority"
  },
  {
    index: "03",
    eyebrow: "The public may inspect",
    title: "The observer cannot act.",
    detail: "The deployed interface reads an allowlisted derived bundle. It has no wallet, order form, secret, or raw licensed feed.",
    icon: "proof",
    tone: "observer"
  }
];

const evidenceLanes: Array<{ state: string; title: string; detail: string; use: string; tone: string }> = [
  {
    state: "Evidence",
    title: "Captured replay",
    detail: "Spain–Belgium is preserved as a real retrospective market capture.",
    use: "No-trade evidence",
    tone: "capture"
  },
  {
    state: "Evidence",
    title: "Registered v2",
    detail: "A forward paper protocol waits for qualifying observations before reporting a result.",
    use: "No observations yet",
    tone: "registered"
  },
  {
    state: "Engineering proof",
    title: "Synthetic lifecycle",
    detail: "Deterministic stubs exercise signal-to-settlement and portable receipt verification.",
    use: "Excluded from performance",
    tone: "synthetic"
  },
  {
    state: "Roadmap boundary",
    title: "Solana anchor",
    detail: "The commitment path is prepared, but no transaction has been submitted.",
    use: "Not active",
    tone: "roadmap"
  }
];

const builtCapabilities = [
  "TXLine and Polymarket official ingestion",
  "Shared live and replay event contract",
  "Rolling features and three detectors",
  "Strict Claude triage and thesis adapters",
  "Deterministic paper risk and execution",
  "Append-only ledger and portable receipt",
  "Derived-only public observer"
];

const roadmapCapabilities = [
  "Submitted Solana anchoring",
  "Real-money execution adapter",
  "MODELER in-play probability engine",
  "Four-persona paper tournament",
  "Head Trader allocation loop",
  "Scheduled Data Doctor"
];

function FlowArrow({ label }: { label: string }) {
  return <div className="architecture-flow-arrow" aria-hidden="true"><span>{label}</span><i /></div>;
}

function OperatingPath() {
  return (
    <ol className="architecture-operating-path" aria-label="Samaritan operating path">
      {operatingPath.map((stage) => (
        <li key={stage.index}>
          <span>{stage.index}</span>
          <div><b>{stage.label}</b><small>{stage.detail}</small></div>
        </li>
      ))}
    </ol>
  );
}

function SystemMap() {
  return (
    <section className="architecture-map-section" aria-labelledby="architecture-map-title">
      <header className="architecture-section-heading architecture-map-heading">
        <span><small>Current system · July 2026</small><h2 id="architecture-map-title">How a market observation becomes accountable evidence.</h2></span>
        <div className="architecture-map-legend" aria-label="Architecture map legend">
          <span><i className="external" />External input</span>
          <span><i className="private" />Private runtime</span>
          <span><i className="public" />Public projection</span>
          <span><i className="roadmap" />Roadmap only</span>
        </div>
      </header>

      <div className="architecture-map">
        <div className="architecture-map-column architecture-source-column">
          <header><span>01</span><small>Official inputs</small></header>
          <article>
            <span className="architecture-node-icon"><Icon name="pulse" /></span>
            <div><small>TXLine / TxODDS</small><b>Snapshot + SSE</b><p>Licensed market data stays inside the private plane.</p></div>
            <em>Official</em>
          </article>
          <article>
            <span className="architecture-node-icon"><Icon name="chart" /></span>
            <div><small>Polymarket V2</small><b>Gamma + CLOB</b><p>Public market context enters through supported APIs.</p></div>
            <em>Official</em>
          </article>
          <article>
            <span className="architecture-node-icon"><Icon name="replay" /></span>
            <div><small>Runtime mode</small><b>Live or captured replay</b><p>Both emit the same canonical event contract.</p></div>
            <em>Same path</em>
          </article>
        </div>

        <FlowArrow label="Normalize" />

        <article className="architecture-runtime">
          <header>
            <span><Icon name="system" /></span>
            <div><small>Private decision runtime</small><h3>One governed path</h3></div>
            <em><i />Built</em>
          </header>
          <div className="architecture-runtime-grid">
            {runtimeModules.map((module) => (
              <section key={module.index}>
                <span className="architecture-runtime-index">{module.index}</span>
                <span className="architecture-runtime-icon"><Icon name={module.icon} /></span>
                <div><small>{module.eyebrow}</small><b>{module.title}</b><p>{module.detail}</p></div>
              </section>
            ))}
          </div>
          <footer>
            <span><Icon name="case" /><b>Append-only ledger</b><small>Decision recorded before action</small></span>
            <span><Icon name="proof" /><b>Receipt writer</b><small>Portable commitments + provenance</small></span>
            <span><Icon name="lock" /><b>Paper adapter</b><small>Real-money route absent</small></span>
          </footer>
        </article>

        <FlowArrow label="Project" />

        <div className="architecture-map-column architecture-plane-column">
          <header><span>05</span><small>Evidence + observer</small></header>
          <article className="private-plane">
            <span className="architecture-node-icon"><Icon name="case" /></span>
            <div><small>Private evidence plane</small><b>Journal + ledger</b><p>Operational state, decisions, fills, and receipts remain append-only.</p></div>
            <em>Built</em>
          </article>
          <article className="public-plane">
            <span className="architecture-node-icon"><Icon name="proof" /></span>
            <div><small>Public judge plane</small><b>Frozen derived bundle</b><p>Allowlisted artifacts pass through a read-only edge worker to this observer.</p></div>
            <em>Deployed</em>
          </article>
          <article className="roadmap-plane">
            <span className="architecture-node-icon"><Icon name="lock" /></span>
            <div><small>External commitment</small><b>Solana anchoring</b><p>Prepared architecture; no submitted transaction is claimed.</p></div>
            <em>Roadmap</em>
          </article>
        </div>

        <footer className="architecture-map-boundary">
          <span><Icon name="shield" /></span>
          <div><b>Public boundary</b><p>Derived signals and decisions may cross. Raw TXLine data, credentials, wallets, and mutable controls may not.</p></div>
          <em>Fail closed</em>
        </footer>
      </div>
    </section>
  );
}

function AuthoritySplit() {
  return (
    <section className="architecture-authority" aria-labelledby="architecture-authority-title">
      <header className="architecture-section-heading">
        <span><small>Authority split</small><h2 id="architecture-authority-title">Intelligence is not permission.</h2></span>
        <p>Every boundary answers one question: who is allowed to decide what happens next?</p>
      </header>
      <div className="architecture-authority-grid">
        {authorityCards.map((card) => (
          <article className={card.tone} key={card.index}>
            <header><span>{card.index}</span><i><Icon name={card.icon} /></i></header>
            <small>{card.eyebrow}</small>
            <h3>{card.title}</h3>
            <p>{card.detail}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function EvidencePlanes() {
  return (
    <section className="architecture-evidence" aria-labelledby="architecture-evidence-title">
      <header className="architecture-section-heading">
        <span><small>Evidence planes</small><h2 id="architecture-evidence-title">Different evidence. Never blended.</h2></span>
        <a href="/proof">Inspect the receipt <Icon name="arrow" /></a>
      </header>
      <div className="architecture-evidence-list">
        {evidenceLanes.map((lane, index) => (
          <article className={lane.tone} key={lane.title}>
            <span className="architecture-evidence-index">{String(index + 1).padStart(2, "0")}</span>
            <span className="architecture-evidence-state"><i />{lane.state}</span>
            <div><h3>{lane.title}</h3><p>{lane.detail}</p></div>
            <em>{lane.use}</em>
          </article>
        ))}
      </div>
    </section>
  );
}

function CapabilityBoundary() {
  return (
    <section className="architecture-capabilities" aria-labelledby="architecture-capabilities-title">
      <header className="architecture-section-heading">
        <span><small>Capability boundary</small><h2 id="architecture-capabilities-title">Built today. Named honestly.</h2></span>
      </header>
      <div className="architecture-capability-grid">
        <article className="built">
          <header><span><Icon name="check" /></span><div><small>Current system</small><h3>Built + connected</h3></div><em>Active</em></header>
          <ul>{builtCapabilities.map((capability) => <li key={capability}><Icon name="check" />{capability}</li>)}</ul>
        </article>
        <article className="roadmap">
          <header><span><Icon name="clock" /></span><div><small>Future system</small><h3>Designed, not claimed</h3></div><em>Roadmap</em></header>
          <ul>{roadmapCapabilities.map((capability) => <li key={capability}><Icon name="minus" />{capability}</li>)}</ul>
        </article>
      </div>
      <div className="architecture-principle-rail" aria-label="Samaritan architecture principles">
        <span><Icon name="replay" /><b>Same event path</b><small>Live + replay</small></span>
        <span><Icon name="spark" /><b>Strict schemas</b><small>Bounded judgment</small></span>
        <span><Icon name="shield" /><b>Hard risk</b><small>Code-owned</small></span>
        <span><Icon name="case" /><b>Ledger first</b><small>Before action</small></span>
        <span><Icon name="proof" /><b>Derived public</b><small>Read only</small></span>
        <span><Icon name="lock" /><b>Fail closed</b><small>No hidden path</small></span>
      </div>
    </section>
  );
}

export function ArchitectureApp() {
  return (
    <div className="editorial-architecture">
      <div className="editorial-page architecture-page">
        <EditorialNavigation active="architecture" modeLabel="Current system · paper only" />
        <main id="architecture">
          <section className="architecture-hero" aria-labelledby="architecture-title">
            <div className="architecture-hero-copy">
              <span className="architecture-kicker"><i />System architecture · current boundary</span>
              <h1 id="architecture-title">Judgment<br />is not authority.</h1>
              <p>Samaritan turns official market observations into inspectable paper decisions while keeping Claude, risk, execution, and public evidence in deliberately separate lanes.</p>
              <div className="architecture-hero-actions">
                <a href="#system-map">Explore the system <Icon name="arrow" /></a>
                <span><Icon name="lock" /><small>Money path</small><b>Closed</b></span>
              </div>
            </div>
            <aside className="architecture-hero-boundary" aria-label="Samaritan hard boundary">
              <span className="architecture-boundary-label">Hard boundary</span>
              <div className="architecture-boundary-orbit"><span><Icon name="spark" /></span><i /><b><Icon name="shield" /></b></div>
              <p><b>Claude can form a thesis.</b><br />Only deterministic code can admit, size, or reject it.</p>
              <footer><span><i />Paper execution</span><em>No wallet connected</em></footer>
            </aside>
          </section>

          <OperatingPath />
          <div id="system-map"><SystemMap /></div>
          <AuthoritySplit />
          <EvidencePlanes />
          <CapabilityBoundary />

          <footer className="architecture-final-boundary">
            <span><Icon name="lock" /></span>
            <div><small>Current public boundary</small><b>No wallet. No real order. No raw licensed feed. No submitted anchor.</b></div>
            <a href="/casebook">Read the decisions <Icon name="arrow" /></a>
          </footer>
        </main>
      </div>
    </div>
  );
}
