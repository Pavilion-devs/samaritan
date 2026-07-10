import { createWriteStream } from "node:fs";
import { join } from "node:path";
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

async function captureStream(options: {
  network: string;
  streamName: "odds" | "scores";
  url: string;
  headers: Record<string, string>;
  outDir: string;
  deadline: number;
}): Promise<void> {
  let lastEventId = "";
  let reconnect = 0;
  const raw = createWriteStream(join(options.outDir, `${options.streamName}.raw.sse`), { flags: "a" });
  const framesPath = join(options.outDir, `${options.streamName}.frames.ndjson`);
  const reconnectPath = join(options.outDir, "reconnects.ndjson");

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

    try {
      const response = await fetch(options.url, { headers });
      if (!response.ok || !response.body) {
        const text = await response.text();
        throw new Error(`${options.streamName} stream failed ${response.status}: ${text.slice(0, 300)}`);
      }

      const reader = response.body.getReader();
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
      reader.releaseLock();
    } catch (error) {
      await appendJsonl(reconnectPath, {
        at: new Date().toISOString(),
        stream: options.streamName,
        reconnect,
        lastEventId: lastEventId || null,
        action: "disconnect",
        error: error instanceof Error ? error.message : String(error)
      });
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    reconnect += 1;
  }

  raw.end();
}

async function main(): Promise<void> {
  const args = parseArgs();
  const network = getNetwork(args);
  const token = await loadToken(network);
  const config = NETWORKS[network];
  const durationMinutes = numberArg(args, "duration-minutes", 240);
  const fixtureId = stringArg(args, "fixture-id");
  const runId = stringArg(args, "run-label", timestampSlug())!;
  const outDir = join(SAMPLES_DIR, "odds-sse", network, runId);
  const query = fixtureId ? `?fixtureId=${encodeURIComponent(fixtureId)}` : "";
  const deadline = Date.now() + durationMinutes * 60_000;

  await ensureDir(outDir);

  await logManifest({
    type: "txline-sse-run-start",
    network,
    endpoint: "/api/odds/stream + /api/scores/stream",
    query: fixtureId ? { fixtureId } : {},
    runId,
    path: outDir
  });

  await Promise.all([
    captureStream({
      network,
      streamName: "odds",
      url: `${config.apiOrigin}/api/odds/stream${query}`,
      headers: authHeaders(token),
      outDir,
      deadline
    }),
    captureStream({
      network,
      streamName: "scores",
      url: `${config.apiOrigin}/api/scores/stream${query}`,
      headers: authHeaders(token),
      outDir,
      deadline
    })
  ]);

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

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
