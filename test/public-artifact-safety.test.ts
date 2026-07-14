import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parsePublicArtifactAuditArgs } from "../src/public/audit-public-artifacts.js";
import {
  assertPublicArtifactsSafe,
  auditPublicArtifacts,
  type PublicArtifactAuditReport,
  type PublicArtifactViolationCode
} from "../src/public/artifact-safety.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "samaritan-public-artifacts-"));
  directories.push(directory);
  return directory;
}

function writeJson(directory: string, filename: string, value: unknown): string {
  const path = join(directory, filename);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

function codes(report: PublicArtifactAuditReport): PublicArtifactViolationCode[] {
  return report.violations.map((violation) => violation.code);
}

describe("public artifact safety auditor", () => {
  it("accepts derived-only movements and a hash-only decision receipt", async () => {
    const directory = temporaryDirectory();
    writeJson(directory, "decision-receipt.json", {
      schemaVersion: 1,
      provenance: {
        evidenceClass: "captured_paper_case",
        performanceUse: "subject_to_registered_evaluation"
      },
      signal: {
        detector: "CONSENSUS_MOVE",
        derivedEvidence: {
          consensusMoveFromBaselineBps: 25,
          consensusVelocityBps: 40,
          crossMarketGapBps: 175,
          gapBasis: "live_book"
        }
      },
      thesis: {
        fairProbability: 0.54,
        recommendation: "paper_trade"
      },
      execution: {
        bestPrice: 0.51,
        halfSpreadBps: 50
      },
      sourceEvidence: [
        {
          source: "txline",
          role: "signal",
          disclosure: "hash_only",
          payloadSha256: "a".repeat(64)
        }
      ]
    });
    writeJson(directory, "matchroom-derived.json", {
      publicDataPolicy: {
        derivedOnly: true,
        txlineProbabilityDisplay: "bucketed_movement_only",
        txlineMovementBucketBps: 25
      },
      replay: {
        consensusMoveFromBaselineBps: 25,
        firstMaterialMoveLatencyMs: 228,
        bestBid: 0.17,
        bestAsk: 0.18
      }
    });

    const report = await auditPublicArtifacts({ allowlistedPaths: [directory], cwd: directory });

    expect(report).toMatchObject({ ok: true, mode: "bundle", existingAllowlistedRoots: 1, filesScanned: 2 });
    expect(report.violations).toEqual([]);
    expect(() => assertPublicArtifactsSafe(report)).not.toThrow();
  });

  it("rejects forbidden raw keys and a nested TXLine envelope", async () => {
    const directory = temporaryDirectory();
    writeJson(directory, "public-data.json", {
      harmless: true,
      nested: {
        raw: {
          FixtureId: 18_218_149,
          MessageId: 99,
          Ts: 1_700_000_000_000,
          SuperOddsType: "Over/Under",
          BookmakerId: 10_021,
          Bookmaker: "TXLineStablePriceDemargined",
          Pct: ["55.000", "45.000"],
          Prices: [1800, 2200]
        }
      }
    });

    const report = await auditPublicArtifacts({ allowlistedPaths: [directory], cwd: directory });

    expect(report.ok).toBe(false);
    expect(codes(report)).toEqual(expect.arrayContaining(["RAW_TXLINE_KEY", "RAW_TXLINE_ENVELOPE"]));
    expect(report.violations.some((violation) => violation.jsonPath?.includes("nested"))).toBe(true);
  });

  it("rejects direct exact consensus levels and series while allowing derived bps", async () => {
    const directory = temporaryDirectory();
    writeJson(directory, "levels.json", {
      safe: { consensusMoveFromBaselineBps: 50 },
      nested: {
        consensusProbability: 0.5375,
        stablePriceSeries: [0.52, 0.53, 0.5375]
      }
    });

    const report = await auditPublicArtifacts({ allowlistedPaths: [directory], cwd: directory });

    expect(codes(report)).toContain("EXACT_TXLINE_CONSENSUS");
    expect(report.violations.filter((violation) => violation.code === "EXACT_TXLINE_CONSENSUS")).toHaveLength(2);
  });

  it("rejects algebraically reconstructive exact venue-level plus consensus-gap shapes", async () => {
    const directory = temporaryDirectory();
    writeJson(directory, "reconstructive.json", {
      case: {
        venue: { polymarketProbability: 0.5125 },
        derived: { crossMarketGapBps: 225 }
      }
    });

    const report = await auditPublicArtifacts({ allowlistedPaths: [directory], cwd: directory });

    expect(codes(report)).toContain("RECONSTRUCTIVE_TXLINE_SHAPE");
  });

  it("rejects a TXLine-labelled nested exact level but permits hash-only provenance", async () => {
    const directory = temporaryDirectory();
    writeJson(directory, "sources.json", {
      safe: { source: "txline", payloadSha256: "b".repeat(64), disclosure: "hash_only" },
      unsafe: { source: "txline", observations: [{ probability: 0.51 }, { probability: 0.52 }] }
    });

    const report = await auditPublicArtifacts({ allowlistedPaths: [directory], cwd: directory });

    expect(codes(report)).toContain("EXACT_TXLINE_CONSENSUS");
    expect(report.violations.filter((violation) => violation.code === "EXACT_TXLINE_CONSENSUS")).toHaveLength(1);
  });

  it("rejects sensitive structured keys and concrete secret value patterns", async () => {
    const directory = temporaryDirectory();
    writeJson(directory, "config.json", {
      nested: {
        apiToken: "txline-secret-that-must-never-ship",
        harmless: "value"
      }
    });
    writeFileSync(join(directory, "notes.md"), "Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789\n");

    const report = await auditPublicArtifacts({ allowlistedPaths: [directory], cwd: directory });

    expect(codes(report)).toEqual(expect.arrayContaining(["SENSITIVE_DATA_KEY", "SECRET_VALUE_PATTERN"]));
  });

  it("rejects private workstation paths in otherwise harmless files", async () => {
    const directory = temporaryDirectory();
    writeJson(directory, "build-metadata.json", {
      generatedFrom: "/Users/deborah/Documents/samaritan/private-ledger.sqlite"
    });

    const report = await auditPublicArtifacts({ allowlistedPaths: [directory], cwd: directory });

    expect(codes(report)).toContain("PRIVATE_ABSOLUTE_PATH");
  });

  it("rejects raw capture extensions/names and symlinks in bundle mode", async () => {
    const directory = temporaryDirectory();
    writeFileSync(join(directory, "txline-odds-capture.ndjson"), "{\"FixtureId\":1}\n");
    writeFileSync(join(directory, "target.txt"), "safe\n");
    symlinkSync(join(directory, "target.txt"), join(directory, "linked.txt"));

    const report = await auditPublicArtifacts({ allowlistedPaths: [directory], cwd: directory });

    expect(codes(report)).toEqual(
      expect.arrayContaining(["RAW_CAPTURE_EXTENSION", "RAW_CAPTURE_FILENAME", "SYMLINK_NOT_ALLOWED"])
    );
  });

  it("rejects renamed opaque payloads and still inspects JSON disguised as text", async () => {
    const directory = temporaryDirectory();
    writeFileSync(join(directory, "renamed.bin"), Buffer.from([0, 1, 2, 3, 4]));
    writeFileSync(join(directory, "looks-harmless.txt"), JSON.stringify({ nested: { Pct: ["51.0", "49.0"] } }));

    const report = await auditPublicArtifacts({ allowlistedPaths: [directory], cwd: directory });

    expect(codes(report)).toEqual(expect.arrayContaining(["OPAQUE_DATA_ARTIFACT", "RAW_TXLINE_KEY"]));
  });

  it("rejects per-file and aggregate oversize artifacts using caller-frozen limits", async () => {
    const directory = temporaryDirectory();
    writeFileSync(join(directory, "one.txt"), "a".repeat(12));
    writeFileSync(join(directory, "two.txt"), "b".repeat(12));

    const report = await auditPublicArtifacts({
      allowlistedPaths: [directory],
      cwd: directory,
      maxFileBytes: 10,
      maxTotalBytes: 20
    });

    expect(codes(report)).toEqual(expect.arrayContaining(["FILE_TOO_LARGE", "BUNDLE_TOO_LARGE"]));
  });

  it("fails closed without an explicit existing bundle allowlist", async () => {
    const directory = temporaryDirectory();
    const emptyDirectory = join(directory, "empty");
    mkdirSync(emptyDirectory);
    const empty = await auditPublicArtifacts({ allowlistedPaths: [], cwd: directory });
    const missing = await auditPublicArtifacts({ allowlistedPaths: ["does-not-exist"], cwd: directory });
    const emptyBundle = await auditPublicArtifacts({ allowlistedPaths: [emptyDirectory], cwd: directory });

    expect(codes(empty)).toEqual(expect.arrayContaining(["NO_EXPLICIT_ALLOWLIST", "NO_ALLOWLISTED_BUNDLE"]));
    expect(codes(missing)).toEqual(expect.arrayContaining(["ALLOWLIST_PATH_MISSING", "NO_ALLOWLISTED_BUNDLE"]));
    expect(codes(emptyBundle)).toEqual(["EMPTY_ALLOWLISTED_BUNDLE"]);
    expect(() => assertPublicArtifactsSafe(empty)).toThrow(/NO_EXPLICIT_ALLOWLIST/);
  });

  it("requires explicit source-audit mode and paths but ignores implementation identifiers", async () => {
    const directory = temporaryDirectory();
    writeFileSync(
      join(directory, "normalizer.ts"),
      [
        "export type RawOdds = { Pct: string[]; Prices: number[]; BookmakerId: number };",
        "export const token = process.env.TXLINE_API_TOKEN;",
        "export const consensusProbability = (row: RawOdds) => Number(row.Pct[0]) / 100;"
      ].join("\n")
    );

    const report = await auditPublicArtifacts({ allowlistedPaths: [directory], cwd: directory, mode: "source" });
    const noPaths = await auditPublicArtifacts({ allowlistedPaths: [], cwd: directory, mode: "source" });

    expect(report.ok).toBe(true);
    expect(codes(noPaths)).toEqual(["NO_EXPLICIT_ALLOWLIST"]);
  });

  it("distinguishes source references from concrete data embedded in a shipped script", async () => {
    const safeDirectory = temporaryDirectory();
    writeFileSync(
      join(safeDirectory, "normalizer.js"),
      "export const normalize = (row) => ({ probability: Number(row.Pct[0]), odds: row.Prices });\n"
    );
    const unsafeDirectory = temporaryDirectory();
    writeFileSync(
      join(unsafeDirectory, "bootstrap.js"),
      "window.__BOOTSTRAP__ = { Pct: [\"51.000\", \"49.000\"], Prices: [1960, 2040] };\n"
    );

    const safe = await auditPublicArtifacts({ allowlistedPaths: [safeDirectory], cwd: safeDirectory });
    const unsafe = await auditPublicArtifacts({ allowlistedPaths: [unsafeDirectory], cwd: unsafeDirectory });

    expect(safe.ok).toBe(true);
    expect(codes(unsafe)).toContain("RAW_TXLINE_KEY");
  });

  it("recognizes JSON-escaped Windows workstation paths", async () => {
    const directory = temporaryDirectory();
    writeJson(directory, "metadata.json", { buildRoot: "C:\\Users\\Deborah\\samaritan\\private" });

    const report = await auditPublicArtifacts({ allowlistedPaths: [directory], cwd: directory });

    expect(codes(report)).toContain("PRIVATE_ABSOLUTE_PATH");
  });

  it("rejects invalid public JSON instead of silently treating it as source text", async () => {
    const directory = temporaryDirectory();
    writeFileSync(join(directory, "broken.json"), "{ not: valid json }\n");

    const report = await auditPublicArtifacts({ allowlistedPaths: [directory], cwd: directory });

    expect(codes(report)).toContain("UNPARSEABLE_ARTIFACT_DATA");
  });
});

describe("public artifact audit CLI arguments", () => {
  it("keeps bundle and source allowlists explicit and mutually exclusive", () => {
    expect(parsePublicArtifactAuditArgs(["--bundle", "dist/public-bundle"])).toMatchObject({
      mode: "bundle",
      allowlistedPaths: ["dist/public-bundle"]
    });
    expect(parsePublicArtifactAuditArgs(["--source-audit", "--path", "src", "--path", "docs/submission"]))
      .toMatchObject({ mode: "source", allowlistedPaths: ["src", "docs/submission"] });
    expect(() => parsePublicArtifactAuditArgs(["--source-audit", "--bundle", "dist"])).toThrow(
      /cannot be combined/
    );
    expect(() => parsePublicArtifactAuditArgs(["--path", "src"])).toThrow(/only valid/);
  });
});
