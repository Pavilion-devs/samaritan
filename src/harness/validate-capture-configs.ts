import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCaptureConfig, validateCaptureConfig } from "./capture-config.js";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const configsDir = resolve(repoRoot, "config/captures");
const txlineFixtures = JSON.parse(await readFile(resolve(repoRoot, "samples/fixtures/mainnet-world-cup-fixtures.json"), "utf8"));
const polymarketEvents = JSON.parse(await readFile(resolve(repoRoot, "data/live/gamma-discovery/open-world-cup-events.json"), "utf8"));
const results = [];
for (const name of (await readdir(configsDir)).filter((value) => value.endsWith(".json")).sort()) {
  const config = JSON.parse(await readFile(resolve(configsDir, name), "utf8"));
  if (config === null || typeof config !== "object" || !("capture" in config)) {
    results.push({ name, status: "legacy_capture_config", evidenceValid: true, readyToSchedule: false, reason: "not_a_future_scheduled_capture", launch: null });
    continue;
  }
  const scheduledEndUtc = (config as { capture?: { scheduledEndUtc?: unknown } }).capture?.scheduledEndUtc;
  const scheduledEndTsMs = Date.parse(String(scheduledEndUtc ?? ""));
  if (Number.isFinite(scheduledEndTsMs) && scheduledEndTsMs < Date.now()) {
    try {
      const parsed = parseCaptureConfig(config);
      results.push({
        name,
        status: "historical_capture_config",
        evidenceValid: true,
        readyToSchedule: false,
        reason: "capture_window_ended_static_review_valid_outcome_requires_preserved_run_evidence",
        captureId: parsed.captureId,
        launch: null
      });
    } catch (error) {
      results.push({ name, evidenceValid: false, error: error instanceof Error ? error.message : String(error) });
    }
    continue;
  }
  try {
    const validation = validateCaptureConfig({ repoRoot, config, txlineFixtures, polymarketEvents });
    results.push({ name, status: validation.config.status, evidenceValid: true, readyToSchedule: validation.readyToSchedule, reason: validation.reason, launch: validation.launch });
  } catch (error) {
    results.push({ name, evidenceValid: false, error: error instanceof Error ? error.message : String(error) });
  }
}
console.log(JSON.stringify(results, null, 2));
if (results.some((result) => !result.evidenceValid)) process.exitCode = 1;
