export const SPAIN_BELGIUM_MATCHROOM_ID = "paired-spain-belgium-2026-07-10";
export const COMMAND_SNAPSHOT_ID = "command-2026-world-cup";
export const CASEBOOK_SNAPSHOT_ID = "casebook-2026-world-cup";
export const STUDY_SNAPSHOT_ID = "paper-study-2026-world-cup";
export const TXLINE_PUBLIC_MOVEMENT_BUCKET_BPS = 25;

export type ReplayStepId = "pre" | "goal" | "post";

export type PublicBookPoint = {
  offsetMs: number;
  bestBid: number;
  bestAsk: number;
  spread: number;
  available: true;
};

export type ReplayState = {
  id: ReplayStepId;
  label: string;
  offsetMs: number;
  observedAt: string;
  consensusMoveFromBaselineBps: number;
  bestBid: number;
  bestAsk: number;
  spread: number;
  conclusionTitle: string;
  conclusionBody: string;
  decisionExplanation: string;
};

export type PublicDataPolicy = {
  derivedOnly: true;
  txlineProbabilityDisplay: "bucketed_movement_only";
  txlineMovementBucketBps: typeof TXLINE_PUBLIC_MOVEMENT_BUCKET_BPS;
  credentialsRequired: false;
  walletControlsExposed: false;
};

export type DecisionStage = {
  id: "signal" | "evidence" | "pass" | "execution";
  label: string;
  detail: string;
  status: "complete" | "passed" | "locked";
  timingLabel: string;
};

export type EvidenceRow = {
  replayStateId: ReplayStepId;
  observedAt: string;
  offsetLabel: string;
  source: "Polymarket" | "TXLine" | "Samaritan";
  observation: string;
  bestAsk: number;
  assessment: "Moved first" | "Pass" | "No trade";
};

export type AvailabilityGap = {
  startedAt: string;
  endedAt: string;
  durationMs: number;
};

export type MatchroomSnapshot = {
  schemaVersion: 2;
  snapshotId: typeof SPAIN_BELGIUM_MATCHROOM_ID;
  caseId: string;
  casebookCaseCount: number;
  generatedAt: string;
  mode: "captured_replay";
  executionMode: "paper";
  realMoneyGate: "closed";
  tradeable: false;
  match: {
    fixtureId: string;
    eventSlug: string;
    competition: "World Cup";
    stage: "Captured fixture";
    kickoffUtc: string;
    originalMatchDate: string;
    home: { name: string; code: string };
    away: { name: string; code: string };
    scoreAtCursor: { home: number; away: number };
    goalOrdinal: number;
    clockSeconds: number;
    clockLabel: string;
  };
  market: {
    family: "match_result";
    outcome: string;
    label: string;
    period: "90 minutes plus stoppage time";
    mappingStatus: "research_only";
  };
  replay: {
    firstSeenAt: string;
    firstSeenLatencyMs: number;
    firstMaterialMoveLatencyMs: number;
    preTriggerMarketMoveBps: number;
    activeStateId: "goal";
    states: ReplayState[];
    chart: PublicBookPoint[];
    availabilityGaps: AvailabilityGap[];
  };
  decision: {
    disposition: "no_trade";
    semanticStatus: "disciplined_pass";
    label: "No trade";
    primaryReason: "Market moved before signal";
    explanation: string;
    capitalMovedMicros: 0;
    ordersPlaced: 0;
    walletAccessed: false;
    stages: DecisionStage[];
  };
  evidence: EvidenceRow[];
  proof: {
    captureStatus: "verified";
    identityParity: true;
    identityHash: string;
    headHash: string;
    canonicalEvents: number;
    replayMode: "capture-order-per-source";
    feedOutageCount: number;
    feedDowntimeMs: number;
    maximumFeedDowntimeMs: number;
    gateCases: number;
    movedBeforeTxlineCases: number;
    noMaterialRepriceCases: number;
    cleanStaleWindows: 0;
    corpusCommitment: string;
    corpusAssurance: "local_file_sha256_not_capture_manifest_membership";
  };
  publicDataPolicy: PublicDataPolicy;
};

export type DashboardApiResponse = {
  data: MatchroomSnapshot;
};

export type CommandFixturePhase = "scheduled" | "running" | "complete" | "failed" | "unknown";

