import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, open, readFile, rename, stat, statfs, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { validateCaptureConfig, type CaptureConfig } from "./capture-config.js";

const MINIMUM_FREE_BYTES = 10n * 1_024n * 1_024n * 1_024n;
const GAMMA_ORIGIN = "https://gamma-api.polymarket.com";
const WATCHDOG_POLL_MS = 5_000;
const CHILD_TERMINATION_GRACE_MS = 10_000;
const MAX_BOUNDARY_LINE_BYTES = 16 * 1_024 * 1_024;
const GAMMA_PREFLIGHT_ATTEMPTS = 3;
const GAMMA_ATTEMPT_TIMEOUT_MS = 15_000;
const GAMMA_RETRY_DELAY_MS = 250;

type TokenFile = {
  network?: unknown;
  serviceLevelId?: unknown;
  jwt?: unknown;
  apiToken?: unknown;
};

type SupervisorState = "scheduled" | "preflight" | "running" | "completed" | "failed";

type SupervisorStatus = {
  schemaVersion: 1;
  captureId: string;
  runLabel: string;
  state: SupervisorState;
  updatedAt: string;
  supervisorPid: number;
  scheduledStartUtc: string;
  scheduledEndUtc: string;
  childPid?: number;
  exitCode?: number | null;
  error?: string;
  terminalEvidence?: SynchronizedCaptureEvidence;
};

type CaptureStreamName = "polymarket" | "txline_odds" | "txline_scores";

export type SupervisorLock = {
  path: string;
  nonce: string;
  pid: number;
};

export type CaptureStreamObservation = {
  name: CaptureStreamName;
  path: string;
  exists: boolean;
  size: number;
  mtimeMs: number;
};

export type CaptureStreamCoverage = {
  name: CaptureStreamName;
  path: string;
  bytes: number;
  firstReceivedAt: string;
  lastReceivedAt: string;
  firstReceivedTsMs: number;
  lastReceivedTsMs: number;
};

export type SynchronizedCaptureEvidence = {
  manifestPath: string;
  windowStartUtc: string;
  windowEndUtc: string;
  synchronizedStartUtc: string;
  synchronizedEndUtc: string;
  streams: CaptureStreamCoverage[];
};

const terminalCaptureManifestSchema = z.object({
  schemaVersion: z.literal(2),
  runId: z.string().min(1),
  status: z.literal("completed"),
  startedAt: z.string().datetime(),
  captureStartedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  deadlineAt: z.string().datetime(),
  captureWindow: z.object({
    startUtc: z.string().datetime(),
    endUtc: z.string().datetime(),
    maxStartupSkewSeconds: z.number().int().positive()
  }).strict(),
  endpoint: z.string().min(1),
  paired: z.literal(true),
  txlineFixtureId: z.string().min(1),
  exactEventSlugs: z.array(z.string().min(1)).min(1),
  fullWorldCupDiscovery: z.literal(false),
  stats: z.object({
    messages: z.number().int().positive(),
    parsedItems: z.number().int().nonnegative(),
    parseErrors: z.number().int().nonnegative(),
    transportHeartbeats: z.number().int().nonnegative(),
    inScopeBookEvents: z.number().int().positive(),
    inScopeBookSnapshots: z.number().int().positive(),
    discoveredAssets: z.number().int().positive(),
    subscribedAssets: z.number().int().positive(),
    connects: z.number().int().positive(),
    opens: z.number().int().positive(),
    disconnects: z.number().int().nonnegative(),
    reconnects: z.number().int().nonnegative(),
    forcedReconnects: z.number().int().nonnegative(),
    eventTypes: z.record(z.string().min(1), z.number().int().nonnegative())
  }).strict(),
  pairedChildExit: z.object({
    code: z.literal(0),
    signal: z.null(),
    atMs: z.number().int().nonnegative(),
    spawnError: z.never().optional()
  }).strict(),
  error: z.null()
}).strict();

const txlineStreamSummarySchema = z.object({
  stream: z.enum(["odds", "scores"]),
  frames: z.number().int().positive(),
  jsonDataFrames: z.number().int().nonnegative(),
  exactFixtureDataFrames: z.number().int().nonnegative(),
  usableExactFixtureOddsFrames: z.number().int().nonnegative(),
  completedExactFixtureScoreFrames: z.number().int().nonnegative(),
  firstReceivedAt: z.string().datetime(),
  lastReceivedAt: z.string().datetime()
}).strict();

