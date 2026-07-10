import { join } from "node:path";
import { existsSync } from "node:fs";
import {
  appendJsonl,
  authHeaders,
  dateFromEpochDay,
  epochDayFromIso,
  fetchText,
  getNetwork,
  loadToken,
  logManifest,
  NETWORKS,
  numberArg,
  parseArgs,
  readJson,
  SAMPLES_DIR,
  stringArg,
  timestampSlug,
  writeText
} from "./lib.js";

type Fixture = Record<string, unknown> & {
  FixtureId?: number;
  StartTime?: string | number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function countRows(text: string): number {
  try {
    const json = JSON.parse(text) as unknown;
    return Array.isArray(json) ? json.length : text.trim() ? 1 : 0;
  } catch {
    return text.trim() ? 1 : 0;
  }
}

function fixtureId(fixture: Fixture): string {
  return String(fixture.FixtureId ?? fixture.fixtureId ?? fixture.id ?? "");
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

async function captureIntervalFamily(options: {
  network: string;
  apiOrigin: string;
  headers: Record<string, string>;
  family: "odds" | "scores";
  fromEpochDay: number;
  toEpochDay: number;
  sleepMs: number;
  concurrency: number;
  maxIntervals: number;
  fixtureId?: string;
  runId: string;
}): Promise<void> {
  const retentionLog = join(SAMPLES_DIR, "_logs", `retention-${options.network}-${options.runId}.jsonl`);
  const tasks: Array<{ day: number; hour: number; interval: number }> = [];
  for (let day = options.fromEpochDay; day <= options.toEpochDay; day += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      for (let interval = 0; interval < 12; interval += 1) {
        tasks.push({ day, hour, interval });
      }
    }
  }
  const selectedTasks = options.maxIntervals > 0 ? tasks.slice(0, options.maxIntervals) : tasks;
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const task = selectedTasks[nextIndex];
      nextIndex += 1;
      if (!task) return;
      const { day, hour, interval } = task;
      const pathOnly = `/api/${options.family}/updates/${day}/${hour}/${interval}`;
      const qs = options.fixtureId ? `?fixtureId=${encodeURIComponent(options.fixtureId)}` : "";
      const url = `${options.apiOrigin}${pathOnly}${qs}`;
      let response: Awaited<ReturnType<typeof fetchText>>;
      let transportError = "";
      try {
        response = await fetchText(url, { headers: options.headers });
      } catch (error) {
        transportError = error instanceof Error ? error.message : String(error);
        response = { ok: false, status: 0, contentType: "", text: "" };
      }
      const rows = response.ok ? countRows(response.text) : 0;
      let savedPath = "";
      if (response.ok && rows > 0) {
        savedPath = join(
          SAMPLES_DIR,
          options.family === "odds" ? "odds-historical" : "scores",
          options.network,
          String(day),
          `${hour.toString().padStart(2, "0")}-${interval.toString().padStart(2, "0")}.json`
        );
        await writeText(savedPath, response.text.endsWith("\n") ? response.text : `${response.text}\n`);
        await logManifest({
          type: `txline-${options.family}-interval`,
          network: options.network,
          endpoint: pathOnly,
          query: options.fixtureId ? { fixtureId: options.fixtureId } : {},
          status: response.status,
          rows,
          path: savedPath
        });
      }
      await appendJsonl(retentionLog, {
        checkedAt: new Date().toISOString(),
        network: options.network,
        family: options.family,
        endpoint: pathOnly,
        fixtureId: options.fixtureId,
        epochDay: day,
        date: dateFromEpochDay(day),
        hour,
        interval,
        status: response.status,
        ok: response.ok,
        rows,
        savedPath,
        transportError
      });
      if (options.sleepMs > 0) await sleep(options.sleepMs);
    }
  }

  const workerCount = Math.max(1, Math.min(options.concurrency, selectedTasks.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
}

async function captureScoresHistorical(options: {
  network: string;
  apiOrigin: string;
  headers: Record<string, string>;
  fixturesPath: string;
  runId: string;
  sleepMs: number;
}): Promise<void> {
  if (!existsSync(options.fixturesPath)) return;
  const fixtures = await readJson<Fixture[]>(options.fixturesPath);
  const now = Date.now();
  for (const fixture of fixtures.sort((a, b) => startTimeMs(a) - startTimeMs(b))) {
    const id = fixtureId(fixture);
    if (!id || startTimeMs(fixture) > now) continue;
    const endpoint = `/api/scores/historical/${id}`;
    const response = await fetchText(`${options.apiOrigin}${endpoint}`, { headers: options.headers });
    const rows = response.ok ? countRows(response.text) : 0;
    const path = join(SAMPLES_DIR, "scores", options.network, "historical", `${id}.json`);
    if (response.ok) {
      await writeText(path, response.text.endsWith("\n") ? response.text : `${response.text}\n`);
      await logManifest({
        type: "txline-scores-historical",
        network: options.network,
        endpoint,
        status: response.status,
        rows,
        fixtureId: id,
        path
      });
    }
    await appendJsonl(join(SAMPLES_DIR, "_logs", `scores-historical-${options.network}-${options.runId}.jsonl`), {
      checkedAt: new Date().toISOString(),
      network: options.network,
      endpoint,
      fixtureId: id,
      status: response.status,
      ok: response.ok,
      rows,
      path: response.ok ? path : ""
    });
    if (options.sleepMs > 0) await sleep(options.sleepMs);
  }
}

async function main(): Promise<void> {
  const args = parseArgs();
  const network = getNetwork(args);
  const token = await loadToken(network);
  const config = NETWORKS[network];
  const from = stringArg(args, "from", process.env.PHASE0_ARCHIVE_FROM ?? "2026-06-11")!;
  const to = stringArg(args, "to", process.env.PHASE0_ARCHIVE_TO ?? new Date().toISOString().slice(0, 10))!;
  const fromEpochDay = epochDayFromIso(from);
  const toEpochDay = epochDayFromIso(to);
  const families = (stringArg(args, "families", "odds,scores") ?? "odds,scores")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const sleepMs = numberArg(args, "sleep-ms", Number(process.env.PHASE0_ARCHIVE_SLEEP_MS ?? 75));
  const concurrency = numberArg(args, "concurrency", 20);
  const maxIntervals = numberArg(args, "max-intervals", 0);
  const fixtureId = stringArg(args, "fixture-id");
  const runId = timestampSlug();

  for (const family of families) {
    if (family !== "odds" && family !== "scores") throw new Error(`Unknown family ${family}`);
    await captureIntervalFamily({
      network,
      apiOrigin: config.apiOrigin,
      headers: authHeaders(token),
      family,
      fromEpochDay,
      toEpochDay,
      sleepMs,
      concurrency,
      maxIntervals,
      fixtureId,
      runId
    });
  }

  await captureScoresHistorical({
    network,
    apiOrigin: config.apiOrigin,
    headers: authHeaders(token),
    fixturesPath: join(SAMPLES_DIR, "fixtures", `${network}-world-cup-fixtures.json`),
    runId,
    sleepMs
  });

  console.log(`Archive pass complete for ${network} ${from} to ${to}.`);
  console.log(`Retention log run id: ${runId}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