export type CommandCaptureTerminalEvidence = {
  windowStartUtc: string;
  windowEndUtc: string;
  synchronizedStartUtc: string;
  synchronizedEndUtc: string;
  streamCount: 3;
};

export type CommandFeedState = {
  id: "txline" | "polymarket" | "decision_ledger" | "replay_proof";
  label: string;
  status: CommandFixturePhase | "initialized" | "verified";
  statusLabel: string;
  detail: string;
};

export type CommandFixture = {
  fixtureId: string;
  home: { name: string; code: string };
  away: { name: string; code: string };
  kickoffUtc: string;
  captureStartUtc: string;
  captureEndUtc: string;
  signalCutoffUtc: string;
  eventSlug: string;
  phase: CommandFixturePhase;
  statusLabel: string;
  statusDetail: string;
  statusSource: "analysis_manifest" | "supervisor_status" | "reviewed_config" | "none";
  statusUpdatedAt: string | null;
  terminalEvidence: CommandCaptureTerminalEvidence | null;
  identityStatus: "exact_match_confirmed";
  captureOnly: true;
  tradeable: false;
};

export type CommandCase = {
  caseId: string;
  matchroomId: typeof SPAIN_BELGIUM_MATCHROOM_ID;
  fixtureId: string;
  fixtureLabel: string;
  home: MatchroomSnapshot["match"]["home"];
  away: MatchroomSnapshot["match"]["away"];
  occurredAt: string;
  marketLabel: string;
  marketOutcomeLabel: string;
  candidateLabel: "Live-lane gate readout";
  disposition: "no_trade";
  dispositionLabel: string;
  reason: string;
  evidenceStatus: "verified_replay";
  preTriggerMarketMoveBps: number;
  consensusMoveFromBaselineBps: number;
  bestAsk: number;
  canonicalEvents: number;
  capitalMovedMicros: 0;
  ordersPlaced: 0;
  walletAccessed: false;
};

export type CommandSnapshot = {
  schemaVersion: 2;
  snapshotId: typeof COMMAND_SNAPSHOT_ID;
  generatedAt: string;
  mode: "offline_artifact";
  executionMode: "paper";
  realMoneyGate: "closed";
  tradeable: false;
  system: {
    posture: "standing_by" | "capture_window" | "awaiting_verification";
    label: string;
    detail: string;
    feeds: CommandFeedState[];
  };
  featuredCase: CommandCase & {
    scoreLabel: string;
    scoreAtCursor: MatchroomSnapshot["match"]["scoreAtCursor"];
    clockSeconds: number;
    clockLabel: string;
    conclusion: string;
    identityParity: true;
    chart: PublicBookPoint[];
  };
  fixtureSchedule: CommandFixture[];
  recentCases: CommandCase[];
  additionalCaseState: {
    status: "waiting_for_eligible_capture";
    label: "No active study can admit cases";
    detail: string;
  };
  study: {
    protocolVersion: string;
    protocolStatus: "invalidated_suspended";
    configHash: string;
    startedAt: string;
    status: "suspended";
    statusLabel: "V1 suspended";
    filledMatches: number;
    requiredFilledMatches: number;
    fills: number;
    requiredFills: number;
    bountyStatus: "exploratory";
    stoppingRuleMet: false;
    reason: string;
  };
  proof: {
    replayIdentityParity: true;
    replayIdentityHash: string;
    canonicalEvents: number;
    bountyLedgerValid: true;
    bountyLedgerRows: number;
    longRunLedgerValid: true;
    longRunLedgerRows: number;
    evidenceFixtures: number;
    pairedBookReplays: number;
    signalResearchOnly: number;
  };
  sourceFreshness: {
    paperReportGeneratedAt: string;
    fixtureUniverseGeneratedAt: string;
    replayGeneratedAt: string;
  };
  publicDataPolicy: PublicDataPolicy;
};

export type CommandApiResponse = {
  data: CommandSnapshot;
};

