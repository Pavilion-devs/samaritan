import { join } from "node:path";
import {
  authHeaders,
  epochDayFromIso,
  fetchJson,
  getNetwork,
  loadToken,
  logManifest,
  NETWORKS,
  parseArgs,
  SAMPLES_DIR,
  stringArg,
  timestampSlug,
  writeJson,
  writeText
} from "./lib.js";

type Fixture = Record<string, unknown> & {
  FixtureId?: number;
  CompetitionId?: number;
  Competition?: string | Record<string, unknown>;
  StartTime?: string | number;
};

function fixtureId(fixture: Fixture): string {
  return String(fixture.FixtureId ?? fixture.fixtureId ?? fixture.id ?? "unknown");
}

function competitionName(fixture: Fixture): string {
  const value = fixture.Competition;
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    return String(value.Name ?? value.name ?? value.Competition ?? JSON.stringify(value));
  }
  return "";
}

function competitionId(fixture: Fixture): number | undefined {
  const value = fixture.CompetitionId ?? fixture.competitionId;
  return typeof value === "number" ? value : undefined;
}

function startTimeMs(fixture: Fixture): number {
  const value = fixture.StartTime ?? fixture.startTime;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) return asNumber;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const network = getNetwork(args);
  const token = await loadToken(network);
  const config = NETWORKS[network];
  const runId = timestampSlug();
  const starts = (stringArg(args, "starts") ?? "2026-06-11,2026-06-20,2026-07-01")
    .split(",")
    .map((date) => date.trim())
    .filter(Boolean);

  const allFixtures = new Map<string, Fixture>();
  const rawPaths: string[] = [];

  for (const start of starts) {
    const epochDay = epochDayFromIso(start);
    const url = `${config.apiOrigin}/api/fixtures/snapshot?startEpochDay=${epochDay}`;
    const data = await fetchJson<Fixture[]>(url, { headers: authHeaders(token) });
    const path = join(SAMPLES_DIR, "fixtures", `${network}-snapshot-${epochDay}-${runId}.json`);
    await writeJson(path, data);
    rawPaths.push(path);
    for (const fixture of data) allFixtures.set(fixtureId(fixture), fixture);
    await logManifest({
      type: "txline-fixtures-snapshot",
      network,
      endpoint: "/api/fixtures/snapshot",
      query: { startEpochDay: epochDay },
      rows: data.length,
      path
    });
  }

  const competitions = new Map<string, { id?: number; name: string; rows: number }>();
  for (const fixture of allFixtures.values()) {
    const id = competitionId(fixture);
    const name = competitionName(fixture);
    const key = `${id ?? "unknown"}:${name}`;
    const existing = competitions.get(key) ?? { id, name, rows: 0 };
    existing.rows += 1;
    competitions.set(key, existing);
  }

  const explicitCompetitionId = stringArg(args, "competition-id");
  const candidateIds = [...competitions.values()]
    .filter((item) =>
      explicitCompetitionId
        ? String(item.id) === explicitCompetitionId
        : /world cup|fifa/i.test(item.name)
    )
    .map((item) => item.id)
    .filter((id): id is number => typeof id === "number");
  const uniqueCandidateIds = [...new Set(candidateIds)];

  const worldCupFixtures = [...allFixtures.values()]
    .filter((fixture) => uniqueCandidateIds.includes(competitionId(fixture) ?? -1))
    .sort((a, b) => startTimeMs(a) - startTimeMs(b));

  const summaryPath = join(SAMPLES_DIR, "fixtures", `${network}-summary-${runId}.md`);
  await writeText(
    summaryPath,
    [
      `# Fixtures Capture (${network})`,
      "",
      `Captured: ${new Date().toISOString()}`,
      `Raw snapshots: ${rawPaths.length}`,
      `Unique fixtures: ${allFixtures.size}`,
      "",
      "## Competition Candidates",
      "",
      "| CompetitionId | Competition | Rows |",
      "|---:|---|---:|",
      ...[...competitions.values()]
        .sort((a, b) => b.rows - a.rows)
        .map((item) => `| ${item.id ?? ""} | ${item.name || ""} | ${item.rows} |`),
      "",
      "## World Cup Selection",
      "",
      `Selected CompetitionId(s): ${uniqueCandidateIds.join(", ") || "none found"}`,
      `Selected fixtures: ${worldCupFixtures.length}`,
      ""
    ].join("\n")
  );

  const worldCupPath = join(SAMPLES_DIR, "fixtures", `${network}-world-cup-fixtures.json`);
  await writeJson(worldCupPath, worldCupFixtures);
  await logManifest({
    type: "txline-fixtures-world-cup-derived",
    network,
    endpoint: "/api/fixtures/snapshot",
    selectedCompetitionIds: uniqueCandidateIds,
    rows: worldCupFixtures.length,
    path: worldCupPath
  });

  console.log(`Captured ${rawPaths.length} fixture snapshots for ${network}.`);
  console.log(`Unique fixtures: ${allFixtures.size}`);
  console.log(`World Cup candidate IDs: ${uniqueCandidateIds.join(", ") || "none found"}`);
  console.log(`World Cup fixtures saved: ${worldCupFixtures.length}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
