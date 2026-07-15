import {
  ClaudeAnalystAgent,
  ClaudeTriageAgent,
  createAnthropicMessagesClient,
  isAnthropicApiMessagesClient,
  type ClaudeEvidenceSink,
  type ClaudeMessagesClient
} from "../agents/claude.js";
import {
  ClaudeInvocationEvidenceLedger,
  type ClaudeInvocationEvidenceChainVerification
} from "../agents/claude-evidence-ledger.js";
import { CLAUDE_HARD_CEILING_NANO_USD } from "../agents/claude-pricing.js";
import { ClaudeSpendLedger } from "../agents/claude-spend-ledger.js";
import type { AnalystAgent, TriageAgent } from "../agents/contracts.js";
import {
  receiptAgentRunsFromClaudeEvidenceLedger
} from "../proof/claude-invocation-evidence.js";
import type { ReceiptAgentRun } from "../proof/decision-receipt-schema.js";
import type { DecisionLedger } from "../store/decision-ledger.js";
import {
  applyPaperFixtureAdmission,
  createPersistentPaperLaneRuntime,
  planPaperFixtureAdmission,
  type PersistentPaperLaneRuntime
} from "./paper-lane-runtime.js";
import type { PaperFixtureUniverse } from "./paper-fixture-universe.js";
import type { PolymarketFeeResolver } from "./paper-scheduler.js";
import type { PaperStudyInitialization } from "./paper-study-ledger.js";

type ClaudeSource = {
  apiKey?: string;
  client?: ClaudeMessagesClient;
};

type LaneResources = {
  initialization: PaperStudyInitialization;
  ledger: DecisionLedger;
};

export type PersistentClaudePaperStudy = {
  agents: {
    triage: TriageAgent;
    analyst: AnalystAgent;
  };
  spendLedger: ClaudeSpendLedger;
  invocationEvidence: {
    verifyChain(): ClaudeInvocationEvidenceChainVerification;
    receiptAgentRuns(caseId: string): ReceiptAgentRun[];
  } | null;
  bounty: PersistentPaperLaneRuntime;
  longRun: PersistentPaperLaneRuntime;
  admitUniverse(universe: PaperFixtureUniverse): {
    bounty: string[];
    longRun: string[];
  };
};

function messageClient(source: ClaudeSource): ClaudeMessagesClient {
  const hasApiKey = source.apiKey !== undefined;
  const hasClient = source.client !== undefined;
  if (hasApiKey === hasClient) {
    throw new Error("Claude paper study requires exactly one API key or injected Messages client");
  }
  return source.client ?? createAnthropicMessagesClient(source.apiKey!);
}

export function createPersistentClaudePaperStudy(input: ClaudeSource & {
  spendLedger: ClaudeSpendLedger;
  bounty: LaneResources;
  longRun: LaneResources;
  universe: PaperFixtureUniverse;
  feeResolver: PolymarketFeeResolver;
  /** Required durable sink for Anthropic API-backed studies. */
  evidenceLedger?: ClaudeInvocationEvidenceLedger;
  /** Lightweight observation seam for injected clients and tests only. */
  evidenceSink?: ClaudeEvidenceSink;
  minimumDecisionLatencyMs?: number;
  maximumPendingMs: number;
}): PersistentClaudePaperStudy {
  if (input.bounty.initialization.protocolStatus !== input.longRun.initialization.protocolStatus) {
    throw new Error("Paper study lanes have different protocol registration states");
  }
  const usesAnthropicApi = input.apiKey !== undefined || (
    input.client !== undefined && isAnthropicApiMessagesClient(input.client)
  );
  if (
    usesAnthropicApi &&
    input.bounty.initialization.protocolStatus !== ("registered" as string)
  ) {
    throw new Error(
      `Anthropic API use is disabled for ${input.bounty.initialization.protocolStatus} paper protocols`
    );
  }
  if (input.evidenceLedger !== undefined && input.evidenceSink !== undefined) {
    throw new Error("Claude paper study invocation evidence has multiple sinks");
  }
  if (usesAnthropicApi && input.evidenceLedger === undefined) {
    throw new Error("Anthropic API use requires an opened persistent invocation-evidence ledger");
  }
  if (input.evidenceLedger !== undefined) {
    // Construction fails on a closed or tampered store before a client exists
    // or any fixture can be admitted.
    input.evidenceLedger.verifyChain();
  }
  if (input.spendLedger.hardCeilingNanoUsd > CLAUDE_HARD_CEILING_NANO_USD) {
    throw new Error("Claude paper study spend ceiling exceeds the locked project maximum");
  }
  if (input.bounty.ledger === input.longRun.ledger) {
    throw new Error("Bounty and long-run paper studies require separate decision ledgers");
  }
  if (input.universe.laneStartTsMs !== input.longRun.initialization.startedAtTsMs) {
    throw new Error("Paper fixture universe does not match the long-run ledger start");
  }
  const client = messageClient(input);
  const evidenceSink: ClaudeEvidenceSink | undefined = input.evidenceLedger === undefined
    ? input.evidenceSink
    : (evidence) => { input.evidenceLedger!.append(evidence); };
  const evidenceConfig = evidenceSink === undefined
    ? {}
    : { evidenceSink };
  const agents = {
    triage: new ClaudeTriageAgent({ client, spendLedger: input.spendLedger, ...evidenceConfig }),
    analyst: new ClaudeAnalystAgent({ client, spendLedger: input.spendLedger, ...evidenceConfig })
  };
  const common = {
    universe: input.universe,
    triageAgent: agents.triage,
    analystAgent: agents.analyst,
    feeResolver: input.feeResolver,
    executionLatencyMs: input.minimumDecisionLatencyMs ?? 1,
    maximumPendingMs: input.maximumPendingMs,
    processingNow: Date.now
  };
  const bounty = createPersistentPaperLaneRuntime({
    lane: "bounty",
    initialization: input.bounty.initialization,
    ledger: input.bounty.ledger,
    ...common
  });
  const longRun = createPersistentPaperLaneRuntime({
    lane: "long_run",
    initialization: input.longRun.initialization,
    ledger: input.longRun.ledger,
    ...common
  });
  return {
    agents,
    spendLedger: input.spendLedger,
    invocationEvidence: input.evidenceLedger === undefined ? null : {
      verifyChain: () => input.evidenceLedger!.verifyChain(),
      receiptAgentRuns: (caseId) => receiptAgentRunsFromClaudeEvidenceLedger(
        input.evidenceLedger!,
        caseId
      )
    },
    bounty,
    longRun,
    admitUniverse: (universe) => {
      const bountyPlan = planPaperFixtureAdmission(bounty, universe);
      const longRunPlan = planPaperFixtureAdmission(longRun, universe);
      return {
        bounty: applyPaperFixtureAdmission(bounty, bountyPlan),
        longRun: applyPaperFixtureAdmission(longRun, longRunPlan)
      };
    }
  };
}