export type CasebookCaseSummary = {
  caseId: string;
  matchroomId: typeof SPAIN_BELGIUM_MATCHROOM_ID | null;
  selectedExemplar: boolean;
  goalOrdinal: number;
  goalClockSeconds: number;
  occurredAt: string;
  fixtureId: string;
  fixtureLabel: string;
  homeCode: string;
  awayCode: string;
  marketFamily: "Match result" | "Full-time total";
  marketLabel: string;
  lineMilli: number | null;
  classification: "polymarket_moved_before_txline" | "no_material_reprice_in_window";
  detector: "STALE_QUOTE_FEASIBILITY";
  disposition: string;
  executionOutcome: string;
  evidenceLane: "Research only";
  source: "Captured replay";
  verificationStatus: "Internally reconciled";
  reason: string;
  preTriggerMarketMoveBps: number;
};

export type CasebookSnapshot = {
  schemaVersion: 3;
  snapshotId: typeof CASEBOOK_SNAPSHOT_ID;
  generatedAt: string;
  mode: "offline_artifact";
  executionMode: "paper";
  realMoneyGate: "closed";
  tradeable: false;
  statistics: {
    totalCases: number;
    noTradeCases: number;
    executedCases: number;
    reconciledCases: number;
    capitalMovedMicros: 0;
  };
  corpus: {
    unit: "goal_market_feasibility_observation";
    coverage: "all_reported_goal_market_cases";
    captureReplays: 1;
    fixtureCount: 1;
    goalEvents: number;
    marketEventCases: number;
    movedBeforeTxlineCases: number;
    noMaterialRepriceCases: number;
    cleanStaleWindows: 0;
    commitment: string;
    assurance: "local_file_sha256_not_capture_manifest_membership";
    selectedExemplar: {
      caseId: string;
      policy: "earliest_pretrigger_match_result_then_largest_pretrigger_ask_move";
      detail: string;
    };
  };
  filterOptions: {
    fixtures: string[];
    marketFamilies: string[];
    detectors: string[];
    dispositions: string[];
    executionOutcomes: string[];
    evidenceLanes: string[];
    sources: string[];
  };
  cases: CasebookCaseSummary[];
  selectedCase: {
    summary: CasebookCaseSummary;
    match: MatchroomSnapshot["match"];
    decision: MatchroomSnapshot["decision"];
    lifecycle: DecisionStage[];
    evidenceReadout: {
      consensusMoveFromBaselineBps: number;
      bestBid: number;
      bestAsk: number;
      spread: number;
      preTriggerMarketMoveBps: number;
      movementConclusion: "Polymarket moved before TXLine";
    };
    analysis: {
      thesisStatus: "not_requested";
      thesisReason: string;
      invalidation: string;
      costStatus: "not_applicable";
      costMicros: 0;
      costReason: string;
    };
    evidence: EvidenceRow[];
    proof: MatchroomSnapshot["proof"];
  };
  nextEvidence: {
    status: "waiting_for_verified_capture";
    label: string;
    detail: string;
  };
  publicDataPolicy: PublicDataPolicy;
};

export type CasebookApiResponse = {
  data: CasebookSnapshot;
};

export type StudyCounts = {
  matches: number;
  signals: number;
  filledMatches: number;
  fills: number;
  settledFills: number;
};

export type StudyMatchRow = {
  fixtureId: string;
  kickoffUtc: string;
  selectedLine: number;
  signals: number;
  fills: number;
  fillRate: number;
  meanHalfSpreadBps: number | null;
  meanSlippageBps: number | null;
  grossClvBps: number | null;
  netClvBps: number | null;
  settlementPnlMicroUsd: number | null;
  netReturnBps: number | null;
};

export type StudyEndpoints = {
  meanNetClvBps: number;
  netClvInterval: { iterations: number; seed: number; matches: number; signals: number; low: number; median: number; high: number };
  meanSettlementPnlMicroUsd: number;
  settlementPnlInterval: { iterations: number; seed: number; matches: number; signals: number; low: number; median: number; high: number };
  noTradeBaselineClvBps: 0;
  randomDirectionControlClvBps: number;
  fractionSettledMatchesNetPositive: number;
};

export type StudyGuardrails = {
  fillRate: number;
  fillRatePassed: boolean;
  meanSlippageBps: number | null;
  slippagePassed: boolean;
  maxDrawdownMicroUsd: number;
  drawdownPassed: boolean;
  selectedDepthComplete: boolean;
  closeMarksComplete: boolean;
  settlementComplete: boolean;
};

