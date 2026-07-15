import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { captureStartupFailure, parseAbsoluteCaptureWindow } from "./capture-window.js";
import { writeAtomicJson } from "./polymarket-lib.js";
import {
  appendJsonl,
  authHeaders,
  ensureDir,
  getNetwork,
  loadToken,
  logManifest,
  NETWORKS,
  numberArg,
  parseArgs,
  SAMPLES_DIR,
  stringArg,
  timestampSlug
} from "./lib.js";

type ParsedSse = {
  id?: string;
  event?: string;
  data: string;
  retry?: number;
};

function nowNs(): string {
  return process.hrtime.bigint().toString();
}

function parseSseBlock(block: string): ParsedSse | null {
  const message: ParsedSse = { data: "" };
  for (const rawLine of block.split(/\r?\n/)) {
    if (!rawLine || rawLine.startsWith(":")) continue;
    const separatorIndex = rawLine.indexOf(":");
    const field = separatorIndex === -1 ? rawLine : rawLine.slice(0, separatorIndex);
    const value = separatorIndex === -1 ? "" : rawLine.slice(separatorIndex + 1).replace(/^ /, "");
    if (field === "data") message.data += `${value}\n`;
    if (field === "event") message.event = value;
    if (field === "id") message.id = value;
    if (field === "retry") message.retry = Number(value);
  }
  message.data = message.data.replace(/\n$/, "");
  return message.data || message.event || message.id ? message : null;
}

export type CaptureStreamOptions = {
  network: string;
  streamName: "odds" | "scores";
  url: string;
  headers: Record<string, string>;
  outDir: string;
  deadline: number;
  fetchImpl?: typeof fetch;
  reconnectDelayMs?: number;
  expectedFixtureId?: string;
};

export type CaptureStreamSummary = {
  stream: "odds" | "scores";
  frames: number;
  jsonDataFrames: number;
  exactFixtureDataFrames: number;
  usableExactFixtureOddsFrames: number;
  completedExactFixtureScoreFrames: number;
  firstReceivedAt: string | null;
  lastReceivedAt: string | null;
};

/**
 * TXLine `Pct` is a de-vigged percentage on a 0-100 scale. Allow only a
 * narrow half-percentage-point rounding envelope around 100 so malformed,
 * fractional 0-1 values, and partially populated rows cannot certify a run.
 */
export const TXLINE_DEVIG_SUM_MIN = 99.5;
export const TXLINE_DEVIG_SUM_MAX = 100.5;

export function isUsableExactFixtureOddsRecord(record: Record<string, unknown>): boolean {
  if (
    record.SuperOddsType !== "1X2_PARTICIPANT_RESULT" &&
    record.SuperOddsType !== "OVERUNDER_PARTICIPANT_GOALS"
  ) return false;
  if (
    !Array.isArray(record.PriceNames) ||
    !Array.isArray(record.Prices) ||
    !Array.isArray(record.Pct) ||
    record.PriceNames.length === 0 ||
    record.Prices.length !== record.PriceNames.length ||
    record.Pct.length !== record.PriceNames.length
  ) return false;
  if (!record.PriceNames.every((value) => typeof value === "string" && value.trim().length > 0)) {
    return false;
  }
  if (!record.Prices.every((value) => typeof value === "number" && Number.isFinite(value) && value > 0)) {
    return false;
  }
  if (!record.Pct.every((value) => {
    if (typeof value !== "string" || value.trim().length === 0) return false;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100;
  })) return false;
  const sum = record.Pct.reduce((total, value) => total + Number(value), 0);
  return sum >= TXLINE_DEVIG_SUM_MIN && sum <= TXLINE_DEVIG_SUM_MAX;
}

export function isCompletedExactFixtureScoreRecord(record: Record<string, unknown>): boolean {
  return record.Action === "game_finalised" && record.StatusId === 100;
}

