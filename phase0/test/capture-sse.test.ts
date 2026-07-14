import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { captureStream } from "../src/capture-sse.js";

test("captureStream aborts an open SSE response at the deadline", async () => {
  const directory = await mkdtemp(join(tmpdir(), "samaritan-sse-deadline-"));
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache"
    });
    response.write('id: event-1\ndata: {"Ts":1}\n\n');
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP test server");

  const startedAt = Date.now();
  try {
    await captureStream({
      network: "mainnet",
      streamName: "odds",
      url: `http://127.0.0.1:${address.port}`,
      headers: {},
      outDir: directory,
      deadline: startedAt + 100,
      reconnectDelayMs: 1
    });

    assert.ok(Date.now() - startedAt < 1_000, "capture should not wait for the server to close");
    const frames = await readFile(join(directory, "odds.frames.ndjson"), "utf8");
    assert.match(frames, /event-1/);
    const reconnects = await readFile(join(directory, "reconnects.ndjson"), "utf8");
    assert.doesNotMatch(reconnects, /"action":"disconnect"/);
  } finally {
    server.closeAllConnections();
    server.close();
    await once(server, "close");
    await rm(directory, { recursive: true, force: true });
  }
});