const terminalTxlineManifestSchema = z.object({
  schemaVersion: z.literal(1),
  network: z.literal("mainnet"),
  runId: z.string().min(1),
  fixtureId: z.string().min(1),
  startedAt: z.string().datetime(),
  deadlineAt: z.string().datetime(),
  captureWindow: z.object({
    startUtc: z.string().datetime(),
    endUtc: z.string().datetime(),
    maxStartupSkewSeconds: z.number().int().positive()
  }).strict(),
  status: z.literal("completed"),
  endedAt: z.string().datetime(),
  streams: z.array(txlineStreamSummarySchema).length(2),
  error: z.null()
}).strict();

function argument(name: string, argv = process.argv.slice(2)): string | undefined {
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolveSleep, rejectSleep) => {
    const abortSignal = signal;
    if (abortSignal?.aborted) {
      rejectSleep(abortSignal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      abortSignal?.removeEventListener("abort", onAbort);
      rejectSleep(abortSignal?.reason);
    };
    const timer = setTimeout(() => {
      abortSignal?.removeEventListener("abort", onAbort);
      resolveSleep();
    }, ms);
    abortSignal?.addEventListener("abort", onAbort, { once: true });
  });
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function writeStatus(path: string, status: SupervisorStatus): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(status, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

export async function acquireSupervisorLock(options: {
  path: string;
  captureId: string;
  pid?: number;
  isPidAlive?: (pid: number) => boolean;
}): Promise<SupervisorLock> {
  const pid = options.pid ?? process.pid;
  const isAlive = options.isPidAlive ?? pidAlive;
  await mkdir(dirname(options.path), { recursive: true });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const nonce = randomUUID();
    let created = false;
    try {
      const handle = await open(options.path, "wx", 0o600);
      created = true;
      try {
        await handle.writeFile(`${JSON.stringify({
          schemaVersion: 1,
          captureId: options.captureId,
          pid,
          nonce,
          acquiredAt: new Date().toISOString()
        })}\n`);
        await handle.sync();
      } finally {
        await handle.close();
      }
      return { path: options.path, nonce, pid };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        if (created) await unlink(options.path).catch(() => undefined);
        throw error;
      }
    }

    let existing: { pid?: unknown } | null = null;
    try {
      existing = JSON.parse(await readFile(options.path, "utf8")) as { pid?: unknown };
    } catch {
      const info = await stat(options.path).catch(() => null);
      if (info && Date.now() - info.mtimeMs < 5_000) {
        throw new Error(`Capture supervisor lock is newly created but unreadable: ${options.path}`);
      }
    }
    const existingPid = Number(existing?.pid);
    if (Number.isInteger(existingPid) && existingPid > 0 && isAlive(existingPid)) {
      throw new Error(`Capture supervisor already active with PID ${existingPid}`);
    }
    await unlink(options.path).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
  }
  throw new Error(`Could not acquire exclusive capture supervisor lock: ${options.path}`);
}

