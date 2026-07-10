import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, join } from "node:path";
import {
  appendJsonl,
  listFilesRecursive,
  SAMPLES_DIR,
  writeText
} from "./lib.js";

type AnyRecord = Record<string, unknown>;

function parseMaybeJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function flattenJsonValues(values: unknown[]): AnyRecord[] {
  const rows: AnyRecord[] = [];
  for (const value of values) {
    if (Array.isArray(value)) {
      for (const item of value) if (item && typeof item === "object") rows.push(item as AnyRecord);
    } else if (value && typeof value === "object") {
      rows.push(value as AnyRecord);
    }
  }
  return rows;
}

function parsePayloadRows(text: string): AnyRecord[] {
  const parsed = parseMaybeJson(text);
  if (parsed !== undefined) return flattenJsonValues([parsed]);

  const rows: AnyRecord[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const value = parseMaybeJson(line.slice(5).trim());
    if (value && typeof value === "object" && !Array.isArray(value)) rows.push(value as AnyRecord);
  }
  return rows;
}

function quantile(values: number[], q: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * q)));
  return sorted[index];
}

function normalizePayloadTimestampMs(value: number): number {
  return value < 10_000_000_000 ? value * 1000 : value;
}

function latencySummaryLines(label: string, deltas: number[]): string[] {
  if (deltas.length === 0) return [`### ${label}`, "", "No data frames with payload timestamps."];
  return [
    `### ${label}`,
    "",
    `Frames with payload timestamps: ${deltas.length}`,
    `p00 ms: ${quantile(deltas, 0)}`,
    `p50 ms: ${quantile(deltas, 0.5)}`,
    `p90 ms: ${quantile(deltas, 0.9)}`,
    `p99 ms: ${quantile(deltas, 0.99)}`,
    `max ms: ${quantile(deltas, 1)}`
  ];
}

function pctValues(row: AnyRecord): string[] {
  return Array.isArray(row.Pct) ? row.Pct.map(String) : [];
}

async function forEachRowsFromDir(
  dir: string,
  onRow: (row: AnyRecord) => void | Promise<void>
): Promise<void> {
  const files = (await listFilesRecursive(dir)).filter((file) => file.endsWith(".json"));
  for (const file of files) {
    for (const row of parsePayloadRows(await readFile(file, "utf8"))) await onRow(row);
  }
}

function increment(map: Map<string, number>, key: unknown, by = 1): void {
  const normalized = String(key ?? "");
  map.set(normalized, (map.get(normalized) ?? 0) + by);
}

function topMap(map: Map<string, number>, limit = 40): string[] {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, count]) => `- \`${key || "(blank)"}\`: ${count}`);
}

function normalizedKey(key: string): string {
  return /^\d+$/.test(key) ? "<numeric>" : key;
}

function walkKeys(value: unknown, prefix: string, out: Map<string, number>, maxDepth = 3): void {
  if (maxDepth < 0 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    increment(out, `${prefix}[]`);
    for (const item of value.slice(0, 25)) walkKeys(item, `${prefix}[]`, out, maxDepth - 1);
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as AnyRecord)) {
    const path = `${prefix}.${normalizedKey(key)}`;
    increment(out, path);
    walkKeys(child, path, out, maxDepth - 1);
  }
}

function walkBooleanValues(
  value: unknown,
  prefix: string,
  trueOut: Map<string, number>,
  falseOut: Map<string, number>,
  maxDepth = 3
): void {
  if (maxDepth < 0 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const item of value) walkBooleanValues(item, `${prefix}[]`, trueOut, falseOut, maxDepth - 1);
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as AnyRecord)) {
    const path = `${prefix}.${normalizedKey(key)}`;
    if (typeof child === "boolean") increment(child ? trueOut : falseOut, path);
    else walkBooleanValues(child, path, trueOut, falseOut, maxDepth - 1);
  }
}

