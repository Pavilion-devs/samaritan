import type { MappingRecord } from "../mapping/registry.js";
import {
  PAPER_STUDY_MINIMUM_SIGNAL_TO_KICKOFF_MS,
  PAPER_STUDY_REPLAY_WINDOW_BEFORE_KICKOFF_MS
} from "../config/paper-study.js";
import {
  assertCausalTotalSelectorConfig,
  selectMainTotalLine,
  type TotalLineEvidence,
  type TotalLineSelectorConfig
} from "../research/main-total-selector.js";

export type PairedCaptureEvidence = {
  runId: string;
  status: "verified";
  fixtureId: string;
  eventSlug: string;
  logComplete: boolean;
  mappingConfirmed: boolean;
  identityParity: boolean;
  replayMode: string;
  rows: number;
  firstObservedTsMs: number;
};

export type PaperFixtureEvidence = {
  fixtureId: string;
  home: string;
  away: string;
  kickoffTsMs: number;
  eventSlugs: string[];
  mappingStatus: "candidate" | "verified";
  selectedTotal: {
    marketId: string;
    marketKey: string;
    conditionId: string;
    lineMilli: number;
    preKickoffOverProbability: number;
    preKickoffPointTsMs: number;
    coveragePoints: number;
    assetIds: string[];
  };
  evidenceGrade: "paired_order_books" | "sampled_price_history" | "metadata_only";
  capabilities: {
    signalResearchReplay: boolean;
    executablePaperReplay: boolean;
    kickoffCloseReplay: boolean;
    publicResolutionReplay: boolean;
  };
  bountyLane: {
    mode: "executable_book_replay" | "book_lifecycle_replay" | "signal_research_only" | "unavailable";
    exploratory: true;
    reason: string;
  };
  longRunLane: {
    eligible: boolean;
    reason:
      | "predates_long_run_lane_start"
      | "mapping_not_verified"
      | "executable_capture_required"
      | null;
  };
  pairedCapture: PairedCaptureEvidence | null;
};

export type PaperFixtureUniverse = {
  generatedAt: string;
  laneStartTsMs: number;
  selectorConfig: TotalLineSelectorConfig;
  fixtures: PaperFixtureEvidence[];
  summary: {
    fixtures: number;
    pairedBookReplays: number;
    executableBookReplays: number;
    bookLifecycleReplays: number;
    signalResearchOnly: number;
    unavailable: number;
    longRunEligible: number;
  };
};

function totalRecord(records: readonly MappingRecord[], fixtureId: string): MappingRecord {
  const candidates = records.filter((record) =>
    record.txlineFixtureId === fixtureId &&
    record.conditions.some((condition) => condition.family === "total_goals" && condition.period === "full_time")
  );
  if (candidates.length !== 1) {
    throw new Error(`Fixture ${fixtureId} requires exactly one full-time totals mapping record`);
  }
  return candidates[0]!;
}

function validateFixtureIdentity(records: readonly MappingRecord[], fixtureId: string): {
  home: string;
  away: string;
  kickoffTsMs: number;
  eventSlugs: string[];
} {
  const fixtures = records.filter((record) => record.txlineFixtureId === fixtureId);
  const first = fixtures[0];
  if (!first) throw new Error(`Missing mapping records for fixture ${fixtureId}`);
  for (const record of fixtures) {
    if (
      record.teams.home.canonical !== first.teams.home.canonical ||
      record.teams.away.canonical !== first.teams.away.canonical ||
      record.kickoff.txlineTsMs !== first.kickoff.txlineTsMs ||
      record.kickoff.polymarketTsMs !== first.kickoff.polymarketTsMs
    ) {
      throw new Error(`Fixture ${fixtureId} has conflicting identity evidence`);
    }
  }
  if (first.kickoff.txlineTsMs !== first.kickoff.polymarketTsMs) {
    throw new Error(`Fixture ${fixtureId} kickoff does not match across sources`);
  }
  return {
    home: first.teams.home.canonical,
    away: first.teams.away.canonical,
    kickoffTsMs: first.kickoff.txlineTsMs,
    eventSlugs: [...new Set(fixtures.map((record) => record.polymarketEventSlug))].sort()
  };
}