export async function releaseSupervisorLock(lock: SupervisorLock): Promise<void> {
  try {
    const current = JSON.parse(await readFile(lock.path, "utf8")) as { nonce?: unknown; pid?: unknown };
    if (current.nonce !== lock.nonce || current.pid !== lock.pid) {
      throw new Error("Refusing to release a capture supervisor lock owned by another process");
    }
    await unlink(lock.path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export async function writeExclusiveSupervisorPid(options: {
  path: string;
  pid?: number;
  isPidAlive?: (pid: number) => boolean;
}): Promise<void> {
  const pid = options.pid ?? process.pid;
  const isAlive = options.isPidAlive ?? pidAlive;
  await mkdir(dirname(options.path), { recursive: true });
  try {
    await writeFile(options.path, `${pid}\n`, { mode: 0o600, flag: "wx" });
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const existing = Number((await readFile(options.path, "utf8")).trim());
  if (!Number.isInteger(existing) || existing <= 0) {
    throw new Error(`Existing capture supervisor PID file is malformed: ${options.path}`);
  }
  if (isAlive(existing)) throw new Error(`Legacy capture supervisor already active with PID ${existing}`);
  await unlink(options.path);
  await writeFile(options.path, `${pid}\n`, { mode: 0o600, flag: "wx" });
}

function jwtExpiryMs(jwt: string): number {
  const payload = jwt.split(".")[1];
  if (!payload) throw new Error("TXLine JWT has no payload");
  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: unknown };
  const seconds = Number(parsed.exp);
  if (!Number.isFinite(seconds)) throw new Error("TXLine JWT has no finite expiry");
  return seconds * 1_000;
}

export function validateCaptureToken(token: unknown, requiredThroughTsMs: number): void {
  if (!token || typeof token !== "object") throw new Error("TXLine token file is malformed");
  const record = token as TokenFile;
  if (record.network !== "mainnet" || record.serviceLevelId !== 12) {
    throw new Error("Scheduled capture requires the mainnet SL12 token");
  }
  if (typeof record.jwt !== "string" || record.jwt.length === 0 || typeof record.apiToken !== "string" || record.apiToken.length === 0) {
    throw new Error("TXLine token file is missing required credentials");
  }
  if (jwtExpiryMs(record.jwt) <= requiredThroughTsMs) {
    throw new Error("TXLine JWT expires before the scheduled capture ends");
  }
}

export function captureCommandArgs(config: CaptureConfig): string[] {
  return [
    "capture:paired",
    "--",
    "--network",
    "mainnet",
    "--txline-fixture-id",
    config.txline.fixtureId,
    "--capture-start-utc",
    config.capture.scheduledStartUtc,
    "--capture-end-utc",
    config.capture.scheduledEndUtc,
    "--max-startup-skew-seconds",
    String(config.capture.maxStartupSkewSeconds),
    "--run-label",
    config.capture.runLabel,
    "--event-slugs",
    `${config.polymarket.eventSlug},${config.polymarket.totalsEventSlug}`,
    "--max-assets",
    String(config.capture.polymarketMaxAssets),
    "--discovery-interval-seconds",
    String(config.capture.discoveryIntervalSeconds)
  ];
}

async function fetchGammaWithinStartupDeadline(input: {
  url: string;
  fetchImpl: typeof fetch;
  startupDeadlineTsMs: number;
}): Promise<{ response: Response; text: string }> {
  let lastError = "request was not attempted";
  for (let attempt = 1; attempt <= GAMMA_PREFLIGHT_ATTEMPTS; attempt += 1) {
    const remainingMs = input.startupDeadlineTsMs - Date.now();
    if (remainingMs <= 0) break;
    const controller = new AbortController();
    const attemptMs = Math.max(1, Math.min(GAMMA_ATTEMPT_TIMEOUT_MS, remainingMs));
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([
        input.fetchImpl(input.url, { signal: controller.signal }).then(async (result) => ({
          response: result,
          text: await result.text()
        })),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            controller.abort(new Error("Gamma preflight attempt timed out"));
            reject(new Error("Gamma preflight attempt timed out"));
          }, attemptMs);
        })
      ]);
      if (response.response.ok || (response.response.status < 500 && response.response.status !== 429)) return response;
      lastError = `HTTP ${response.response.status}`;
    } catch (error) {
      lastError = safeError(error);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
    const retryBudgetMs = input.startupDeadlineTsMs - Date.now();
    if (attempt === GAMMA_PREFLIGHT_ATTEMPTS || retryBudgetMs <= 0) break;
    await sleep(Math.min(GAMMA_RETRY_DELAY_MS, retryBudgetMs));
  }
  throw new Error(`Gamma preflight could not complete inside maximum startup skew: ${lastError}`);
}

export async function fetchExactEvents(input: {
  config: CaptureConfig;
  fetchImpl: typeof fetch;
  startupDeadlineTsMs: number;
}): Promise<unknown[]> {
  const events: unknown[] = [];
  for (const slug of [input.config.polymarket.eventSlug, input.config.polymarket.totalsEventSlug]) {
    const result = await fetchGammaWithinStartupDeadline({
      url: `${GAMMA_ORIGIN}/events/slug/${encodeURIComponent(slug)}`,
      fetchImpl: input.fetchImpl,
      startupDeadlineTsMs: input.startupDeadlineTsMs
    });
    if (!result.response.ok) throw new Error(`Gamma exact-event preflight failed for ${slug}: HTTP ${result.response.status}`);
    const event = JSON.parse(result.text) as unknown;
    if (!event || typeof event !== "object" || String((event as { slug?: unknown }).slug ?? "") !== slug) {
      throw new Error(`Gamma exact-event preflight returned the wrong identity for ${slug}`);
    }
    events.push(event);
  }
  return events;
}

