import type { ReactNode } from "react";

export type ProductRoute = "command" | "matchroom" | "casebook" | "study" | "proof";

export type IconName =
  | "arrow"
  | "case"
  | "chart"
  | "check"
  | "chevron"
  | "clock"
  | "command"
  | "cup"
  | "lock"
  | "minus"
  | "pause"
  | "play"
  | "proof"
  | "pulse"
  | "replay"
  | "shield"
  | "spark"
  | "system";

export function Icon({ name, className }: { name: IconName; className?: string }) {
  const paths: Record<IconName, ReactNode> = {
    arrow: <><path d="M5 12h13" /><path d="m14 8 4 4-4 4" /></>,
    case: <><path d="M5 3h11l3 3v15H5z" /><path d="M8 10h8M8 14h8M8 18h5" /></>,
    chart: <path d="M4 19V9m5 10V5m5 14v-7m5 7V3" />,
    check: <path d="m7 12 3 3 7-7" />,
    chevron: <path d="m7 10 5 5 5-5" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    command: <><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" /></>,
    cup: <path d="m12 2 2.5 5.2 5.5.8-4 4 .9 5.7-4.9-2.8-4.9 2.8.9-5.7-4-4 5.5-.8L12 2Z" />,
    lock: <><rect x="6" y="10" width="12" height="10" rx="2" /><path d="M9 10V7a3 3 0 0 1 6 0v3" /></>,
    minus: <path d="M7 12h10" />,
    pause: <path d="M8 6v12M16 6v12" />,
    play: <path d="m9 6 9 6-9 6V6Z" />,
    proof: <><path d="m12 3 7 3v5c0 4.8-2.7 8-7 10-4.3-2-7-5.2-7-10V6l7-3Z" /><path d="m9 12 2 2 4-5" /></>,
    pulse: <path d="M3 12h4l2-6 4 12 2-6h6" />,
    replay: <><circle cx="12" cy="12" r="9" /><path d="m8.5 8.5 3.5-2 3.5 2-.7 4H9.2l-.7-4ZM9.2 12.5 7 16m7.8-3.5L17 16" /></>,
    shield: <><path d="m12 3 7 3v5c0 4.8-2.7 8-7 10-4.3-2-7-5.2-7-10V6l7-3Z" /><rect x="9" y="10" width="6" height="5" rx="1" /><path d="M10.5 10V8.8a1.5 1.5 0 0 1 3 0V10" /></>,
    spark: <><path d="m12 3 1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3Z" /><path d="m18 16 .7 2.3L21 19l-2.3.7L18 22l-.7-2.3L15 19l2.3-.7L18 16Z" /></>,
    system: <><path d="M5 5v14M19 5v14M9 8h6M9 12h6M9 16h6" /></>
  };
  return <svg className={className} viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

export function BrandMark() {
  return <span className="brand-mark" aria-hidden="true"><i /><i /></span>;
}

export function EditorialNavigation({ active, modeLabel }: { active: ProductRoute; modeLabel: string }) {
  const links: Array<{ id: ProductRoute; href: string; label: string }> = [
    { id: "command", href: "/command", label: "Overview" },
    { id: "matchroom", href: "/matchroom", label: "Live match" },
    { id: "casebook", href: "/casebook", label: "Decisions" },
    { id: "study", href: "/study", label: "Performance" },
    { id: "proof", href: "/proof", label: "Proof" }
  ];

  return (
    <header className="editorial-nav">
      <a className="editorial-brand" href="/command" aria-label="Samaritan overview">
        <BrandMark />
        <span>Samaritan</span>
      </a>
      <nav className="editorial-links" aria-label="Product navigation">
        {links.map((link) => (
          <a
            className={link.id === active ? "active" : undefined}
            href={link.href}
            aria-current={link.id === active ? "page" : undefined}
            key={link.id}
          >
            {link.label}
          </a>
        ))}
      </nav>
      <div className="editorial-observer-state"><i aria-hidden="true" /><span>{modeLabel}</span></div>
    </header>
  );
}

export type ProvenanceTone = "capture" | "configured" | "historical" | "offline" | "synthetic";

export function ProvenanceBadge({ label, tone }: { label: string; tone: ProvenanceTone }) {
  return <span className={`provenance-badge ${tone}`}><i aria-hidden="true" />{label}</span>;
}

export function formatUsdMicros(value: number, minimumFractionDigits = 2) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits,
    maximumFractionDigits: 2
  }).format(value / 1_000_000);
}