export function buildPaperFixtureUniverse(input: {
  generatedAt: string;
  laneStartTsMs: number;
  mappings: readonly MappingRecord[];
  totalEvidence: readonly TotalLineEvidence[];
  pairedCaptures: readonly PairedCaptureEvidence[];
  sampledHistoryAssetIds: ReadonlySet<string>;
  selectorConfig: TotalLineSelectorConfig;
}): PaperFixtureUniverse {
  if (!Number.isSafeInteger(input.laneStartTsMs)) throw new Error("Lane start must be integer milliseconds");
  if (!Number.isFinite(Date.parse(input.generatedAt))) throw new Error("Fixture universe requires generatedAt ISO time");
  assertCausalTotalSelectorConfig(input.selectorConfig);
  const fixtureIds = [...new Set(
    input.mappings
      .filter((record) => record.conditions.some((condition) =>
        condition.family === "total_goals" && condition.period === "full_time"
      ))
      .map((record) => record.txlineFixtureId)
  )].sort();
  const fixtures = fixtureIds.map((fixtureId): PaperFixtureEvidence => {
    const identity = validateFixtureIdentity(input.mappings, fixtureId);
    const record = totalRecord(input.mappings, fixtureId);
    const selection = selectMainTotalLine(
      fixtureId,
      input.totalEvidence.filter((row) => row.fixtureId === fixtureId),
      input.selectorConfig,
      identity.kickoffTsMs - PAPER_STUDY_REPLAY_WINDOW_BEFORE_KICKOFF_MS
    );
    if (!selection.selected || selection.selected.preKickoffOverProbability === null || selection.selected.preKickoffPointTsMs === null) {
      throw new Error(`Fixture ${fixtureId} has no eligible frozen total selection`);
    }
    const condition = record.conditions.find((candidate) =>
      candidate.family === "total_goals" &&
      candidate.period === "full_time" &&
      candidate.lineMilli === selection.selected!.lineMilli &&
      candidate.polymarketMarketId === selection.selected!.marketId
    );
    if (!condition) throw new Error(`Fixture ${fixtureId} selected total is absent from its mapping record`);
    const assetIds = condition.tokens.map((token) => token.assetId).sort();
    const sampledHistoryComplete = assetIds.every((assetId) => input.sampledHistoryAssetIds.has(assetId));
    const pairedCapture = input.pairedCaptures.find((capture) => capture.fixtureId === fixtureId) ?? null;
    if (pairedCapture && !identity.eventSlugs.includes(pairedCapture.eventSlug)) {
      throw new Error(`Fixture ${fixtureId} paired capture event slug does not match its mapping evidence`);
    }
    const pairedVerified = pairedCapture !== null &&
      pairedCapture.logComplete &&
      pairedCapture.mappingConfirmed &&
      pairedCapture.identityParity;
    const pairedPreMatchWindow = pairedVerified &&
      pairedCapture.firstObservedTsMs <= identity.kickoffTsMs - PAPER_STUDY_MINIMUM_SIGNAL_TO_KICKOFF_MS;
    const evidenceGrade = pairedVerified
      ? "paired_order_books"
      : sampledHistoryComplete
        ? "sampled_price_history"
        : "metadata_only";
    const mode = pairedPreMatchWindow
      ? "executable_book_replay"
      : pairedVerified
        ? "book_lifecycle_replay"
      : sampledHistoryComplete
        ? "signal_research_only"
        : "unavailable";
    const reason = pairedPreMatchWindow
      ? "Verified synchronized TXLine and Polymarket book capture is available"
      : pairedVerified
        ? "Verified paired books start inside the 15-minute signal cutoff; lifecycle replay only"
      : sampledHistoryComplete
        ? "Sampled prices exist, but synchronized executable order-book depth was not captured"
        : "Selected total lacks complete replay price evidence";
    const afterLaneStart = identity.kickoffTsMs >= input.laneStartTsMs;
    const mappingVerified = record.status === "verified";
    const longRunEligible = afterLaneStart && mappingVerified && pairedPreMatchWindow;
    const longRunReason = !afterLaneStart
      ? "predates_long_run_lane_start"
      : !mappingVerified
        ? "mapping_not_verified"
        : !pairedPreMatchWindow
          ? "executable_capture_required"
          : null;
    return {
      fixtureId,
      ...identity,
      mappingStatus: record.status === "verified" ? "verified" : "candidate",
      selectedTotal: {
        marketId: condition.polymarketMarketId,
        marketKey: selection.selected.marketKey,
        conditionId: condition.conditionId,
        lineMilli: condition.lineMilli!,
        preKickoffOverProbability: selection.selected.preKickoffOverProbability,
        preKickoffPointTsMs: selection.selected.preKickoffPointTsMs,
        coveragePoints: selection.selected.coveragePoints,
        assetIds
      },
      evidenceGrade,
      capabilities: {
        signalResearchReplay: sampledHistoryComplete || pairedVerified,
        executablePaperReplay: pairedPreMatchWindow,
        kickoffCloseReplay: pairedVerified,
        publicResolutionReplay: pairedVerified
      },
      bountyLane: { mode, exploratory: true, reason },
      longRunLane: {
        eligible: longRunEligible,
        reason: longRunReason
      },
      pairedCapture
    };
  });
  return {
    generatedAt: input.generatedAt,
    laneStartTsMs: input.laneStartTsMs,
    selectorConfig: input.selectorConfig,
    fixtures,
    summary: {
      fixtures: fixtures.length,
      pairedBookReplays: fixtures.filter((fixture) => fixture.evidenceGrade === "paired_order_books").length,
      executableBookReplays: fixtures.filter((fixture) => fixture.bountyLane.mode === "executable_book_replay").length,
      bookLifecycleReplays: fixtures.filter((fixture) => fixture.bountyLane.mode === "book_lifecycle_replay").length,
      signalResearchOnly: fixtures.filter((fixture) => fixture.bountyLane.mode === "signal_research_only").length,
      unavailable: fixtures.filter((fixture) => fixture.bountyLane.mode === "unavailable").length,
      longRunEligible: fixtures.filter((fixture) => fixture.longRunLane.eligible).length
    }
  };
}