async function assertNoOutputCollision(repoRoot: string, config: CaptureConfig): Promise<void> {
  const paths = [
    resolve(repoRoot, "samples/polymarket-live", config.capture.runLabel),
    resolve(repoRoot, "samples/odds-sse/mainnet", config.capture.runLabel)
  ];
  for (const path of paths) {
    if (existsSync(path)) throw new Error(`Refusing to append to an existing capture output: ${path}`);
  }
}

async function assertFreeDisk(repoRoot: string): Promise<void> {
  const stats = await statfs(repoRoot, { bigint: true });
  const freeBytes = stats.bavail * stats.bsize;
  if (freeBytes < MINIMUM_FREE_BYTES) {
    throw new Error(`Capture preflight requires at least 10 GiB free; found ${freeBytes} bytes`);
  }
}

async function assertNonempty(path: string): Promise<void> {
  const info = await stat(path);
  if (!info.isFile() || info.size === 0) throw new Error(`Capture output is empty: ${path}`);
}

function streamPaths(repoRoot: string, runLabel: string): Array<{
  name: CaptureStreamName;
  path: string;
  expectedStream?: "odds" | "scores";
}> {
  return [
    {
      name: "polymarket",
      path: resolve(repoRoot, "samples/polymarket-live", runLabel, "messages.ndjson")
    },
    {
      name: "txline_odds",
      path: resolve(repoRoot, "samples/odds-sse/mainnet", runLabel, "odds.frames.ndjson"),
      expectedStream: "odds"
    },
    {
      name: "txline_scores",
      path: resolve(repoRoot, "samples/odds-sse/mainnet", runLabel, "scores.frames.ndjson"),
      expectedStream: "scores"
    }
  ];
}

export function streamFreshnessFailure(input: {
  nowTsMs: number;
  startupDeadlineTsMs: number;
  staleAfterMs: number;
  streams: readonly CaptureStreamObservation[];
}): string | undefined {
  if (input.nowTsMs < input.startupDeadlineTsMs) return undefined;
  for (const stream of input.streams) {
    if (!stream.exists || stream.size <= 0) return `${stream.name} did not produce a capture artifact before startup grace expired`;
    const ageMs = input.nowTsMs - stream.mtimeMs;
    if (ageMs > input.staleAfterMs) return `${stream.name} capture stream stalled for ${ageMs}ms`;
  }
  return undefined;
}

async function streamObservations(repoRoot: string, config: CaptureConfig): Promise<CaptureStreamObservation[]> {
  return Promise.all(streamPaths(repoRoot, config.capture.runLabel).map(async ({ name, path }) => {
    try {
      const info = await stat(path);
      return { name, path, exists: info.isFile(), size: info.size, mtimeMs: info.mtimeMs };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { name, path, exists: false, size: 0, mtimeMs: 0 };
      }
      throw error;
    }
  }));
}

async function monitorStreamFreshness(options: {
  repoRoot: string;
  config: CaptureConfig;
  signal: AbortSignal;
}): Promise<never> {
  const startupDeadlineTsMs = Date.parse(options.config.capture.scheduledStartUtc) +
    options.config.capture.startupGraceSeconds * 1_000;
  const staleAfterMs = options.config.capture.streamStaleSeconds * 1_000;
  while (true) {
    const nowTsMs = Date.now();
    const failure = streamFreshnessFailure({
      nowTsMs,
      startupDeadlineTsMs,
      staleAfterMs,
      streams: await streamObservations(options.repoRoot, options.config)
    });
    if (failure) throw new Error(failure);
    await sleep(WATCHDOG_POLL_MS, options.signal);
  }
}

