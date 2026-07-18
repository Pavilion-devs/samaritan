import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { PAPER_STUDY_TOTAL_SELECTOR_CONFIG } from "../config/paper-study.js";
import { MappingRegistry } from "../mapping/registry.js";
import type { TotalLineEvidence } from "../research/main-total-selector.js";
import {
  buildPaperFixtureUniverse,
  renderPaperFixtureUniverseMarkdown,
  type PairedCaptureEvidence
} from "./paper-fixture-universe.js";
import {
  pairedCaptureEvidenceFromManifest,
  parseVerifiedPairedAnalysisManifest
} from "./paired-capture-manifest.js";
import {
  PAPER_STUDY_FROZEN_CONFIG_SHA256,
  PAPER_STUDY_PROTOCOL_STATUS,
  PAPER_STUDY_PROTOCOL_VERSION
} from "./paper-study-ledger.js";

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
}

function optionalArgument(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : null;
}

async function pairedCaptures(root: string): Promise<PairedCaptureEvidence[]> {
  const captures: PairedCaptureEvidence[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("paired-")) continue;
    const path = join(root, entry.name, "analysis-manifest.json");
    try {
      await access(path);
    } catch {
      continue;
    }
    const manifest = parseVerifiedPairedAnalysisManifest(JSON.parse(await readFile(path, "utf8")));
    if (manifest === null) continue;
    captures.push(pairedCaptureEvidenceFromManifest(manifest));
  }
  return captures;
}

const mappingsPath = resolve(argument("mappings", "data/live/gamma-discovery/candidate-mappings.json"));
const evidencePath = resolve(argument("total-evidence", "data/research/main-total-line-evidence.json"));
const historiesDir = resolve(argument("histories", "samples/polymarket-history/world-cup-2026-v1/histories"));
const liveRoot = resolve(argument("live-root", "data/live"));
const outputPath = resolve(argument("output", "data/paper/v2/fixture-universe.json"));
const reportPath = resolve(argument("report", "data/paper/v2/reports/fixture-universe.md"));
const ledgerManifestPath = resolve(argument("ledger-manifest", "data/paper/v2/study-ledgers.json"));
const laneStartArgument = optionalArgument("lane-start");
const ledgerManifest = JSON.parse(await readFile(ledgerManifestPath, "utf8")) as {
  protocolVersion: string;
  protocolStatus: string;
  configHash: string;
  realMoneyGate: string;
  longRun: { startedAtTsMs: number };
};
if (
  ledgerManifest.protocolVersion !== PAPER_STUDY_PROTOCOL_VERSION ||
  ledgerManifest.protocolStatus !== PAPER_STUDY_PROTOCOL_STATUS ||
  ledgerManifest.configHash !== PAPER_STUDY_FROZEN_CONFIG_SHA256 ||
  ledgerManifest.realMoneyGate !== "closed"
) {
  throw new Error("Paper fixture universe requires the registered v2 paper-study manifest");
}
const laneStartTsMs = laneStartArgument === null
  ? ledgerManifest.longRun.startedAtTsMs
  : Date.parse(laneStartArgument);
const generatedAt = new Date().toISOString();
const [mappingFile, evidenceFile, historyFiles, captures] = await Promise.all([
  readFile(mappingsPath, "utf8").then((value) => JSON.parse(value) as { records?: unknown[] }),
  readFile(evidencePath, "utf8").then((value) => JSON.parse(value) as { evidence?: TotalLineEvidence[] }),
  readdir(historiesDir),
  pairedCaptures(liveRoot)
]);
const mappings = new MappingRegistry(mappingFile.records ?? []).records();
const universe = buildPaperFixtureUniverse({
  generatedAt,
  laneStartTsMs,
  mappings,
  totalEvidence: evidenceFile.evidence ?? [],
  pairedCaptures: captures,
  sampledHistoryAssetIds: new Set(historyFiles.filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -5))),
  selectorConfig: PAPER_STUDY_TOTAL_SELECTOR_CONFIG
});
await Promise.all([mkdir(dirname(outputPath), { recursive: true }), mkdir(dirname(reportPath), { recursive: true })]);
await Promise.all([
  writeFile(outputPath, `${JSON.stringify(universe, null, 2)}\n`),
  writeFile(reportPath, renderPaperFixtureUniverseMarkdown(universe))
]);
console.log(JSON.stringify({ outputPath, reportPath, summary: universe.summary }, null, 2));
