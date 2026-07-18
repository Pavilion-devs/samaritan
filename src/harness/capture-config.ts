import { resolve } from "node:path";
import { z } from "zod";

const captureConfigSchema = z.object({
  captureId: z.string().min(1),
  status: z.enum(["pending_human_confirmation", "human_confirmed_for_capture_only"]),
  tradeable: z.literal(false),
  confirmedBy: z.literal("Deborah").optional(),
  confirmedAt: z.string().date().optional(),
  txline: z.object({
    fixtureId: z.string().min(1),
    home: z.string().min(1),
    away: z.string().min(1),
    kickoffUtc: z.string().datetime()
  }),
  polymarket: z.object({
    eventId: z.string().min(1),
    eventSlug: z.string().min(1),
    totalsEventId: z.string().min(1),
    totalsEventSlug: z.string().min(1),
    home: z.string().min(1),
    away: z.string().min(1),
    kickoffUtc: z.string().datetime(),
    rulesPeriod: z.literal("first_90_minutes_plus_stoppage_time")
  }),
  capture: z.object({
    scheduledStartUtc: z.string().datetime(),
    scheduledEndUtc: z.string().datetime(),
    durationMinutes: z.number().int().min(300).max(720),
    runLabel: z.string().regex(/^paired-[a-z0-9-]+$/),
    polymarketMaxAssets: z.number().int().min(1).max(500),
    discoveryIntervalSeconds: z.number().int().min(15).max(3_600),
    startupGraceSeconds: z.number().int().min(30).max(900),
    streamStaleSeconds: z.number().int().min(30).max(900),
    maxStartupSkewSeconds: z.number().int().min(1).max(300)
  }),
  evidence: z.object({
    txlineFixtures: z.string().min(1),
    polymarketEvents: z.string().min(1),
    readinessReport: z.string().min(1)
  }),
  note: z.string().min(1)
}).strict().superRefine((config, context) => {
  if (config.status === "human_confirmed_for_capture_only" && (!config.confirmedBy || !config.confirmedAt)) {
    context.addIssue({ code: "custom", path: ["confirmedBy"], message: "Confirmed capture requires Deborah and date" });
  }
  if (config.status === "pending_human_confirmation" && (config.confirmedBy || config.confirmedAt)) {
    context.addIssue({ code: "custom", path: ["confirmedBy"], message: "Pending capture cannot claim confirmation" });
  }
  const startTsMs = Date.parse(config.capture.scheduledStartUtc);
  const endTsMs = Date.parse(config.capture.scheduledEndUtc);
  if (endTsMs - startTsMs !== config.capture.durationMinutes * 60_000) {
    context.addIssue({
      code: "custom",
      path: ["capture", "scheduledEndUtc"],
      message: "Absolute capture window must equal durationMinutes"
    });
  }
  if (config.capture.maxStartupSkewSeconds > config.capture.startupGraceSeconds) {
    context.addIssue({
      code: "custom",
      path: ["capture", "maxStartupSkewSeconds"],
      message: "Maximum startup skew cannot exceed the artifact startup grace"
    });
  }
  if (
    config.txline.home !== config.polymarket.home ||
    config.txline.away !== config.polymarket.away ||
    config.txline.kickoffUtc !== config.polymarket.kickoffUtc
  ) {
    context.addIssue({
      code: "custom",
      path: ["polymarket", "kickoffUtc"],
      message: "Capture config teams or kickoff disagree across sources"
    });
  }
  if (startTsMs !== Date.parse(config.txline.kickoffUtc) - 3 * 60 * 60_000) {
    context.addIssue({
      code: "custom",
      path: ["capture", "scheduledStartUtc"],
      message: "Paired capture must start exactly three hours before kickoff"
    });
  }
});

export type CaptureConfig = z.infer<typeof captureConfigSchema>;

/**
 * Parses the immutable reviewed config without claiming that its historical
 * fixture still appears in today's rolling TXLine or Polymarket snapshots.
 */
export function parseCaptureConfig(value: unknown): CaptureConfig {
  return captureConfigSchema.parse(value);
}

type TxLineFixture = {
  FixtureId?: string | number;
  Participant1?: string;
  Participant2?: string;
  StartTime?: string | number;
};

type GammaEvent = {
  id?: string | number;
  slug?: string;
  teams?: Array<{ name?: string }>;
  startTime?: string;
  markets?: Array<{
    sportsMarketType?: string;
    gameStartTime?: string;
    description?: string;
  }>;
};

export type CaptureValidation = {
  config: CaptureConfig;
  evidenceValid: true;
  readyToSchedule: boolean;
  reason: "ready" | "human_confirmation_required" | "scheduled_start_passed";
  launch: {
    cwd: string;
    command: string;
    logPath: string;
    pidPath: string;
    scheduledStartTsMs: number;
  } | null;
};

function timestamp(value: string | number | undefined): number {
  if (typeof value === "number") return value;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  return Date.parse(String(value ?? ""));
}

