import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { realpath, stat, readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { ClaudeInvocationEvidenceLedger } from "../agents/claude-evidence-ledger.js";
import { ClaudeSpendLedger } from "../agents/claude-spend-ledger.js";
import { stableJson } from "../domain/json.js";
import { decimalLineToMilli } from "../domain/probability.js";
import {
  assertDistinctFilesystemPaths,
  assertFilesystemPathWithin,
  canonicalFilesystemPath
} from "../domain/filesystem-paths.js";
import { PAPER_STUDY_MINIMUM_SIGNAL_TO_KICKOFF_MS } from "../config/paper-study.js";
import { PolymarketClobFeeResolver } from "../ingest/polymarket/fees.js";
import { MappingRegistry } from "../mapping/registry.js";
import type { DecisionLedgerVerification } from "../store/decision-ledger.js";
import { createPersistentClaudePaperStudy } from "./claude-paper-study.js";
import {
  capturedPaperReplaySnapshotSource,
  capturedPaperReplaySource
} from "./paper-event-source.js";
import {
  CAPTURED_PAPER_EVENT_SNAPSHOT_HARD_LIMIT_BYTES,
  CAPTURED_PAPER_INGRESS_CAPACITY_HARD_LIMIT,
  admittedCapturedPaperSource,
  capturedPaperIngressCapacity,
  profileCapturedPaperIngress
} from "./captured-paper-admission.js";
import {
  pairedCaptureEvidenceSchema,
  type PaperFixtureEvidence,
  type PaperFixtureUniverse
} from "./paper-fixture-universe.js";
import {
  pairedCaptureEvidenceFromManifest,
  parseVerifiedPairedAnalysisManifest,
  type VerifiedPairedAnalysisManifest
} from "./paired-capture-manifest.js";
import type { PaperStudyLane } from "./paper-pipeline.js";
import { runPaperSession, type PaperSessionSummary } from "./paper-session.js";
import {
  PAPER_STUDY_PROTOCOL_STATUS,
  PAPER_STUDY_PROTOCOL_VERSION,
  initializePaperStudyLedger
} from "./paper-study-ledger.js";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export type CapturedPaperSessionOptions = {
  repoRoot: string;
  runLabel: string;
  captureConfigPath: string;
  txlineFixtureSnapshotPath: string;
  polymarketEventSnapshotPath: string;
  txlineOddsFramesPath: string;
  txlineScoresFramesPath: string;
  polymarketMessagesPath: string;
  polymarketSubscriptionsPath: string;
  polymarketTerminalManifestPath: string;
  txlineTerminalManifestPath: string;
  captureAnalysisManifestPath: string;
  mappingRegistryPath: string;
  causalTotalEvidencePath: string;
  fixtureUniversePath: string;
  studyLedgerManifestPath: string;
  spendLedgerPath: string;
  invocationEvidenceLedgerPath: string;
  envPath: string;
  fixtureId: string;
  lane: PaperStudyLane;
  speed: number;
  decisionLatencyMs: number;
  maximumPendingMs: number;
};

type StudyLedgerManifestLane = {
  path: string;
  startedAtTsMs: number;
  chain: {
    valid: true;
    rows: number;
    headHash: string;
  };
};

type StudyLedgerManifest = {
  protocolVersion: string;
  protocolStatus: string;
  configHash: string;
  realMoneyGate: "closed";
  bounty: StudyLedgerManifestLane;
  longRun: StudyLedgerManifestLane;
};

export type CapturedPaperSessionPreflight = {
  options: CapturedPaperSessionOptions;
  registry: MappingRegistry;
  universe: PaperFixtureUniverse;
  fixture: PaperFixtureEvidence;
  analysis: VerifiedPairedAnalysisManifest;
  manifest: StudyLedgerManifest;
  bountyLedgerPath: string;
  longRunLedgerPath: string;
  ingressQueueCapacity: number;
  canonicalInputPaths: readonly string[];
  replayEventJson: readonly string[];
};

export type CapturedPaperSessionResult = {
  ok: true;
  protocolVersion: string;
  protocolStatus: "registered";
  realMoneyGate: "closed";
  source: {
    fixtureId: string;
    lane: PaperStudyLane;
    replayMode: "capture-order-per-source";
    speed: number;
  };
  session: PaperSessionSummary;
  terminalCaseIds: string[];
  decisionChain: DecisionLedgerVerification;
  spend: {
    summary: ReturnType<ClaudeSpendLedger["summary"]>;
    chain: ReturnType<ClaudeSpendLedger["verifyChain"]>;
  };
  localInvocationChain: ReturnType<ClaudeInvocationEvidenceLedger["verifyChain"]> & {
    assurance: "local_hash_chain_verified_locally_not_provider_attestation";
  };
  receiptAgentRunAvailability: Array<{
    caseId: string;
    available: boolean;
    runs: number;
    reason: string | null;
  }>;
  decisionReceipt: {
    generated: false;
    status: "downstream_not_generated_by_session_runner";
  };
};

const ledgerChainSchema = z.object({
  valid: z.literal(true),
  rows: z.number().int().positive().safe(),
  headHash: z.string().regex(SHA256_PATTERN)
}).strict();

const ledgerLaneSchema = z.object({
  path: z.string().min(1),
  startedAtTsMs: z.number().int().nonnegative().safe(),
  chain: ledgerChainSchema
}).passthrough();

const studyLedgerManifestSchema = z.object({
  protocolVersion: z.string().min(1),
  protocolStatus: z.string().min(1),
  configHash: z.string().regex(SHA256_PATTERN),
  realMoneyGate: z.literal("closed"),
  bounty: ledgerLaneSchema,
  longRun: ledgerLaneSchema
}).passthrough();

const selectorSchema = z.object({
  minimumCoveragePoints: z.number().int().nonnegative().safe(),
  minimumVolume: z.number().finite().nonnegative(),
  minimumLiquidity: z.number().finite().nonnegative(),
  maximumDistanceFromEven: z.number().finite().min(0).max(0.5),
  weights: z.object({
    balance: z.number().finite().nonnegative(),
    volume: z.number().finite().nonnegative(),
    liquidity: z.number().finite().nonnegative(),
    coverage: z.number().finite().nonnegative()
  }).strict()
}).strict();

const fixtureSchema = z.object({
  fixtureId: z.string().min(1),
  home: z.string().min(1),
  away: z.string().min(1),
  kickoffTsMs: z.number().int().nonnegative().safe(),
  eventSlugs: z.array(z.string().min(1)).min(1),
  mappingStatus: z.enum(["candidate", "verified"]),
  selectedTotal: z.object({
    marketId: z.string().min(1),
    marketKey: z.string().min(1),
    conditionId: z.string().min(1),
    lineMilli: z.number().int().positive().safe(),
    preKickoffOverProbability: z.number().finite().min(0).max(1),
    preKickoffPointTsMs: z.number().int().nonnegative().safe(),
    coveragePoints: z.number().int().positive().safe(),
    assetIds: z.array(z.string().min(1)).min(2)
  }).strict(),
  evidenceGrade: z.enum(["paired_order_books", "sampled_price_history", "metadata_only"]),
  capabilities: z.object({
    signalResearchReplay: z.boolean(),
    executablePaperReplay: z.boolean(),
    kickoffCloseReplay: z.boolean(),
    publicResolutionReplay: z.boolean()
  }).strict(),
  bountyLane: z.object({
    mode: z.enum([
      "executable_book_replay",
      "book_lifecycle_replay",
      "signal_research_only",
      "unavailable"
    ]),
    exploratory: z.literal(true),
    reason: z.string().min(1)
  }).strict(),
  longRunLane: z.object({
    eligible: z.boolean(),
    reason: z.enum([
      "predates_long_run_lane_start",
      "mapping_not_verified",
      "executable_capture_required",
      "lifecycle_evidence_required"
    ]).nullable()
  }).strict(),
  pairedCapture: pairedCaptureEvidenceSchema.nullable()
}).strict();

const universeSchema = z.object({
  generatedAt: z.string().datetime(),
  laneStartTsMs: z.number().int().nonnegative().safe(),
  selectorConfig: selectorSchema,
  fixtures: z.array(fixtureSchema),
  summary: z.object({
    fixtures: z.number().int().nonnegative().safe(),
    pairedBookReplays: z.number().int().nonnegative().safe(),
    executableBookReplays: z.number().int().nonnegative().safe(),
    bookLifecycleReplays: z.number().int().nonnegative().safe(),
    signalResearchOnly: z.number().int().nonnegative().safe(),
    unavailable: z.number().int().nonnegative().safe(),
    longRunEligible: z.number().int().nonnegative().safe()
  }).strict()
}).strict();

const subscriptionSchema = z.object({
  assetId: z.string().min(1),
  outcome: z.string().transform((value) => value.toLocaleLowerCase()).pipe(z.enum(["over", "under"])),
  eventSlug: z.string().min(1),
  marketId: z.string().min(1),
  conditionId: z.string().min(1),
  sportsMarketType: z.literal("totals"),
  line: z.union([z.string().min(1), z.number().finite()])
}).passthrough();

const optionNames = new Set([
  "run-label",
  "capture-config",
  "txline-fixture-snapshot",
  "polymarket-event-snapshot",
  "txline-odds",
  "txline-scores",
  "polymarket-messages",
  "polymarket-subscriptions",
  "polymarket-terminal-manifest",
  "txline-terminal-manifest",
  "capture-analysis-manifest",
  "mapping-registry",
  "causal-total-evidence",
  "universe",
  "study-ledger-manifest",
  "spend-ledger",
  "invocation-evidence-ledger",
  "env",
  "fixture",
  "lane",
  "speed",
  "decision-latency-ms",
  "maximum-pending-ms"
]);

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`--${name} must be a positive safe integer`);
  }
  return parsed;
}

