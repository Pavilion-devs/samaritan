import type { PaperStudyInitialization } from "../harness/paper-study-ledger.js";
import type { PaperStudyReport } from "./paper-study.js";

export type LedgerChainEvidence = {
  valid: true;
  rows: number;
  headHash: string;
};

export type PaperStudyEvidenceArtifact = {
  generatedAt: string;
  protocolVersion: string;
  configHash: string;
  realMoneyGate: "closed";
  fixtureUniverseGeneratedAt: string;
  lanes: {
    bounty: {
      initialization: PaperStudyInitialization;
      chain: LedgerChainEvidence;
      report: PaperStudyReport;
    };
    longRun: {
      initialization: PaperStudyInitialization;
      chain: LedgerChainEvidence;
      report: PaperStudyReport;
    };
  };
};

function decimal(value: number | null, digits = 1): string {
  return value === null ? "-" : value.toFixed(digits);
}

function usd(microUsd: number | null): string {
  return microUsd === null ? "-" : (microUsd / 1_000_000).toFixed(2);
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function laneSection(name: string, report: PaperStudyReport): string[] {
  if (
    report.status === "sealed" &&
    (report.rows !== null || report.endpoints !== null || report.guardrails !== null)
  ) {
    throw new Error("Sealed paper-study report contains unsealed results");
  }
  const lines = [
    `## ${name}`,
    "",
    `Status: **${report.status.toUpperCase()}**  `,
    `Reason: ${report.reason}  `,
    `Counts: ${report.counts.matches} matches / ${report.counts.signals} signals / ${report.counts.filledMatches} filled matches / ${report.counts.fills} fills / ${report.counts.settledFills} settled fills.`,
    ""
  ];
  if (report.rows === null) {
    lines.push(
      "Primary endpoints and per-match rows are sealed until both registered stopping thresholds are met.",
      ""
    );
    return lines;
  }
  lines.push(
    "| Fixture | Kickoff UTC | Total | Signals | Fills | Fill rate | Half-spread bps | Slippage bps | Gross CLV bps | Net CLV bps | Settlement P&L ($) | Net return bps |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...report.rows.map((row) =>
      `| ${row.fixtureId} | ${new Date(row.kickoffTsMs).toISOString()} | ${(row.selectedLineMilli / 1_000).toFixed(1)} | ${row.signals} | ${row.fills} | ${percent(row.fillRate)} | ${decimal(row.meanHalfSpreadBps)} | ${decimal(row.meanSlippageBps)} | ${decimal(row.grossClvBps)} | ${decimal(row.netClvBps)} | ${usd(row.settlementPnlMicroUsd)} | ${decimal(row.netReturnBps)} |`
    ),
    ""
  );
  if (report.endpoints === null) {
    lines.push("Endpoints are unavailable until close and settlement evidence is complete.", "");
  } else {
    const endpoints = report.endpoints;
    lines.push(
      "### Endpoints",
      "",
      `- Mean net executable CLV: ${decimal(endpoints.meanNetClvBps)} bps; match-clustered 95% CI [${decimal(endpoints.netClvInterval.low)}, ${decimal(endpoints.netClvInterval.high)}], median ${decimal(endpoints.netClvInterval.median)} (${endpoints.netClvInterval.iterations.toLocaleString("en-US")} iterations).`,
      `- Mean settlement P&L: $${usd(endpoints.meanSettlementPnlMicroUsd)}; match-clustered 95% CI [$${usd(endpoints.settlementPnlInterval.low)}, $${usd(endpoints.settlementPnlInterval.high)}].`,
      `- Settled matches net-positive: ${percent(endpoints.fractionSettledMatchesNetPositive)}.`,
      `- No-trade baseline: ${decimal(endpoints.noTradeBaselineClvBps)} bps; matched-cost random-direction control: ${decimal(endpoints.randomDirectionControlClvBps)} bps.`,
      ""
    );
  }
  if (report.guardrails !== null) {
    const guardrails = report.guardrails;
    lines.push(
      "### Guardrails",
      "",
      `| Fill rate | Slippage | Drawdown | Depth complete | Close complete | Settlement complete |`,
      `|---:|---:|---:|---|---|---|`,
      `| ${percent(guardrails.fillRate)} (${guardrails.fillRatePassed ? "pass" : "fail"}) | ${decimal(guardrails.meanSlippageBps)} bps (${guardrails.slippagePassed ? "pass" : "fail"}) | $${usd(guardrails.maxDrawdownMicroUsd)} (${guardrails.drawdownPassed ? "pass" : "fail"}) | ${guardrails.selectedDepthComplete ? "yes" : "no"} | ${guardrails.closeMarksComplete ? "yes" : "no"} | ${guardrails.settlementComplete ? "yes" : "no"} |`,
      ""
    );
  }
  return lines;
}

export function renderPaperStudyEvidence(artifact: PaperStudyEvidenceArtifact): string {
  return [
    "# Samaritan Paper Study Evidence",
    "",
    `Generated: ${artifact.generatedAt}  `,
    `Protocol: \`${artifact.protocolVersion}\`  `,
    `Frozen config SHA-256: \`${artifact.configHash}\`  `,
    `Fixture universe generated: ${artifact.fixtureUniverseGeneratedAt}  `,
    "Real-money gate: **CLOSED**",
    "",
    "This report is reconstructed from append-only decision ledgers. Bounty results are exploratory. Long-run rows and endpoints remain sealed until the registered stopping rule is met.",
    "",
    "| Lane | Chain rows | Chain head |",
    "|---|---:|---|",
    `| Bounty | ${artifact.lanes.bounty.chain.rows} | \`${artifact.lanes.bounty.chain.headHash}\` |`,
    `| Long-run | ${artifact.lanes.longRun.chain.rows} | \`${artifact.lanes.longRun.chain.headHash}\` |`,
    "",
    ...laneSection("Bounty Demonstration Lane", artifact.lanes.bounty.report),
    ...laneSection("Long-Run Profitability Lane", artifact.lanes.longRun.report),
    "No result in this artifact authorizes real-money execution.",
    ""
  ].join("\n");
}
