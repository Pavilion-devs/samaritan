#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { verifyPublicEdgeBundle } from "./edge-bundle.js";

const canonicalRepoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

async function main(): Promise<void> {
  try {
    const result = await verifyPublicEdgeBundle(canonicalRepoRoot);
    process.stdout.write(
      `Verified ${result.manifest.routes.length} frozen edge routes ` +
      `(bundle ${result.manifest.edgeBundleSha256})\n`
    );
  } catch (error) {
    process.stderr.write(`Public edge verification failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
