import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { PAPER_STUDY_REPLAY_WINDOW_BEFORE_KICKOFF_MS } from "../config/paper-study.js";
import {
  renderHistoricalGateStudyMarkdown,
  runHistoricalGateStudy
} from "./historical-gate-study.js";

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
}

const outputPath = resolve(argument("output", "data/research/historical-gate-study-causal-economic-v4.json"));
const reportPath = resolve(argument("report", "docs/research/historical-gate-study-causal-economic-v4.md"));
for (const path of [outputPath, reportPath]) {
  if (existsSync(path)) throw new Error(`Refusing to replace existing corrected gate artifact: ${path}`);
}
const study = await runHistoricalGateStudy({
  archivePath: resolve(argument("db", "data/research/samaritan-research-v1.duckdb")),
  mappingsPath: resolve(argument("mappings", "data/research/mappings/world-cup-candidates.json")),
  totalEvidencePath: resolve(argument("total-evidence", "data/research/main-total-line-evidence-causal-v2.json")),
  trainFraction: Number(argument("train-fraction", "0.7")),
  windowBeforeKickoffMs:
    Number(argument("window-hours", String(PAPER_STUDY_REPLAY_WINDOW_BEFORE_KICKOFF_MS / 3_600_000))) *
    3_600_000,
  minimumTrainingSignals: Number(argument("minimum-training-signals", "30")),
  costProxyProbability: Number(argument("cost-proxy-bps", "100")) / 10_000
}, (message) => console.log(message));

await Promise.all([mkdir(dirname(outputPath), { recursive: true }), mkdir(dirname(reportPath), { recursive: true })]);
await Promise.all([
  writeFile(outputPath, `${JSON.stringify(study, null, 2)}\n`),
  writeFile(reportPath, renderHistoricalGateStudyMarkdown(study))
]);
console.log(JSON.stringify({
  outputPath,
  reportPath,
  split: study.split,
  detectorStatuses: Object.fromEntries(
    study.detectors.map((detector) => [detector.detector, detector.test.necessaryEvidenceStatus])
  ),
  forwardPaperCandidate: study.forwardPaperCandidate
}, null, 2));
