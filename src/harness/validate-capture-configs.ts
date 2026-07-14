import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateCaptureConfig } from "./capture-config.js";

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
  try {
    const validation = validateCaptureConfig({ repoRoot, config, txlineFixtures, polymarketEvents });
    results.push({ name, status: validation.config.status, evidenceValid: true, readyToSchedule: validation.readyToSchedule, reason: validation.reason, launch: validation.launch });
  } catch (error) {
    results.push({ name, evidenceValid: false, error: error instanceof Error ? error.message : String(error) });
  }
}
console.log(JSON.stringify(results, null, 2));
if (results.some((result) => !result.evidenceValid)) process.exitCode = 1;
