import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import {
  decisionReceiptSchema,
  verifyDecisionReceipt
} from "../proof/decision-receipt-schema.js";
import {
  CASEBOOK_API_PATH,
  COMMAND_API_PATH,
  PUBLIC_DASHBOARD_BUNDLE_RELATIVE_DIR,
  PUBLIC_SYNTHETIC_RECEIPT_FILENAME,
  SPAIN_BELGIUM_API_PATH,
  STUDY_API_PATH,
  readFrozenDashboardResponse,
  sha256 as dashboardSha256
} from "./public-bundle.js";
import { TXLINE_PULSE_API_PATH } from "./txline-pulse.js";

export const JUDGE_EVIDENCE_API_PATH = "/api/judge/evidence" as const;

const publicRouteSchema = z.object({
  label: z.string().min(1),
  route: z.string().min(1)
}).strict();

const criterionSchema = z.object({
  id: z.enum([
    "core_functionality_and_data_ingestion",
    "autonomous_operation",
    "deterministic_logic_and_architecture",
    "innovation_and_novelty",
    "production_readiness"
  ]),
  criterion: z.string().min(1),
  evidence: z.array(publicRouteSchema).min(1)
}).strict();

const txlineEndpointSchema = z.object({
  method: z.enum(["GET", "POST"]),
  path: z.string().regex(/^\/(?:auth|api)\//),
  purpose: z.string().min(1)
}).strict();

export const judgeEvidenceResponseSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string().datetime(),
  app: z.object({
    name: z.literal("Samaritan"),
    service: z.literal("samaritan-dashboard"),
    buildCommit: z.string().regex(/^[a-f0-9]{7,64}$/).nullable()
  }).strict(),
  access: z.object({
    authenticationRequired: z.literal(false),
    readOnly: z.literal(true),
    source: z.literal("verified_frozen_public_bundle"),
    disclosure: z.literal("derived_metadata_only")
  }).strict(),
  trackCriteria: z.array(criterionSchema).length(5),
  txlineIntegration: z.object({
    endpointsUsed: z.array(txlineEndpointSchema).length(10),
    publicOutput: z.literal("derived_evidence_only")
  }).strict(),
  evidenceClassCounts: z.object({
    capturedReplayFixtures: z.number().int().nonnegative(),
    capturedReplayObservations: z.number().int().nonnegative(),
    capturedNoTradeObservations: z.number().int().nonnegative(),
    historicalTrainingObservations: z.number().int().nonnegative(),
    historicalHeldoutObservations: z.number().int().nonnegative(),
    historicalHeldoutFixtures: z.number().int().nonnegative(),
    syntheticLifecycleReceipts: z.number().int().nonnegative(),
    verifiedCapturedAgentLifecycleReceipts: z.number().int().nonnegative(),
    registeredForwardPaperSignals: z.number().int().nonnegative()
  }).strict(),
  gates: z.object({
    executionMode: z.literal("paper"),
    paperProtocol: z.object({
      id: z.string().min(1),
      status: z.string().min(1),
      active: z.boolean(),
      observationStatus: z.string().min(1),
      evidencePolicy: z.string().min(1),
      qualifyingCounts: z.object({
        matches: z.number().int().nonnegative(),
        signals: z.number().int().nonnegative(),
        filledMatches: z.number().int().nonnegative(),
        fills: z.number().int().nonnegative(),
        settledFills: z.number().int().nonnegative()
      }).strict(),
      riskLimits: z.object({
        bankrollMicroUsd: z.number().int().positive(),
        perTradeStakeMicroUsd: z.number().int().positive(),
        aggregateExposureMicroUsd: z.number().int().positive(),
        drawdownStopMicroUsd: z.number().int().positive()
      }).strict()
    }).strict(),
    realMoney: z.object({
      gate: z.literal("closed"),
      ordersEnabled: z.literal(false)
    }).strict()
  }).strict(),
  syntheticReceipt: z.object({
    route: z.literal(`/artifacts/dashboard/${PUBLIC_SYNTHETIC_RECEIPT_FILENAME}`),
    orderedEventCount: z.number().int().positive(),
    verificationStatus: z.literal("offline_verified"),
    lifecycleStatus: z.string().min(1),
    synthetic: z.literal(true),
    externalCalls: z.literal(0),
    performanceUse: z.literal("excluded_synthetic"),
    solanaAnchorStatus: z.literal("not_submitted")
  }).strict(),
  publicLimitations: z.array(z.string().min(1)).length(6),
  documentation: z.object({
    technicalOverview: z.literal("https://github.com/Pavilion-devs/samaritan/blob/main/docs/submission/technical-overview.md"),
    txlineApiFeedback: z.literal("https://github.com/Pavilion-devs/samaritan/blob/main/docs/submission/txline-api-feedback.md"),
    repository: z.literal("https://github.com/Pavilion-devs/samaritan")
  }).strict()
}).strict();

