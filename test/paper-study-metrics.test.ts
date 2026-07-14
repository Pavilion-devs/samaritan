import { describe, expect, it } from "vitest";
import {
  evaluatePaperStudy,
  type PaperStudyObservation
} from "../src/metrics/paper-study.js";

function observations(input: {
  lane: "bounty" | "long_run";
  matches: number;
  fillsPerMatch: number;
  unfilledPerMatch?: number;
  netClvBps?: number;
  slippageBps?: number;
  pnlMicroUsd?: number;
}): PaperStudyObservation[] {
  const rows: PaperStudyObservation[] = [];
  for (let match = 0; match < input.matches; match += 1) {
    for (let signal = 0; signal < input.fillsPerMatch + (input.unfilledPerMatch ?? 0); signal += 1) {
      const filled = signal < input.fillsPerMatch;
      rows.push({
        caseId: `case-${match}-${signal}`,
        lane: input.lane,
        fixtureId: `fixture-${match}`,
        kickoffTsMs: 1_000_000 + match * 10_000,
        selectedLineMilli: 2_500,
        signalId: `signal-${match}-${signal}`,
        fill: filled ? {
          status: "filled",
          entryCostMicroUsd: 3_000_000,
          halfSpreadBps: 20,
          slippageBps: input.slippageBps ?? 10,
          selectedDepthUsd: 100,
          grossClvBps: (input.netClvBps ?? 100) + 20,
          netClvBps: input.netClvBps ?? 100,
          executableLiquidationClvBps: (input.netClvBps ?? 100) - 20,
          settledAtTsMs: 2_000_000 + match * 10_000 + signal,
          settlementPnlMicroUsd: input.pnlMicroUsd ?? 100_000
        } : null
      });
    }
  }
  return rows;
}

describe("registered paper-study evaluator", () => {
  it("seals long-run endpoints until both stopping thresholds are met", () => {
    const notEnoughMatchesInput = observations({
      lane: "long_run",
      matches: 19,
      fillsPerMatch: 3
    });
    const notEnoughMatches = evaluatePaperStudy({ lane: "long_run", observations: notEnoughMatchesInput });
    expect(notEnoughMatches).toMatchObject({ status: "sealed", stoppingRuleMet: false });
    expect(notEnoughMatches.rows).toBeNull();
    expect(notEnoughMatches.endpoints).toBeNull();
    expect(notEnoughMatches.guardrails).toBeNull();

    const notEnoughFillsInput = observations({
      lane: "long_run",
      matches: 20,
      fillsPerMatch: 1
    });
    const notEnoughFills = evaluatePaperStudy({ lane: "long_run", observations: notEnoughFillsInput });
    expect(notEnoughFills).toMatchObject({ status: "sealed", stoppingRuleMet: false });
  });

  it("accepts only after positive clustered evidence and every guardrail pass", () => {
    const input = observations({
      lane: "long_run",
      matches: 20,
      fillsPerMatch: 2,
      netClvBps: 100,
      pnlMicroUsd: 100_000
    });
    const report = evaluatePaperStudy({ lane: "long_run", observations: input });
    expect(report.status).toBe("accept");
    expect(report.endpoints?.netClvInterval).toMatchObject({
      iterations: 10_000,
      matches: 20,
      signals: 40,
      low: 100,
      median: 100,
      high: 100
    });
    expect(report.endpoints!.meanNetClvBps).toBeGreaterThan(
      report.endpoints!.randomDirectionControlClvBps
    );
    expect(report.rows).toHaveLength(20);
  });

  it("rejects a positive point estimate when a registered guardrail fails", () => {
    const input = observations({
      lane: "long_run",
      matches: 20,
      fillsPerMatch: 2,
      slippageBps: 101
    });
    const report = evaluatePaperStudy({ lane: "long_run", observations: input });
    expect(report.status).toBe("reject");
    expect(report.guardrails).toMatchObject({ slippagePassed: false });
  });

  it("treats reaching the drawdown stop as a failed guardrail", () => {
    const input = observations({
      lane: "long_run",
      matches: 20,
      fillsPerMatch: 2,
      pnlMicroUsd: -500_000
    });
    const report = evaluatePaperStudy({ lane: "long_run", observations: input });
    expect(report.status).toBe("reject");
    expect(report.guardrails).toMatchObject({
      maxDrawdownMicroUsd: 20_000_000,
      drawdownPassed: false
    });
  });

  it("keeps bounty evidence explicitly exploratory and bootstrap output reproducible", () => {
    const input = observations({ lane: "bounty", matches: 3, fillsPerMatch: 2 });
    const first = evaluatePaperStudy({ lane: "bounty", observations: input });
    const second = evaluatePaperStudy({ lane: "bounty", observations: input });
    expect(first.status).toBe("exploratory");
    expect(first.endpoints).toEqual(second.endpoints);
  });

  it("will not score filled cases with missing close or settlement evidence", () => {
    const input = observations({ lane: "long_run", matches: 20, fillsPerMatch: 2 });
    input[0]!.fill!.netClvBps = null;
    const report = evaluatePaperStudy({ lane: "long_run", observations: input });
    expect(report.status).toBe("inconclusive");
    expect(report.endpoints).toBeNull();
    expect(report.guardrails).toMatchObject({ closeMarksComplete: false });
  });

  it("returns a sealed zero-count report for a fresh long-run ledger", () => {
    const report = evaluatePaperStudy({ lane: "long_run", observations: [] });
    expect(report).toMatchObject({
      status: "sealed",
      counts: { matches: 0, signals: 0, filledMatches: 0, fills: 0, settledFills: 0 }
    });
    expect(report.endpoints).toBeNull();
  });

  it("does not call empty bounty evidence complete", () => {
    const report = evaluatePaperStudy({ lane: "bounty", observations: [] });
    expect(report.guardrails).toMatchObject({
      selectedDepthComplete: false,
      closeMarksComplete: false,
      settlementComplete: false
    });
  });
});