async function analyzeOdds(): Promise<string[]> {
  const bookmakerCounts = new Map<string, number>();
  const superTypes = new Map<string, number>();
  const periods = new Map<string, number>();
  const parameters = new Map<string, number>();
  const gameStates = new Map<string, number>();
  const inRunning = new Map<string, number>();
  let oddsRows = 0;
  let pctRows = 0;
  let pctFormatOk = 0;
  let pctSumNear100 = 0;
  let pctSumNear1 = 0;
  let pricesRows = 0;
  let pricesIntegerRows = 0;

  await forEachRowsFromDir(join(SAMPLES_DIR, "odds-historical"), (row) => {
    oddsRows += 1;
    const bookmaker = `${row.BookmakerId ?? ""}:${row.Bookmaker ?? ""}`;
    bookmakerCounts.set(bookmaker, (bookmakerCounts.get(bookmaker) ?? 0) + 1);
    for (const [map, value] of [
      [superTypes, row.SuperOddsType],
      [periods, row.MarketPeriod],
      [parameters, row.MarketParameters],
      [gameStates, row.GameState],
      [inRunning, row.InRunning]
    ] as Array<[Map<string, number>, unknown]>) {
      const key = String(value ?? "");
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    const pct = pctValues(row);
    if (pct.length > 0) {
      pctRows += 1;
      if (pct.every((value) => /^(NA|\d+\.\d{3})$/.test(value))) pctFormatOk += 1;
      const nums = pct.filter((value) => value !== "NA").map(Number);
      const sum = nums.reduce((acc, value) => acc + value, 0);
      if (Math.abs(sum - 100) < 1.5) pctSumNear100 += 1;
      if (Math.abs(sum - 1) < 0.015) pctSumNear1 += 1;
    }
    if (Array.isArray(row.Prices)) {
      pricesRows += 1;
      if (row.Prices.every((value) => Number.isInteger(value))) pricesIntegerRows += 1;
    }
  });

  return [
    "## Odds Payload Verification",
    "",
    `Rows scanned: ${oddsRows}`,
    `Distinct bookmaker keys: ${bookmakerCounts.size}`,
    "",
    "### Bookmakers",
    "",
    ...topMap(bookmakerCounts, 80),
    "",
    "### Pct and Prices",
    "",
    `Pct rows: ${pctRows}`,
    `Pct rows matching strict 3-decimal strings or NA: ${pctFormatOk}`,
    `Pct rows summing near 100: ${pctSumNear100}`,
    `Pct rows summing near 1: ${pctSumNear1}`,
    `Prices rows: ${pricesRows}`,
    `Prices rows with integer prices: ${pricesIntegerRows}`,
    "",
    "### SuperOddsType",
    "",
    ...topMap(superTypes),
    "",
    "### MarketParameters",
    "",
    ...topMap(parameters),
    "",
    "### MarketPeriod",
    "",
    ...topMap(periods),
    "",
    "### InRunning",
    "",
    ...topMap(inRunning),
    "",
    "### GameState",
    "",
    ...topMap(gameStates),
    ""
  ];
}

async function analyzeScores(): Promise<string[]> {
  const fields = new Map<string, number>();
  const statusIds = new Map<string, number>();
  const gameStates = new Map<string, number>();
  const actions = new Map<string, number>();
  const dataKeys = new Map<string, number>();
  const dataTrueFlags = new Map<string, number>();
  const dataFalseFlags = new Map<string, number>();
  const scoreKeys = new Map<string, number>();
  const playerStatsKeys = new Map<string, number>();
  const possibleEventKeys = new Map<string, number>();
  const statsKeyPresence = new Map<string, number>();
  const statsKeyNonZero = new Map<string, number>();
  const statsPeriodPrefixes = new Map<string, number>();
  const statsBaseKeys = new Map<string, number>();
  const watchedActions = [
    "goal",
    "corner",
    "shot",
    "var",
    "penalty",
    "yellow_card",
    "red_card",
    "yellowcard",
    "redcard"
  ];
  let rowsWithClock = 0;
  let rowsWithStats = 0;
  let rowsWithData = 0;
  let rowsWithLineups = 0;
  let rowsWithPlayerStats = 0;
  let rowsWithPossibleEvent = 0;
  let scoreRows = 0;

  await forEachRowsFromDir(join(SAMPLES_DIR, "scores"), (row) => {
    scoreRows += 1;
    for (const key of Object.keys(row)) increment(fields, key);
    increment(statusIds, row.StatusId ?? row.statusSoccerId ?? row.statusId ?? "");
    increment(gameStates, row.GameState ?? row.gameState ?? "");
    increment(actions, row.Action ?? row.action ?? "");

    if (row.Clock && typeof row.Clock === "object") rowsWithClock += 1;
    if (row.Lineups && Array.isArray(row.Lineups)) rowsWithLineups += 1;
    if (row.PlayerStats && typeof row.PlayerStats === "object") {
      rowsWithPlayerStats += 1;
      walkKeys(row.PlayerStats, "PlayerStats", playerStatsKeys, 4);
    }
    if (row.Score && typeof row.Score === "object") walkKeys(row.Score, "Score", scoreKeys, 4);
    if (row.PossibleEvent && typeof row.PossibleEvent === "object") {
      rowsWithPossibleEvent += 1;
      walkKeys(row.PossibleEvent, "PossibleEvent", possibleEventKeys, 3);
    }
    if (row.Parti1State && typeof row.Parti1State === "object") {
      walkKeys(row.Parti1State, "Parti1State", possibleEventKeys, 3);
    }
    if (row.Parti2State && typeof row.Parti2State === "object") {
      walkKeys(row.Parti2State, "Parti2State", possibleEventKeys, 3);
    }

    const data = row.Data ?? row.dataSoccer;
    if (data && typeof data === "object") {
      rowsWithData += 1;
      walkKeys(data, "Data", dataKeys, 4);
      walkBooleanValues(data, "Data", dataTrueFlags, dataFalseFlags, 4);
    }

    const stats = row.Stats ?? row.stats;
    if (stats && typeof stats === "object") {
      rowsWithStats += 1;
      for (const [key, value] of Object.entries(stats as AnyRecord)) {
        increment(statsKeyPresence, key);
        const numericKey = Number(key);
        if (Number.isInteger(numericKey)) {
          increment(statsPeriodPrefixes, Math.floor(numericKey / 1000));
          increment(statsBaseKeys, numericKey % 1000);
        }
        if (Number(value) !== 0) increment(statsKeyNonZero, key);
      }
    }
  });

  const watchedActionLines = watchedActions.map(
    (action) => `- \`${action}\`: ${actions.get(action) ?? 0}`
  );

  return [
    "## Scores Payload Verification",
    "",
    `Rows scanned: ${scoreRows}`,
    `Rows with Clock: ${rowsWithClock}`,
    `Rows with Stats: ${rowsWithStats}`,
    `Rows with Data: ${rowsWithData}`,
    `Rows with Score object: ${[...scoreKeys.values()].reduce((acc, value) => acc + value, 0) > 0 ? "yes" : "no"}`,
    `Rows with PossibleEvent envelope: ${rowsWithPossibleEvent}`,
    `Rows with PlayerStats: ${rowsWithPlayerStats}`,
    `Rows with Lineups: ${rowsWithLineups}`,
    "",
    "### High-Stakes Event Checks",
    "",
    ...watchedActionLines,
    "",
    "Boolean `Data` flags observed as true:",
    "",
    ...topMap(dataTrueFlags, 40),
    "",
    "Boolean `Data` flags observed as false:",
    "",
    ...topMap(dataFalseFlags, 40),
    "",
    "### Stats Key Encoding",
    "",
    `Distinct numeric Stats keys: ${statsKeyPresence.size}`,
    "",
    "Period prefixes observed (`floor(key / 1000)`):",
    "",
    ...topMap(statsPeriodPrefixes, 20),
    "",
    "Base keys observed (`key % 1000`):",
    "",
    ...topMap(statsBaseKeys, 20),
    "",
    "Stats keys with non-zero values:",
    "",
    ...topMap(statsKeyNonZero, 80),
    "",
    "### Actions",
    "",
    ...topMap(actions, 120),
    "",
    "### Data Keys",
    "",
    ...topMap(dataKeys, 120),
    "",
    "### Score Object Keys",
    "",
    ...topMap(scoreKeys, 80),
    "",
    "### PlayerStats Keys",
    "",
    ...topMap(playerStatsKeys, 80),
    "",
    "### Possible Event State Keys",
    "",
    ...topMap(possibleEventKeys, 80),
    "",
    "### Fields Seen",
    "",
    ...topMap(fields, 160),
    "",
    "### Status IDs / States",
    "",
    ...topMap(statusIds, 40),
    "",
    "### GameState",
    "",
    ...topMap(gameStates, 40),
    ""
  ];
}

async function writeLatency(): Promise<void> {
  const frameFiles = (await listFilesRecursive(join(SAMPLES_DIR, "odds-sse"))).filter((file) =>
    file.endsWith(".frames.ndjson")
  );
  type LatencyClass = "steady-state unique first delivery" | "duplicate/replayed" | "reconnect catch-up";
  type ClassifiedFrame = { delta: number; stream: string; classification: LatencyClass };
  const classified: ClassifiedFrame[] = [];
  const allDeltas: number[] = [];
  const allDeltasByStream = new Map<string, number[]>();
  const seenIdentities = new Set<string>();
  const reconnectWindows = new Map<string, number[]>();
  const reconnectFiles = [...new Set(frameFiles.map((file) => join(dirname(file), "reconnects.ndjson")))];
  const outageDurations: Array<{ stream: string; disconnectedAt: string; reconnectedAt: string; durationMs: number }> = [];
  for (const reconnectFile of reconnectFiles) {
    const rows = (await readFile(reconnectFile, "utf8").catch(() => ""))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as AnyRecord)
      .sort((a, b) => Date.parse(String(a.at ?? "")) - Date.parse(String(b.at ?? "")));
    for (const row of rows) {
      if (row.action !== "connect") continue;
      const stream = String(row.stream ?? "unknown");
      const key = `${dirname(reconnectFile)}:${stream}`;
      if (!reconnectWindows.has(key)) reconnectWindows.set(key, []);
      reconnectWindows.get(key)!.push(Date.parse(String(row.at ?? "")));
    }
    for (const stream of [...new Set(rows.map((row) => String(row.stream ?? "unknown")))]) {
      const streamRows = rows.filter((row) => String(row.stream ?? "unknown") === stream);
      for (const [index, row] of streamRows.entries()) {
        if (row.action !== "disconnect") continue;
        const nextConnect = streamRows.slice(index + 1).find((candidate) => candidate.action === "connect");
        if (!nextConnect) continue;
        const disconnectedAt = Date.parse(String(row.at ?? ""));
        const reconnectedAt = Date.parse(String(nextConnect.at ?? ""));
        if (!Number.isFinite(disconnectedAt) || !Number.isFinite(reconnectedAt)) continue;
        outageDurations.push({
          stream,
          disconnectedAt: new Date(disconnectedAt).toISOString(),
          reconnectedAt: new Date(reconnectedAt).toISOString(),
          durationMs: reconnectedAt - disconnectedAt
        });
      }
    }
  }
  let heartbeatFrames = 0;
  let framesWithoutPayloadTs = 0;
  for (const file of frameFiles) {
    for (const line of (await readFile(file, "utf8")).split("\n")) {
      if (!line.trim()) continue;
      const frame = JSON.parse(line) as AnyRecord;
      const raw = String(frame.rawFrame ?? "");
      if (frame.event === "heartbeat" || raw.split(/\r?\n/).some((item) => item === "event: heartbeat")) {
        heartbeatFrames += 1;
        continue;
      }
      const dataLine = raw.split(/\r?\n/).find((item) => item.startsWith("data:"));
      if (!dataLine) continue;
      const data = parseMaybeJson(dataLine.slice(5).trim()) as AnyRecord | undefined;
      const payloadTs = Number(data?.Ts ?? data?.ts);
      const receivedAt = Date.parse(String(frame.receivedAt));
      if (Number.isFinite(payloadTs) && Number.isFinite(receivedAt)) {
        const delta = receivedAt - normalizePayloadTimestampMs(payloadTs);
        const stream = String(frame.stream ?? "unknown");
        allDeltas.push(delta);
        if (!allDeltasByStream.has(stream)) allDeltasByStream.set(stream, []);
        allDeltasByStream.get(stream)!.push(delta);
        const identityFields = [
          data?.MessageId,
          data?.FixtureId,
          data?.Id,
          data?.Seq,
          data?.Ts,
          data?.Action,
          data?.SuperOddsType,
          data?.MarketParameters,
          data?.MarketPeriod
        ].map((value) => String(value ?? ""));
        const stableIdentity = data?.MessageId !== undefined || data?.Id !== undefined
          ? `${stream}:${identityFields.join(":")}`
          : `${stream}:${createHash("sha256").update(dataLine.slice(5).trim()).digest("hex")}`;
        const duplicate = seenIdentities.has(stableIdentity);
        if (!duplicate) seenIdentities.add(stableIdentity);
        const windowKey = `${dirname(file)}:${stream}`;
        const catchUp = (reconnectWindows.get(windowKey) ?? []).some(
          (connectedAt) => receivedAt >= connectedAt && receivedAt <= connectedAt + 90_000
        );
        classified.push({
          delta,
          stream,
          classification: duplicate
            ? "duplicate/replayed"
            : catchUp
              ? "reconnect catch-up"
              : "steady-state unique first delivery"
        });
      } else {
        framesWithoutPayloadTs += 1;
      }
    }
  }
  const streamSections = [...allDeltasByStream.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([stream, streamDeltas]) => ["", ...latencySummaryLines(`Stream: ${stream}`, streamDeltas)]);
  const categorySections = ([
    "steady-state unique first delivery",
    "duplicate/replayed",
    "reconnect catch-up"
  ] as LatencyClass[]).flatMap((classification) => {
    const rows = classified.filter((frame) => frame.classification === classification);
    const byStream = [...new Set(rows.map((row) => row.stream))]
      .sort()
      .flatMap((stream) => [
        "",
        ...latencySummaryLines(
          `${classification} — ${stream}`,
          rows.filter((row) => row.stream === stream).map((row) => row.delta)
        )
      ]);
    return [
      "",
      ...latencySummaryLines(classification, rows.map((row) => row.delta)),
      ...byStream
    ];
  });
  const steady = classified.filter((frame) => frame.classification === "steady-state unique first delivery");
  const steadyNegative = steady.filter((frame) => frame.delta < 0);
  const negativeByStream = [...new Set(steady.map((row) => row.stream))]
    .sort()
    .map((stream) => {
      const streamRows = steady.filter((row) => row.stream === stream);
      const negatives = streamRows.filter((row) => row.delta < 0);
      return `| ${stream} | ${negatives.length} | ${streamRows.length} | ${streamRows.length ? ((negatives.length / streamRows.length) * 100).toFixed(2) : "0.00"}% | ${negatives.length ? quantile(negatives.map((row) => row.delta), 0) : ""} |`;
    });
  const outageValues = outageDurations.map((row) => row.durationMs);
  await writeText(
    join(SAMPLES_DIR, "LATENCY.md"),
    [
      "# TXLine SSE Latency",
      "",
      `Generated: ${new Date().toISOString()}`,
      "Heartbeat frames are excluded. Payload timestamps observed in seconds are normalized to milliseconds. The original aggregate is retained below; the revised interpretation separates reconnect effects.",
      "",
      `Heartbeat frames skipped: ${heartbeatFrames}`,
      `Non-heartbeat frames without payload timestamps: ${framesWithoutPayloadTs}`,
      "",
      "## Original aggregate (retained)",
      "",
      ...latencySummaryLines("All Non-Heartbeat Frames", allDeltas),
      ...streamSections,
      "",
      "## Revised classification",
      "",
      "A duplicate/replayed frame repeats the same payload identity already observed. A reconnect catch-up frame is a unique first delivery received in the first 90 seconds after any connection, including initial bootstrap. Steady-state excludes both categories. The conservative 90-second boundary is an analysis label chosen to isolate observed bootstrap/backfill bursts, not a claim about server internals.",
      ...categorySections,
      "",
      "## Reconnect outages",
      "",
      `Completed reconnect outages: ${outageDurations.length}`,
      `Total outage duration ms: ${outageValues.reduce((sum, value) => sum + value, 0)}`,
      `Median outage duration ms: ${quantile(outageValues, 0.5) ?? ""}`,
      `Maximum outage duration ms: ${quantile(outageValues, 1) ?? ""}`,
      "",
      "| Stream | Disconnected UTC | Reconnected UTC | Outage ms |",
      "|---|---|---|---:|",
      ...outageDurations.map((row) => `| ${row.stream} | ${row.disconnectedAt} | ${row.reconnectedAt} | ${row.durationMs} |`),
      "",
      "## Clock-skew / negative-delta observations",
      "",
      `Negative steady-state deltas: ${steadyNegative.length}/${steady.length}. Small negative deltas mean the payload clock is slightly ahead of the capture host clock; they are not negative network latency.`,
      "",
      "| Stream | Negative frames | Steady frames | Share | Most negative ms |",
      "|---|---:|---:|---:|---:|",
      ...negativeByStream,
      "",
      "## Revised interpretation",
      "",
      "- Use the steady-state unique first-delivery distribution for ordinary delivery timing. The original p90/p99/max combine ordinary delivery with duplicate/replay and reconnect catch-up behavior.",
      "- The remaining long odds tail in the steady-state class is receive-time minus payload `Ts`, not a packet-level transit timer. It may include upstream generation/batching semantics and must not be labeled pure network latency without a server-send timestamp.",
      "- Reconnect outage durations are operational availability measurements, not per-frame network latency.",
      "- Replayed and catch-up frames remain in the raw capture and in the original aggregate; they are not discarded.",
      "- Historical one-minute Polymarket prices cannot prove a seconds-level STALE_QUOTE edge. That requires synchronized live order-book capture alongside TXLine.",
      ""
    ].join("\n")
  );
}

