import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { validateCaptureConfig } from "../harness/capture-config.js";
import {
  COMMAND_SNAPSHOT_ID,
  SPAIN_BELGIUM_MATCHROOM_ID,
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

const fixtureUniverseSchema = z.object({
  generatedAt: z.string().datetime(),
  summary: z.object({
    fixtures: z.number().int().nonnegative(),
    pairedBookReplays: z.number().int().nonnegative(),
    signalResearchOnly: z.number().int().nonnegative(),
    longRunEligible: z.number().int().nonnegative()
  })
});

async function json(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

function teamCode(name: string): string {
  const code = ({ France: "FRA", Spain: "ESP", England: "ENG", Argentina: "ARG" } as Record<string, string>)[name];
  if (!code) throw new Error(`Command projection has no reviewed team code for ${name}`);
  return code;
}

function fixturePhase(nowTsMs: number, captureStartTsMs: number, kickoffTsMs: number, durationMinutes: number): CommandFixture["phase"] {
  if (nowTsMs < captureStartTsMs) return "scheduled";
  if (nowTsMs <= captureStartTsMs + durationMinutes * 60_000) return "capture_window";
  if (nowTsMs > kickoffTsMs) return "awaiting_verification";
  return "capture_window";
}

function phaseLabel(phase: CommandFixture["phase"]): string {
  if (phase === "scheduled") return "Capture confirmed";
  if (phase === "capture_window") return "Capture window";
  return "Awaiting verification";
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
    const config = await json(resolve(configDir, name));
    if (config === null || typeof config !== "object" || !("capture" in config)) continue;
    const validation = validateCaptureConfig({ repoRoot, config, txlineFixtures, polymarketEvents });
    if (!validation.readyToSchedule || validation.config.status !== "human_confirmed_for_capture_only") {
      throw new Error(`Command projection failed closed: ${name} is not confirmed for capture`);
    }
    const kickoffTsMs = Date.parse(validation.config.txline.kickoffUtc);
    const captureStartTsMs = Date.parse(validation.config.capture.scheduledStartUtc);
    const phase = fixturePhase(nowTsMs, captureStartTsMs, kickoffTsMs, validation.config.capture.durationMinutes);
    fixtures.push({
      fixtureId: validation.config.txline.fixtureId,
      home: { name: validation.config.txline.home, code: teamCode(validation.config.txline.home) },
      away: { name: validation.config.txline.away, code: teamCode(validation.config.txline.away) },
      kickoffUtc: validation.config.txline.kickoffUtc,
      captureStartUtc: validation.config.capture.scheduledStartUtc,
      signalCutoffUtc: new Date(kickoffTsMs - 15 * 60_000).toISOString(),
      eventSlug: validation.config.polymarket.eventSlug,
      phase,
      statusLabel: phaseLabel(phase),
      identityStatus: "exact_match_confirmed",
      captureOnly: true,
      tradeable: false
    });
  }
  if (fixtures.length === 0) throw new Error("Command projection failed closed: no confirmed capture fixtures");
  return fixtures.sort((left, right) => Date.parse(left.kickoffUtc) - Date.parse(right.kickoffUtc));
}

export async function buildCommandSnapshot(repoRoot: string, nowTsMs = Date.now()): Promise<CommandSnapshot> {
  if (!Number.isSafeInteger(nowTsMs)) throw new Error("Command projection requires a valid current timestamp");
  const [matchroom, reportValue, universeValue, fixtureSchedule] = await Promise.all([
    buildSpainBelgiumMatchroomSnapshot(repoRoot),
    json(resolve(repoRoot, "data/paper/reports/current.json")),
    json(resolve(repoRoot, "data/research/paper-fixture-universe.json")),
    buildFixtureSchedule(repoRoot, nowTsMs)
  ]);
  const report = paperReportSchema.parse(reportValue);
  const universe = fixtureUniverseSchema.parse(universeValue);
  if (universe.summary.longRunEligible !== 0) {
    throw new Error("Command projection failed closed: fixture admission changed without a refreshed public contract");
  }

  const goal = matchroom.replay.states.find((state) => state.id === "goal");
  if (!goal) throw new Error("Command projection failed closed: featured replay has no goal state");
  const recentCase: CommandCase = {
    caseId: "ESP-BEL-01",
    matchroomId: SPAIN_BELGIUM_MATCHROOM_ID,
    fixtureId: matchroom.match.fixtureId,
    fixtureLabel: "Spain vs Belgium",
    occurredAt: matchroom.replay.firstSeenAt,
    marketLabel: "Match result · Draw",
    candidateLabel: "Live-lane gate readout",
    disposition: "no_trade",
    dispositionLabel: "No trade",
    reason: "Market moved before signal",
    evidenceStatus: "verified_replay",
    preTriggerMarketMoveBps: matchroom.replay.preTriggerMarketMoveBps,
    consensusMoveFromBaselineBps: goal.consensusMoveFromBaselineBps,
    bestAsk: goal.bestAsk
  };
  const activeFixture = fixtureSchedule.find((fixture) => fixture.phase === "capture_window") ??
    fixtureSchedule.find((fixture) => fixture.phase === "scheduled") ?? fixtureSchedule[0]!;
  const posture = activeFixture.phase === "scheduled" ? "standing_by" : activeFixture.phase;
  const postureLabel = posture === "standing_by" ? "Standing by for paired capture" :
    posture === "capture_window" ? "Capture window is open" : "Awaiting capture verification";
  const postureDetail = activeFixture.phase === "scheduled"
    ? `${activeFixture.home.name} vs ${activeFixture.away.name} is confirmed for public-data capture only.`
    : `${activeFixture.home.name} vs ${activeFixture.away.name} remains non-tradeable until captured evidence is verified.`;
  const longRun = report.lanes.longRun;

  return {
    schemaVersion: 2,
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
        { id: "txline", label: "TXLine", status: "scheduled", statusLabel: "Scheduled", detail: `Exact fixture ${activeFixture.fixtureId} confirmed` },
        { id: "polymarket", label: "Polymarket", status: "scheduled", statusLabel: "Scheduled", detail: "Exact event family confirmed" },
        { id: "decision_ledger", label: "Paper ledgers", status: "initialized", statusLabel: "Preserved", detail: "Invalidated v1 zero-observation chains remain valid" },
        { id: "replay_proof", label: "Replay proof", status: "verified", statusLabel: "Verified", detail: `${matchroom.proof.canonicalEvents.toLocaleString("en-US")} canonical events` }
      ]
    },
    featuredCase: {
      ...recentCase,
      scoreLabel: "1–0",
      clockLabel: matchroom.match.clockLabel,
      conclusion: goal.decisionExplanation,
      canonicalEvents: matchroom.proof.canonicalEvents,
      identityParity: true,
      chart: matchroom.replay.chart
    },
    fixtureSchedule,
    recentCases: [recentCase],
    additionalCaseState: {
      status: "waiting_for_eligible_capture",
      label: "No active study can admit cases",
      detail: "Capture verification may add evidence, but study admission waits for Deborah to register corrected v2."
    },
    study: {
      protocolVersion: report.protocolVersion,
      protocolStatus: "invalidated_suspended",
      configHash: report.configHash,
      startedAt: longRun.initialization.startedAt,
      status: "suspended",
      statusLabel: "V1 suspended",
      filledMatches: longRun.report.counts.filledMatches,
      requiredFilledMatches: longRun.initialization.frozenConfig.evaluation.minimumFilledMatches,
      fills: longRun.report.counts.fills,
      requiredFills: longRun.initialization.frozenConfig.evaluation.minimumFills,
      bountyStatus: "exploratory",
      stoppingRuleMet: false,
      reason: longRun.report.reason
    },
    proof: {
      replayIdentityParity: true,
      replayIdentityHash: matchroom.proof.identityHash,
      canonicalEvents: matchroom.proof.canonicalEvents,
      bountyLedgerValid: true,
      bountyLedgerRows: report.lanes.bounty.chain.rows,
      longRunLedgerValid: true,
      longRunLedgerRows: longRun.chain.rows,
      evidenceFixtures: universe.summary.fixtures,
      pairedBookReplays: universe.summary.pairedBookReplays,
      signalResearchOnly: universe.summary.signalResearchOnly
    },
    sourceFreshness: {
      paperReportGeneratedAt: report.generatedAt,
      fixtureUniverseGeneratedAt: universe.generatedAt,
      replayGeneratedAt: matchroom.generatedAt
    },
    publicDataPolicy: matchroom.publicDataPolicy
  };
}

export async function buildCommandDashboardResponse(repoRoot: string, nowTsMs = Date.now()): Promise<CommandApiResponse> {
  return { data: await buildCommandSnapshot(repoRoot, nowTsMs) };
}
