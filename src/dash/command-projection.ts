import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { parseCaptureConfig, validateCaptureConfig } from "../harness/capture-config.js";
import { parseVerifiedPairedAnalysisManifest } from "../harness/paired-capture-manifest.js";
import { PAPER_STUDY_EVALUATION_CANDIDATE } from "../metrics/paper-study.js";
import {
  COMMAND_SNAPSHOT_ID,
  FORWARD_PAPER_CONFIG_HASH,
  FORWARD_PAPER_PROTOCOL_ID,
  FORWARD_PAPER_REGISTERED_AT,
  type CommandApiResponse,
  type CommandCase,
  type CommandFixture,
  type CommandSnapshot
} from "./public-contract.js";
import { buildSpainBelgiumMatchroomSnapshot } from "./projection.js";

const paperCountsSchema = z.object({
  matches: z.number().int().nonnegative(),
  signals: z.number().int().nonnegative(),
  filledMatches: z.number().int().nonnegative(),
  fills: z.number().int().nonnegative(),
  settledFills: z.number().int().nonnegative()
});

const paperReportSchema = z.object({
  generatedAt: z.string().datetime(),
  protocolVersion: z.string().min(1),
  configHash: z.string().regex(/^[a-f0-9]{64}$/),
  realMoneyGate: z.literal("closed"),
  fixtureUniverseGeneratedAt: z.string().datetime(),
  lanes: z.object({
    bounty: z.object({
      chain: z.object({ valid: z.literal(true), rows: z.number().int().positive(), headHash: z.string().regex(/^[a-f0-9]{64}$/) }),
      report: z.object({ status: z.literal("exploratory"), counts: paperCountsSchema })
    }),
    longRun: z.object({
      initialization: z.object({
        startedAt: z.string().datetime(),
        frozenConfig: z.object({
          evaluation: z.object({
            minimumFilledMatches: z.number().int().positive(),
            minimumFills: z.number().int().positive()
          })
        })
      }),
      chain: z.object({ valid: z.literal(true), rows: z.number().int().positive(), headHash: z.string().regex(/^[a-f0-9]{64}$/) }),
      report: z.object({
        status: z.literal("sealed"),
        reason: z.string().min(1),
        counts: paperCountsSchema,
        stoppingRuleMet: z.literal(false),
        rows: z.null(),
        endpoints: z.null(),
        guardrails: z.null()
      })
    })
  })
});

const registeredInitializationSchema = z.object({
  protocolVersion: z.literal(FORWARD_PAPER_PROTOCOL_ID),
  protocolStatus: z.literal("registered"),
  configHash: z.literal(FORWARD_PAPER_CONFIG_HASH),
  realMoneyGate: z.literal("closed"),
  startedAtTsMs: z.number().int().nonnegative(),
  startedAt: z.string().datetime(),
  registration: z.object({
    protocolId: z.literal(FORWARD_PAPER_PROTOCOL_ID),
    status: z.literal("registered"),
    registeredBy: z.literal("Deborah"),
    registeredAt: z.literal(FORWARD_PAPER_REGISTERED_AT),
    scope: z.literal("forward_paper_only"),
    realMoneyGate: z.literal("closed")
  }).strict(),
  frozenConfig: z.object({
    evaluation: z.object({
      minimumFilledMatches: z.number().int().positive(),
      minimumFills: z.number().int().positive()
    }).passthrough()
  }).passthrough()
}).passthrough();

const registeredV2ReportSchema = z.object({
  generatedAt: z.string().datetime(),
  protocolVersion: z.literal(FORWARD_PAPER_PROTOCOL_ID),
  configHash: z.literal(FORWARD_PAPER_CONFIG_HASH),
  realMoneyGate: z.literal("closed"),
  fixtureUniverseGeneratedAt: z.string().datetime(),
  lanes: z.object({
    bounty: z.object({
      initialization: registeredInitializationSchema,
      chain: z.object({ valid: z.literal(true), rows: z.number().int().positive(), headHash: z.string().regex(/^[a-f0-9]{64}$/) }).passthrough(),
      report: z.object({ status: z.literal("exploratory"), counts: paperCountsSchema }).passthrough()
    }).passthrough(),
    longRun: z.object({
      initialization: registeredInitializationSchema,
      chain: z.object({ valid: z.literal(true), rows: z.number().int().positive(), headHash: z.string().regex(/^[a-f0-9]{64}$/) }).passthrough(),
      report: z.object({
        status: z.literal("sealed"),
        reason: z.string().min(1),
        counts: paperCountsSchema,
        stoppingRuleMet: z.literal(false),
        rows: z.null(),
        endpoints: z.null(),
        guardrails: z.null()
      }).passthrough()
    }).passthrough()
  }).strict()
}).strict();