export async function captureStream(options: CaptureStreamOptions): Promise<CaptureStreamSummary> {
  let lastEventId = "";
  let reconnect = 0;
  const fetchImpl = options.fetchImpl ?? fetch;
  const reconnectDelayMs = options.reconnectDelayMs ?? 2_000;
  const raw = createWriteStream(join(options.outDir, `${options.streamName}.raw.sse`), { flags: "a" });
  const framesPath = join(options.outDir, `${options.streamName}.frames.ndjson`);
  const reconnectPath = join(options.outDir, "reconnects.ndjson");
  const summary: CaptureStreamSummary = {
    stream: options.streamName,
    frames: 0,
    jsonDataFrames: 0,
    exactFixtureDataFrames: 0,
    usableExactFixtureOddsFrames: 0,
    completedExactFixtureScoreFrames: 0,
    firstReceivedAt: null,
    lastReceivedAt: null
  };

  try {
    while (Date.now() < options.deadline) {
      const headers: Record<string, string> = {
        ...options.headers,
        Accept: "text/event-stream",
        "Cache-Control": "no-cache",
        "Accept-Encoding": "gzip"
      };
      if (lastEventId) headers["Last-Event-ID"] = lastEventId;

      await appendJsonl(reconnectPath, {
        at: new Date().toISOString(),
        stream: options.streamName,
        reconnect,
        lastEventId: lastEventId || null,
        action: "connect"
      });

      const controller = new AbortController();
      const deadlineTimer = setTimeout(
        () => controller.abort(new Error("capture deadline reached")),
        Math.max(1, options.deadline - Date.now())
      );
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        const response = await fetchImpl(options.url, { headers, signal: controller.signal });
        if (!response.ok || !response.body) {
          const text = await response.text();
          throw new Error(`${options.streamName} stream failed ${response.status}: ${text.slice(0, 300)}`);
        }

        reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (Date.now() < options.deadline) {
          const { value, done } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          raw.write(chunk);
          buffer += chunk;
          let separator = buffer.match(/\r?\n\r?\n/);
          while (separator?.index !== undefined) {
            const receivedAt = new Date();
            const receivedAtUnixNs = `${BigInt(receivedAt.getTime()) * 1_000_000n}`;
            const receivedAtMonotonicNs = nowNs();
            const rawFrame = buffer.slice(0, separator.index);
            buffer = buffer.slice(separator.index + separator[0].length);
            const parsed = parseSseBlock(rawFrame);
            if (parsed?.id) lastEventId = parsed.id;
            summary.frames += 1;
            summary.firstReceivedAt ??= receivedAt.toISOString();
            summary.lastReceivedAt = receivedAt.toISOString();
            if (parsed?.data) {
              try {
                const payload = JSON.parse(parsed.data) as unknown;
                if (payload && typeof payload === "object" && !Array.isArray(payload)) {
                  summary.jsonDataFrames += 1;
                  const record = payload as Record<string, unknown>;
                  const exactFixture = options.expectedFixtureId !== undefined &&
                    String(record.FixtureId ?? "") === options.expectedFixtureId;
                  if (exactFixture) summary.exactFixtureDataFrames += 1;
                  if (
                    exactFixture &&
                    options.streamName === "scores" &&
                    isCompletedExactFixtureScoreRecord(record)
                  ) {
                    summary.completedExactFixtureScoreFrames += 1;
                  }
                  if (
                    exactFixture &&
                    options.streamName === "odds" &&
                    isUsableExactFixtureOddsRecord(record)
                  ) {
                    summary.usableExactFixtureOddsFrames += 1;
                  }
                }
              } catch {
                // Raw evidence remains preserved. Malformed data is not counted as usable evidence.
              }
            }
            await appendJsonl(framesPath, {
              receivedAt: receivedAt.toISOString(),
              receivedAtUnixNs,
              receivedAtMonotonicNs,
              stream: options.streamName,
              lastEventId: parsed?.id ?? null,
              event: parsed?.event ?? null,
              rawFrame
            });
            separator = buffer.match(/\r?\n\r?\n/);
          }
        }
      } catch (error) {
        const expectedDeadline = controller.signal.aborted && Date.now() >= options.deadline;
        if (!expectedDeadline) {
          await appendJsonl(reconnectPath, {
            at: new Date().toISOString(),
            stream: options.streamName,
            reconnect,
            lastEventId: lastEventId || null,
            action: "disconnect",
            error: error instanceof Error ? error.message : String(error)
          });
          const remainingMs = Math.max(0, options.deadline - Date.now());
          await new Promise((resolve) => setTimeout(resolve, Math.min(reconnectDelayMs, remainingMs)));
        }
      } finally {
        clearTimeout(deadlineTimer);
        if (reader) {
          await reader.cancel("capture ended").catch(() => undefined);
          reader.releaseLock();
        }
      }
      reconnect += 1;
    }
  } finally {
    raw.end();
    await once(raw, "finish");
  }
  return summary;
}