async function writeRetention(): Promise<void> {
  const logs = (await listFilesRecursive(join(SAMPLES_DIR, "_logs"))).filter((file) =>
    basename(file).startsWith("retention-")
  );
  const scoreHistoricalLogs = (await listFilesRecursive(join(SAMPLES_DIR, "_logs"))).filter((file) =>
    basename(file).startsWith("scores-historical-")
  );
  const fixtureFiles = (await listFilesRecursive(join(SAMPLES_DIR, "fixtures"))).filter((file) =>
    file.endsWith("world-cup-fixtures.json")
  );
  const fixtureStartDates = new Map<string, string>();
  for (const file of fixtureFiles) {
    for (const fixture of parsePayloadRows(await readFile(file, "utf8"))) {
      const id = fixture.FixtureId ?? fixture.fixtureId ?? fixture.id;
      const start = fixture.StartTime ?? fixture.startTime;
      const startMs = typeof start === "number" ? start : Date.parse(String(start ?? ""));
      if (id && Number.isFinite(startMs)) {
        fixtureStartDates.set(String(id), new Date(startMs).toISOString().slice(0, 10));
      }
    }
  }
  const latestIntervals = new Map<string, AnyRecord>();
  const latestHistorical = new Map<string, AnyRecord>();
  const isLater = (candidate: AnyRecord, existing?: AnyRecord) =>
    !existing || String(candidate.checkedAt ?? "") > String(existing.checkedAt ?? "");

  for (const file of logs) {
    for (const line of (await readFile(file, "utf8")).split("\n")) {
      if (!line.trim()) continue;
      const row = JSON.parse(line) as AnyRecord;
      const key = `${row.network}:${row.family}:${row.endpoint}:${row.fixtureId ?? ""}`;
      if (isLater(row, latestIntervals.get(key))) latestIntervals.set(key, row);
    }
  }

  const byFamilyDay = new Map<string, { okRows: number; emptyOk: number; errors: number }>();
  for (const row of latestIntervals.values()) {
    const key = `${row.network}:${row.family}:${row.date}`;
    const existing = byFamilyDay.get(key) ?? { okRows: 0, emptyOk: 0, errors: 0 };
    if (row.ok && Number(row.rows) > 0) existing.okRows += Number(row.rows);
    else if (row.ok) existing.emptyOk += 1;
    else existing.errors += 1;
    byFamilyDay.set(key, existing);
  }

  for (const file of scoreHistoricalLogs) {
    for (const line of (await readFile(file, "utf8")).split("\n")) {
      if (!line.trim()) continue;
      const row = JSON.parse(line) as AnyRecord;
      const key = `${row.network}:${row.endpoint}`;
      if (isLater(row, latestHistorical.get(key))) latestHistorical.set(key, row);
    }
  }
  const byHistoricalDay = new Map<
    string,
    { fixturesChecked: number; fixturesWithData: number; emptyOk: number; errors: number }
  >();
  for (const row of latestHistorical.values()) {
    const date = fixtureStartDates.get(String(row.fixtureId ?? "")) ?? "(unknown)";
    const key = `${row.network}:${date}`;
    const existing =
      byHistoricalDay.get(key) ?? { fixturesChecked: 0, fixturesWithData: 0, emptyOk: 0, errors: 0 };
    existing.fixturesChecked += 1;
    if (row.ok && Number(row.rows) > 0) existing.fixturesWithData += 1;
    else if (row.ok) existing.emptyOk += 1;
    else existing.errors += 1;
    byHistoricalDay.set(key, existing);
  }

  await writeText(
    join(SAMPLES_DIR, "RETENTION.md"),
    [
      "# TXLine Retention Probe",
      "",
      `Generated: ${new Date().toISOString()}`,
      "",
      "Interval rows are deduped by endpoint across repeated archive runs; the latest probe result wins.",
      "",
      "| Network | Family | Date | Rows Returned | Empty 200 Intervals | Error Intervals |",
      "|---|---|---|---:|---:|---:|",
      ...[...byFamilyDay.entries()].sort().map(([key, value]) => {
        const [network, family, date] = key.split(":");
        return `| ${network} | ${family} | ${date} | ${value.okRows} | ${value.emptyOk} | ${value.errors} |`;
      }),
      byFamilyDay.size ? "" : "No retention probe logs captured yet.",
      "",
      "## Scores Historical Endpoint",
      "",
      "| Network | Fixture Start Date | Fixtures Checked | Fixtures With Data | Empty 200 Fixtures | Error Fixtures |",
      "|---|---|---:|---:|---:|---:|",
      ...[...byHistoricalDay.entries()].sort().map(([key, value]) => {
        const [network, date] = key.split(":");
        return `| ${network} | ${date} | ${value.fixturesChecked} | ${value.fixturesWithData} | ${value.emptyOk} | ${value.errors} |`;
      }),
      byHistoricalDay.size ? "" : "No scores historical probe logs captured yet.",
      ""
    ].join("\n")
  );
}

