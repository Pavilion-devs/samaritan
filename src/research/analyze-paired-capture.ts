import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { analyzePairedLiveCapture, renderPairedLiveStudyMarkdown } from "./paired-live-study.js";

type CaptureConfig = {
  captureId?: string;
  txline?: { fixtureId?: string };
};

function argument(name: string, fallback?: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : fallback;
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}

const captureConfigPath = resolve(argument("capture-config", "config/captures/spain-belgium-2026-07-10.json"));
const captureConfig = JSON.parse(await readFile(captureConfigPath, "utf8")) as CaptureConfig;
const runId = captureConfig.captureId;
const fixtureId = captureConfig.txline?.fixtureId;
if (!runId || !fixtureId) throw new Error("Capture config requires captureId and txline.fixtureId");
const mappingPath = resolve(argument("mappings", "data/research/mappings/world-cup-candidates.json"));
const polymarketDirectory = resolve(argument("polymarket-dir", `samples/polymarket-live/${runId}`));
const txlineDirectory = resolve(argument("txline-dir", `samples/odds-sse/mainnet/${runId}`));
const outputPath = resolve(argument("output", `data/research/${runId}-live-lane.json`));
const reportPath = resolve(argument("report", `docs/research/${runId}-live-lane.md`));
const materialMoveBps = Number(argument("material-move-bps", "50"));
if (!Number.isFinite(materialMoveBps) || materialMoveBps <= 0) {
  throw new RangeError("--material-move-bps must be positive");
}

const study = await analyzePairedLiveCapture({
  fixtureId,
  mappingPath,
  polymarketMessagesPath: resolve(polymarketDirectory, "messages.ndjson"),
  polymarketReconnectsPath: resolve(polymarketDirectory, "reconnects.ndjson"),
  txlineOddsPath: resolve(txlineDirectory, "odds.frames.ndjson"),
  txlineScoresPath: resolve(txlineDirectory, "scores.frames.ndjson"),
  materialMoveProbability: materialMoveBps / 10_000
});
await Promise.all([mkdir(dirname(outputPath), { recursive: true }), mkdir(dirname(reportPath), { recursive: true })]);
await Promise.all([
  writeFile(outputPath, `${JSON.stringify(study, null, 2)}\n`),
  writeFile(reportPath, renderPairedLiveStudyMarkdown(study))
]);
console.log(JSON.stringify({
  outputPath,
  reportPath,
  goals: study.goals.length,
  marketGroups: study.mapping.groups,
  normalizedEvents: study.analysisWindow.normalizedEvents
}, null, 2));