export type JudgeEvidenceResponse = z.infer<typeof judgeEvidenceResponseSchema>;

type JsonRecord = Record<string, unknown>;

function record(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Judge evidence requires ${label}`);
  }
  return value as JsonRecord;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Judge evidence requires ${label}`);
  return value;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Judge evidence requires ${label}`);
  return value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`Judge evidence requires ${label}`);
  return value;
}

function nonnegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`Judge evidence requires ${label}`);
  return value as number;
}

function positiveInteger(value: unknown, label: string): number {
  const parsed = nonnegativeInteger(value, label);
  if (parsed === 0) throw new Error(`Judge evidence requires positive ${label}`);
  return parsed;
}

function literal<T extends string | number | boolean>(value: unknown, expected: T, label: string): T {
  if (value !== expected) throw new Error(`Judge evidence requires ${label}`);
  return expected;
}

function qualifyingCounts(protocol: JsonRecord): JudgeEvidenceResponse["gates"]["paperProtocol"]["qualifyingCounts"] {
  const counts = record(protocol.qualifyingCounts, "paper protocol qualifying counts");
  const parsed = {
    matches: nonnegativeInteger(counts.matches, "paper protocol qualifying matches"),
    signals: nonnegativeInteger(counts.signals, "paper protocol qualifying signals"),
    filledMatches: nonnegativeInteger(counts.filledMatches, "paper protocol qualifying filled matches"),
    fills: nonnegativeInteger(counts.fills, "paper protocol qualifying fills"),
    settledFills: nonnegativeInteger(counts.settledFills, "paper protocol qualifying settled fills")
  };
  if (parsed.filledMatches > parsed.matches || parsed.fills > parsed.signals || parsed.settledFills > parsed.fills) {
    throw new Error("Judge evidence paper protocol counts do not reconcile");
  }
  return parsed;
}

function safeCommit(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized && /^[a-f0-9]{7,64}$/.test(normalized) ? normalized : null;
}

async function gitDirectory(repoRoot: string): Promise<string | null> {
  const marker = resolve(repoRoot, ".git");
  try {
    if ((await stat(marker)).isDirectory()) return marker;
    const contents = await readFile(marker, "utf8");
    const match = /^gitdir:\s*(.+)\s*$/i.exec(contents);
    return match?.[1] ? resolve(repoRoot, match[1]) : null;
  } catch {
    return null;
  }
}

async function localGitCommit(repoRoot: string): Promise<string | null> {
  const directory = await gitDirectory(repoRoot);
  if (!directory) return null;
  try {
    const head = (await readFile(resolve(directory, "HEAD"), "utf8")).trim();
    const detached = safeCommit(head);
    if (detached) return detached;
    const match = /^ref:\s*(refs\/[A-Za-z0-9._/-]+)$/.exec(head);
    const ref = match?.[1];
    if (!ref || ref.includes("..")) return null;
    try {
      return safeCommit(await readFile(resolve(directory, ref), "utf8"));
    } catch {
      const packed = await readFile(resolve(directory, "packed-refs"), "utf8");
      const line = packed.split("\n").find((candidate) => candidate.endsWith(` ${ref}`));
      return safeCommit(line?.split(" ", 1)[0]);
    }
  } catch {
    return null;
  }
}

async function buildCommit(repoRoot: string): Promise<string | null> {
  for (const candidate of [
    process.env.SAMARITAN_BUILD_COMMIT,
    process.env.VERCEL_GIT_COMMIT_SHA,
    process.env.RENDER_GIT_COMMIT,
    process.env.GITHUB_SHA,
    process.env.COMMIT_SHA
  ]) {
    const commit = safeCommit(candidate);
    if (commit) return commit;
  }
  return localGitCommit(repoRoot);
}

const TRACK_CRITERIA: JudgeEvidenceResponse["trackCriteria"] = [
  {
    id: "core_functionality_and_data_ingestion",
    criterion: "Core Functionality & Data Ingestion",
    evidence: [
      { label: "Captured TXLine-derived replay", route: "/matchroom" },
      { label: "Derived evidence index API", route: CASEBOOK_API_PATH },
      { label: "Live derived TXLine connectivity pulse", route: TXLINE_PULSE_API_PATH },
      {
        label: "Integration documentation",
        route: "https://github.com/Pavilion-devs/samaritan/blob/main/docs/submission/technical-overview.md"
      }
    ]
  },
  {
    id: "autonomous_operation",
    criterion: "Autonomous Operation",
    evidence: [
      { label: "Bounded lifecycle proof", route: "/proof" },
      { label: "Offline-verifiable synthetic receipt", route: `/artifacts/dashboard/${PUBLIC_SYNTHETIC_RECEIPT_FILENAME}` }
    ]
  },
  {
    id: "deterministic_logic_and_architecture",
    criterion: "Logic & Code Architecture",
    evidence: [
      { label: "Interactive receipt verifier", route: "/proof" },
      { label: "Decision evidence index", route: "/casebook" },
      { label: "Ordered lifecycle receipt", route: `/artifacts/dashboard/${PUBLIC_SYNTHETIC_RECEIPT_FILENAME}` }
    ]
  },
  {
    id: "innovation_and_novelty",
    criterion: "Innovation / Novelty",
    evidence: [
      { label: "Disciplined no-trade case", route: "/matchroom" },
      { label: "Separated research and proving fixture", route: "/study" }
    ]
  },
  {
    id: "production_readiness",
    criterion: "Production Readiness",
    evidence: [
      { label: "No-login judge surface", route: "/" },
      { label: "Read-only service health", route: "/api/v1/health" },
      { label: "Fail-closed evidence summary", route: JUDGE_EVIDENCE_API_PATH }
    ]
  }
];

const TXLINE_ENDPOINTS: JudgeEvidenceResponse["txlineIntegration"]["endpointsUsed"] = [
  { method: "POST", path: "/auth/guest/start", purpose: "Start the guest authentication session" },
  { method: "POST", path: "/api/token/activate", purpose: "Activate the subscribed data token" },
  { method: "GET", path: "/api/fixtures/snapshot", purpose: "Discover exact fixture and kickoff identities" },
  { method: "GET", path: "/api/odds/stream", purpose: "Consume live odds SSE" },
  { method: "GET", path: "/api/scores/stream", purpose: "Consume live score and action SSE" },
  { method: "GET", path: "/api/odds/snapshot/{fixtureId}", purpose: "Backfill current odds state during recovery" },
  { method: "GET", path: "/api/scores/snapshot/{fixtureId}", purpose: "Backfill current score state during recovery" },
  { method: "GET", path: "/api/odds/updates/{epochDay}/{hourOfDay}/{interval}", purpose: "Build historical odds replay input" },
  { method: "GET", path: "/api/scores/updates/{epochDay}/{hourOfDay}/{interval}", purpose: "Build aligned historical score input" },
  { method: "GET", path: "/api/scores/historical/{fixtureId}", purpose: "Recover retained fixture score sequences" }
];

export type BuildJudgeEvidenceResponseOptions = {
  buildCommit?: string | null;
};

export async function buildJudgeEvidenceResponse(
  repoRoot: string,
  options: BuildJudgeEvidenceResponseOptions = {}
): Promise<JudgeEvidenceResponse> {
  const frozenResponses = await Promise.all([
    readFrozenDashboardResponse(repoRoot, COMMAND_API_PATH),
    readFrozenDashboardResponse(repoRoot, CASEBOOK_API_PATH),
    readFrozenDashboardResponse(repoRoot, STUDY_API_PATH),
    readFrozenDashboardResponse(repoRoot, SPAIN_BELGIUM_API_PATH)
  ]);
  const [commandFrozen, casebookFrozen, studyFrozen, matchroomFrozen] = frozenResponses;
  const manifest = commandFrozen.manifest;
  if (frozenResponses.some((response) => response.manifest.bundleSha256 !== manifest.bundleSha256)) {
    throw new Error("Judge evidence requires one coherent frozen bundle");
  }

  const command = record(record(JSON.parse(commandFrozen.body) as unknown, "command response").data, "command data");
  const casebook = record(record(JSON.parse(casebookFrozen.body) as unknown, "casebook response").data, "casebook data");
  const study = record(record(JSON.parse(studyFrozen.body) as unknown, "study response").data, "study data");
  const matchroom = record(record(JSON.parse(matchroomFrozen.body) as unknown, "matchroom response").data, "matchroom data");

  for (const [label, data] of [
    ["command", command],
    ["casebook", casebook],
    ["study", study],
    ["matchroom", matchroom]
  ] as const) {
    literal(data.executionMode, "paper", `${label} paper mode`);
    literal(data.realMoneyGate, "closed", `${label} real-money gate`);
    literal(data.tradeable, false, `${label} tradeability`);
    const policy = record(data.publicDataPolicy, `${label} public-data policy`);
    literal(policy.derivedOnly, true, `${label} derived-only policy`);
    literal(policy.credentialsRequired, false, `${label} no-login policy`);
    literal(policy.walletControlsExposed, false, `${label} wallet-control policy`);
    literal(policy.txlineProbabilityDisplay, "bucketed_movement_only", `${label} TXLine disclosure policy`);
    literal(policy.txlineFixtureIdentifiersExposed, false, `${label} TXLine fixture-identifier policy`);
  }

  const corpus = record(casebook.corpus, "casebook corpus");
  const statistics = record(casebook.statistics, "casebook statistics");
  const cases = array(casebook.cases, "casebook cases");
  const capturedObservations = nonnegativeInteger(statistics.totalCases, "captured observation count");
  const corpusObservations = nonnegativeInteger(corpus.marketEventCases, "captured corpus count");
  if (cases.length !== capturedObservations || corpusObservations !== capturedObservations) {
    throw new Error("Judge evidence captured observation counts do not reconcile");
  }
  literal(statistics.executedCases, 0, "captured executed-case count");
  literal(statistics.capitalMovedMicros, 0, "captured capital-moved count");
  const capturedDecision = record(matchroom.decision, "captured replay decision");
  literal(capturedDecision.ordersPlaced, 0, "captured replay order count");
  literal(capturedDecision.capitalMovedMicros, 0, "captured replay capital-moved count");
  literal(capturedDecision.walletAccessed, false, "captured replay wallet-access flag");

  const corrected = record(study.correctedHistoricalCandidate, "historical candidate");
  literal(corrected.evidenceClass, "historical_sampled_price_signal_research", "historical evidence class");
  literal(corrected.executable, false, "historical execution boundary");
  const protocol = record(study.protocol, "paper protocol");
  const risk = record(protocol.risk, "paper protocol risk limits");
  const counts = qualifyingCounts(protocol);

  const syntheticProof = record(study.syntheticProof, "synthetic proof metadata");
  literal(syntheticProof.offlineVerified, true, "synthetic receipt verification marker");
  literal(syntheticProof.externalCalls, 0, "synthetic external-call count");
  literal(syntheticProof.performanceUse, "excluded_synthetic", "synthetic performance boundary");
  literal(syntheticProof.solanaAnchorStatus, "not_submitted", "synthetic anchor boundary");

  const download = manifest.downloads.find((candidate) => candidate.file === PUBLIC_SYNTHETIC_RECEIPT_FILENAME);
  if (!download) throw new Error("Judge evidence requires the frozen synthetic receipt");
  const receiptBody = await readFile(
    resolve(repoRoot, PUBLIC_DASHBOARD_BUNDLE_RELATIVE_DIR, PUBLIC_SYNTHETIC_RECEIPT_FILENAME),
    "utf8"
  );
  if (Buffer.byteLength(receiptBody, "utf8") !== download.bytes || dashboardSha256(receiptBody) !== download.sha256) {
    throw new Error("Judge evidence synthetic receipt does not match the frozen manifest");
  }
  let receiptValue: unknown;
  try {
    receiptValue = JSON.parse(receiptBody) as unknown;
  } catch {
    throw new Error("Judge evidence synthetic receipt is invalid JSON");
  }
  const receipt = decisionReceiptSchema.parse(receiptValue);
  const receiptVerification = verifyDecisionReceipt(receipt);
  if (
    !receiptVerification.synthetic ||
    receiptVerification.lifecycleStatus !== string(syntheticProof.lifecycleStatus, "synthetic lifecycle status") ||
    receipt.solanaAnchor !== null ||
    string(syntheticProof.path, "synthetic receipt route") !== `/artifacts/dashboard/${PUBLIC_SYNTHETIC_RECEIPT_FILENAME}`
  ) {
    throw new Error("Judge evidence synthetic receipt metadata does not reconcile");
  }

  return judgeEvidenceResponseSchema.parse({
    schemaVersion: 1,
    generatedAt: manifest.generatedAt,
    app: {
      name: "Samaritan",
      service: "samaritan-dashboard",
      buildCommit: Object.prototype.hasOwnProperty.call(options, "buildCommit")
        ? options.buildCommit ?? null
        : await buildCommit(repoRoot)
    },
    access: {
      authenticationRequired: false,
      readOnly: true,
      source: "verified_frozen_public_bundle",
      disclosure: "derived_metadata_only"
    },
    trackCriteria: TRACK_CRITERIA,
    txlineIntegration: {
      endpointsUsed: TXLINE_ENDPOINTS,
      publicOutput: "derived_evidence_only"
    },
    evidenceClassCounts: {
      capturedReplayFixtures: nonnegativeInteger(corpus.fixtureCount, "captured fixture count"),
      capturedReplayObservations: capturedObservations,
      capturedNoTradeObservations: nonnegativeInteger(statistics.noTradeCases, "captured no-trade count"),
      historicalTrainingObservations: nonnegativeInteger(corrected.trainingNormalizedCases, "historical training count"),
      historicalHeldoutObservations: nonnegativeInteger(corrected.heldoutNormalizedCases, "historical heldout count"),
      historicalHeldoutFixtures: nonnegativeInteger(corrected.heldoutFixtures, "historical heldout fixture count"),
      syntheticLifecycleReceipts: manifest.downloads.filter((candidate) => candidate.synthetic).length,
      verifiedCapturedAgentLifecycleReceipts: manifest.downloads.filter((candidate) => !candidate.synthetic).length,
      registeredForwardPaperSignals: counts.signals
    },
    gates: {
      executionMode: "paper",
      paperProtocol: {
        id: string(protocol.version, "paper protocol id"),
        status: string(protocol.status, "paper protocol status"),
        active: boolean(protocol.active, "paper protocol active flag"),
        observationStatus: string(protocol.observationStatus, "paper protocol observation status"),
        evidencePolicy: string(protocol.evidencePolicy, "paper protocol evidence policy"),
        qualifyingCounts: counts,
        riskLimits: {
          bankrollMicroUsd: positiveInteger(risk.bankrollMicroUsd, "paper bankroll"),
          perTradeStakeMicroUsd: positiveInteger(risk.perTradeStakeMicroUsd, "paper stake"),
          aggregateExposureMicroUsd: positiveInteger(risk.aggregateExposureMicroUsd, "paper exposure cap"),
          drawdownStopMicroUsd: positiveInteger(risk.drawdownStopMicroUsd, "paper drawdown stop")
        }
      },
      realMoney: {
        gate: "closed",
        ordersEnabled: false
      }
    },
    syntheticReceipt: {
      route: `/artifacts/dashboard/${PUBLIC_SYNTHETIC_RECEIPT_FILENAME}`,
      orderedEventCount: receipt.lifecycle.orderedEventKinds.length,
      verificationStatus: "offline_verified",
      lifecycleStatus: receiptVerification.lifecycleStatus,
      synthetic: true,
      externalCalls: 0,
      performanceUse: "excluded_synthetic",
      solanaAnchorStatus: "not_submitted"
    },
    publicLimitations: [
      "The judge surface is a frozen evidence bundle, not a live private-data relay.",
      "The captured replay lane is retrospective feasibility evidence and did not enter the agent or execution runtime.",
      "Historical research lacks executable order-book depth and is not fill or profitability evidence.",
      "The complete lifecycle fixture uses deterministic model stubs, makes zero external calls, and is excluded from performance claims.",
      "Real-money execution is disabled; the registered study is forward paper observation only.",
      "The receipt is verified offline and has not been submitted to Solana."
    ],
    documentation: {
      technicalOverview: "https://github.com/Pavilion-devs/samaritan/blob/main/docs/submission/technical-overview.md",
      txlineApiFeedback: "https://github.com/Pavilion-devs/samaritan/blob/main/docs/submission/txline-api-feedback.md",
      repository: "https://github.com/Pavilion-devs/samaritan"
    }
  });
}
