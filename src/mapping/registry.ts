import { createHash } from "node:crypto";
import { z } from "zod";
import {
  marketKey,
  type CanonicalMarket,
  type CanonicalOutcome,
  type MappingStatus
} from "../bus/events.js";

const outcomeSchema = z.enum(["home", "draw", "away", "over", "under"]);
const familySchema = z.enum(["match_result", "total_goals"]);
const periodSchema = z.enum(["full_time", "first_half", "extra_time", "other"]);

const tokenSchema = z.object({
  assetId: z.string().min(1),
  outcome: outcomeSchema,
  role: z.enum(["canonical", "complement"])
});

const conditionSchema = z.object({
  polymarketMarketId: z.string().min(1),
  conditionId: z.string().min(1),
  family: familySchema,
  period: periodSchema,
  lineMilli: z.number().int().nullable(),
  rulesText: z.string().min(1),
  rulesSha256: z.string().regex(/^[a-f0-9]{64}$/),
  tokens: z.array(tokenSchema).min(1),
  evidence: z
    .object({
      polymarketQuestion: z.string().min(1),
      txlineMarketType: z.enum(["1X2_PARTICIPANT_RESULT", "OVERUNDER_PARTICIPANT_GOALS"]),
      txlineMarketObserved: z.literal(true)
    })
    .optional()
});

const mappingSchema = z
  .object({
    mappingId: z.string().min(1),
    status: z.enum(["candidate", "verified", "rejected"]),
    txlineFixtureId: z.string().min(1),
    teams: z.object({
      home: z.object({ canonical: z.string().min(1), aliases: z.array(z.string()) }),
      away: z.object({ canonical: z.string().min(1), aliases: z.array(z.string()) })
    }),
    kickoff: z.object({
      txlineTsMs: z.number().int().nonnegative(),
      polymarketTsMs: z.number().int().nonnegative()
    }),
    polymarketEventId: z.string().min(1),
    polymarketEventSlug: z.string().min(1),
    conditions: z.array(conditionSchema).min(1),
    evidence: z
      .object({
        confidence: z.enum(["high", "medium"]),
        kickoffDifferenceSeconds: z.number().int(),
        reason: z.string().min(1),
        sourcePaths: z.array(z.string().min(1)).min(1)
      })
      .optional(),
    review: z
      .object({
        settlementVerified: z.literal(true),
        reviewedBy: z.literal("Deborah"),
        reviewedAt: z.string().datetime()
      })
      .optional()
  })
  .superRefine((mapping, context) => {
    if (mapping.status === "verified" && mapping.review === undefined) {
      context.addIssue({
        code: "custom",
        message: "A verified mapping requires an explicit human settlement review",
        path: ["review"]
      });
    }
    for (const [index, condition] of mapping.conditions.entries()) {
      if (sha256(condition.rulesText) !== condition.rulesSha256) {
        context.addIssue({
          code: "custom",
          message: "rulesSha256 does not match the full rulesText",
          path: ["conditions", index, "rulesSha256"]
        });
      }
      if (condition.family === "match_result" && condition.lineMilli !== null) {
        context.addIssue({
          code: "custom",
          message: "Match Result cannot carry a totals line",
          path: ["conditions", index, "lineMilli"]
        });
      }
      if (condition.family === "total_goals" && condition.lineMilli === null) {
        context.addIssue({
          code: "custom",
          message: "Total goals requires an exact lineMilli",
          path: ["conditions", index, "lineMilli"]
        });
      }
    }
  });

export type MappingRecord = z.infer<typeof mappingSchema>;
export type MappedAsset = {
  mappingId: string;
  mappingStatus: MappingStatus;
  fixtureId: string;
  polymarketEventId: string;
  polymarketMarketId: string;
  conditionId: string;
  assetId: string;
  outcome: CanonicalOutcome;
  tokenRole: "canonical" | "complement";
  market: CanonicalMarket;
  tradeable: boolean;
};

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export class UnmappedPolymarketAssetError extends Error {
  constructor(readonly assetId: string) {
    super(`Polymarket asset is not present in the evidence-bearing mapping registry: ${assetId}`);
  }
}

export class MappingRegistry {
  readonly #assets = new Map<string, MappedAsset>();
  readonly #records: MappingRecord[];

  constructor(records: unknown[]) {
    this.#records = records.map((record) => mappingSchema.parse(record));
    const canonicalOutcomes = new Set<string>();
    for (const record of this.#records) {
      for (const condition of record.conditions) {
        const key = marketKey(
          record.txlineFixtureId,
          condition.family,
          condition.period,
          condition.lineMilli
        );
        for (const token of condition.tokens) {
          if (this.#assets.has(token.assetId)) {
            throw new Error(`Duplicate Polymarket asset mapping: ${token.assetId}`);
          }
          if (token.role === "canonical") {
            const outcomeKey = `${key}:${token.outcome}`;
            if (canonicalOutcomes.has(outcomeKey)) {
              throw new Error(`Duplicate canonical market outcome mapping: ${outcomeKey}`);
            }
            canonicalOutcomes.add(outcomeKey);
          }
          this.#assets.set(token.assetId, {
            mappingId: record.mappingId,
            mappingStatus: record.status,
            fixtureId: record.txlineFixtureId,
            polymarketEventId: record.polymarketEventId,
            polymarketMarketId: condition.polymarketMarketId,
            conditionId: condition.conditionId,
            assetId: token.assetId,
            outcome: token.outcome,
            tokenRole: token.role,
            market: {
              family: condition.family,
              period: condition.period,
              lineMilli: condition.lineMilli,
              key
            },
            tradeable: record.status === "verified" && record.review?.settlementVerified === true
          });
        }
      }
    }
  }

  resolveAsset(assetId: string): MappedAsset {
    const mapped = this.#assets.get(assetId);
    if (!mapped) throw new UnmappedPolymarketAssetError(assetId);
    return mapped;
  }

  records(): readonly MappingRecord[] {
    return this.#records;
  }

  assetIds(options: { includeRejected?: boolean } = {}): string[] {
    return [...this.#assets.values()]
      .filter((asset) => options.includeRejected === true || asset.mappingStatus !== "rejected")
      .map((asset) => asset.assetId);
  }
}