const fixtureUniverseSchema = z.object({
  generatedAt: z.string().datetime(),
  summary: z.object({
    fixtures: z.number().int().nonnegative(),
    pairedBookReplays: z.number().int().nonnegative(),
    signalResearchOnly: z.number().int().nonnegative(),
    longRunEligible: z.number().int().nonnegative()
  })
});

const analysisHeaderSchema = z.object({
  runId: z.string().min(1),
  checkedAt: z.string().datetime(),
  status: z.string().min(1),
  fixtureId: z.string().min(1),
  eventSlug: z.string().min(1)
}).passthrough();

const failedAnalysisSchema = analysisHeaderSchema.extend({
  status: z.literal("failed_closed"),
  failures: z.array(z.object({
    code: z.string().min(1),
    detail: z.string().min(1)
  }).strict()).min(1)
});

const captureStreamCoverageSchema = z.object({
  name: z.enum(["polymarket", "txline_odds", "txline_scores"]),
  path: z.string().min(1),
  bytes: z.number().int().positive(),
  firstReceivedAt: z.string().datetime(),
  lastReceivedAt: z.string().datetime(),
  firstReceivedTsMs: z.number().int().nonnegative(),
  lastReceivedTsMs: z.number().int().nonnegative()
}).strict().superRefine((stream, context) => {
  if (
    Date.parse(stream.firstReceivedAt) !== stream.firstReceivedTsMs ||
    Date.parse(stream.lastReceivedAt) !== stream.lastReceivedTsMs
  ) {
    context.addIssue({
      code: "custom",
      message: "Supervisor stream ISO and millisecond timestamps disagree",
      path: ["firstReceivedTsMs"]
    });
  }
  if (stream.lastReceivedTsMs <= stream.firstReceivedTsMs) {
    context.addIssue({
      code: "custom",
      message: "Supervisor stream lacks a positive observation window",
      path: ["lastReceivedTsMs"]
    });
  }
});

const synchronizedCaptureEvidenceSchema = z.object({
  manifestPath: z.string().min(1),
  windowStartUtc: z.string().datetime(),
  windowEndUtc: z.string().datetime(),
  synchronizedStartUtc: z.string().datetime(),
  synchronizedEndUtc: z.string().datetime(),
  streams: z.array(captureStreamCoverageSchema).length(3)
}).strict().superRefine((evidence, context) => {
  const names = new Set(evidence.streams.map((stream) => stream.name));
  if (names.size !== 3) {
    context.addIssue({
      code: "custom",
      message: "Supervisor terminal evidence requires all three unique streams",
      path: ["streams"]
    });
  }
  const windowStart = Date.parse(evidence.windowStartUtc);
  const windowEnd = Date.parse(evidence.windowEndUtc);
  const synchronizedStart = Date.parse(evidence.synchronizedStartUtc);
  const synchronizedEnd = Date.parse(evidence.synchronizedEndUtc);
  const derivedStart = Math.max(...evidence.streams.map((stream) => stream.firstReceivedTsMs));
  const derivedEnd = Math.min(...evidence.streams.map((stream) => stream.lastReceivedTsMs));
  if (
    windowEnd <= windowStart ||
    synchronizedEnd <= synchronizedStart ||
    synchronizedStart < windowStart ||
    synchronizedStart !== derivedStart ||
    synchronizedEnd !== derivedEnd
  ) {
    context.addIssue({
      code: "custom",
      message: "Supervisor terminal evidence has an invalid synchronized window",
      path: ["synchronizedStartUtc"]
    });
  }
});

