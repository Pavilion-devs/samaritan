import { describe, expect, it } from "vitest";
import { buildCaptureReadiness } from "../src/harness/capture-readiness.js";

const kickoff = 20_000_000;
const gammaEvents = [
  {
    id: "event-main",
    slug: "fifwc-fra-esp-2026-07-14",
    title: "France vs. Spain",
    teams: [{ name: "France" }, { name: "Spain" }],
    markets: [{ gameStartTime: new Date(kickoff).toISOString() }]
  },
  {
    id: "event-more",
    slug: "fifwc-fra-esp-2026-07-14-more-markets",
    title: "France vs. Spain - More Markets",
    teams: [{ name: "France" }, { name: "Spain" }],
    markets: [{ gameStartTime: new Date(kickoff).toISOString() }]
  }
];

describe("paired capture readiness", () => {
  it("blocks a public event family without an exact TXLine fixture", () => {
    const report = buildCaptureReadiness({
      generatedAt: "2026-07-12T00:00:00.000Z",
      nowTsMs: 1_000,
      requiredLeadMs: 10_000,
      signalCutoffMs: 5_000,
      gammaEvents,
      txlineFixtures: []
    });
    expect(report.fixtures).toEqual([expect.objectContaining({
      home: "France",
      away: "Spain",
      eventSlugs: ["fifwc-fra-esp-2026-07-14", "fifwc-fra-esp-2026-07-14-more-markets"],
      txlineFixtureId: null,
      status: "blocked_missing_txline_fixture",
      recommendedCaptureStartTsMs: kickoff - 10_000,
      signalCutoffTsMs: kickoff - 5_000
    })]);
  });

  it("advances only an exact team and kickoff match to human confirmation", () => {
    const report = buildCaptureReadiness({
      generatedAt: "2026-07-12T00:00:00.000Z",
      nowTsMs: 1_000,
      requiredLeadMs: 10_000,
      signalCutoffMs: 5_000,
      gammaEvents,
      txlineFixtures: [{
        FixtureId: 123,
        Participant1: "Spain",
        Participant2: "France",
        StartTime: kickoff
      }]
    });
    expect(report.fixtures[0]).toMatchObject({
      txlineFixtureId: "123",
      status: "ready_for_human_confirmation"
    });
  });
});
