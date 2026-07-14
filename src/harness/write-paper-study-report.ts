import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { evaluatePaperStudyLedger } from "../metrics/paper-study-observations.js";
import {
  renderPaperStudyEvidence,
  type PaperStudyEvidenceArtifact
} from "../metrics/paper-study-report.js";
import type { PaperFixtureUniverse } from "./paper-fixture-universe.js";
import { initializePaperStudyLedger } from "./paper-study-ledger.js";

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
}

const manifest = JSON.parse(
  await readFile(resolve(argument("manifest", "data/paper/study-ledgers.json")), "utf8")
) as {
  protocolVersion: string;
  configHash: string;
  realMoneyGate: "closed";
  bounty: { path: string; startedAtTsMs: number };
  longRun: { path: string; startedAtTsMs: number };
};
const universe = JSON.parse(
  await readFile(resolve(argument("universe", "data/research/paper-fixture-universe.json")), "utf8")
) as PaperFixtureUniverse;
const bounty = initializePaperStudyLedger({
  path: resolve(manifest.bounty.path),
  lane: "bounty",
  startedAtTsMs: manifest.bounty.startedAtTsMs
});
const longRun = initializePaperStudyLedger({
  path: resolve(manifest.longRun.path),
  lane: "long_run",
  startedAtTsMs: manifest.longRun.startedAtTsMs
});
try {
  const kickoffByFixtureId = new Map(
    universe.fixtures.map((fixture) => [fixture.fixtureId, fixture.kickoffTsMs])
  );
  const artifact: PaperStudyEvidenceArtifact = {
    generatedAt: new Date().toISOString(),
    protocolVersion: manifest.protocolVersion,
    configHash: manifest.configHash,
    realMoneyGate: "closed",
    fixtureUniverseGeneratedAt: universe.generatedAt,
    lanes: {
      bounty: {
        initialization: bounty.initialization,
        chain: bounty.ledger.verifyChain(),
        report: evaluatePaperStudyLedger({ lane: "bounty", ledger: bounty.ledger, kickoffByFixtureId })
      },
      longRun: {
        initialization: longRun.initialization,
        chain: longRun.ledger.verifyChain(),
        report: evaluatePaperStudyLedger({ lane: "long_run", ledger: longRun.ledger, kickoffByFixtureId })
      }
    }
  };
  const jsonPath = resolve(argument("output", "data/paper/reports/current.json"));
  const markdownPath = resolve(argument("report", "docs/research/paper-study-current.md"));
  await Promise.all([
    mkdir(dirname(jsonPath), { recursive: true }),
    mkdir(dirname(markdownPath), { recursive: true })
  ]);
  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify(artifact, null, 2)}\n`),
    writeFile(markdownPath, renderPaperStudyEvidence(artifact))
  ]);
  process.stdout.write(`${JSON.stringify({
    jsonPath,
    markdownPath,
    bountyStatus: artifact.lanes.bounty.report.status,
    longRunStatus: artifact.lanes.longRun.report.status,
    longRunCounts: artifact.lanes.longRun.report.counts
  }, null, 2)}\n`);
} finally {
  bounty.ledger.close();
  longRun.ledger.close();
}