const supervisorStatusSchema = z.object({
  schemaVersion: z.literal(1),
  captureId: z.string().min(1),
  runLabel: z.string().min(1),
  state: z.enum(["scheduled", "preflight", "running", "completed", "failed"]),
  updatedAt: z.string().datetime(),
  supervisorPid: z.number().int().positive(),
  scheduledStartUtc: z.string().datetime(),
  scheduledEndUtc: z.string().datetime().optional(),
  childPid: z.number().int().positive().optional(),
  exitCode: z.number().int().nullable().optional(),
  error: z.string().min(1).optional(),
  terminalEvidence: synchronizedCaptureEvidenceSchema.optional()
}).strict().superRefine((status, context) => {
  if (
    status.scheduledEndUtc !== undefined &&
    Date.parse(status.scheduledEndUtc) <= Date.parse(status.scheduledStartUtc)
  ) {
    context.addIssue({
      code: "custom",
      message: "Supervisor scheduled end must follow its start",
      path: ["scheduledEndUtc"]
    });
  }
  if (status.terminalEvidence !== undefined && status.state !== "completed") {
    context.addIssue({
      code: "custom",
      message: "Only a completed supervisor may carry terminal evidence",
      path: ["terminalEvidence"]
    });
  }
  if (status.state === "completed") {
    if (status.scheduledEndUtc === undefined || status.terminalEvidence === undefined || status.exitCode !== 0) {
      context.addIssue({
        code: "custom",
        message: "Completed supervisor status requires exact-window terminal evidence and exit code zero",
        path: ["terminalEvidence"]
      });
      return;
    }
    if (
      status.terminalEvidence.windowStartUtc !== status.scheduledStartUtc ||
      status.terminalEvidence.windowEndUtc !== status.scheduledEndUtc
    ) {
      context.addIssue({
        code: "custom",
        message: "Supervisor terminal evidence does not match its scheduled window",
        path: ["terminalEvidence", "windowStartUtc"]
      });
    }
  }
});

export type LocalCaptureArtifact = { present: boolean; value: unknown };

type CaptureOutcome = Pick<CommandFixture,
  "phase" | "statusLabel" | "statusDetail" | "statusSource" | "statusUpdatedAt" | "terminalEvidence"
>;