function eventTimestamp(event: GammaEvent): number {
  return (event.markets ?? [])
    .map((market) => Date.parse(String(market.gameStartTime ?? "")))
    .find(Number.isFinite) ?? Date.parse(String(event.startTime ?? ""));
}

function eventTeams(event: GammaEvent): string[] {
  return (event.teams ?? []).map((team) => String(team.name ?? "")).filter(Boolean);
}

function assertEvent(input: {
  event: GammaEvent | undefined;
  id: string;
  slug: string;
  home: string;
  away: string;
  kickoffTsMs: number;
  totals: boolean;
}): void {
  const { event } = input;
  if (!event || String(event.id ?? "") !== input.id || event.slug !== input.slug) {
    throw new Error(`Polymarket event identity changed for ${input.slug}`);
  }
  if (eventTeams(event).join("|") !== `${input.home}|${input.away}` || eventTimestamp(event) !== input.kickoffTsMs) {
    throw new Error(`Polymarket teams or kickoff changed for ${input.slug}`);
  }
  if (input.totals) {
    const totals = (event.markets ?? []).filter((market) => market.sportsMarketType === "totals");
    if (totals.length === 0 || totals.some((market) =>
      !String(market.description ?? "").includes("first 90 minutes of regular play plus stoppage time")
    )) {
      throw new Error(`Polymarket full-time totals rules are missing or changed for ${input.slug}`);
    }
  }
}

export function validateCaptureConfig(input: {
  repoRoot: string;
  config: unknown;
  txlineFixtures: readonly TxLineFixture[];
  polymarketEvents: readonly GammaEvent[];
  nowTsMs?: number;
  scheduleGraceMs?: number;
}): CaptureValidation {
  const repoRoot = resolve(input.repoRoot);
  const config = parseCaptureConfig(input.config);
  const kickoffTsMs = Date.parse(config.txline.kickoffUtc);
  const fixture = input.txlineFixtures.find((candidate) => String(candidate.FixtureId ?? "") === config.txline.fixtureId);
  if (
    !fixture ||
    fixture.Participant1 !== config.txline.home ||
    fixture.Participant2 !== config.txline.away ||
    timestamp(fixture.StartTime) !== kickoffTsMs
  ) {
    throw new Error(`TXLine fixture ${config.txline.fixtureId} teams or kickoff changed`);
  }
  const bySlug = new Map(input.polymarketEvents.map((event) => [String(event.slug ?? ""), event]));
  assertEvent({
    event: bySlug.get(config.polymarket.eventSlug),
    id: config.polymarket.eventId,
    slug: config.polymarket.eventSlug,
    home: config.polymarket.home,
    away: config.polymarket.away,
    kickoffTsMs,
    totals: false
  });
  assertEvent({
    event: bySlug.get(config.polymarket.totalsEventSlug),
    id: config.polymarket.totalsEventId,
    slug: config.polymarket.totalsEventSlug,
    home: config.polymarket.home,
    away: config.polymarket.away,
    kickoffTsMs,
    totals: true
  });
  const scheduledStartTsMs = Date.parse(config.capture.scheduledStartUtc);
  const nowTsMs = input.nowTsMs ?? Date.now();
  const scheduleGraceMs = Math.max(0, input.scheduleGraceMs ?? 0);
  const schedulePassed = nowTsMs > scheduledStartTsMs + scheduleGraceMs;
  const humanConfirmed = config.status === "human_confirmed_for_capture_only";
  const readyToSchedule = humanConfirmed && !schedulePassed;
  const reason = !humanConfirmed
    ? "human_confirmation_required" as const
    : schedulePassed
      ? "scheduled_start_passed" as const
      : "ready" as const;
  return {
    config,
    evidenceValid: true,
    readyToSchedule,
    reason,
    launch: readyToSchedule ? {
      cwd: resolve(repoRoot, "phase0"),
      command: [
        "pnpm capture:paired --",
        "--network mainnet",
        `--txline-fixture-id ${config.txline.fixtureId}`,
        `--capture-start-utc ${config.capture.scheduledStartUtc}`,
        `--capture-end-utc ${config.capture.scheduledEndUtc}`,
        `--max-startup-skew-seconds ${config.capture.maxStartupSkewSeconds}`,
        `--run-label ${config.capture.runLabel}`,
        `--event-slugs ${config.polymarket.eventSlug},${config.polymarket.totalsEventSlug}`,
        `--max-assets ${config.capture.polymarketMaxAssets}`,
        `--discovery-interval-seconds ${config.capture.discoveryIntervalSeconds}`
      ].join(" "),
      logPath: resolve(repoRoot, "samples/_logs", `${config.capture.runLabel}.log`),
      pidPath: resolve(repoRoot, "samples/_logs", `${config.capture.runLabel}.pid`),
      scheduledStartTsMs
    } : null
  };
}
