export const CLAUDE_MODEL = {
  triage: "claude-haiku-4-5",
  analyst: "claude-opus-4-8"
} as const;

export type ClaudeModel = (typeof CLAUDE_MODEL)[keyof typeof CLAUDE_MODEL];

export type ClaudePricing = {
  inputNanoUsdPerToken: number;
  outputNanoUsdPerToken: number;
  cacheWriteNanoUsdPerToken: number;
  cacheReadNanoUsdPerToken: number;
};

// Anthropic API pricing verified 2026-07-12. Nano-USD keeps fractional
// micro-dollar cache rates exact while all spend arithmetic remains integer.
export const CLAUDE_PRICING: Record<ClaudeModel, ClaudePricing> = {
  "claude-haiku-4-5": {
    inputNanoUsdPerToken: 1_000,
    outputNanoUsdPerToken: 5_000,
    cacheWriteNanoUsdPerToken: 1_250,
    cacheReadNanoUsdPerToken: 100
  },
  "claude-opus-4-8": {
    inputNanoUsdPerToken: 5_000,
    outputNanoUsdPerToken: 25_000,
    cacheWriteNanoUsdPerToken: 6_250,
    cacheReadNanoUsdPerToken: 500
  }
};

export const CLAUDE_OPERATING_TARGET_NANO_USD = 200_000_000_000;
export const CLAUDE_HARD_CEILING_NANO_USD = 300_000_000_000;

export type ClaudeUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
};

export function claudeUsageCostNanoUsd(model: ClaudeModel, usage: ClaudeUsage): number {
  const pricing = CLAUDE_PRICING[model];
  return (
    usage.inputTokens * pricing.inputNanoUsdPerToken +
    usage.outputTokens * pricing.outputNanoUsdPerToken +
    usage.cacheCreationInputTokens * pricing.cacheWriteNanoUsdPerToken +
    usage.cacheReadInputTokens * pricing.cacheReadNanoUsdPerToken
  );
}

export function claudeWorstCaseCostNanoUsd(input: {
  model: ClaudeModel;
  maximumInputTokens: number;
  maximumOutputTokens: number;
}): number {
  const pricing = CLAUDE_PRICING[input.model];
  return (
    input.maximumInputTokens * Math.max(
      pricing.inputNanoUsdPerToken,
      pricing.cacheWriteNanoUsdPerToken
    ) + input.maximumOutputTokens * pricing.outputNanoUsdPerToken
  );
}