async function writeManifest(): Promise<void> {
  const manifestPath = join(SAMPLES_DIR, "_logs", "manifest.jsonl");
  const lines = await readFile(manifestPath, "utf8").catch(() => "");
  const rows = lines
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as AnyRecord);
  await writeText(
    join(SAMPLES_DIR, "MANIFEST.md"),
    [
      "# Samples Manifest",
      "",
      `Generated: ${new Date().toISOString()}`,
      "",
      "| Captured At | Type | Network | Endpoint | Rows | Path |",
      "|---|---|---|---|---:|---|",
      ...rows.map(
        (row) =>
          `| ${row.capturedAt ?? ""} | ${row.type ?? ""} | ${row.network ?? ""} | ${row.endpoint ?? ""} | ${row.rows ?? ""} | ${row.path ?? ""} |`
      ),
      rows.length ? "" : "No manifest entries captured yet.",
      ""
    ].join("\n")
  );
}

async function main(): Promise<void> {
  const report = [
    "# Phase 0 Payload Verification",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    ...(await analyzeOdds()),
    ...(await analyzeScores())
  ];
  await writeText(join(SAMPLES_DIR, "PAYLOAD-VERIFICATION.md"), report.join("\n"));
  await writeLatency();
  await writeRetention();
  await writeManifest();
  await appendJsonl(join(SAMPLES_DIR, "_logs", "analysis-runs.jsonl"), {
    at: new Date().toISOString(),
    outputs: ["PAYLOAD-VERIFICATION.md", "LATENCY.md", "RETENTION.md", "MANIFEST.md"]
  });
  console.log("Analysis files written under samples/.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
