import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  captureStream,
  isCompletedExactFixtureScoreRecord,
  isUsableExactFixtureOddsRecord
} from "../src/capture-sse.js";
import { fetchWithRetry } from "../src/polymarket-lib.js";

test("captureStream aborts an open SSE response at the deadline", async () => {
  const directory = await mkdtemp(join(tmpdir(), "samaritan-sse-deadline-"));
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache"
    });
    response.write('id: event-1\ndata: {"FixtureId":123,"Ts":1,"SuperOddsType":"1X2_PARTICIPANT_RESULT","PriceNames":["1","X","2"],"Prices":[2500,3333,3333],"Pct":["40","30","30"]}\n\n');
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP test server");

  const startedAt = Date.now();
  try {
    const summary = await captureStream({
      network: "mainnet",
      streamName: "odds",
      url: `http://127.0.0.1:${address.port}`,
      headers: {},
      outDir: directory,
      deadline: startedAt + 100,
      reconnectDelayMs: 1,
      expectedFixtureId: "123"
    });

    assert.ok(Date.now() - startedAt < 1_000, "capture should not wait for the server to close");
    const frames = await readFile(join(directory, "odds.frames.ndjson"), "utf8");
    assert.match(frames, /event-1/);
    const reconnects = await readFile(join(directory, "reconnects.ndjson"), "utf8");
    assert.doesNotMatch(reconnects, /"action":"disconnect"/);
    assert.equal(summary.usableExactFixtureOddsFrames, 1);
    assert.equal(summary.exactFixtureDataFrames, 1);
  } finally {
    server.closeAllConnections();
    server.close();
    await once(server, "close");
    await rm(directory, { recursive: true, force: true });
  }
});

test("score completion requires the exact terminal TXLine semantic", () => {
  assert.equal(isCompletedExactFixtureScoreRecord({ Action: "game_finalised", StatusId: 100 }), true);
  assert.equal(isCompletedExactFixtureScoreRecord({ Action: "status", StatusId: 5 }), false);
  assert.equal(isCompletedExactFixtureScoreRecord({ Action: "game_finalised", StatusId: 5 }), false);
});

test("usable exact-fixture odds require aligned prices and sane 0-100 Pct semantics", () => {
  const valid: Record<string, unknown> = {
    SuperOddsType: "OVERUNDER_PARTICIPANT_GOALS",
    PriceNames: ["over", "under"],
    Prices: [1900, 2100],
    Pct: ["52.631", "47.369"]
  };
  assert.equal(isUsableExactFixtureOddsRecord(valid), true);
  const invalid: Array<Record<string, unknown>> = [
    { ...valid, Prices: [] },
    { ...valid, Prices: [1900] },
    { ...valid, Prices: [1900, 0] },
    { ...valid, Prices: [1900, Number.NaN] },
    { ...valid, Pct: ["52.631", ""] },
    { ...valid, Pct: [52.631, 47.369] },
    { ...valid, Pct: ["0.52631", "0.47369"] },
    { ...valid, Pct: ["101", "-1"] },
    { ...valid, PriceNames: ["over", " "] },
    { ...valid, SuperOddsType: "ASIANHANDICAP_PARTICIPANT_GOALS" }
  ];
  for (const row of invalid) assert.equal(isUsableExactFixtureOddsRecord(row), false);
});

test("Gamma retry aborts inside an absolute request deadline", async () => {
  const server = createServer((_request, _response) => {
    // Intentionally never send headers: the deadline must abort this request.
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP test server");
  const startedAt = Date.now();
  try {
    const result = await fetchWithRetry(`http://127.0.0.1:${address.port}`, {}, {
      attempts: 3,
      attemptTimeoutMs: 30,
      baseDelayMs: 5,
      maxDelayMs: 5,
      deadlineTsMs: startedAt + 80
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 0);
    assert.ok(Date.now() - startedAt < 500, "request must not outlive its absolute deadline");
  } finally {
    server.closeAllConnections();
    server.close();
    await once(server, "close");
  }
});