export type CorrectedHistoricalCandidate = {
  schemaVersion: 4;
  generatedAt: string;
  protocolId: "historical-gate-causal-economic-v4-2026-07-14";
  configurationHash: string;
  status: "historical_signal_candidate_for_forward_paper_review";
  registration: "engineering_candidate_unregistered";
  activeStudy: false;
  detector: "CONSENSUS_MOVE";
  marketFamily: "Full-time totals";
  trainingNormalizedCases: 135;
  heldoutNormalizedCases: 38;
  heldoutFixtures: 18;
  costProxyBps: 100;
  meanNetAfterCostProxyBps: 132.7;
  matchClustered95Bps: {
    iterations: 10_000;
    cluster: "fixture";
    low: 14.3;
    high: 243.9;
  };
  evidenceClass: "historical_sampled_price_signal_research";
  executionEvidence: "not_established_no_historical_bid_ask_or_depth";
  executable: false;
  claimBoundary: "Forward paper review candidate only; not alpha, profitability, fill proof, or permission to trade.";
};

export type SyntheticProofReceipt = {
  label: "Synthetic full-lifecycle proving fixture";
  path: "/artifacts/dashboard/synthetic-decision-receipt.json";
  lifecycleStatus: "filled_settled";
  offlineVerified: true;
  performanceUse: "excluded_synthetic";
  externalCalls: 0;
  solanaAnchorStatus: "not_submitted";
  explanation: "Closed-world production-component demo; separate from historical evidence and excluded from every performance claim.";
};

export type StudySnapshot = {
  schemaVersion: 2;
  snapshotId: typeof STUDY_SNAPSHOT_ID;
  generatedAt: string;
  mode: "offline_artifact";
  executionMode: "paper";
  realMoneyGate: "closed";
  tradeable: false;
  protocol: {
    version: string;
    status: "invalidated_suspended";
    active: false;
    configHash: string;
    startedAt: string;
    candidate: {
      detector: "CONSENSUS_MOVE";
      marketFamily: "Full-time totals only";
      moveAbsZ: number;
      cusumThresholdBps: number;
      minimumGapBps: number;
      minimumUpdates: number;
      selector: "Closest to even";
      minimumCoveragePoints: number;
      maximumDistanceFromEven: number;
    };
    evaluation: {
      unitOfAnalysis: "match";
      primaryEndpoint: "Executable CLV net of measured costs";
      minimumFilledMatches: number;
      minimumFills: number;
      targetMatches: 30;
      bootstrapIterations: number;
      bootstrapSeed: number;
      randomDirectionControl: "Seeded matched-cost sign flip";
    };
    risk: {
      bankrollMicroUsd: number;
      perTradeStakeMicroUsd: number;
      aggregateExposureMicroUsd: number;
      drawdownStopMicroUsd: number;
    };
    guardrailThresholds: {
      minimumFillRate: number;
      maximumMeanSlippageBps: number;
      maximumDrawdownMicroUsd: number;
      selectedDepthRequired: true;
    };
  };
  lanes: {
    bounty: {
      label: "Preserved v1 bounty ledger";
      status: "exploratory";
      statusLabel: "Exploratory";
      reason: string;
      counts: StudyCounts;
      chain: { valid: true; rows: number; headHash: string };
      canSatisfyGate: false;
    };
    longRun: {
      label: "Preserved v1 long-run ledger";
      status: "sealed" | "accept" | "reject" | "inconclusive";
      statusLabel: string;
      reason: string;
      counts: StudyCounts;
      stoppingRuleMet: boolean;
      chain: { valid: true; rows: number; headHash: string };
      canSatisfyGate: false;
    };
  };
  results: {
    visibility: "sealed";
    rows: null;
    endpoints: null;
    guardrails: null;
  } | {
    visibility: "open";
    rows: StudyMatchRow[];
    endpoints: StudyEndpoints | null;
    guardrails: StudyGuardrails;
  };
  correctedHistoricalCandidate: CorrectedHistoricalCandidate;
  syntheticProof: SyntheticProofReceipt;
  fixtureUniverse: {
    generatedAt: string;
    evidenceFixtures: number;
    pairedBookReplays: number;
    executableBookReplays: number;
    signalResearchOnly: number;
    longRunEligible: number;
  };
  decisionRules: {
    accept: string[];
    reject: string[];
    inconclusive: string[];
  };
  publicDataPolicy: PublicDataPolicy;
};

export type StudyApiResponse = {
  data: StudySnapshot;
};
