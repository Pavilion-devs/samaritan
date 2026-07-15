import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CapturedPaperSessionAuthorizationError,
  parseCapturedPaperSessionArgs,
  preflightCapturedPaperSession,
  runCapturedPaperSessionCli
} from "../src/harness/run-captured-paper-session.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("captured paper-session CLI", () => {
  it("parses explicit replay, fixture, lane, speed, and persistence paths", () => {
    const root = resolve("/tmp/samaritan-captured-cli-options");
    const options = parseCapturedPaperSessionArgs([
      "--run-label", "paired-fixture-42",
      "--capture-config", "capture/config.json",
      "--txline-fixture-snapshot", "capture/fixtures.json",
      "--polymarket-event-snapshot", "capture/events.json",
      "--txline-odds", "capture/odds.ndjson",
      "--txline-scores", "capture/scores.ndjson",
      "--polymarket-messages", "capture/messages.ndjson",
      "--polymarket-subscriptions", "capture/subscriptions.json",
      "--polymarket-terminal-manifest", "capture/polymarket-terminal.json",
      "--txline-terminal-manifest", "capture/txline-terminal.json",
      "--capture-analysis-manifest", "capture/analysis.json",
      "--mapping-registry", "evidence/mappings.json",
      "--causal-total-evidence", "evidence/causal-total.json",
      "--universe", "evidence/universe.json",
      "--study-ledger-manifest", "paper/manifest.json",
      "--spend-ledger", "private/spend.sqlite",
      "--invocation-evidence-ledger", "private/invocations.sqlite",
      "--env", "private/runtime.env",
      "--fixture", "fixture-42",
      "--lane", "long_run",
      "--speed", "0.5",
      "--decision-latency-ms", "7",
      "--maximum-pending-ms", "9000"
    ], root);

    expect(options).toEqual({
      repoRoot: root,
      runLabel: "paired-fixture-42",
      captureConfigPath: join(root, "capture/config.json"),
      txlineFixtureSnapshotPath: join(root, "capture/fixtures.json"),
      polymarketEventSnapshotPath: join(root, "capture/events.json"),
      txlineOddsFramesPath: join(root, "capture/odds.ndjson"),
      txlineScoresFramesPath: join(root, "capture/scores.ndjson"),
      polymarketMessagesPath: join(root, "capture/messages.ndjson"),
      polymarketSubscriptionsPath: join(root, "capture/subscriptions.json"),
      polymarketTerminalManifestPath: join(root, "capture/polymarket-terminal.json"),
      txlineTerminalManifestPath: join(root, "capture/txline-terminal.json"),
      captureAnalysisManifestPath: join(root, "capture/analysis.json"),
      mappingRegistryPath: join(root, "evidence/mappings.json"),
      causalTotalEvidencePath: join(root, "evidence/causal-total.json"),
      fixtureUniversePath: join(root, "evidence/universe.json"),
      studyLedgerManifestPath: join(root, "paper/manifest.json"),
      spendLedgerPath: join(root, "private/spend.sqlite"),
      invocationEvidenceLedgerPath: join(root, "private/invocations.sqlite"),
      envPath: join(root, "private/runtime.env"),
      fixtureId: "fixture-42",
      lane: "long_run",
      speed: 0.5,
      decisionLatencyMs: 7,
      maximumPendingMs: 9_000
    });
  });

  it("rejects unknown, duplicate, missing, and unsafe argument values", () => {
    expect(() => parseCapturedPaperSessionArgs(["--wat", "value"]))
      .toThrow(/Unknown captured paper-session option/);
    expect(() => parseCapturedPaperSessionArgs(["--fixture", "one", "--fixture", "two"]))
      .toThrow(/Duplicate/);
    expect(() => parseCapturedPaperSessionArgs(["--fixture"]))
      .toThrow(/requires a value/);
    expect(() => parseCapturedPaperSessionArgs([
      "--run-label", "paired-test-run", "--fixture", "has whitespace"
    ]))
      .toThrow(/without whitespace/);
    expect(() => parseCapturedPaperSessionArgs([
      "--run-label", "paired-test-run", "--fixture", "fixture", "--lane", "production"
    ]))
      .toThrow(/bounty.*long_run/);
    expect(() => parseCapturedPaperSessionArgs([
      "--run-label", "paired-test-run", "--fixture", "fixture", "--speed", "0"
    ])).toThrow(/finite, positive, and at most 1/);
    expect(() => parseCapturedPaperSessionArgs([
      "--run-label", "paired-test-run", "--fixture", "fixture", "--speed", "infinity"
    ])).toThrow(/finite, positive, and at most 1/);
    expect(() => parseCapturedPaperSessionArgs([
      "--run-label", "paired-test-run", "--fixture", "fixture", "--speed", "1.01"
    ])).toThrow(/finite, positive, and at most 1/);
    expect(() => parseCapturedPaperSessionArgs([
      "--run-label", "paired-test-run", "--fixture", "fixture", "--maximum-pending-ms", "1.2"
    ]))
      .toThrow(/positive safe integer/);
    expect(() => parseCapturedPaperSessionArgs(["--run-label", "paired-test-run"]))
      .toThrow(/--fixture is required/);
    expect(() => parseCapturedPaperSessionArgs(["--fixture", "fixture"]))
      .toThrow(/--run-label is required/);
  });

  it("defaults an explicitly selected capture to causal real-time replay", () => {
    const options = parseCapturedPaperSessionArgs([
      "--run-label", "paired-causal-test",
      "--fixture", "fixture-test"
    ], "/tmp/samaritan-causal-default");
    expect(options.speed).toBe(1);
    expect(options.runLabel).toBe("paired-causal-test");
  });

  it("accepts pnpm 11's leading script-argument separator", () => {
    const options = parseCapturedPaperSessionArgs([
      "--",
      "--run-label", "paired-pnpm-eleven",
      "--fixture", "fixture-pnpm-eleven"
    ], "/tmp/samaritan-pnpm-eleven");
    expect(options).toMatchObject({
      runLabel: "paired-pnpm-eleven",
      fixtureId: "fixture-pnpm-eleven",
      speed: 1
    });
  });

  it("denies the current unregistered protocol before preflight, ledgers, or execution", async () => {
    const directory = mkdtempSync(join(tmpdir(), "samaritan-captured-auth-"));
    directories.push(directory);
    const spendPath = join(directory, "spend.sqlite");
    const invocationPath = join(directory, "invocations.sqlite");
    const execute = vi.fn();

    await expect(runCapturedPaperSessionCli([
      "--spend-ledger", spendPath,
      "--invocation-evidence-ledger", invocationPath,
      "--env", join(directory, "must-not-be-read.env")
    ], execute)).rejects.toBeInstanceOf(CapturedPaperSessionAuthorizationError);
    expect(execute).not.toHaveBeenCalled();
    expect(existsSync(spendPath)).toBe(false);
    expect(existsSync(invocationPath)).toBe(false);
  });

  it("fails read-only preflight on empty capture evidence without creating durable ledgers", async () => {
    const directory = mkdtempSync(join(tmpdir(), "samaritan-captured-preflight-"));
    directories.push(directory);
    const options = parseCapturedPaperSessionArgs([
      "--run-label", "paired-preflight-test",
      "--fixture", "fixture-test",
      "--capture-config", "config.json",
      "--txline-fixture-snapshot", "fixtures.json",
      "--polymarket-event-snapshot", "events.json",
      "--txline-odds", "odds.frames.ndjson",
      "--txline-scores", "scores.frames.ndjson",
      "--polymarket-messages", "messages.ndjson",
      "--polymarket-subscriptions", "subscriptions.json",
      "--capture-analysis-manifest", "analysis.json",
      "--mapping-registry", "mappings.json",
      "--universe", "universe.json",
      "--study-ledger-manifest", "manifest.json",
      "--spend-ledger", "spend.sqlite",
      "--invocation-evidence-ledger", "invocations.sqlite"
    ], directory);
    writeFileSync(options.captureConfigPath, "{}\n");
    writeFileSync(options.txlineFixtureSnapshotPath, "{}\n");
    writeFileSync(options.polymarketEventSnapshotPath, "{}\n");
    writeFileSync(options.txlineOddsFramesPath, "");

    await expect(preflightCapturedPaperSession(options)).rejects.toThrow(
      /TXLine odds frames must be a non-empty file/
    );
    expect(existsSync(options.spendLedgerPath)).toBe(false);
    expect(existsSync(options.invocationEvidenceLedgerPath)).toBe(false);
  });

  it("rejects aliased durable evidence paths before reading capture data", async () => {
    const directory = mkdtempSync(join(tmpdir(), "samaritan-captured-paths-"));
    directories.push(directory);
    const options = parseCapturedPaperSessionArgs([
      "--run-label", "paired-path-test",
      "--fixture", "fixture-test",
      "--spend-ledger", "same.sqlite",
      "--invocation-evidence-ledger", "same.sqlite"
    ], directory);
    await expect(preflightCapturedPaperSession(options)).rejects.toThrow(
      /Claude evidence paths must be distinct/
    );
    expect(existsSync(join(directory, "same.sqlite"))).toBe(false);
  });

  it("rejects evidence snapshots that are distinct strings but the same file through a symlink", async () => {
    const directory = mkdtempSync(join(tmpdir(), "samaritan-captured-symlinks-"));
    directories.push(directory);
    const options = parseCapturedPaperSessionArgs([
      "--run-label", "paired-symlink-test",
      "--fixture", "fixture-test",
      "--capture-config", "config.json",
      "--txline-fixture-snapshot", "fixtures.json",
      "--polymarket-event-snapshot", "events.json",
      "--txline-odds", "odds.frames.ndjson",
      "--txline-scores", "scores.frames.ndjson",
      "--polymarket-messages", "messages.ndjson",
      "--polymarket-subscriptions", "subscriptions.json",
      "--polymarket-terminal-manifest", "capture-manifest.json",
      "--txline-terminal-manifest", "txline-capture-manifest.json",
      "--capture-analysis-manifest", "analysis.json",
      "--mapping-registry", "mappings.json",
      "--causal-total-evidence", "causal-total.json",
      "--universe", "universe.json",
      "--study-ledger-manifest", "manifest.json"
    ], directory);
    writeFileSync(options.txlineFixtureSnapshotPath, "{}\n");
    symlinkSync(options.txlineFixtureSnapshotPath, options.polymarketEventSnapshotPath);
    for (const path of [
      options.captureConfigPath,
      options.txlineOddsFramesPath,
      options.txlineScoresFramesPath,
      options.polymarketMessagesPath,
      options.polymarketSubscriptionsPath,
      options.polymarketTerminalManifestPath,
      options.txlineTerminalManifestPath,
      options.captureAnalysisManifestPath,
      options.mappingRegistryPath,
      options.causalTotalEvidencePath,
      options.fixtureUniversePath,
      options.studyLedgerManifestPath
    ]) writeFileSync(path, "{}\n");

    await expect(preflightCapturedPaperSession(options)).rejects.toThrow(
      /Canonical captured paper-session input paths must be distinct/
    );
  });
});