function replaySpeed(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
    throw new Error("--speed must be finite, positive, and at most 1 for causal real-Claude replay");
  }
  return parsed;
}

function argumentMap(argv: readonly string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const token = argv[index];
    if (!token?.startsWith("--")) throw new Error(`Unexpected positional argument: ${token ?? "<missing>"}`);
    const name = token.slice(2);
    if (!optionNames.has(name)) throw new Error(`Unknown captured paper-session option: --${name}`);
    if (values.has(name)) throw new Error(`Duplicate captured paper-session option: --${name}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--") || value.trim() === "") {
      throw new Error(`--${name} requires a value`);
    }
    values.set(name, value);
  }
  return values;
}

export function parseCapturedPaperSessionArgs(
  argv: readonly string[],
  cwd = process.cwd()
): CapturedPaperSessionOptions {
  // pnpm 11 preserves the conventional `--` script-argument separator.
  // Accept exactly one leading separator so documented `pnpm <script> -- ...`
  // commands and direct `tsx ...` invocation share the same strict parser.
  const normalizedArgv = argv[0] === "--" ? argv.slice(1) : argv;
  const values = argumentMap(normalizedArgv);
  const runLabel = values.get("run-label");
  if (!runLabel) throw new Error("--run-label is required; no capture is selected implicitly");
  if (!/^paired-[a-z0-9-]+$/.test(runLabel)) {
    throw new Error("--run-label must be a safe paired capture label");
  }
  const path = (name: string, fallback: string): string => resolve(cwd, values.get(name) ?? fallback);
  const lane = values.get("lane") ?? "bounty";
  if (lane !== "bounty" && lane !== "long_run") {
    throw new Error("--lane must be 'bounty' or 'long_run'");
  }
  const fixtureId = values.get("fixture");
  if (!fixtureId) throw new Error("--fixture is required; no fixture is selected implicitly");
  if (!/^[A-Za-z0-9._:-]+$/.test(fixtureId)) {
    throw new Error("--fixture must be a non-empty identifier without whitespace");
  }
  return {
    repoRoot: resolve(cwd),
    runLabel,
    captureConfigPath: path(
      "capture-config",
      `config/captures/${runLabel.slice("paired-".length)}.json`
    ),
    txlineFixtureSnapshotPath: path(
      "txline-fixture-snapshot",
      "samples/fixtures/mainnet-world-cup-fixtures.json"
    ),
    polymarketEventSnapshotPath: path(
      "polymarket-event-snapshot",
      "data/live/gamma-discovery/open-world-cup-events.json"
    ),
    txlineOddsFramesPath: path(
      "txline-odds",
      `samples/odds-sse/mainnet/${runLabel}/odds.frames.ndjson`
    ),
    txlineScoresFramesPath: path(
      "txline-scores",
      `samples/odds-sse/mainnet/${runLabel}/scores.frames.ndjson`
    ),
    polymarketMessagesPath: path(
      "polymarket-messages",
      `samples/polymarket-live/${runLabel}/messages.ndjson`
    ),
    polymarketSubscriptionsPath: path(
      "polymarket-subscriptions",
      `samples/polymarket-live/${runLabel}/subscriptions.json`
    ),
    polymarketTerminalManifestPath: path(
      "polymarket-terminal-manifest",
      `samples/polymarket-live/${runLabel}/capture-manifest.json`
    ),
    txlineTerminalManifestPath: path(
      "txline-terminal-manifest",
      `samples/odds-sse/mainnet/${runLabel}/txline-capture-manifest.json`
    ),
    captureAnalysisManifestPath: path(
      "capture-analysis-manifest",
      `data/live/${runLabel}/analysis-manifest.json`
    ),
    mappingRegistryPath: path(
      "mapping-registry",
      "data/research/mappings/world-cup-candidates.json"
    ),
    causalTotalEvidencePath: path(
      "causal-total-evidence",
      "data/research/main-total-line-evidence-causal-v2.json"
    ),
    fixtureUniversePath: path("universe", "data/research/paper-fixture-universe.json"),
    studyLedgerManifestPath: path("study-ledger-manifest", "data/paper/study-ledgers.json"),
    spendLedgerPath: path("spend-ledger", "data/agents/claude-spend.sqlite"),
    invocationEvidenceLedgerPath: path(
      "invocation-evidence-ledger",
      "data/agents/claude-invocation-evidence.sqlite"
    ),
    envPath: path("env", ".env"),
    fixtureId,
    lane,
    speed: replaySpeed(values.get("speed") ?? "1"),
    decisionLatencyMs: positiveInteger(
      values.get("decision-latency-ms") ?? "1",
      "decision-latency-ms"
    ),
    maximumPendingMs: positiveInteger(
      values.get("maximum-pending-ms") ?? String(5 * 60_000),
      "maximum-pending-ms"
    )
  };
}

export class CapturedPaperSessionAuthorizationError extends Error {
  readonly protocolStatus = PAPER_STUDY_PROTOCOL_STATUS;
  readonly apiRequestsPerformed = 0;
  readonly externalRequestsPerformed = 0;
  readonly actualSpendNanoUsd = 0;
  readonly envLoaded = false;
  readonly spendLedgerOpened = false;
  readonly fixtureAdmissions = 0;

  constructor() {
    super(
      `Captured Claude paper session is disabled: protocol status is ${PAPER_STUDY_PROTOCOL_STATUS}. ` +
      "Deborah must explicitly register the corrected paper protocol before fixture admission or model spend."
    );
    this.name = "CapturedPaperSessionAuthorizationError";
  }
}

export function assertCapturedPaperSessionAuthorized(): void {
  if (PAPER_STUDY_PROTOCOL_STATUS !== ("registered" as string)) {
    throw new CapturedPaperSessionAuthorizationError();
  }
}

async function nonemptyFile(path: string, label: string): Promise<void> {
  let metadata;
  try {
    metadata = await stat(path);
  } catch (error) {
    throw new Error(`${label} is unavailable at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!metadata.isFile() || metadata.size <= 0) {
    throw new Error(`${label} must be a non-empty file: ${path}`);
  }
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function capturedPaperInputPaths(options: CapturedPaperSessionOptions): string[] {
  return [
    options.captureConfigPath,
    options.txlineFixtureSnapshotPath,
    options.polymarketEventSnapshotPath,
    options.txlineOddsFramesPath,
    options.txlineScoresFramesPath,
    options.polymarketMessagesPath,
    options.polymarketSubscriptionsPath,
    options.polymarketTerminalManifestPath,
    options.txlineTerminalManifestPath,
    options.captureAnalysisManifestPath,
    options.mappingRegistryPath,
    options.causalTotalEvidencePath,
    options.fixtureUniversePath,
    options.studyLedgerManifestPath
  ];
}

async function assertCapturedInputHashes(
  analysis: NonNullable<ReturnType<typeof parseVerifiedPairedAnalysisManifest>>,
  options: CapturedPaperSessionOptions,
  scope: "all" | "non_replay" = "all"
): Promise<void> {
  const inputs = {
    captureConfig: options.captureConfigPath,
    txlineFixtureSnapshot: options.txlineFixtureSnapshotPath,
    polymarketEventSnapshot: options.polymarketEventSnapshotPath,
    polymarketTerminalManifest: options.polymarketTerminalManifestPath,
    txlineTerminalManifest: options.txlineTerminalManifestPath,
    subscriptions: options.polymarketSubscriptionsPath,
    polymarketMessages: options.polymarketMessagesPath,
    txlineOdds: options.txlineOddsFramesPath,
    txlineScores: options.txlineScoresFramesPath,
    mappings: options.mappingRegistryPath,
    causalTotalEvidence: options.causalTotalEvidencePath
  } as const;
  for (const name of Object.keys(inputs) as Array<keyof typeof inputs>) {
    if (
      scope === "non_replay" &&
      (name === "txlineOdds" || name === "txlineScores" || name === "polymarketMessages")
    ) continue;
    const path = inputs[name];
    const expected = analysis.proof.inputHashes[name];
    if (!expected || await sha256File(path) !== expected) {
      throw new Error(`Verified capture input changed after analysis: ${name}`);
    }
  }
}

function selectedFixtureIsExecutable(fixture: PaperFixtureEvidence, lane: PaperStudyLane): boolean {
  const executable = fixture.mappingStatus === "verified" &&
    fixture.pairedCapture !== null &&
    fixture.pairedCapture.mappingConfirmed &&
    fixture.pairedCapture.selectedBookDepthComplete &&
    fixture.pairedCapture.exactFixtureTxlineOddsAvailable &&
    fixture.pairedCapture.exactFixtureTxlineScoresAvailable &&
    fixture.pairedCapture.exactFixtureScoreCompleted &&
    fixture.capabilities.executablePaperReplay &&
    fixture.capabilities.kickoffCloseReplay &&
    fixture.capabilities.publicResolutionReplay &&
    fixture.bountyLane.mode === "executable_book_replay";
  return lane === "bounty" ? executable : executable && fixture.longRunLane.eligible;
}

function assertUniverseSummary(universe: PaperFixtureUniverse): void {
  const expected = {
    fixtures: universe.fixtures.length,
    pairedBookReplays: universe.fixtures.filter((fixture) => fixture.evidenceGrade === "paired_order_books").length,
    executableBookReplays: universe.fixtures.filter((fixture) => fixture.bountyLane.mode === "executable_book_replay").length,
    bookLifecycleReplays: universe.fixtures.filter((fixture) => fixture.bountyLane.mode === "book_lifecycle_replay").length,
    signalResearchOnly: universe.fixtures.filter((fixture) => fixture.bountyLane.mode === "signal_research_only").length,
    unavailable: universe.fixtures.filter((fixture) => fixture.bountyLane.mode === "unavailable").length,
    longRunEligible: universe.fixtures.filter((fixture) => fixture.longRunLane.eligible).length
  };
  if (stableJson(expected) !== stableJson(universe.summary)) {
    throw new Error("Paper fixture-universe summary does not match its fixture rows");
  }
}

function assertSelectedMapping(
  registry: MappingRegistry,
  fixture: PaperFixtureEvidence
): void {
  const candidates = registry.records().filter((record) =>
    record.txlineFixtureId === fixture.fixtureId &&
    record.status === "verified" &&
    fixture.eventSlugs.includes(record.polymarketEventSlug)
  );
  const matches = candidates.flatMap((record) => record.conditions.map((condition) => ({ record, condition })))
    .filter(({ condition }) =>
      condition.polymarketMarketId === fixture.selectedTotal.marketId &&
      condition.conditionId === fixture.selectedTotal.conditionId &&
      condition.family === "total_goals" &&
      condition.period === "full_time" &&
      condition.lineMilli === fixture.selectedTotal.lineMilli
    );
  if (matches.length !== 1) {
    throw new Error(`Fixture ${fixture.fixtureId} requires exactly one reviewed selected-total mapping`);
  }
  const mappedAssets = matches[0]!.condition.tokens.map((token) => token.assetId).sort();
  const selectedAssets = [...fixture.selectedTotal.assetIds].sort();
  if (stableJson(mappedAssets) !== stableJson(selectedAssets)) {
    throw new Error(`Fixture ${fixture.fixtureId} selected assets do not match its reviewed mapping`);
  }
  for (const assetId of selectedAssets) {
    const mapped = registry.resolveAsset(assetId);
    if (
      !mapped.tradeable ||
      mapped.fixtureId !== fixture.fixtureId ||
      mapped.market.key !== fixture.selectedTotal.marketKey ||
      mapped.conditionId !== fixture.selectedTotal.conditionId ||
      mapped.polymarketMarketId !== fixture.selectedTotal.marketId
    ) {
      throw new Error(`Selected asset ${assetId} is not bound to the reviewed executable fixture`);
    }
  }
}

function assertSelectedSubscriptions(value: unknown, fixture: PaperFixtureEvidence): void {
  const subscriptions = z.array(subscriptionSchema).min(1).parse(value);
  if (new Set(subscriptions.map((subscription) => subscription.assetId)).size !== subscriptions.length) {
    throw new Error("Capture subscriptions contain duplicate asset identities");
  }
  const byAsset = new Map(subscriptions.map((subscription) => [subscription.assetId, subscription]));
  const selectedEventSlug = fixture.pairedCapture?.selectedTotal.eventSlug;
  if (!selectedEventSlug) throw new Error(`Fixture ${fixture.fixtureId} lacks selected capture evidence`);
  for (const assetId of fixture.selectedTotal.assetIds) {
    const subscription = byAsset.get(assetId);
    if (
      !subscription ||
      subscription.conditionId !== fixture.selectedTotal.conditionId ||
      subscription.marketId !== fixture.selectedTotal.marketId ||
      subscription.eventSlug !== selectedEventSlug ||
      decimalLineToMilli(String(subscription.line)) !== fixture.selectedTotal.lineMilli
    ) {
      throw new Error(`Selected asset ${assetId} is absent from the reviewed capture subscriptions`);
    }
  }
}

function allDistinct(paths: string[], label: string): void {
  if (new Set(paths).size !== paths.length) throw new Error(`${label} paths must be distinct`);
}

/**
 * Read-only local preflight. It validates every capture and admission artifact
 * before .env, API credentials, or any SQLite ledger is opened.
 */
export async function preflightCapturedPaperSession(
  options: CapturedPaperSessionOptions
): Promise<CapturedPaperSessionPreflight> {
  const expectedCaptureNames = [
    [options.txlineOddsFramesPath, "odds.frames.ndjson"],
    [options.txlineScoresFramesPath, "scores.frames.ndjson"],
    [options.polymarketMessagesPath, "messages.ndjson"],
    [options.polymarketSubscriptionsPath, "subscriptions.json"],
    [options.polymarketTerminalManifestPath, "capture-manifest.json"],
    [options.txlineTerminalManifestPath, "txline-capture-manifest.json"]
  ] as const;
  for (const [path, expectedName] of expectedCaptureNames) {
    if (basename(path) !== expectedName) {
      throw new Error(`Captured replay path must end in ${expectedName}: ${path}`);
    }
  }
  const inputPaths = capturedPaperInputPaths(options);
  allDistinct(inputPaths, "Captured paper-session input");
  allDistinct([
    options.spendLedgerPath,
    options.invocationEvidenceLedgerPath
  ], "Claude evidence");

  await nonemptyFile(options.captureConfigPath, "Capture config");
  await nonemptyFile(options.txlineFixtureSnapshotPath, "TXLine fixture evidence snapshot");
  await nonemptyFile(options.polymarketEventSnapshotPath, "Polymarket event evidence snapshot");
  await nonemptyFile(options.txlineOddsFramesPath, "TXLine odds frames");
  await nonemptyFile(options.txlineScoresFramesPath, "TXLine scores frames");
  await nonemptyFile(options.polymarketMessagesPath, "Polymarket messages");
  await nonemptyFile(options.polymarketSubscriptionsPath, "Polymarket subscriptions");
  await nonemptyFile(options.polymarketTerminalManifestPath, "Polymarket terminal manifest");
  await nonemptyFile(options.txlineTerminalManifestPath, "TXLine terminal manifest");
  await nonemptyFile(options.captureAnalysisManifestPath, "Capture analysis manifest");
  await nonemptyFile(options.mappingRegistryPath, "Mapping registry");
  await nonemptyFile(options.causalTotalEvidencePath, "Causal total evidence");
  await nonemptyFile(options.fixtureUniversePath, "Paper fixture universe");
  await nonemptyFile(options.studyLedgerManifestPath, "Study-ledger manifest");
  // Only the sealed raw capture directories may canonically live outside the
  // repository (the scheduler intentionally exposes them through run-scoped
  // symlinks). Every config, derived proof, and admission input stays inside.
  await Promise.all([
    options.captureConfigPath,
    options.txlineFixtureSnapshotPath,
    options.polymarketEventSnapshotPath,
    options.captureAnalysisManifestPath,
    options.mappingRegistryPath,
    options.causalTotalEvidencePath,
    options.fixtureUniversePath,
    options.studyLedgerManifestPath
  ].map((path) => assertFilesystemPathWithin(
    path,
    options.repoRoot,
    "Captured paper-session derived input"
  )));
  const canonicalInputs = await assertDistinctFilesystemPaths(
    inputPaths,
    "Canonical captured paper-session input"
  );

  const [captureConfigRaw, mappingRaw, universeRaw, ledgerManifestRaw, analysisRaw, subscriptionsRaw] = await Promise.all([
    readFile(options.captureConfigPath, "utf8"),
    readFile(options.mappingRegistryPath, "utf8"),
    readFile(options.fixtureUniversePath, "utf8"),
    readFile(options.studyLedgerManifestPath, "utf8"),
    readFile(options.captureAnalysisManifestPath, "utf8"),
    readFile(options.polymarketSubscriptionsPath, "utf8")
  ]);
  const captureEvidence = z.object({
    evidence: z.object({
      txlineFixtures: z.string().min(1),
      polymarketEvents: z.string().min(1)
    }).passthrough()
  }).passthrough().parse(JSON.parse(captureConfigRaw) as unknown).evidence;
  if (
    resolve(options.repoRoot, captureEvidence.txlineFixtures) !== options.txlineFixtureSnapshotPath ||
    resolve(options.repoRoot, captureEvidence.polymarketEvents) !== options.polymarketEventSnapshotPath
  ) {
    throw new Error("Explicit evidence snapshots do not match the capture config references");
  }
  const mappingDocument = z.object({ records: z.array(z.unknown()).min(1) }).passthrough()
    .parse(JSON.parse(mappingRaw) as unknown);
  const registry = new MappingRegistry(mappingDocument.records);
  const universe = universeSchema.parse(JSON.parse(universeRaw) as unknown) as PaperFixtureUniverse;
  assertUniverseSummary(universe);
  const manifest = studyLedgerManifestSchema.parse(
    JSON.parse(ledgerManifestRaw) as unknown
  ) as StudyLedgerManifest;
  if (
    manifest.protocolVersion !== PAPER_STUDY_PROTOCOL_VERSION ||
    manifest.protocolStatus !== (PAPER_STUDY_PROTOCOL_STATUS as string) ||
    manifest.protocolStatus !== "registered"
  ) {
    throw new Error("Study-ledger manifest is not registered for the current paper protocol");
  }
  if (universe.laneStartTsMs !== manifest.longRun.startedAtTsMs) {
    throw new Error("Paper fixture universe does not match the long-run ledger start");
  }
  const matchingFixtures = universe.fixtures.filter((fixture) => fixture.fixtureId === options.fixtureId);
  if (matchingFixtures.length !== 1) {
    throw new Error(`Fixture universe requires exactly one fixture ${options.fixtureId}`);
  }
  const fixture = matchingFixtures[0]!;
  if (!selectedFixtureIsExecutable(fixture, options.lane)) {
    throw new Error(`Fixture ${options.fixtureId} is not executable in the ${options.lane} paper lane`);
  }
  if (options.lane === "long_run" && fixture.kickoffTsMs < manifest.longRun.startedAtTsMs) {
    throw new Error(`Fixture ${options.fixtureId} predates the long-run lane start`);
  }
  assertSelectedMapping(registry, fixture);
  assertSelectedSubscriptions(JSON.parse(subscriptionsRaw) as unknown, fixture);

  const analysis = parseVerifiedPairedAnalysisManifest(JSON.parse(analysisRaw) as unknown);
  if (analysis === null) throw new Error("Capture analysis manifest is not verified");
  if (
    analysis.runId !== options.runLabel ||
    analysis.fixtureId !== options.fixtureId ||
    analysis.admission.status !== "eligible" ||
    !analysis.capture.mappingConfirmed
  ) {
    throw new Error("Capture analysis is not eligible for the explicitly selected run and fixture");
  }
  const analysisKickoffTsMs = Date.parse(analysis.capture.kickoffUtc);
  if (
    analysisKickoffTsMs !== fixture.kickoffTsMs ||
    Date.parse(analysis.capture.signalCutoffUtc) !==
      fixture.kickoffTsMs - PAPER_STUDY_MINIMUM_SIGNAL_TO_KICKOFF_MS
  ) {
    throw new Error("Capture analysis kickoff or signal cutoff does not match the admitted fixture universe");
  }
  await assertCapturedInputHashes(analysis, options, "non_replay");
  const committedIngress = analysis.selectedMarketEvidence.canonicalIngress;
  const committedIngressProfile = {
    eventCount: committedIngress.eventCount,
    firstObservedTsMs: Date.parse(committedIngress.firstObservedAt),
    lastObservedTsMs: Date.parse(committedIngress.lastObservedAt),
    modelStallBudgetMs: committedIngress.modelStallBudgetMs,
    maximumEventsInModelStallWindow: committedIngress.maximumEventsInModelStallWindow,
    counts: committedIngress.counts
  };
  const admissionIdentity = {
    fixtureId: analysis.fixtureId,
    marketId: analysis.selectedTotal.marketId,
    conditionId: analysis.selectedTotal.conditionId,
    lineMilli: analysis.selectedTotal.lineMilli,
    assetIds: analysis.selectedTotal.assetIds
  };
  const replayInputHashes: Partial<Record<
    "txlineOdds" | "txlineScores" | "polymarketMessages",
    string
  >> = {};
  const replayEventJson: string[] = [];
  let replaySnapshotBytes = 0;
  for await (const event of admittedCapturedPaperSource(capturedPaperReplaySource({
    txlineOddsFramesPath: options.txlineOddsFramesPath,
    txlineScoresFramesPath: options.txlineScoresFramesPath,
    polymarketMessagesPath: options.polymarketMessagesPath,
    registry,
    speed: Number.POSITIVE_INFINITY,
    onInputHash: (name, hash) => {
      if (replayInputHashes[name] !== undefined) {
        throw new Error(`Captured replay input reported more than one hash: ${name}`);
      }
      replayInputHashes[name] = hash;
    }
  }), admissionIdentity)) {
    if (replayEventJson.length >= CAPTURED_PAPER_INGRESS_CAPACITY_HARD_LIMIT) {
      throw new Error("Captured replay exceeds the immutable event-snapshot count limit");
    }
    const eventJson = stableJson(event);
    replaySnapshotBytes += Buffer.byteLength(eventJson, "utf8");
    if (replaySnapshotBytes > CAPTURED_PAPER_EVENT_SNAPSHOT_HARD_LIMIT_BYTES) {
      throw new Error("Captured replay exceeds the immutable event-snapshot byte limit");
    }
    replayEventJson.push(eventJson);
  }
  for (const name of ["txlineOdds", "txlineScores", "polymarketMessages"] as const) {
    if (replayInputHashes[name] !== analysis.proof.inputHashes[name]) {
      throw new Error(`Verified capture input changed while snapshotting exact replay bytes: ${name}`);
    }
  }
  const currentIngressProfile = await profileCapturedPaperIngress(
    capturedPaperReplaySnapshotSource({
      eventJson: replayEventJson,
      speed: Number.POSITIVE_INFINITY
    }),
    admissionIdentity
  );
  if (stableJson(currentIngressProfile) !== stableJson(committedIngressProfile)) {
    throw new Error("Current canonical ingress profile does not match the verified capture analysis");
  }
  // Non-replay evidence is parsed into memory above; verify it remained stable
  // while the exact replay-byte snapshot was constructed.
  await assertCapturedInputHashes(analysis, options, "non_replay");
  const ingressQueueCapacity = capturedPaperIngressCapacity(currentIngressProfile);
  if (ingressQueueCapacity !== committedIngress.requiredIngressCapacity) {
    throw new Error("Capture analysis ingress capacity commitment is inconsistent");
  }
  const analysisEvidence = pairedCaptureEvidenceFromManifest(analysis);
  if (fixture.pairedCapture === null || stableJson(analysisEvidence) !== stableJson(fixture.pairedCapture)) {
    throw new Error("Fixture universe paired-capture evidence does not match its verified analysis manifest");
  }
  const [
    analysisTxlineDir,
    oddsDir,
    scoresDir,
    txlineTerminalDir,
    analysisPolymarketDir,
    messagesDir,
    subscriptionsDir,
    polymarketTerminalDir
  ] =
    await Promise.all([
      realpath(resolve(options.repoRoot, analysis.capture.txlineDir)),
      realpath(dirname(options.txlineOddsFramesPath)),
      realpath(dirname(options.txlineScoresFramesPath)),
      realpath(dirname(options.txlineTerminalManifestPath)),
      realpath(resolve(options.repoRoot, analysis.capture.polymarketDir)),
      realpath(dirname(options.polymarketMessagesPath)),
      realpath(dirname(options.polymarketSubscriptionsPath)),
      realpath(dirname(options.polymarketTerminalManifestPath))
    ]);
  if (
    analysisTxlineDir !== oddsDir ||
    analysisTxlineDir !== scoresDir ||
    analysisTxlineDir !== txlineTerminalDir ||
    analysisPolymarketDir !== messagesDir ||
    analysisPolymarketDir !== subscriptionsDir ||
    analysisPolymarketDir !== polymarketTerminalDir
  ) {
    throw new Error("Explicit replay paths do not match the verified capture analysis directories");
  }

  const bountyLedgerPath = resolve(options.repoRoot, manifest.bounty.path);
  const longRunLedgerPath = resolve(options.repoRoot, manifest.longRun.path);
  allDistinct([
    bountyLedgerPath,
    longRunLedgerPath,
    options.spendLedgerPath,
    options.invocationEvidenceLedgerPath
  ], "Persistent ledger");
  await nonemptyFile(bountyLedgerPath, "Bounty decision ledger");
  await nonemptyFile(longRunLedgerPath, "Long-run decision ledger");
  const canonicalPersistentPaths = await assertDistinctFilesystemPaths([
    bountyLedgerPath,
    longRunLedgerPath,
    options.spendLedgerPath,
    options.invocationEvidenceLedgerPath
  ], "Canonical persistent ledger");
  const canonicalEnvPath = await canonicalFilesystemPath(options.envPath);
  await assertDistinctFilesystemPaths(
    [...canonicalInputs, ...canonicalPersistentPaths, canonicalEnvPath],
    "Canonical captured input, environment, and persistent ledger"
  );
  return {
    options,
    registry,
    universe,
    fixture,
    analysis,
    manifest,
    bountyLedgerPath,
    longRunLedgerPath,
    ingressQueueCapacity,
    canonicalInputPaths: Object.freeze([...canonicalInputs]),
    replayEventJson: Object.freeze([...replayEventJson])
  };
}

function assertManifestChainPrefix(
  ledgerEntries: ReturnType<ReturnType<typeof initializePaperStudyLedger>["ledger"]["entries"]>,
  actual: DecisionLedgerVerification,
  expected: StudyLedgerManifestLane["chain"],
  lane: PaperStudyLane
): void {
  if (actual.rows < expected.rows) {
    throw new Error(`${lane} decision ledger is shorter than its manifest commitment`);
  }
  if (ledgerEntries[expected.rows - 1]?.entryHash !== expected.headHash) {
    throw new Error(`${lane} decision ledger does not contain its manifest commitment`);
  }
}

async function loadOptionalEnv(path: string): Promise<void> {
  try {
    await stat(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return;
    throw error;
  }
  loadEnvFile(path);
}

async function executeCapturedPaperSession(
  preflight: CapturedPaperSessionPreflight
): Promise<CapturedPaperSessionResult> {
  // Authorization is repeated at the mutation/network boundary in case this
  // function is called directly instead of through the CLI wrapper.
  assertCapturedPaperSessionAuthorized();
  // Capture symlinks may intentionally target the sealed external runtime,
  // so pin their canonical identities rather than assuming repo containment.
  // The replay itself uses only the exact hash-verified in-memory snapshot.
  const currentCanonicalInputPaths = await assertDistinctFilesystemPaths(
    capturedPaperInputPaths(preflight.options),
    "Canonical captured paper-session input"
  );
  if (stableJson(currentCanonicalInputPaths) !== stableJson(preflight.canonicalInputPaths)) {
    throw new Error("Captured paper-session input path identity changed after preflight");
  }
  await assertCapturedInputHashes(preflight.analysis, preflight.options, "non_replay");
  await loadOptionalEnv(preflight.options.envPath);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");

  let bounty: ReturnType<typeof initializePaperStudyLedger> | null = null;
  let longRun: ReturnType<typeof initializePaperStudyLedger> | null = null;
  let spendLedger: ClaudeSpendLedger | null = null;
  let evidenceLedger: ClaudeInvocationEvidenceLedger | null = null;
  const terminalCaseIds: string[] = [];
  try {
    bounty = initializePaperStudyLedger({
      path: preflight.bountyLedgerPath,
      lane: "bounty",
      startedAtTsMs: preflight.manifest.bounty.startedAtTsMs
    });
    longRun = initializePaperStudyLedger({
      path: preflight.longRunLedgerPath,
      lane: "long_run",
      startedAtTsMs: preflight.manifest.longRun.startedAtTsMs
    });
    if (
      bounty.initialization.configHash !== preflight.manifest.configHash ||
      longRun.initialization.configHash !== preflight.manifest.configHash
    ) {
      throw new Error("Persistent paper ledgers do not match the manifest config commitment");
    }
    if (
      bounty.initialization.startedAtTsMs !== preflight.manifest.bounty.startedAtTsMs ||
      longRun.initialization.startedAtTsMs !== preflight.manifest.longRun.startedAtTsMs
    ) {
      throw new Error("Persistent paper ledgers do not match the manifest start commitments");
    }
    const bountyChainBefore = bounty.ledger.verifyChain();
    const longRunChainBefore = longRun.ledger.verifyChain();
    assertManifestChainPrefix(
      bounty.ledger.entries(),
      bountyChainBefore,
      preflight.manifest.bounty.chain,
      "bounty"
    );
    assertManifestChainPrefix(
      longRun.ledger.entries(),
      longRunChainBefore,
      preflight.manifest.longRun.chain,
      "long_run"
    );

    spendLedger = new ClaudeSpendLedger(preflight.options.spendLedgerPath);
    evidenceLedger = new ClaudeInvocationEvidenceLedger(
      preflight.options.invocationEvidenceLedgerPath
    );
    spendLedger.verifyChain();
    evidenceLedger.verifyChain();
    const officialFeeResolver = new PolymarketClobFeeResolver();
    const study = createPersistentClaudePaperStudy({
      apiKey,
      spendLedger,
      bounty,
      longRun,
      universe: preflight.universe,
      feeResolver: (book, _asOfTsMs, haltSignal) =>
        officialFeeResolver.resolve(book, haltSignal),
      evidenceLedger,
      minimumDecisionLatencyMs: preflight.options.decisionLatencyMs,
      maximumPendingMs: preflight.options.maximumPendingMs
    });
    const invocationEvidence = study.invocationEvidence;
    if (invocationEvidence === null) {
      throw new Error("Captured Claude paper session lacks durable invocation evidence");
    }
    const runtime = preflight.options.lane === "bounty" ? study.bounty : study.longRun;
    if (!runtime.fixtures.some((fixture) => fixture.fixtureId === preflight.options.fixtureId)) {
      throw new Error(`Selected runtime did not admit fixture ${preflight.options.fixtureId}`);
    }

    const session = await runPaperSession({
      source: (signal) => admittedCapturedPaperSource(capturedPaperReplaySnapshotSource({
        eventJson: preflight.replayEventJson,
        speed: preflight.options.speed,
        signal
      }), {
        fixtureId: preflight.fixture.fixtureId,
        marketId: preflight.fixture.selectedTotal.marketId,
        conditionId: preflight.fixture.selectedTotal.conditionId,
        lineMilli: preflight.fixture.selectedTotal.lineMilli,
        assetIds: preflight.fixture.selectedTotal.assetIds
      }),
      runtime,
      ingressQueueCapacity: preflight.ingressQueueCapacity,
      onTerminal: ({ terminal }) => { terminalCaseIds.push(terminal.caseId); }
    });
    const decisionChain = runtime.scheduler.dependencies.pipeline.dependencies.ledger.verifyChain();
    const spend = {
      summary: spendLedger.summary(),
      chain: spendLedger.verifyChain()
    };
    const invocationChain = evidenceLedger.verifyChain();
    const receiptAgentRunAvailability = terminalCaseIds.map((caseId) => {
      try {
        const runs = invocationEvidence.receiptAgentRuns(caseId);
        return { caseId, available: runs.length > 0, runs: runs.length, reason: null };
      } catch (error) {
        return {
          caseId,
          available: false,
          runs: 0,
          reason: error instanceof Error ? error.message : String(error)
        };
      }
    });
    return {
      ok: true,
      protocolVersion: PAPER_STUDY_PROTOCOL_VERSION,
      protocolStatus: "registered",
      realMoneyGate: "closed",
      source: {
        fixtureId: preflight.options.fixtureId,
        lane: preflight.options.lane,
        replayMode: "capture-order-per-source",
        speed: preflight.options.speed
      },
      session,
      terminalCaseIds,
      decisionChain,
      spend,
      localInvocationChain: {
        ...invocationChain,
        assurance: "local_hash_chain_verified_locally_not_provider_attestation"
      },
      receiptAgentRunAvailability,
      decisionReceipt: {
        generated: false,
        status: "downstream_not_generated_by_session_runner"
      }
    };
  } finally {
    try {
      evidenceLedger?.verifyChain();
      spendLedger?.verifyChain();
    } finally {
      evidenceLedger?.close();
      spendLedger?.close();
      bounty?.ledger.close();
      longRun?.ledger.close();
    }
  }
}

export async function runCapturedPaperSessionCli(
  argv: readonly string[],
  execute: typeof executeCapturedPaperSession = executeCapturedPaperSession
): Promise<CapturedPaperSessionResult> {
  assertCapturedPaperSessionAuthorized();
  const options = parseCapturedPaperSessionArgs(argv);
  const preflight = await preflightCapturedPaperSession(options);
  return execute(preflight);
}

async function main(): Promise<void> {
  try {
    const result = await runCapturedPaperSessionCli(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    if (error instanceof CapturedPaperSessionAuthorizationError) {
      process.stderr.write(`${JSON.stringify({
        ok: false,
        authorization: "denied",
        protocolStatus: error.protocolStatus,
        realMoneyGate: "closed",
        apiRequestsPerformed: error.apiRequestsPerformed,
        externalRequestsPerformed: error.externalRequestsPerformed,
        actualSpendNanoUsd: error.actualSpendNanoUsd,
        envLoaded: error.envLoaded,
        spendLedgerOpened: error.spendLedgerOpened,
        fixtureAdmissions: error.fixtureAdmissions,
        error: error.message
      }, null, 2)}\n`);
    } else {
      process.stderr.write(`${JSON.stringify({
        ok: false,
        realMoneyGate: "closed",
        error: error instanceof Error ? error.message : String(error)
      }, null, 2)}\n`);
    }
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