async function boundaryLine(path: string, edge: "first" | "last"): Promise<string> {
  const handle = await open(path, "r");
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size <= 0) throw new Error(`Capture output is empty: ${path}`);
    const length = Math.min(info.size, MAX_BOUNDARY_LINE_BYTES);
    const position = edge === "first" ? 0 : info.size - length;
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(buffer, 0, length, position);
    const bytes = buffer.subarray(0, bytesRead);
    if (edge === "first") {
      const newline = bytes.indexOf(0x0a);
      if (newline === -1 && length < info.size) throw new Error(`First capture row exceeds ${MAX_BOUNDARY_LINE_BYTES} bytes: ${path}`);
      return bytes.subarray(0, newline === -1 ? bytes.length : newline).toString("utf8").replace(/\r$/, "");
    }
    let end = bytes.length;
    while (end > 0 && (bytes[end - 1] === 0x0a || bytes[end - 1] === 0x0d)) end -= 1;
    const newline = bytes.lastIndexOf(0x0a, end - 1);
    if (newline === -1 && length < info.size) throw new Error(`Last capture row exceeds ${MAX_BOUNDARY_LINE_BYTES} bytes: ${path}`);
    return bytes.subarray(newline + 1, end).toString("utf8").replace(/^\r/, "");
  } finally {
    await handle.close();
  }
}

async function streamCoverage(input: {
  name: CaptureStreamName;
  path: string;
  expectedStream?: "odds" | "scores";
}): Promise<CaptureStreamCoverage> {
  const recordSchema = z.object({
    receivedAt: z.string().datetime(),
    ...(input.expectedStream ? { stream: z.literal(input.expectedStream) } : {})
  }).passthrough();
  const [firstLine, lastLine, info] = await Promise.all([
    boundaryLine(input.path, "first"),
    boundaryLine(input.path, "last"),
    stat(input.path)
  ]);
  let first: z.infer<typeof recordSchema>;
  let last: z.infer<typeof recordSchema>;
  try {
    first = recordSchema.parse(JSON.parse(firstLine) as unknown);
    last = recordSchema.parse(JSON.parse(lastLine) as unknown);
  } catch (error) {
    throw new Error(`Capture boundary row is malformed for ${input.name}: ${safeError(error)}`);
  }
  return {
    name: input.name,
    path: input.path,
    bytes: info.size,
    firstReceivedAt: first.receivedAt,
    lastReceivedAt: last.receivedAt,
    firstReceivedTsMs: Date.parse(first.receivedAt),
    lastReceivedTsMs: Date.parse(last.receivedAt)
  };
}

export function validateSynchronizedCoverage(input: {
  windowStartTsMs: number;
  windowEndTsMs: number;
  startupGraceMs: number;
  streamStaleMs: number;
  streams: readonly CaptureStreamCoverage[];
}): { synchronizedStartTsMs: number; synchronizedEndTsMs: number } {
  if (input.streams.length !== 3) throw new Error("Terminal evidence requires exactly three capture streams");
  for (const stream of input.streams) {
    if (stream.firstReceivedTsMs < input.windowStartTsMs) {
      throw new Error(`${stream.name} began before the reviewed capture window`);
    }
    if (stream.firstReceivedTsMs > input.windowStartTsMs + input.startupGraceMs) {
      throw new Error(`${stream.name} began after artifact startup grace expired`);
    }
    if (stream.lastReceivedTsMs <= stream.firstReceivedTsMs) {
      throw new Error(`${stream.name} does not have a positive capture window`);
    }
    if (stream.lastReceivedTsMs < input.windowEndTsMs - input.streamStaleMs) {
      throw new Error(`${stream.name} ended too early for terminal coverage`);
    }
    if (stream.lastReceivedTsMs > input.windowEndTsMs + input.streamStaleMs) {
      throw new Error(`${stream.name} extends beyond the reviewed capture window tolerance`);
    }
  }
  const synchronizedStartTsMs = Math.max(...input.streams.map((stream) => stream.firstReceivedTsMs));
  const synchronizedEndTsMs = Math.min(...input.streams.map((stream) => stream.lastReceivedTsMs));
  if (synchronizedStartTsMs > input.windowStartTsMs + input.startupGraceMs ||
      synchronizedEndTsMs < input.windowEndTsMs - input.streamStaleMs ||
      synchronizedEndTsMs <= synchronizedStartTsMs) {
    throw new Error("Capture streams lack synchronized coverage of the reviewed window");
  }
  return { synchronizedStartTsMs, synchronizedEndTsMs };
}