export function Navigation({ active, caseCount }: { active: ProductRoute; caseCount?: number }) {
  return (
    <aside className="sidebar">
      <a className="brand" href="/command" aria-label="Samaritan Command home"><BrandMark /><span>Samaritan</span></a>
      <nav className="side-nav" aria-label="Product navigation">
        <span className="nav-group">Workspace</span>
        <a className={active === "command" ? "active" : undefined} href="/command" aria-current={active === "command" ? "page" : undefined}><Icon name="command" /><span>Overview</span></a>
        <a className={active === "matchroom" ? "active" : undefined} href="/matchroom" aria-current={active === "matchroom" ? "page" : undefined}><Icon name="replay" /><span>Live match</span></a>
        <a className={active === "casebook" ? "active" : undefined} href="/casebook" aria-current={active === "casebook" ? "page" : undefined}><Icon name="case" /><span>Decisions</span>{caseCount === undefined ? null : <em>{caseCount}</em>}</a>
        <a className={active === "study" ? "active" : undefined} href="/study" aria-current={active === "study" ? "page" : undefined}><Icon name="chart" /><span>Performance</span></a>
        <a className={active === "proof" ? "active" : undefined} href="/proof" aria-current={active === "proof" ? "page" : undefined}><Icon name="proof" /><span>Proof</span></a>
        <span className="nav-group system-group">Read only</span>
        <a href="/command#system"><Icon name="system" /><span>System</span><i className="feed-dot" aria-label="Offline evidence snapshot available" /></a>
      </nav>
      <div className="sidebar-bottom">
        <div className="gate-card">
          <span className="shield-lock"><Icon name="shield" /></span>
          <span><b>Gate closed</b><small>Real-money disabled in bounty build</small></span>
        </div>
        <div className="owner">
          <span className="owner-avatar">D</span>
          <span><b>Deborah</b><small>Participant · project owner</small></span>
        </div>
      </div>
    </aside>
  );
}

export function MobileNavigation({ active }: { active: ProductRoute }) {
  return (
    <nav className="mobile-nav" aria-label="Mobile product navigation">
      <a className={active === "command" ? "active" : undefined} href="/command"><Icon name="command" /><span>Overview</span></a>
      <a className={active === "matchroom" ? "active" : undefined} href="/matchroom"><Icon name="replay" /><span>Match</span></a>
      <a className={active === "casebook" ? "active" : undefined} href="/casebook"><Icon name="case" /><span>Decisions</span></a>
      <a className={active === "study" ? "active" : undefined} href="/study"><Icon name="chart" /><span>Results</span></a>
      <a className={active === "proof" ? "active" : undefined} href="/proof"><Icon name="proof" /><span>Proof</span></a>
    </nav>
  );
}

export function Topbar({ title, modeLabel, modeClass }: {
  title: string;
  modeLabel: string;
  modeClass: "replay" | "offline";
}) {
  return (
    <header className="topbar">
      <div className="mobile-brand"><BrandMark /><b>Samaritan</b></div>
      <div className="page-title"><span>World Cup 2026 / Observer workspace</span><h1>{title}</h1></div>
      <div className="system-state" aria-label="Artifact system state">
        <span className={`state-chip ${modeClass}`}><i />{modeLabel}</span>
        <span className="state-chip paper">No real orders</span>
        <span className="state-chip gate"><Icon name="shield" />Real-money gate closed</span>
      </div>
    </header>
  );
}
