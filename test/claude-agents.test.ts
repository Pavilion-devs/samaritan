import type {
  Message,
  MessageCreateParamsNonStreaming
} from "@anthropic-ai/sdk/resources/messages/messages";
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import {
  ClaudeAnalystAgent,
  CLAUDE_PROMPT_VERSION,
  ClaudeTriageAgent,
  type ClaudeInvocationEvidence,
  type ClaudeMessagesClient
} from "../src/agents/claude.js";
import { receiptAgentRunFromClaudeEvidence } from "../src/proof/claude-invocation-evidence.js";
import { CLAUDE_MODEL } from "../src/agents/claude-pricing.js";
import { ClaudeSpendLedger } from "../src/agents/claude-spend-ledger.js";
import type { TradeThesis } from "../src/agents/contracts.js";
import type { DetectorSignal } from "../src/detectors/types.js";

const nowTsMs = 1_000_000;

function signal(): DetectorSignal {
  return {
    signalId: "signal-claude-1",
    kind: "CONSENSUS_MOVE",
    detectedAtTsMs: nowTsMs - 1_000,
    observedAtTsMs: nowTsMs - 1_000,
    fixtureId: "fixture-1",
    market: {
      family: "total_goals",
      period: "full_time",
      lineMilli: 2_500,
      key: "fixture-1:total_goals:full_time:2500"
    },
    outcome: "over",
    direction: "buy",
    eligibility: "research_only",
    reason: "Frozen totals candidate",
    evidence: {
      consensusProbability: 0.55,
      polymarketProbability: 0.51,
      consensusVelocity: 0.02,
      consensusZScore: 1.2,
      polymarketVelocity: 0,
      polymarketZScore: 0,
      cusumUp: 0.001,
      cusumDown: 0,
      rawGap: 0.04,
      gapBasis: "live_book",
      persistenceMs: 5_000,
      mappingStatus: "verified",
      scoreContextActions: []
    }
  };
}

function thesis(overrides: Partial<TradeThesis> = {}): TradeThesis {
  return {
    schemaVersion: 1,
    signalId: signal().signalId,
    fixtureId: signal().fixtureId,
    marketKey: signal().market.key,
    outcome: signal().outcome,
    direction: signal().direction,
    recommendation: "paper_trade",
    fairProbability: 0.55,
    thesisSummary: "The executable total has not caught up to the consensus move.",
    evidenceFor: ["The move persisted while the live-book gap remained open."],
    steelmanAgainst: "The move may be noise or reverse before kickoff.",
    invalidationConditions: ["The executable ask reaches fair value."],
    submittedAtTsMs: nowTsMs,
    expiresAtTsMs: nowTsMs + 300_000,
    analystModel: CLAUDE_MODEL.analyst,
    ...overrides
  };
}

function message(input: {
  content: Message["content"];
  stopReason?: Message["stop_reason"];
  model?: string;
}): Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: input.model ?? CLAUDE_MODEL.triage,
    content: input.content,
    stop_reason: input.stopReason ?? "tool_use",
    stop_sequence: null,
    usage: {
      input_tokens: 100,
      output_tokens: 20,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation: null,
      inference_geo: null,
      output_tokens_details: null,
      service_tier: "standard"
    }
  } as Message;
}

function clientReturning(response: Message): {
  client: ClaudeMessagesClient;
  create: ReturnType<typeof vi.fn>;
} {
  const create = vi.fn(async (_params: MessageCreateParamsNonStreaming) => response);
  return { client: { create }, create };
}