export async function main(): Promise<void> {
  const args = parseArgs();
  const network = getNetwork(args);
  const token = await loadToken(network);
  const config = NETWORKS[network];
  const durationMinutes = numberArg(args, "duration-minutes", 240);
  const captureWindow = parseAbsoluteCaptureWindow({
    startUtc: stringArg(args, "capture-start-utc"),
    endUtc: stringArg(args, "capture-end-utc"),
    maxStartupSkewSeconds: numberArg(args, "max-startup-skew-seconds", 120)
  });
  const fixtureId = stringArg(args, "fixture-id");
  const runId = stringArg(args, "run-label", timestampSlug())!;
  const outDir = join(SAMPLES_DIR, "odds-sse", network, runId);
  const query = fixtureId ? `?fixtureId=${encodeURIComponent(fixtureId)}` : "";
  if (captureWindow) {
    const waitMs = captureWindow.startTsMs - Date.now();
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    const startupFailure = captureStartupFailure(captureWindow, Date.now());
    if (startupFailure) throw new Error(startupFailure);
  }
  const deadline = captureWindow?.endTsMs ?? Date.now() + durationMinutes * 60_000;
  if (captureWindow && !fixtureId) throw new Error("Absolute TXLine capture requires an exact fixture ID");

  await ensureDir(outDir);
  const terminalManifestPath = join(outDir, "txline-capture-manifest.json");
  const startedAt = new Date().toISOString();
  const manifestBase = {
    schemaVersion: 1,
    network,
    runId,
    fixtureId: fixtureId ?? null,
    startedAt,
    deadlineAt: new Date(deadline).toISOString(),
    captureWindow: captureWindow === null ? null : {
      startUtc: captureWindow.startUtc,
      endUtc: captureWindow.endUtc,
      maxStartupSkewSeconds: captureWindow.maxStartupSkewSeconds
    }
  };
  await writeAtomicJson(terminalManifestPath, {
    ...manifestBase,
    status: "running",
    endedAt: null,
    streams: null,
    error: null
  });

  await logManifest({
    type: "txline-sse-run-start",
    network,
    endpoint: "/api/odds/stream + /api/scores/stream",
    query: fixtureId ? { fixtureId } : {},
    runId,
    path: outDir,
    captureWindow: captureWindow === null ? null : {
      startUtc: captureWindow.startUtc,
      endUtc: captureWindow.endUtc,
      maxStartupSkewSeconds: captureWindow.maxStartupSkewSeconds
    }
  });

  let streams: CaptureStreamSummary[];
  try {
    streams = await Promise.all([
      captureStream({
        network,
        streamName: "odds",
        url: `${config.apiOrigin}/api/odds/stream${query}`,
        headers: authHeaders(token),
        outDir,
        deadline,
        expectedFixtureId: fixtureId
      }),
      captureStream({
        network,
        streamName: "scores",
        url: `${config.apiOrigin}/api/scores/stream${query}`,
        headers: authHeaders(token),
        outDir,
        deadline,
        expectedFixtureId: fixtureId
      })
    ]);
    await writeAtomicJson(terminalManifestPath, {
      ...manifestBase,
      status: "completed",
      endedAt: new Date().toISOString(),
      streams,
      error: null
    });
  } catch (error) {
    await writeAtomicJson(terminalManifestPath, {
      ...manifestBase,
      status: "failed",
      endedAt: new Date().toISOString(),
      streams: null,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }

  await logManifest({
    type: "txline-sse-run-end",
    network,
    endpoint: "/api/odds/stream + /api/scores/stream",
    query: fixtureId ? { fixtureId } : {},
    runId,
    path: outDir
  });
  console.log(`SSE capture complete: ${outDir}`);
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
