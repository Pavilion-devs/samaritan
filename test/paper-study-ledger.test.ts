import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initializePaperStudyLedger } from "../src/harness/paper-study-ledger.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("persistent paper-study ledger initialization", () => {
  it("records the frozen protocol once and reopens idempotently", () => {
    const directory = mkdtempSync(join(tmpdir(), "samaritan-paper-ledger-"));
    directories.push(directory);
    const path = join(directory, "long-run.sqlite");
    const first = initializePaperStudyLedger({ path, lane: "long_run", startedAtTsMs: 1_000 });
    expect(first.created).toBe(true);
    expect(first.initialization).toMatchObject({
      protocolVersion: "paper-study-v2-candidate-2026-07-14",
      protocolStatus: "engineering_candidate_unregistered",
      configHash: "93e61c1903d0a13bbeb1dbbd3ad9b11af0335b96c82bd2ca7aa9ddedeeabf3ce",
      lane: "long_run",
      startedAtTsMs: 1_000,
      realMoneyGate: "closed",
      frozenConfig: {
        executionTiming: {
          readinessClock: "observed_ts_ms",
          decisionLatency: "max_measured_or_minimum",
          venuePlacementDelayMs: 1_000
        },
        selectorAsOfBeforeKickoffMs: 10_800_000,
        economicCases: {
          version: "binary_totals_executable_buy_v1",
          retain: "actual_buy_only",
          sellOnly: "drop_unproven_complementary_ask"
        },
        historicalEvidence: {
          protocolId: "historical-gate-causal-economic-v4-2026-07-14",
          configurationHash: "9a4eeff928f697fc55ab5147a4dc07f611c40bb749501fc3bd92b211f24b2e54"
        },
        risk: {
          bankrollMicroUsd: 50_000_000,
          perTradeStakeMicroUsd: 3_000_000,
          aggregateExposureMicroUsd: 15_000_000,
          drawdownStopMicroUsd: 20_000_000,
          realMoneyGate: "closed"
        },
        evaluation: { minimumFilledMatches: 20, minimumFills: 40, bootstrapIterations: 10_000 }
      }
    });
    const hash = first.initialization.configHash;
    expect(first.ledger.verifyChain()).toMatchObject({ valid: true, rows: 1 });
    first.ledger.close();

    const reopened = initializePaperStudyLedger({ path, lane: "long_run", startedAtTsMs: 9_999 });
    expect(reopened.created).toBe(false);
    expect(reopened.initialization.startedAtTsMs).toBe(1_000);
    expect(reopened.initialization.configHash).toBe(hash);
    expect(reopened.ledger.entries()).toHaveLength(1);
    reopened.ledger.close();
  });

  it("refuses to reuse a lane ledger under a different lane", () => {
    const directory = mkdtempSync(join(tmpdir(), "samaritan-paper-ledger-"));
    directories.push(directory);
    const path = join(directory, "lane.sqlite");
    const bounty = initializePaperStudyLedger({ path, lane: "bounty", startedAtTsMs: 1_000 });
    bounty.ledger.close();
    expect(() => initializePaperStudyLedger({ path, lane: "long_run", startedAtTsMs: 1_000 })).toThrow(
      /does not match/
    );
  });
});