describe("bounded Claude agents", () => {
  it("forwards a runtime halt to an in-flight Claude request and settles its reservation", async () => {
    const ledger = new ClaudeSpendLedger(":memory:");
    const controller = new AbortController();
    const create = vi.fn((_params: MessageCreateParamsNonStreaming, options?: { signal?: AbortSignal }) =>
      new Promise<Message>((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
      })
    );
    const agent = new ClaudeTriageAgent({
      client: { create },
      spendLedger: ledger,
      requestId: () => "request-aborted-in-flight"
    });

    const pending = agent.triage({
      caseId: "case-aborted-in-flight",
      signal: signal(),
      haltSignal: controller.signal
    });
    await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(create.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
    controller.abort(new Error("operator halt"));

    await expect(pending).rejects.toThrow(/Claude request failed/);
    expect(ledger.summary()).toMatchObject({ outstandingReservedNanoUsd: 0 });
    expect(ledger.verifyChain()).toMatchObject({ valid: true, rows: 2 });
    ledger.close();
  });

  it("forces Haiku through one strict triage submission tool", async () => {
    const ledger = new ClaudeSpendLedger(":memory:");
    const fake = clientReturning(message({
      content: [{
        type: "tool_use",
        id: "tool-1",
        name: "submit_triage",
        input: { decision: "escalate", priority: "normal", rationale: "Coherent executable gap." },
        caller: { type: "direct" }
      }]
    }));
    const agent = new ClaudeTriageAgent({
      client: fake.client,
      spendLedger: ledger,
      requestId: () => "request-triage-1"
    });

    await expect(agent.triage({ caseId: "case-1", signal: signal() })).resolves.toEqual({
      decision: "escalate",
      priority: "normal",
      rationale: "Coherent executable gap."
    });
    const params = fake.create.mock.calls[0]?.[0] as MessageCreateParamsNonStreaming;
    expect(params.model).toBe(CLAUDE_MODEL.triage);
    expect(params.tool_choice).toEqual({
      type: "tool",
      name: "submit_triage",
      disable_parallel_tool_use: true
    });
    expect(params.tools?.[0]).toMatchObject({ name: "submit_triage", strict: true });
    expect(ledger.summary()).toMatchObject({
      actualCostNanoUsd: 200_000,
      outstandingReservedNanoUsd: 0
    });
    expect(ledger.verifyChain()).toMatchObject({ valid: true, rows: 2 });
    ledger.close();
  });

  it("emits hash-only evidence and refuses injected-client receipt claims", async () => {
    const ledger = new ClaudeSpendLedger(":memory:");
    const captured: ClaudeInvocationEvidence[] = [];
    const fake = clientReturning(message({
      content: [{
        type: "tool_use",
        id: "tool-evidence",
        name: "submit_triage",
        input: { decision: "escalate", priority: "normal", rationale: "Review the live-book gap." },
        caller: { type: "direct" }
      }]
    }));
    const agent = new ClaudeTriageAgent({
      client: fake.client,
      spendLedger: ledger,
      requestId: () => "private-request-id",
      evidenceSink: (evidence) => { captured.push(evidence); }
    });

    await agent.triage({ caseId: "case-evidence", signal: signal() });

    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      caseId: "case-evidence",
      stage: "triage",
      invocationClass: "injected_client",
      model: CLAUDE_MODEL.triage,
      promptVersion: CLAUDE_PROMPT_VERSION.triage,
      actualCostNanoUsd: 200_000
    });
    for (const hash of [
      captured[0]!.promptSha256,
      captured[0]!.responseSha256,
      captured[0]!.billingEvidenceSha256
    ]) expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(captured[0])).not.toContain("private-request-id");
    expect(JSON.stringify(captured[0])).not.toContain("Review the live-book gap.");
    expect(() => receiptAgentRunFromClaudeEvidence(captured[0]!, "case-evidence"))
      .toThrow(/Injected Claude clients/);
    expect(() => receiptAgentRunFromClaudeEvidence({
      ...captured[0]!,
      invocationClass: "anthropic_api"
    }, "different-case")).toThrow(/different decision case/);
    expect(() => receiptAgentRunFromClaudeEvidence({
      ...captured[0]!,
      invocationClass: "anthropic_api"
    }, "case-evidence")).toThrow(/reference generated after local hash-chain verification/);
    ledger.close();
  });

  it.each([
    {
      name: "text instead of a tool",
      response: message({ content: [{ type: "text", text: "escalate", citations: null }], stopReason: "end_turn" })
    },
    {
      name: "duplicate tool calls",
      response: message({ content: [
        { type: "tool_use", id: "tool-1", name: "submit_triage", input: { decision: "drop", priority: "low", rationale: "Noise." }, caller: { type: "direct" } },
        { type: "tool_use", id: "tool-2", name: "submit_triage", input: { decision: "escalate", priority: "high", rationale: "Maybe." }, caller: { type: "direct" } }
      ] })
    },
    {
      name: "token truncation",
      response: message({ content: [], stopReason: "max_tokens" })
    }
  ])("fails closed on $name", async ({ response }) => {
    const ledger = new ClaudeSpendLedger(":memory:");
    const fake = clientReturning(response);
    const agent = new ClaudeTriageAgent({
      client: fake.client,
      spendLedger: ledger,
      requestId: () => "request-invalid"
    });
    await expect(agent.triage({ caseId: "case-1", signal: signal() })).rejects.toThrow();
    expect(ledger.summary()).toMatchObject({
      actualCostNanoUsd: 200_000,
      outstandingReservedNanoUsd: 0
    });
    expect(ledger.verifyChain()).toMatchObject({ valid: true, rows: 2 });
    ledger.close();
  });

  it("fails closed when the provider returns a different model identity", async () => {
    const ledger = new ClaudeSpendLedger(":memory:");
    const captured: ClaudeInvocationEvidence[] = [];
    const fake = clientReturning(message({
      model: CLAUDE_MODEL.analyst,
      content: [{
        type: "tool_use",
        id: "tool-wrong-model",
        name: "submit_triage",
        input: { decision: "drop", priority: "low", rationale: "Wrong model response." },
        caller: { type: "direct" }
      }]
    }));
    const agent = new ClaudeTriageAgent({
      client: fake.client,
      spendLedger: ledger,
      requestId: () => "request-wrong-model",
      evidenceSink: (evidence) => { captured.push(evidence); }
    });

    await expect(agent.triage({ caseId: "case-1", signal: signal() }))
      .rejects.toThrow(/response model mismatch/);
    expect(captured).toEqual([]);
    expect(ledger.summary()).toMatchObject({
      actualCostNanoUsd: 200_000,
      outstandingReservedNanoUsd: 0
    });
    ledger.close();
  });

  it("uses Opus adaptive thinking but accepts only submit_thesis", async () => {
    const ledger = new ClaudeSpendLedger(":memory:");
    const fake = clientReturning(message({
      model: CLAUDE_MODEL.analyst,
      content: [
        { type: "thinking", thinking: "", signature: "signature" },
        { type: "tool_use", id: "tool-thesis", name: "submit_thesis", input: thesis(), caller: { type: "direct" } }
      ]
    }));
    const agent = new ClaudeAnalystAgent({
      client: fake.client,
      spendLedger: ledger,
      requestId: () => "request-analyst-1"
    });

    await expect(agent.investigate({
      caseId: "case-1",
      signal: signal(),
      asOfTsMs: nowTsMs,
      triage: { decision: "escalate", priority: "normal", rationale: "Review it." }
    })).resolves.toEqual(thesis());
    const params = fake.create.mock.calls[0]?.[0] as MessageCreateParamsNonStreaming;
    expect(params).toMatchObject({
      model: CLAUDE_MODEL.analyst,
      thinking: { type: "adaptive", display: "omitted" },
      output_config: { effort: "medium" },
      tool_choice: { type: "auto", disable_parallel_tool_use: true }
    });
    expect(JSON.stringify(params.tools?.[0])).not.toMatch(/"minimum"|"maximum"|"minLength"|"maxLength"/);
    ledger.close();
  });

  it("rejects analyst attempts to add sizing fields", async () => {
    const ledger = new ClaudeSpendLedger(":memory:");
    const fake = clientReturning(message({
      model: CLAUDE_MODEL.analyst,
      content: [{
        type: "tool_use",
        id: "tool-thesis",
        name: "submit_thesis",
        input: { ...thesis(), stakeMicroUsd: 3_000_000 },
        caller: { type: "direct" }
      }]
    }));
    const agent = new ClaudeAnalystAgent({
      client: fake.client,
      spendLedger: ledger,
      requestId: () => "request-analyst-invalid"
    });
    await expect(agent.investigate({
      caseId: "case-1",
      signal: signal(),
      asOfTsMs: nowTsMs,
      triage: { decision: "escalate", priority: "normal", rationale: "Review it." }
    })).rejects.toThrow();
    ledger.close();
  });

  it("charges the full reservation when billing is unknown after a client failure", async () => {
    const ledger = new ClaudeSpendLedger(":memory:");
    const client: ClaudeMessagesClient = {
      create: vi.fn(async () => { throw new Error("network details must not escape"); })
    };
    const agent = new ClaudeTriageAgent({
      client,
      spendLedger: ledger,
      requestId: () => "request-network-failure"
    });
    await expect(agent.triage({ caseId: "case-1", signal: signal() })).rejects.toThrow(
      "triage Claude request failed"
    );
    const summary = ledger.summary();
    expect(summary.actualCostNanoUsd).toBeGreaterThan(0);
    expect(summary.outstandingReservedNanoUsd).toBe(0);
    ledger.close();
  });

  it("settles a rejected API request at zero without exposing credentials", async () => {
    const ledger = new ClaudeSpendLedger(":memory:");
    const client: ClaudeMessagesClient = {
      create: vi.fn(async () => {
        throw Anthropic.APIError.generate(
          400,
          { type: "error", error: { type: "invalid_request_error", message: "bad sk-ant-secret" } },
          "bad sk-ant-secret",
          new Headers()
        );
      })
    };
    const agent = new ClaudeTriageAgent({
      client,
      spendLedger: ledger,
      requestId: () => "request-rejected"
    });
    const rejection = agent.triage({ caseId: "case-1", signal: signal() });
    await expect(rejection).rejects.toThrow(/\[redacted\]/);
    await expect(rejection).rejects.not.toThrow(/sk-ant-secret/);
    expect(ledger.summary()).toMatchObject({
      actualCostNanoUsd: 0,
      outstandingReservedNanoUsd: 0
    });
    ledger.close();
  });

  it("rejects at the hard ceiling before calling Anthropic", async () => {
    const ledger = new ClaudeSpendLedger(":memory:", 1);
    const create = vi.fn(async () => message({ content: [] }));
    const agent = new ClaudeTriageAgent({
      client: { create },
      spendLedger: ledger,
      requestId: () => "request-over-budget"
    });
    await expect(agent.triage({ caseId: "case-1", signal: signal() })).rejects.toThrow(
      /hard spend ceiling/
    );
    expect(create).not.toHaveBeenCalled();
    expect(ledger.verifyChain()).toMatchObject({ valid: true, rows: 0 });
    ledger.close();
  });
});