async function json(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

async function optionalJson(path: string): Promise<LocalCaptureArtifact> {
  try {
    return { present: true, value: await json(path) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { present: false, value: null };
    // A present but unreadable/malformed outcome artifact is not silently treated as absent.
    return { present: true, value: undefined };
  }
}

function teamCodes(eventSlug: string): { home: string; away: string } {
  const match = /^fifwc-([a-z0-9]{3})-([a-z0-9]{3})-\d{4}-\d{2}-\d{2}$/i.exec(eventSlug);
  if (!match) throw new Error(`Command projection cannot derive team codes from ${eventSlug}`);
  return { home: match[1]!.toUpperCase(), away: match[2]!.toUpperCase() };
}

function unknownOutcome(source: CaptureOutcome["statusSource"], detail: string, updatedAt: string | null): CaptureOutcome {
  return {
    phase: "unknown",
    statusLabel: "Outcome unknown",
    statusDetail: detail,
    statusSource: source,
    statusUpdatedAt: updatedAt,
    terminalEvidence: null
  };
}

export function resolveCaptureOutcome(input: {
  nowTsMs: number;
  captureId: string;
  runLabel: string;
  fixtureId: string;
  eventSlug: string;
  captureStartUtc: string;
  captureEndUtc: string;
  analysisManifest: LocalCaptureArtifact;
  supervisorStatus: LocalCaptureArtifact;
}): CaptureOutcome {
  const captureStartTsMs = Date.parse(input.captureStartUtc);
  const captureEndTsMs = Date.parse(input.captureEndUtc);
  if (input.analysisManifest.present) {
    const header = analysisHeaderSchema.safeParse(input.analysisManifest.value);
    if (!header.success) {
      return unknownOutcome("analysis_manifest", "Local analysis manifest is malformed", null);
    }
    const checkedAtTsMs = Date.parse(header.data.checkedAt);
    if (checkedAtTsMs <= input.nowTsMs) {
      if (
        header.data.runId !== input.runLabel ||
        header.data.fixtureId !== input.fixtureId ||
        header.data.eventSlug !== input.eventSlug
      ) {
        return unknownOutcome("analysis_manifest", "Local analysis identity does not match the reviewed capture", header.data.checkedAt);
      }
      if (header.data.status === "failed_closed") {
        const failed = failedAnalysisSchema.safeParse(input.analysisManifest.value);
        if (!failed.success) {
          return unknownOutcome("analysis_manifest", "Failed-closed analysis record is malformed", header.data.checkedAt);
        }
        return {
          phase: "failed",
          statusLabel: "Failed closed",
          statusDetail: `${failed.data.failures.length} verification failure${failed.data.failures.length === 1 ? "" : "s"} recorded`,
          statusSource: "analysis_manifest",
          statusUpdatedAt: failed.data.checkedAt,
          terminalEvidence: null
        };
      }
      if (header.data.status === "verified") {
        try {
          const verified = parseVerifiedPairedAnalysisManifest(input.analysisManifest.value);
          if (verified === null) throw new Error("Verified analysis parser returned no record");
          return {
            phase: "complete",
            statusLabel: "Verification complete",
            statusDetail: `${verified.verification.rows.toLocaleString("en-US")} canonical events verified`,
            statusSource: "analysis_manifest",
            statusUpdatedAt: verified.checkedAt,
            terminalEvidence: null
          };
        } catch {
          return unknownOutcome("analysis_manifest", "Verified analysis record failed strict validation", header.data.checkedAt);
        }
      }
      return unknownOutcome("analysis_manifest", "Analysis manifest has no recognized terminal outcome", header.data.checkedAt);
    }
  }

  if (input.supervisorStatus.present) {
    const parsed = supervisorStatusSchema.safeParse(input.supervisorStatus.value);
    if (!parsed.success) return unknownOutcome("supervisor_status", "Local supervisor status is malformed", null);
    const status = parsed.data;
    const updatedAtTsMs = Date.parse(status.updatedAt);
    if (updatedAtTsMs <= input.nowTsMs) {
      if (
        status.captureId !== input.captureId ||
        status.runLabel !== input.runLabel ||
        status.scheduledStartUtc !== input.captureStartUtc ||
        (status.scheduledEndUtc !== undefined && status.scheduledEndUtc !== input.captureEndUtc)
      ) {
        return unknownOutcome("supervisor_status", "Local supervisor identity does not match the reviewed capture", status.updatedAt);
      }
      if (status.state === "failed") {
        return {
          phase: "failed",
          statusLabel: "Supervisor failed",
          statusDetail: "Capture supervisor recorded a fail-closed terminal state",
          statusSource: "supervisor_status",
          statusUpdatedAt: status.updatedAt,
          terminalEvidence: null
        };
      }
      if (status.state === "completed") {
        const terminalEvidence = status.terminalEvidence!;
        return {
          phase: "complete",
          statusLabel: "Capture complete",
          statusDetail: "Synchronized terminal coverage recorded; analysis verification is still separate",
          statusSource: "supervisor_status",
          statusUpdatedAt: status.updatedAt,
          terminalEvidence: {
            windowStartUtc: terminalEvidence.windowStartUtc,
            windowEndUtc: terminalEvidence.windowEndUtc,
            synchronizedStartUtc: terminalEvidence.synchronizedStartUtc,
            synchronizedEndUtc: terminalEvidence.synchronizedEndUtc,
            streamCount: 3
          }
        };
      }
      if (status.state === "preflight" || status.state === "running") {
        if (input.nowTsMs > captureEndTsMs) {
          return unknownOutcome("supervisor_status", "Supervisor state is stale beyond the configured capture window", status.updatedAt);
        }
        return {
          phase: "running",
          statusLabel: status.state === "preflight" ? "Preflight recorded" : "Capture running",
          statusDetail: "State comes from the local capture supervisor",
          statusSource: "supervisor_status",
          statusUpdatedAt: status.updatedAt,
          terminalEvidence: null
        };
      }
      if (input.nowTsMs < captureStartTsMs) {
        return {
          phase: "scheduled",
          statusLabel: "Capture scheduled",
          statusDetail: "Scheduled state recorded by the local supervisor",
          statusSource: "supervisor_status",
          statusUpdatedAt: status.updatedAt,
          terminalEvidence: null
        };
      }
      return unknownOutcome("supervisor_status", "Scheduled supervisor state is stale after launch time", status.updatedAt);
    }
  }

  if (input.nowTsMs < captureStartTsMs) {
    return {
      phase: "scheduled",
      statusLabel: "Capture scheduled",
      statusDetail: "Human-confirmed capture-only config",
      statusSource: "reviewed_config",
      statusUpdatedAt: null,
      terminalEvidence: null
    };
  }
  return unknownOutcome("none", "No terminal analysis or current supervisor outcome is available", null);
}

async function buildFixtureSchedule(repoRoot: string, nowTsMs: number): Promise<CommandFixture[]> {
  const configDir = resolve(repoRoot, "config/captures");
  const [names, txlineFixtures, polymarketEvents] = await Promise.all([
    readdir(configDir),
    json(resolve(repoRoot, "samples/fixtures/mainnet-world-cup-fixtures.json")),
    json(resolve(repoRoot, "data/live/gamma-discovery/open-world-cup-events.json"))
  ]);
  if (!Array.isArray(txlineFixtures) || !Array.isArray(polymarketEvents)) {
    throw new Error("Command projection failed closed: capture identity evidence is malformed");
  }

  const fixtures: CommandFixture[] = [];
  for (const name of names.filter((value) => value.endsWith(".json")).sort()) {
    const configValue = await json(resolve(configDir, name));
    if (configValue === null || typeof configValue !== "object" || !("capture" in configValue)) continue;
    const parsedConfig = parseCaptureConfig(configValue);
    const historicalReviewedConfig = nowTsMs > Date.parse(parsedConfig.capture.scheduledEndUtc);
    const config = historicalReviewedConfig
      ? parsedConfig
      : validateCaptureConfig({ repoRoot, config: configValue, txlineFixtures, polymarketEvents, nowTsMs }).config;
    // Historical confirmed captures remain valid display evidence after their launch
    // window closes, but they are labelled as reviewed config rather than
    // re-verified against today's rolling source snapshots.
    if (config.status !== "human_confirmed_for_capture_only") {
      throw new Error(`Command projection failed closed: ${name} is not confirmed for capture`);
    }
    const kickoffTsMs = Date.parse(config.txline.kickoffUtc);
    const [analysisManifest, supervisorStatus] = await Promise.all([
      optionalJson(resolve(repoRoot, "data/live", config.capture.runLabel, "analysis-manifest.json")),
      optionalJson(resolve(repoRoot, "samples/_logs", `${config.capture.runLabel}.supervisor.json`))
    ]);
    const outcome = resolveCaptureOutcome({
      nowTsMs,
      captureId: config.captureId,
      runLabel: config.capture.runLabel,
      fixtureId: config.txline.fixtureId,
      eventSlug: config.polymarket.eventSlug,
      captureStartUtc: config.capture.scheduledStartUtc,
      captureEndUtc: config.capture.scheduledEndUtc,
      analysisManifest,
      supervisorStatus
    });
    const codes = teamCodes(config.polymarket.eventSlug);
    fixtures.push({
      captureId: config.captureId,
      home: { name: config.txline.home, code: codes.home },
      away: { name: config.txline.away, code: codes.away },
      kickoffUtc: config.txline.kickoffUtc,
      captureStartUtc: config.capture.scheduledStartUtc,
      captureEndUtc: config.capture.scheduledEndUtc,
      signalCutoffUtc: new Date(kickoffTsMs - 15 * 60_000).toISOString(),
      eventSlug: config.polymarket.eventSlug,
      ...outcome,
      identityStatus: historicalReviewedConfig ? "historical_reviewed_config" : "exact_match_confirmed",
      captureOnly: true,
      tradeable: false
    });
  }
  if (fixtures.length === 0) throw new Error("Command projection failed closed: no confirmed capture fixtures");
  return fixtures.sort((left, right) => Date.parse(left.kickoffUtc) - Date.parse(right.kickoffUtc));
}

export async function buildCommandSnapshot(repoRoot: string, nowTsMs = Date.now()): Promise<CommandSnapshot> {
  if (!Number.isSafeInteger(nowTsMs)) throw new Error("Command projection requires a valid current timestamp");
  const [matchroom, reportValue, universeValue, registeredReportValue, registeredUniverseValue, fixtureSchedule] = await Promise.all([
    buildSpainBelgiumMatchroomSnapshot(repoRoot),
    json(resolve(repoRoot, "data/paper/reports/current.json")),
    json(resolve(repoRoot, "data/research/paper-fixture-universe.json")),
    json(resolve(repoRoot, "data/paper/v2/reports/current.json")),
    json(resolve(repoRoot, "data/paper/v2/fixture-universe.json")),
    buildFixtureSchedule(repoRoot, nowTsMs)
  ]);
  const report = paperReportSchema.parse(reportValue);
  const universe = fixtureUniverseSchema.parse(universeValue);
  const registeredReport = registeredV2ReportSchema.parse(registeredReportValue);
  const registeredUniverse = fixtureUniverseSchema.parse(registeredUniverseValue);
  if (universe.summary.longRunEligible !== 0) {
    throw new Error("Command projection failed closed: fixture admission changed without a refreshed public contract");
  }
  if (
    Object.values(report.lanes.bounty.report.counts).some((value) => value !== 0) ||
    Object.values(report.lanes.longRun.report.counts).some((value) => value !== 0)
  ) {
    throw new Error("Command projection failed closed: invalidated v1 audit contains observations");
  }
  const registeredAtTsMs = Date.parse(FORWARD_PAPER_REGISTERED_AT);
  if (
    registeredReport.fixtureUniverseGeneratedAt !== registeredUniverse.generatedAt ||
    registeredReport.lanes.bounty.initialization.startedAtTsMs < registeredAtTsMs ||
    registeredReport.lanes.longRun.initialization.startedAtTsMs < registeredAtTsMs ||
    registeredReport.lanes.bounty.initialization.startedAt !== new Date(registeredReport.lanes.bounty.initialization.startedAtTsMs).toISOString() ||
    registeredReport.lanes.longRun.initialization.startedAt !== new Date(registeredReport.lanes.longRun.initialization.startedAtTsMs).toISOString()
  ) {
    throw new Error("Command projection failed closed: registered v2 report does not match its forward-only boundary");
  }

  const goal = matchroom.replay.states.find((state) => state.id === "goal");
  if (!goal) throw new Error("Command projection failed closed: featured replay has no goal state");
  const recentCase: CommandCase = {
    caseId: matchroom.caseId,
    matchroomId: matchroom.snapshotId,
    fixtureRef: matchroom.match.fixtureRef,
    fixtureLabel: `${matchroom.match.home.name} vs ${matchroom.match.away.name}`,
    home: matchroom.match.home,
    away: matchroom.match.away,
    occurredAt: matchroom.replay.firstSeenAt,
    marketLabel: matchroom.market.label,
    marketOutcomeLabel: matchroom.market.outcome,
    candidateLabel: "Live-lane gate readout",
    disposition: matchroom.decision.disposition,
    dispositionLabel: matchroom.decision.label,
    reason: matchroom.decision.primaryReason,
    evidenceStatus: "verified_replay",
    preTriggerMarketMoveBps: matchroom.replay.preTriggerMarketMoveBps,
    consensusMoveFromBaselineBps: goal.consensusMoveFromBaselineBps,
    bestAsk: goal.bestAsk,
    canonicalEvents: matchroom.proof.canonicalEvents,
    capitalMovedMicros: matchroom.decision.capitalMovedMicros,
    ordersPlaced: matchroom.decision.ordersPlaced,
    walletAccessed: matchroom.decision.walletAccessed
  };
  const activeFixture = fixtureSchedule.find((fixture) => fixture.phase === "running") ??
    fixtureSchedule.find((fixture) => fixture.phase === "scheduled") ??
    fixtureSchedule.find((fixture) => fixture.phase === "unknown") ??
    fixtureSchedule.find((fixture) => fixture.phase === "failed") ?? fixtureSchedule[0]!;
  const posture = activeFixture.phase === "scheduled" ? "standing_by" :
    activeFixture.phase === "running" ? "capture_window" : "awaiting_verification";
  const postureLabel = activeFixture.phase === "scheduled" ? "Standing by for paired capture" :
    activeFixture.phase === "running" ? "Capture supervisor recorded running" :
    activeFixture.phase === "failed" ? "Capture failed closed" :
    activeFixture.phase === "complete" ? "Capture outcome recorded" : "Capture outcome unknown";
  const postureDetail = `${activeFixture.home.name} vs ${activeFixture.away.name}: ${activeFixture.statusDetail}. Non-tradeable.`;
  const longRun = report.lanes.longRun;
  const registeredLongRun = registeredReport.lanes.longRun;
  const qualifyingCounts = registeredLongRun.report.counts;
  const observationStatus = qualifyingCounts.signals === 0
    ? "awaiting_fresh_evidence" as const
    : "collecting_forward_evidence" as const;

  return {
    schemaVersion: 3,
    snapshotId: COMMAND_SNAPSHOT_ID,
    generatedAt: new Date(nowTsMs).toISOString(),
    mode: "offline_artifact",
    executionMode: "paper",
    realMoneyGate: "closed",
    tradeable: false,
    system: {
      posture,
      label: postureLabel,
      detail: postureDetail,
      feeds: [
        { id: "txline", label: "TXLine", status: activeFixture.phase, statusLabel: activeFixture.statusLabel, detail: `Exact source identity confirmed at export · ${activeFixture.statusDetail}` },
        { id: "polymarket", label: "Polymarket", status: activeFixture.phase, statusLabel: activeFixture.statusLabel, detail: `Exact event family · ${activeFixture.statusDetail}` },
        { id: "decision_ledger", label: "V2 study ledgers", status: "verified", statusLabel: "Verified", detail: `Registered forward-paper chains verify · ${qualifyingCounts.signals} qualifying signal${qualifyingCounts.signals === 1 ? "" : "s"}` },
        { id: "replay_proof", label: "Replay proof", status: "verified", statusLabel: "Verified", detail: `${matchroom.proof.canonicalEvents.toLocaleString("en-US")} canonical events` }
      ]
    },
    featuredCase: {
      ...recentCase,
      scoreLabel: `${matchroom.match.scoreAtCursor.home}–${matchroom.match.scoreAtCursor.away}`,
      scoreAtCursor: matchroom.match.scoreAtCursor,
      clockSeconds: matchroom.match.clockSeconds,
      clockLabel: matchroom.match.clockLabel,
      conclusion: goal.decisionExplanation,
      identityParity: true,
      chart: matchroom.replay.chart
    },
    fixtureSchedule,
    recentCases: [recentCase],
    additionalCaseState: {
      status: "waiting_for_eligible_capture",
      label: "Registered v2 awaits fresh eligible evidence",
      detail: qualifyingCounts.signals === 0
        ? "Registration is active for forward paper only; zero observations qualify until a fresh fixture passes every admission gate."
        : `${qualifyingCounts.signals} forward signal${qualifyingCounts.signals === 1 ? " is" : "s are"} reconstructed from the registered v2 ledger; historical, retrospective, and synthetic rows remain excluded.`
    },
    study: {
      protocolVersion: FORWARD_PAPER_PROTOCOL_ID,
      protocolStatus: "registered",
      configHash: FORWARD_PAPER_CONFIG_HASH,
      registeredAt: FORWARD_PAPER_REGISTERED_AT,
      status: "active_forward_paper",
      statusLabel: "V2 registered",
      observationStatus,
      qualifyingCounts,
      requiredFilledMatches: PAPER_STUDY_EVALUATION_CANDIDATE.minimumFilledMatches,
      requiredFills: PAPER_STUDY_EVALUATION_CANDIDATE.minimumFills,
      bountyStatus: "exploratory",
      stoppingRuleMet: registeredLongRun.report.stoppingRuleMet,
      realMoneyGate: "closed",
      reason: `${registeredLongRun.report.reason}. Historical, retrospective, and synthetic rows cannot count.`,
      historicalV1: {
        protocolVersion: report.protocolVersion,
        protocolStatus: "invalidated_suspended",
        configHash: report.configHash,
        startedAt: longRun.initialization.startedAt,
        zeroObservationAudit: true
      }
    },
    proof: {
      replayIdentityParity: true,
      replayIdentityHash: matchroom.proof.identityHash,
      canonicalEvents: matchroom.proof.canonicalEvents,
      bountyLedgerValid: true,
      bountyLedgerRows: registeredReport.lanes.bounty.chain.rows,
      longRunLedgerValid: true,
      longRunLedgerRows: registeredLongRun.chain.rows,
      evidenceFixtures: universe.summary.fixtures,
      pairedBookReplays: universe.summary.pairedBookReplays,
      signalResearchOnly: universe.summary.signalResearchOnly
    },
    sourceFreshness: {
      paperReportGeneratedAt: registeredReport.generatedAt,
      fixtureUniverseGeneratedAt: registeredUniverse.generatedAt,
      replayGeneratedAt: matchroom.generatedAt
    },
    publicDataPolicy: matchroom.publicDataPolicy
  };
}

export async function buildCommandDashboardResponse(repoRoot: string, nowTsMs = Date.now()): Promise<CommandApiResponse> {
  return { data: await buildCommandSnapshot(repoRoot, nowTsMs) };
}
