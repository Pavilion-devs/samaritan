export type CaptureReadiness = {
  generatedAt: string;
  requiredLeadMs: number;
  fixtures: Array<{
    home: string;
    away: string;
    kickoffTsMs: number;
    eventSlugs: string[];
    polymarketEventIds: string[];
    txlineFixtureId: string | null;
    status: "ready_for_human_confirmation" | "blocked_missing_txline_fixture";
    recommendedCaptureStartTsMs: number;
    signalCutoffTsMs: number;
  }>;
};

type GammaEvent = {
  id?: string | number;
  slug?: string;
  title?: string;
  teams?: Array<{ name?: string }>;
  markets?: Array<{ gameStartTime?: string }>;
};

type TxLineFixture = {
  FixtureId?: string | number;
  Participant1?: string;
  Participant2?: string;
  StartTime?: string | number;
};

function normalizeTeam(value: unknown): string {
  const normalized = String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return ({
    usa: "united states",
    "korea republic": "south korea",
    czechia: "czech republic",
    turkiye: "turkey",
    "cabo verde": "cape verde"
  } as Record<string, string>)[normalized] ?? normalized;
}

function kickoffMs(value: string | number | undefined): number {
  if (typeof value === "number") return value;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  return Date.parse(String(value ?? ""));
}

function gammaKickoff(event: GammaEvent): number {
  return (event.markets ?? [])
    .map((market) => Date.parse(String(market.gameStartTime ?? "")))
    .find(Number.isFinite) ?? Number.NaN;
}

function gammaTeams(event: GammaEvent): [string, string] | null {
  const teams = (event.teams ?? []).map((team) => String(team.name ?? "")).filter(Boolean);
  if (teams.length >= 2) return [teams[0]!, teams[1]!];
  const title = String(event.title ?? "").replace(/\s+-\s+More Markets.*$/i, "");
  const match = title.match(/^(.+?)\s+vs\.?\s+(.+?)$/i);
  return match ? [match[1]!, match[2]!] : null;
}

export function buildCaptureReadiness(input: {
  generatedAt: string;
  nowTsMs: number;
  requiredLeadMs: number;
  signalCutoffMs: number;
  gammaEvents: readonly GammaEvent[];
  txlineFixtures: readonly TxLineFixture[];
}): CaptureReadiness {
  if (!Number.isSafeInteger(input.nowTsMs) || input.requiredLeadMs <= input.signalCutoffMs) {
    throw new Error("Capture readiness requires valid time and lead settings");
  }
  const groups = new Map<string, {
    home: string;
    away: string;
    kickoffTsMs: number;
    eventSlugs: Set<string>;
    eventIds: Set<string>;
  }>();
  for (const event of input.gammaEvents) {
    const teams = gammaTeams(event);
    const kickoffTsMs = gammaKickoff(event);
    if (!teams || !Number.isFinite(kickoffTsMs) || kickoffTsMs <= input.nowTsMs) continue;
    const slug = String(event.slug ?? "");
    if (!/^fifwc-/.test(slug) || (!slug.endsWith("-more-markets") && /-(halftime|second-half|exact-score|first-to-score|total-corners|player-props)/.test(slug))) {
      continue;
    }
    const teamKey = teams.map(normalizeTeam).sort().join("|");
    const key = `${teamKey}:${kickoffTsMs}`;
    const group = groups.get(key) ?? {
      home: teams[0],
      away: teams[1],
      kickoffTsMs,
      eventSlugs: new Set<string>(),
      eventIds: new Set<string>()
    };
    if (slug) group.eventSlugs.add(slug);
    if (event.id !== undefined) group.eventIds.add(String(event.id));
    groups.set(key, group);
  }
  const fixtures = [...groups.values()]
    .sort((left, right) => left.kickoffTsMs - right.kickoffTsMs)
    .map((group) => {
      const teamKey = [group.home, group.away].map(normalizeTeam).sort().join("|");
      const matches = input.txlineFixtures.filter((fixture) =>
        [fixture.Participant1, fixture.Participant2].map(normalizeTeam).sort().join("|") === teamKey &&
        Math.abs(kickoffMs(fixture.StartTime) - group.kickoffTsMs) <= 15 * 60_000
      );
      if (matches.length > 1) throw new Error(`Multiple TXLine fixtures match ${group.home} vs ${group.away}`);
      const fixture = matches[0];
      return {
        home: group.home,
        away: group.away,
        kickoffTsMs: group.kickoffTsMs,
        eventSlugs: [...group.eventSlugs].sort(),
        polymarketEventIds: [...group.eventIds].sort(),
        txlineFixtureId: fixture ? String(fixture.FixtureId ?? "") : null,
        status: fixture ? "ready_for_human_confirmation" as const : "blocked_missing_txline_fixture" as const,
        recommendedCaptureStartTsMs: group.kickoffTsMs - input.requiredLeadMs,
        signalCutoffTsMs: group.kickoffTsMs - input.signalCutoffMs
      };
    });
  return { generatedAt: input.generatedAt, requiredLeadMs: input.requiredLeadMs, fixtures };
}

export function renderCaptureReadinessMarkdown(readiness: CaptureReadiness): string {
  const rows = readiness.fixtures.map((fixture) =>
    `| ${fixture.home} vs ${fixture.away} | ${new Date(fixture.kickoffTsMs).toISOString()} | ${fixture.txlineFixtureId ?? "missing"} | ${fixture.status} | ${new Date(fixture.recommendedCaptureStartTsMs).toISOString()} | ${new Date(fixture.signalCutoffTsMs).toISOString()} |`
  );
  return [
    "# Paired Capture Readiness",
    "",
    `Generated ${readiness.generatedAt}. Public Polymarket discovery plus the local TXLine fixture snapshot; no authenticated refresh was performed.`,
    "",
    "| Match | Kickoff UTC | TXLine fixture | Status | Recommended capture start | Latest registered signal time |",
    "|---|---:|---:|---|---:|---:|",
    ...rows,
    "",
    "A capture remains blocked until TXLine fixture ID, teams, and kickoff match an exact Polymarket event family and Deborah confirms the mapping. Recommended start is three hours before kickoff so the frozen feature windows warm up before the 15-minute signal cutoff.",
    ""
  ].join("\n");
}
