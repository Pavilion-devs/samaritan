#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import {
  auditPublicArtifacts,
  DEFAULT_PUBLIC_ARTIFACT_MAX_FILE_BYTES,
  DEFAULT_PUBLIC_ARTIFACT_MAX_TOTAL_BYTES,
  type PublicArtifactAuditMode,
  type PublicArtifactAuditReport
} from "./artifact-safety.js";

type CliOptions = {
  mode: PublicArtifactAuditMode;
  allowlistedPaths: string[];
  maxFileBytes: number;
  maxTotalBytes: number;
  json: boolean;
  help: boolean;
};

const USAGE = `Usage:
  pnpm exec tsx src/public/audit-public-artifacts.ts --bundle <frozen-public-bundle> [--bundle <path> ...]
  pnpm exec tsx src/public/audit-public-artifacts.ts --source-audit --path <public-repo-path> [--path <path> ...]

Options:
  --bundle <path>          Explicit allowlisted frozen public bundle path (repeatable)
  --source-audit           Audit explicitly named repository source paths; never implies cwd
  --path <path>            Explicit allowlisted path for --source-audit (repeatable)
  --max-file-bytes <n>     Per-file ceiling (default ${DEFAULT_PUBLIC_ARTIFACT_MAX_FILE_BYTES})
  --max-total-bytes <n>    Total allowlisted byte ceiling (default ${DEFAULT_PUBLIC_ARTIFACT_MAX_TOTAL_BYTES})
  --json                   Emit the complete machine-readable report
  --help                   Show this usage text

The command has no implicit scan root. Bundle mode fails closed when no existing
--bundle path is supplied. Source mode must be explicitly selected and still
requires one or more --path allowlist entries.
`;

function parsePositiveInteger(raw: string | undefined, flag: string): number {
  if (!raw || !/^[1-9][0-9]*$/u.test(raw)) throw new Error(`${flag} requires a positive integer`);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${flag} exceeds the safe integer range`);
  return parsed;
}

export function parsePublicArtifactAuditArgs(args: readonly string[]): CliOptions {
  const bundles: string[] = [];
  const sourcePaths: string[] = [];
  let sourceAudit = false;
  let json = false;
  let help = false;
  let maxFileBytes = DEFAULT_PUBLIC_ARTIFACT_MAX_FILE_BYTES;
  let maxTotalBytes = DEFAULT_PUBLIC_ARTIFACT_MAX_TOTAL_BYTES;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--bundle") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--bundle requires a path");
      bundles.push(value);
      index += 1;
      continue;
    }
    if (argument === "--path") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--path requires a path");
      sourcePaths.push(value);
      index += 1;
      continue;
    }
    if (argument === "--source-audit") {
      sourceAudit = true;
      continue;
    }
    if (argument === "--max-file-bytes") {
      maxFileBytes = parsePositiveInteger(args[index + 1], argument);
      index += 1;
      continue;
    }
    if (argument === "--max-total-bytes") {
      maxTotalBytes = parsePositiveInteger(args[index + 1], argument);
      index += 1;
      continue;
    }
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      help = true;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  if (sourceAudit && bundles.length > 0) {
    throw new Error("--bundle cannot be combined with --source-audit; use explicit --path entries");
  }
  if (!sourceAudit && sourcePaths.length > 0) {
    throw new Error("--path is only valid with explicit --source-audit");
  }

  return {
    mode: sourceAudit ? "source" : "bundle",
    allowlistedPaths: sourceAudit ? sourcePaths : bundles,
    maxFileBytes,
    maxTotalBytes,
    json,
    help
  };
}

function humanReport(report: PublicArtifactAuditReport): string {
  const status = report.ok ? "PASS" : "FAIL";
  const lines = [
    `Public artifact safety audit: ${status}`,
    `mode=${report.mode} roots=${report.existingAllowlistedRoots}/${report.allowlistedPaths.length} files=${report.filesScanned} bytes=${report.bytesScanned}`,
    `limits: file=${report.limits.maxFileBytes} bytes total=${report.limits.maxTotalBytes} bytes`
  ];
  for (const violation of report.violations) {
    const location = violation.jsonPath ? `${violation.path}${violation.jsonPath}` : violation.path;
    lines.push(`[${violation.code}] ${location}: ${violation.message}`);
  }
  return `${lines.join("\n")}\n`;
}

export async function runPublicArtifactAuditCli(args: readonly string[]): Promise<number> {
  const options = parsePublicArtifactAuditArgs(args);
  if (options.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  const report = await auditPublicArtifacts({
    allowlistedPaths: options.allowlistedPaths,
    mode: options.mode,
    maxFileBytes: options.maxFileBytes,
    maxTotalBytes: options.maxTotalBytes
  });
  process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : humanReport(report));
  return report.ok ? 0 : 1;
}

async function main(): Promise<void> {
  try {
    process.exitCode = await runPublicArtifactAuditCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`Public artifact audit refused to run: ${error instanceof Error ? error.message : String(error)}\n`);
    process.stderr.write(USAGE);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
