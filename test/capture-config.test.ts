import { describe, expect, it } from "vitest";
import { parseCaptureConfig, validateCaptureConfig } from "../src/harness/capture-config.js";

const repoRoot = "/tmp/samaritan-portable-clone";
const kickoff = "2026-07-14T19:00:00.000Z";
const config = {
  captureId: "paired-france-spain-2026-07-14",
  status: "pending_human_confirmation",
  tradeable: false,
  txline: { fixtureId: "123", home: "France", away: "Spain", kickoffUtc: kickoff },
  polymarket: {
    eventId: "1",
    eventSlug: "fifwc-fra-esp-2026-07-14",
    totalsEventId: "2",
    totalsEventSlug: "fifwc-fra-esp-2026-07-14-more-markets",
    home: "France",
    away: "Spain",
    kickoffUtc: kickoff,
    rulesPeriod: "first_90_minutes_plus_stoppage_time"
  },
  capture: {
    scheduledStartUtc: "2026-07-14T16:00:00.000Z",
    scheduledEndUtc: "2026-07-14T22:00:00.000Z",
    durationMinutes: 360,
    runLabel: "paired-france-spain-2026-07-14",
    polymarketMaxAssets: 50,
    discoveryIntervalSeconds: 900,
    startupGraceSeconds: 180,
    streamStaleSeconds: 300,
    maxStartupSkewSeconds: 120
  },
  evidence: { txlineFixtures: "fixtures", polymarketEvents: "events", readinessReport: "report" },
  note: "Capture only; no trading."
};
const txlineFixtures = [{ FixtureId: 123, Participant1: "France", Participant2: "Spain", StartTime: Date.parse(kickoff) }];
const polymarketEvents = [
  {
    id: "1",
    slug: "fifwc-fra-esp-2026-07-14",
    teams: [{ name: "France" }, { name: "Spain" }],
    startTime: kickoff,
    markets: [{ sportsMarketType: "moneyline", gameStartTime: kickoff }]
  },
  {
    id: "2",
    slug: "fifwc-fra-esp-2026-07-14-more-markets",
    teams: [{ name: "France" }, { name: "Spain" }],
    startTime: kickoff,
    markets: [{
      sportsMarketType: "totals",
      gameStartTime: kickoff,
      description: "This market refers only to the outcome within the first 90 minutes of regular play plus stoppage time."
    }]
  }
];

describe("paired capture config validation", () => {
  it("parses an ended reviewed config without pretending it exists in current rolling snapshots", () => {
    const parsed = parseCaptureConfig({
      ...config,
      status: "human_confirmed_for_capture_only",
      confirmedBy: "Deborah",
      confirmedAt: "2026-07-12"
    });
    expect(parsed).toMatchObject({
      captureId: "paired-france-spain-2026-07-14",
      txline: { fixtureId: "123", home: "France", away: "Spain" },
      polymarket: { eventSlug: "fifwc-fra-esp-2026-07-14" }
    });
  });

  it("keeps static cross-source identity and capture-window rules in schema-only parsing", () => {
    expect(() => parseCaptureConfig({
      ...config,
      polymarket: { ...config.polymarket, away: "Argentina" }
    })).toThrow(/teams or kickoff disagree/);
    expect(() => parseCaptureConfig({
      ...config,
      capture: { ...config.capture, scheduledStartUtc: "2026-07-14T15:59:59.000Z", scheduledEndUtc: "2026-07-14T21:59:59.000Z" }
    })).toThrow(/exactly three hours/);
  });

  it("validates evidence but withholds launch until human confirmation", () => {
    const result = validateCaptureConfig({
      repoRoot,
      config,
      txlineFixtures,
      polymarketEvents,
      nowTsMs: Date.parse("2026-07-14T15:00:00.000Z")
    });
    expect(result).toMatchObject({
      evidenceValid: true,
      readyToSchedule: false,
      reason: "human_confirmation_required",
      launch: null
    });
  });

  it("emits an exact capture command only after Deborah confirmation", () => {
    const result = validateCaptureConfig({
      config: { ...config, status: "human_confirmed_for_capture_only", confirmedBy: "Deborah", confirmedAt: "2026-07-12" },
      repoRoot,
      txlineFixtures,
      polymarketEvents,
      nowTsMs: Date.parse("2026-07-14T15:00:00.000Z")
    });
    expect(result.readyToSchedule).toBe(true);
    expect(result.launch?.command).toContain("--txline-fixture-id 123 --capture-start-utc 2026-07-14T16:00:00.000Z");
    expect(result.launch?.command).toContain("--capture-end-utc 2026-07-14T22:00:00.000Z --max-startup-skew-seconds 120");
    expect(result.launch?.command).toContain("--event-slugs fifwc-fra-esp-2026-07-14,fifwc-fra-esp-2026-07-14-more-markets");
    expect(result.launch?.command).toContain("--max-assets 50 --discovery-interval-seconds 900");
    expect(result.launch).toMatchObject({
      cwd: `${repoRoot}/phase0`,
      logPath: `${repoRoot}/samples/_logs/paired-france-spain-2026-07-14.log`,
      pidPath: `${repoRoot}/samples/_logs/paired-france-spain-2026-07-14.pid`
    });
    expect(JSON.stringify(result.launch)).not.toContain("/Users/");
  });

  it("fails closed when kickoff evidence changes", () => {
    expect(() => validateCaptureConfig({
      config,
      repoRoot,
      txlineFixtures: [{ ...txlineFixtures[0], StartTime: Date.parse(kickoff) + 60_000 }],
      polymarketEvents
    })).toThrow(/changed/);
  });

  it("withholds a confirmed launch after its scheduled start", () => {
    const result = validateCaptureConfig({
      config: { ...config, status: "human_confirmed_for_capture_only", confirmedBy: "Deborah", confirmedAt: "2026-07-12" },
      repoRoot,
      txlineFixtures,
      polymarketEvents,
      nowTsMs: Date.parse("2026-07-14T16:00:00.001Z")
    });
    expect(result).toMatchObject({
      evidenceValid: true,
      readyToSchedule: false,
      reason: "scheduled_start_passed",
      launch: null
    });
  });

  it("rejects a relative duration that disagrees with the reviewed absolute end", () => {
    expect(() => validateCaptureConfig({
      config: {
        ...config,
        capture: { ...config.capture, scheduledEndUtc: "2026-07-14T21:59:59.000Z" }
      },
      repoRoot,
      txlineFixtures,
      polymarketEvents
    })).toThrow(/Absolute capture window/);
  });
});