export async function verifyTerminalCaptureEvidence(
  repoRoot: string,
  config: CaptureConfig
): Promise<SynchronizedCaptureEvidence> {
  const polymarketDir = resolve(repoRoot, "samples/polymarket-live", config.capture.runLabel);
  const txlineDir = resolve(repoRoot, "samples/odds-sse/mainnet", config.capture.runLabel);
  const manifestPath = resolve(polymarketDir, "capture-manifest.json");
  await assertNonempty(resolve(polymarketDir, "subscriptions.json"));
  const manifest = terminalCaptureManifestSchema.parse(await readJson(manifestPath));
  const txlineManifestPath = resolve(txlineDir, "txline-capture-manifest.json");
  const txlineManifest = terminalTxlineManifestSchema.parse(await readJson(txlineManifestPath));
  const expectedSlugs = [config.polymarket.eventSlug, config.polymarket.totalsEventSlug];
  if (manifest.runId !== config.capture.runLabel || manifest.txlineFixtureId !== config.txline.fixtureId) {
    throw new Error("Completed capture manifest identity does not match reviewed config");
  }
  if (JSON.stringify(manifest.exactEventSlugs) !== JSON.stringify(expectedSlugs)) {
    throw new Error("Completed capture manifest does not contain the exact reviewed event slugs");
  }
  if ((manifest.stats.eventTypes.book ?? 0) <= 0 ||
      manifest.stats.inScopeBookEvents <= 0 ||
      manifest.stats.inScopeBookSnapshots <= 0) {
    throw new Error("Completed capture lacks a real in-scope Polymarket order book event");
  }
  if (
    manifest.captureWindow.startUtc !== config.capture.scheduledStartUtc ||
    manifest.captureWindow.endUtc !== config.capture.scheduledEndUtc ||
    manifest.deadlineAt !== config.capture.scheduledEndUtc ||
    manifest.captureWindow.maxStartupSkewSeconds !== config.capture.maxStartupSkewSeconds
  ) {
    throw new Error("Completed capture manifest changed the reviewed absolute window");
  }
  if (
    txlineManifest.runId !== config.capture.runLabel ||
    txlineManifest.fixtureId !== config.txline.fixtureId ||
    txlineManifest.deadlineAt !== config.capture.scheduledEndUtc ||
    txlineManifest.captureWindow.startUtc !== config.capture.scheduledStartUtc ||
    txlineManifest.captureWindow.endUtc !== config.capture.scheduledEndUtc ||
    txlineManifest.captureWindow.maxStartupSkewSeconds !== config.capture.maxStartupSkewSeconds
  ) {
    throw new Error("Completed TXLine manifest changed the exact fixture or reviewed window");
  }
  const oddsSummary = txlineManifest.streams.find((stream) => stream.stream === "odds");
  const scoresSummary = txlineManifest.streams.find((stream) => stream.stream === "scores");
  if (!oddsSummary || !scoresSummary || new Set(txlineManifest.streams.map((stream) => stream.stream)).size !== 2) {
    throw new Error("Completed TXLine manifest lacks distinct odds and scores streams");
  }
  if (oddsSummary.exactFixtureDataFrames <= 0 || oddsSummary.usableExactFixtureOddsFrames <= 0) {
    throw new Error("Completed capture lacks usable TXLine odds for the exact fixture");
  }
  if (scoresSummary.exactFixtureDataFrames <= 0) {
    throw new Error("Completed capture lacks TXLine scores for the exact fixture");
  }
  if (scoresSummary.completedExactFixtureScoreFrames <= 0) {
    throw new Error("Completed capture lacks an exact-fixture TXLine game_finalised score frame");
  }
  const windowStartTsMs = Date.parse(config.capture.scheduledStartUtc);
  const windowEndTsMs = Date.parse(config.capture.scheduledEndUtc);
  const captureStartedTsMs = Date.parse(manifest.captureStartedAt);
  if (captureStartedTsMs < windowStartTsMs ||
      captureStartedTsMs > windowStartTsMs + config.capture.maxStartupSkewSeconds * 1_000) {
    throw new Error("Completed capture manifest exceeds maximum startup skew");
  }
  const endedTsMs = Date.parse(manifest.endedAt);
  if (endedTsMs < windowEndTsMs - config.capture.streamStaleSeconds * 1_000 ||
      endedTsMs > windowEndTsMs + config.capture.streamStaleSeconds * 1_000) {
    throw new Error("Completed capture manifest ended outside terminal tolerance");
  }
  const streams = await Promise.all(streamPaths(repoRoot, config.capture.runLabel).map(streamCoverage));
  const synchronized = validateSynchronizedCoverage({
    windowStartTsMs,
    windowEndTsMs,
    startupGraceMs: config.capture.startupGraceSeconds * 1_000,
    streamStaleMs: config.capture.streamStaleSeconds * 1_000,
    streams
  });
  return {
    manifestPath,
    windowStartUtc: config.capture.scheduledStartUtc,
    windowEndUtc: config.capture.scheduledEndUtc,
    synchronizedStartUtc: new Date(synchronized.synchronizedStartTsMs).toISOString(),
    synchronizedEndUtc: new Date(synchronized.synchronizedEndTsMs).toISOString(),
    streams
  };
}

