import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { PAPER_STUDY_MINIMUM_SIGNAL_TO_KICKOFF_MS } from "../config/paper-study.js";
import { buildCaptureReadiness, renderCaptureReadinessMarkdown } from "./capture-readiness.js";

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
}

const gammaPath = resolve(argument("gamma", "data/live/gamma-discovery/open-world-cup-events.json"));
const txlinePath = resolve(argument("txline", "samples/fixtures/mainnet-world-cup-fixtures.json"));
const outputPath = resolve(argument("output", "data/research/capture-readiness.json"));
const reportPath = resolve(argument("report", "docs/research/capture-readiness.md"));
const [gammaEvents, txlineFixtures] = await Promise.all([
  readFile(gammaPath, "utf8").then((value) => JSON.parse(value) as Array<Record<string, unknown>>),
  readFile(txlinePath, "utf8").then((value) => JSON.parse(value) as Array<Record<string, unknown>>)
]);
const readiness = buildCaptureReadiness({
  generatedAt: new Date().toISOString(),
  nowTsMs: Date.now(),
  requiredLeadMs: 3 * 60 * 60_000,
  signalCutoffMs: PAPER_STUDY_MINIMUM_SIGNAL_TO_KICKOFF_MS,
  gammaEvents,
  txlineFixtures
});
await Promise.all([mkdir(dirname(outputPath), { recursive: true }), mkdir(dirname(reportPath), { recursive: true })]);
await Promise.all([
  writeFile(outputPath, `${JSON.stringify(readiness, null, 2)}\n`),
  writeFile(reportPath, renderCaptureReadinessMarkdown(readiness))
]);
console.log(JSON.stringify({ outputPath, reportPath, fixtures: readiness.fixtures }, null, 2));