export function renderPaperFixtureUniverseMarkdown(universe: PaperFixtureUniverse): string {
  const rows = universe.fixtures.map((fixture) =>
    `| ${fixture.fixtureId} | ${fixture.home} vs ${fixture.away} | ${new Date(fixture.kickoffTsMs).toISOString()} | O/U ${(fixture.selectedTotal.lineMilli / 1_000).toFixed(1)} | ${fixture.evidenceGrade} | ${fixture.bountyLane.mode} | ${fixture.longRunLane.eligible ? "eligible" : `no (${fixture.longRunLane.reason})`} |`
  );
  return [
    "# Paper Fixture Evidence Universe",
    "",
    `Generated ${universe.generatedAt}. This is a derived metadata inventory; it does not redistribute raw TXLine data.`,
    "",
    "| Fixture | Match | Kickoff UTC | Frozen total | Evidence grade | Bounty lane | Long-run lane |",
    "|---|---|---:|---:|---|---|---|",
    ...rows,
    "",
    `Summary: ${universe.summary.pairedBookReplays} paired-book replay (${universe.summary.executableBookReplays} strategy-executable; ${universe.summary.bookLifecycleReplays} lifecycle-only), ${universe.summary.signalResearchOnly} sampled-history research fixtures, ${universe.summary.unavailable} unavailable.`,
    "",
    "Sampled-price fixtures may demonstrate signal generation but cannot produce registered paper fills, executable CLV, or profitability evidence. A paired capture that starts inside the 15-minute signal cutoff may prove book/close/resolution lifecycle behavior but cannot create a registered strategy fill. Every listed fixture predates the fresh long-run lane and is excluded from its stopping count.",
    ""
  ].join("\n");
}
