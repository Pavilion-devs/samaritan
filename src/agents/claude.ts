import { createHash, randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import type { APIError } from "@anthropic-ai/sdk/core/error";
import type {
  Message,
  MessageCreateParamsNonStreaming,
  Tool
} from "@anthropic-ai/sdk/resources/messages/messages";
import { transformJSONSchema } from "@anthropic-ai/sdk/lib/transform-json-schema";
import { z, type ZodType } from "zod";
import { stableJson } from "../domain/json.js";
import {
  tradeThesisSchema,
  triageDecisionSchema,
  type AnalystAgent,
  type TriageAgent
} from "./contracts.js";
import {
  CLAUDE_MODEL,
  claudeUsageCostNanoUsd,
  claudeWorstCaseCostNanoUsd,
  type ClaudeModel,
  type ClaudeUsage
} from "./claude-pricing.js";
import { ClaudeSpendLedger, type ClaudeStage } from "./claude-spend-ledger.js";

export const CLAUDE_PROMPT_VERSION = {
  triage: "triage-v1",
  analyst: "analyst-v1"
} as const;

const TRIAGE_SYSTEM = `You are Samaritan's bounded signal triage component.
Classify only the supplied deterministic detector signal. Escalate only when the evidence is coherent enough for analyst review.
You cannot trade, size a position, construct an order, change detector eligibility, or override risk rules.
Your entire response must be one submit_triage tool call.`;

const ANALYST_SYSTEM = `You are Samaritan's bounded sports-market analyst.
Judge only the supplied detector signal and evidence. Steelman the opposing case and state concrete invalidation conditions.
You cannot size a position, construct or place an order, access a wallet, authenticate to a venue, or override deterministic risk rules.
The recommendation is paper-only. Your only valid exit is one submit_thesis tool call. Never answer in prose.`;

type RequestOptions = {
  timeout?: number;
  maxRetries?: number;
  signal?: AbortSignal;
  idempotencyKey?: string;
};

export type ClaudeMessagesClient = {
  create(params: MessageCreateParamsNonStreaming, options?: RequestOptions): Promise<Message>;
};

const anthropicApiClients = new WeakSet<object>();

export function createAnthropicMessagesClient(apiKey: string): ClaudeMessagesClient {
  if (apiKey.length === 0) throw new Error("ANTHROPIC_API_KEY is required");
  const client = new Anthropic({ apiKey });
  const messagesClient: ClaudeMessagesClient = Object.freeze({
    create: (params, options) => client.messages.create(params, options)
  });
  anthropicApiClients.add(messagesClient);
  return messagesClient;
}

export function isAnthropicApiMessagesClient(client: ClaudeMessagesClient): boolean {
  return anthropicApiClients.has(client);
}

export type ClaudeInvocationEvidence = {
  caseId: string;
  stage: "triage" | "analyst";
  invocationClass: "anthropic_api" | "injected_client";
  model: ClaudeModel;
  promptVersion: string;
  promptSha256: string;
  responseSha256: string;
  billingEvidenceSha256: string;
  usage: ClaudeUsage;
  actualCostNanoUsd: number;
};

export type ClaudeEvidenceSink = (
  evidence: ClaudeInvocationEvidence
) => void | Promise<void>;

type AdapterConfig = {
  client: ClaudeMessagesClient;
  spendLedger: ClaudeSpendLedger;
  requestId?: () => string;
  evidenceSink?: ClaudeEvidenceSink;
};

type Invocation = {
  caseId: string;
  stage: Extract<ClaudeStage, "triage" | "analyst">;
  model: ClaudeModel;
  promptVersion: string;
  toolName: string;
  schema: ZodType;
  maximumInputTokens: number;
  maximumOutputTokens: number;
  timeoutMs: number;
  haltSignal?: AbortSignal;
  params: MessageCreateParamsNonStreaming;
};

function tool(name: string, description: string, schema: ZodType): Tool {
  const jsonSchema = transformJSONSchema(z.toJSONSchema(schema));
  if (jsonSchema.type !== "object") throw new Error(`Tool schema ${name} must be an object`);
  return {
    name,
    description,
    input_schema: jsonSchema as Tool.InputSchema,
    strict: true
  };
}

function usage(message: Message): ClaudeUsage {
  return {
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    cacheCreationInputTokens: message.usage.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: message.usage.cache_read_input_tokens ?? 0
  };
}

function responseToolInput(message: Message, expectedToolName: string): unknown {
  if (message.stop_reason !== "tool_use") {
    throw new Error(`Claude response stopped with ${message.stop_reason ?? "no stop reason"}`);
  }
  const toolUses = message.content.filter((block) => block.type === "tool_use");
  if (toolUses.length !== 1 || toolUses[0]?.name !== expectedToolName) {
    throw new Error(`Claude response must contain exactly one ${expectedToolName} call`);
  }
  const unexpected = message.content.filter((block) =>
    block.type !== "tool_use" && block.type !== "thinking" && block.type !== "redacted_thinking"
  );
  if (unexpected.length > 0) throw new Error("Claude response contained content outside the submission tool");
  return toolUses[0].input;
}

function safeApiError(error: APIError): string {
  const detail = error.message
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/\s+/g, " ")
    .slice(0, 500);
  return `${error.status ?? "unknown"} ${error.type ?? error.name}: ${detail}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export class BoundedClaudeInvoker {
  readonly #client: ClaudeMessagesClient;
  readonly #spendLedger: ClaudeSpendLedger;
  readonly #requestId: () => string;
  readonly #evidenceSink: ClaudeEvidenceSink | undefined;
  readonly #invocationClass: ClaudeInvocationEvidence["invocationClass"];

  constructor(config: AdapterConfig) {
    this.#client = config.client;
    this.#spendLedger = config.spendLedger;
    this.#requestId = config.requestId ?? randomUUID;
    this.#evidenceSink = config.evidenceSink;
    this.#invocationClass = anthropicApiClients.has(config.client)
      ? "anthropic_api"
      : "injected_client";
  }

  async invoke(input: Invocation): Promise<unknown> {
    input.haltSignal?.throwIfAborted();
    const requestId = this.#requestId();
    // UTF-8 bytes are a deliberately loose token upper bound. The fixed allowance
    // covers Anthropic's hidden tool-use prompt and request framing.
    const maximumInputTokens = Buffer.byteLength(stableJson(input.params), "utf8") + 4_096;
    if (maximumInputTokens > input.maximumInputTokens) {
      throw new Error(`${input.stage} Claude request exceeds its input bound`);
    }
    const maximumCostNanoUsd = claudeWorstCaseCostNanoUsd({
      model: input.model,
      maximumInputTokens,
      maximumOutputTokens: input.maximumOutputTokens
    });
    this.#spendLedger.reserve({
      requestId,
      caseId: input.caseId,
      stage: input.stage,
      model: input.model,
      maximumCostNanoUsd
    });

    let message: Message;
    try {
      message = await this.#client.create(input.params, {
        timeout: input.timeoutMs,
        maxRetries: 1,
        ...(input.haltSignal === undefined ? {} : { signal: input.haltSignal }),
        idempotencyKey: requestId
      });
    } catch (error) {
      if (error instanceof Anthropic.APIError && error.status !== undefined && error.status < 500) {
        this.#spendLedger.settle({ requestId, status: "request_rejected" });
        throw new Error(`${input.stage} Claude request rejected (${safeApiError(error)})`);
      }
      this.#spendLedger.settle({ requestId, status: "billing_unknown" });
      throw new Error(`${input.stage} Claude request failed`);
    }

    const measuredUsage = usage(message);
    let parsed: unknown;
    try {
      if (message.model !== input.model) {
        throw new Error(
          `${input.stage} Claude response model mismatch: expected ${input.model}, received ${message.model}`
        );
      }
      const toolInput = responseToolInput(message, input.toolName);
      parsed = input.schema.parse(toolInput);
    } catch (error) {
      this.#spendLedger.settle({ requestId, status: "response_invalid", usage: measuredUsage });
      throw error;
    }
    this.#spendLedger.settle({ requestId, status: "success", usage: measuredUsage });
    if (this.#evidenceSink) {
      const actualCostNanoUsd = claudeUsageCostNanoUsd(input.model, measuredUsage);
      const requestIdSha256 = sha256(requestId);
      const promptSha256 = sha256(`samaritan.claude.prompt/v1\n${stableJson(input.params)}`);
      const responseSha256 = sha256(`samaritan.claude.response/v1\n${stableJson(parsed)}`);
      await this.#evidenceSink({
        caseId: input.caseId,
        stage: input.stage,
        invocationClass: this.#invocationClass,
        model: input.model,
        promptVersion: input.promptVersion,
        promptSha256,
        responseSha256,
        billingEvidenceSha256: sha256(`samaritan.claude.billing-evidence/v1\n${stableJson({
          requestIdSha256,
          providerMessageIdSha256: sha256(message.id),
          caseId: input.caseId,
          stage: input.stage,
          invocationClass: this.#invocationClass,
          model: input.model,
          responseModel: message.model,
          promptSha256,
          responseSha256,
          status: "success",
          usage: measuredUsage,
          actualCostNanoUsd
        })}`),
        usage: measuredUsage,
        actualCostNanoUsd
      });
    }
    return parsed;
  }
}

export class ClaudeTriageAgent implements TriageAgent {
  readonly #invoker: BoundedClaudeInvoker;

  constructor(config: AdapterConfig) {
    this.#invoker = new BoundedClaudeInvoker(config);
  }

  triage(input: Parameters<TriageAgent["triage"]>[0]): Promise<unknown> {
    const submissionTool = tool(
      "submit_triage",
      "Submit the bounded drop-or-escalate classification. This does not execute or authorize a trade.",
      triageDecisionSchema
    );
    const params: MessageCreateParamsNonStreaming = {
      model: CLAUDE_MODEL.triage,
      max_tokens: 512,
      cache_control: { type: "ephemeral" },
      system: TRIAGE_SYSTEM,
      messages: [{
        role: "user",
        content: stableJson({
          promptVersion: CLAUDE_PROMPT_VERSION.triage,
          caseId: input.caseId,
          signal: input.signal
        })
      }],
      tools: [submissionTool],
      tool_choice: {
        type: "tool",
        name: submissionTool.name,
        disable_parallel_tool_use: true
      }
    };
    return this.#invoker.invoke({
      caseId: input.caseId,
      stage: "triage",
      model: CLAUDE_MODEL.triage,
      promptVersion: CLAUDE_PROMPT_VERSION.triage,
      toolName: submissionTool.name,
      schema: triageDecisionSchema,
      maximumInputTokens: 16_000,
      maximumOutputTokens: params.max_tokens,
      timeoutMs: 60_000,
      ...(input.haltSignal === undefined ? {} : { haltSignal: input.haltSignal }),
      params
    });
  }
}

export class ClaudeAnalystAgent implements AnalystAgent {
  readonly #invoker: BoundedClaudeInvoker;

  constructor(config: AdapterConfig) {
    this.#invoker = new BoundedClaudeInvoker(config);
  }

  async investigate(input: Parameters<AnalystAgent["investigate"]>[0]): Promise<unknown> {
    const nowTsMs = input.asOfTsMs;
    if (!Number.isSafeInteger(nowTsMs) || nowTsMs < input.signal.observedAtTsMs) {
      throw new Error("Claude analyst as-of timestamp is invalid");
    }
    const boundedThesisSchema = tradeThesisSchema.superRefine((thesis, context) => {
      if (thesis.analystModel !== CLAUDE_MODEL.analyst) {
        context.addIssue({
          code: "custom",
          message: "Unexpected analyst model identity",
          path: ["analystModel"]
        });
      }
      if (thesis.submittedAtTsMs < nowTsMs || thesis.expiresAtTsMs > nowTsMs + 15 * 60_000) {
        context.addIssue({
          code: "custom",
          message: "Thesis timestamps are outside the bounded analysis window",
          path: ["submittedAtTsMs"]
        });
      }
    });
    const submissionTool = tool(
      "submit_thesis",
      "Submit the final paper-only thesis. Never include stake, order, wallet, authentication, or execution fields.",
      boundedThesisSchema
    );
    const params: MessageCreateParamsNonStreaming = {
      model: CLAUDE_MODEL.analyst,
      max_tokens: 8_192,
      cache_control: { type: "ephemeral" },
      thinking: { type: "adaptive", display: "omitted" },
      output_config: { effort: "medium" },
      system: ANALYST_SYSTEM,
      messages: [{
        role: "user",
        content: stableJson({
          promptVersion: CLAUDE_PROMPT_VERSION.analyst,
          caseId: input.caseId,
          nowTsMs,
          maximumExpiryTsMs: nowTsMs + 15 * 60_000,
          requiredAnalystModel: CLAUDE_MODEL.analyst,
          triage: input.triage,
          signal: input.signal
        })
      }],
      tools: [submissionTool],
      tool_choice: {
        type: "auto",
        disable_parallel_tool_use: true
      }
    };
    return this.#invoker.invoke({
      caseId: input.caseId,
      stage: "analyst",
      model: CLAUDE_MODEL.analyst,
      promptVersion: CLAUDE_PROMPT_VERSION.analyst,
      toolName: submissionTool.name,
      schema: boundedThesisSchema,
      maximumInputTokens: 64_000,
      maximumOutputTokens: params.max_tokens,
      timeoutMs: 180_000,
      ...(input.haltSignal === undefined ? {} : { haltSignal: input.haltSignal }),
      params
    });
  }
}