async function waitForChild(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", (code) => resolveExit(code));
  });
}

async function terminateChild(child: ChildProcess, exit: Promise<number | null>): Promise<number | null> {
  if (child.exitCode !== null || child.signalCode !== null) return exit;
  child.kill("SIGTERM");
  const graceful = await Promise.race([
    exit.then((exitCode) => ({ exited: true as const, exitCode })),
    new Promise<{ exited: false }>((resolveTimeout) => {
      const timer = setTimeout(() => resolveTimeout({ exited: false }), CHILD_TERMINATION_GRACE_MS);
      timer.unref();
    })
  ]);
  if (graceful.exited) return graceful.exitCode;
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  return exit;
}

export async function runScheduledCapture(options: {
  repoRoot: string;
  configPath: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}): Promise<void> {
  const repoRoot = resolve(options.repoRoot);
  const configPath = resolve(repoRoot, options.configPath);
  const rawConfig = await readJson(configPath);
  const preliminary = validateCaptureConfig({
    repoRoot,
    config: rawConfig,
    txlineFixtures: await readJson(resolve(repoRoot, (rawConfig as { evidence?: { txlineFixtures?: string } }).evidence?.txlineFixtures ?? "")) as never[],
    polymarketEvents: await readJson(resolve(repoRoot, (rawConfig as { evidence?: { polymarketEvents?: string } }).evidence?.polymarketEvents ?? "")) as never[],
    nowTsMs: 0
  });
  if (!preliminary.readyToSchedule || preliminary.reason !== "ready") {
    throw new Error(`Capture config is not authorized to schedule: ${preliminary.reason}`);
  }
  const config = preliminary.config;
  const statusPath = resolve(repoRoot, "samples/_logs", `${config.capture.runLabel}.supervisor.json`);
  const pidPath = resolve(repoRoot, "samples/_logs", `${config.capture.runLabel}.pid`);
  const lockPath = resolve(repoRoot, "samples/_logs", `${config.capture.runLabel}.supervisor.lock`);
  const baseStatus = {
    schemaVersion: 1 as const,
    captureId: config.captureId,
    runLabel: config.capture.runLabel,
    supervisorPid: process.pid,
    scheduledStartUtc: config.capture.scheduledStartUtc,
    scheduledEndUtc: config.capture.scheduledEndUtc
  };
  const supervisorLock = await acquireSupervisorLock({ path: lockPath, captureId: config.captureId });
  let child: ChildProcess | undefined;
  let freshnessAbort: AbortController | undefined;
  const abortController = new AbortController();
  const stop = () => {
    abortController.abort(new Error("Scheduled capture supervisor received a process signal"));
    freshnessAbort?.abort(new Error("Scheduled capture supervisor stopped"));
    if (child && child.exitCode === null) child.kill("SIGTERM");
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    await writeExclusiveSupervisorPid({ path: pidPath });
    await writeStatus(statusPath, { ...baseStatus, state: "scheduled", updatedAt: new Date().toISOString() });
    const now = options.now ?? Date.now;
    const scheduledStartTsMs = Date.parse(config.capture.scheduledStartUtc);
    const delayMs = scheduledStartTsMs - now();
    if (delayMs > 0) await sleep(delayMs, abortController.signal);
    const preflightAt = now();
    const maxStartupSkewMs = config.capture.maxStartupSkewSeconds * 1_000;
    if (preflightAt > scheduledStartTsMs + maxStartupSkewMs) {
      throw new Error(`Scheduled start passed by ${preflightAt - scheduledStartTsMs} ms`);
    }

    await writeStatus(statusPath, { ...baseStatus, state: "preflight", updatedAt: new Date().toISOString() });
    if (Number(process.versions.node.split(".")[0]) !== 22) throw new Error(`Node 22 required; found ${process.version}`);
    await assertNoOutputCollision(repoRoot, config);
    await assertFreeDisk(repoRoot);
    const token = await readJson(resolve(repoRoot, "phase0/.tokens/mainnet.json"));
    validateCaptureToken(token, Date.parse(config.capture.scheduledEndUtc));
    const startupDeadlineTsMs = scheduledStartTsMs + maxStartupSkewMs;
    const liveEvents = await fetchExactEvents({
      config,
      fetchImpl: options.fetchImpl ?? fetch,
      startupDeadlineTsMs
    });
    if (Date.now() > startupDeadlineTsMs) {
      throw new Error("Scheduled Gamma preflight exceeded maximum startup skew");
    }
    validateCaptureConfig({
      repoRoot,
      config,
      txlineFixtures: await readJson(resolve(repoRoot, config.evidence.txlineFixtures)) as never[],
      polymarketEvents: liveEvents as never[],
      nowTsMs: preflightAt,
      scheduleGraceMs: maxStartupSkewMs
    });
    if (Date.now() > startupDeadlineTsMs) {
      throw new Error("Scheduled capture preflight exceeded maximum startup skew before child launch");
    }

    child = spawn("pnpm", captureCommandArgs(config), {
      cwd: resolve(repoRoot, "phase0"),
      env: process.env,
      stdio: "inherit"
    });
    await writeStatus(statusPath, {
      ...baseStatus,
      state: "running",
      updatedAt: new Date().toISOString(),
      ...(child.pid === undefined ? {} : { childPid: child.pid })
    });
    const childExit = waitForChild(child);
    freshnessAbort = new AbortController();
    const watchdog = monitorStreamFreshness({ repoRoot, config, signal: freshnessAbort.signal });
    const outcome = await Promise.race([
      childExit.then((exitCode) => ({ kind: "exit" as const, exitCode })),
      watchdog.then(
        () => ({ kind: "watchdog_exit" as const }),
        (error: unknown) => ({ kind: "watchdog_failure" as const, error })
      )
    ]);
    if (outcome.kind === "watchdog_failure") {
      await terminateChild(child, childExit);
      throw outcome.error;
    }
    if (outcome.kind === "watchdog_exit") throw new Error("Capture freshness watchdog ended unexpectedly");
    freshnessAbort.abort(new Error("Paired capture child exited"));
    await watchdog.catch(() => undefined);
    const exitCode = outcome.exitCode;
    if (exitCode !== 0) throw new Error(`Paired capture exited with code ${exitCode}`);
    const terminalEvidence = await verifyTerminalCaptureEvidence(repoRoot, config);
    await writeStatus(statusPath, {
      ...baseStatus,
      state: "completed",
      updatedAt: new Date().toISOString(),
      ...(child.pid === undefined ? {} : { childPid: child.pid }),
      exitCode,
      terminalEvidence
    });
  } catch (error) {
    stop();
    if (child && child.exitCode === null && child.signalCode === null) {
      await terminateChild(child, waitForChild(child));
    }
    await writeStatus(statusPath, {
      ...baseStatus,
      state: "failed",
      updatedAt: new Date().toISOString(),
      ...(child?.pid === undefined ? {} : { childPid: child.pid }),
      ...(child?.exitCode === undefined ? {} : { exitCode: child.exitCode }),
      error: safeError(error)
    });
    throw error;
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    await unlink(pidPath).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
    await releaseSupervisorLock(supervisorLock);
  }
}

async function main(): Promise<void> {
  const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
  const configPath = argument("config");
  if (!configPath) throw new Error("Usage: run-scheduled-capture.ts --config config/captures/<capture>.json");
  const launchdLabel = argument("launchd-label");
  try {
    await runScheduledCapture({ repoRoot, configPath });
  } finally {
    if (launchdLabel) {
      if (!/^dev\.samaritan\.[a-z0-9.-]+$/.test(launchdLabel)) throw new Error("Invalid --launchd-label");
      spawnSync("launchctl", ["remove", launchdLabel], { stdio: "ignore" });
    }
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  main().catch((error: unknown) => {
    console.error(safeError(error));
    process.exitCode = 1;
  });
}
