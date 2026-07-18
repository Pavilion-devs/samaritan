import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PAPER_STUDY_REGISTERED_AT_TS_MS,
  PAPER_STUDY_PROTOCOL_VERSION,
  assertPaperStudyRegistrationRequest,
  initializePaperStudyLedger
} from "../src/harness/paper-study-ledger.js";
import { DecisionLedger } from "../src/store/decision-ledger.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("persistent paper-study ledger initialization", () => {
  it("records the frozen protocol once and reopens idempotently", () => {
    const directory = mkdtempSync(join(tmpdir(), "samaritan-paper-ledger-"));
    directories.push(directory);
    const path = join(directory, "long-run.sqlite");
    const first = initializePaperStudyLedger({
      path,
      lane: "long_run",
      startedAtTsMs: PAPER_STUDY_REGISTERED_AT_TS_MS
    });
    expect(first.created).toBe(true);
    expect(first.initialization).toMatchObject({
      protocolVersion: "paper-study-v2-2026-07-18",
      protocolStatus: "registered",
      configHash: "93e61c1903d0a13bbeb1dbbd3ad9b11af0335b96c82bd2ca7aa9ddedeeabf3ce",
      registration: {
        protocolId: "paper-study-v2-2026-07-18",
        status: "registered",
        registeredBy: "Deborah",
        registeredAt: "2026-07-18T07:03:55Z",
        scope: "forward_paper_only",
        realMoneyGate: "closed"
      },
      lane: "long_run",
      startedAtTsMs: PAPER_STUDY_REGISTERED_AT_TS_MS,
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

    const reopened = initializePaperStudyLedger({
      path,
      lane: "long_run",
      startedAtTsMs: PAPER_STUDY_REGISTERED_AT_TS_MS + 9_999
    });
    expect(reopened.created).toBe(false);
    expect(reopened.initialization.startedAtTsMs).toBe(PAPER_STUDY_REGISTERED_AT_TS_MS);
    expect(reopened.initialization.configHash).toBe(hash);
    expect(reopened.ledger.entries()).toHaveLength(1);
    reopened.ledger.close();
  });

  it("refuses to reuse a lane ledger under a different lane", () => {
    const directory = mkdtempSync(join(tmpdir(), "samaritan-paper-ledger-"));
    directories.push(directory);
    const path = join(directory, "lane.sqlite");
    const bounty = initializePaperStudyLedger({
      path,
      lane: "bounty",
      startedAtTsMs: PAPER_STUDY_REGISTERED_AT_TS_MS
    });
    bounty.ledger.close();
    expect(() => initializePaperStudyLedger({
      path,
      lane: "long_run",
      startedAtTsMs: PAPER_STUDY_REGISTERED_AT_TS_MS
    })).toThrow(
      /does not match/
    );
  });

  it("rejects pre-registration starts before creating persistent state", () => {
    const directory = mkdtempSync(join(tmpdir(), "samaritan-paper-ledger-"));
    directories.push(directory);
    const path = join(directory, "too-early.sqlite");

    expect(() => initializePaperStudyLedger({
      path,
      lane: "long_run",
      startedAtTsMs: PAPER_STUDY_REGISTERED_AT_TS_MS - 1
    })).toThrow(/cannot start before 2026-07-18T07:03:55Z/);
    expect(existsSync(path)).toBe(false);
  });

  it("rejects a persisted pre-registration initialization even when reopened with a valid clock", () => {
    const directory = mkdtempSync(join(tmpdir(), "samaritan-paper-ledger-"));
    directories.push(directory);
    const path = join(directory, "forged-early.sqlite");
    const template = initializePaperStudyLedger({
      path: ":memory:",
      lane: "long_run",
      startedAtTsMs: PAPER_STUDY_REGISTERED_AT_TS_MS
    });
    const early = {
      ...structuredClone(template.initialization),
      startedAtTsMs: PAPER_STUDY_REGISTERED_AT_TS_MS - 1,
      startedAt: new Date(PAPER_STUDY_REGISTERED_AT_TS_MS - 1).toISOString()
    };
    template.ledger.close();
    const forged = new DecisionLedger(path);
    forged.append({
      entryId: "study:long_run:initialized:forged-early",
      caseId: "study:long_run",
      kind: "study_initialized",
      atTsMs: early.startedAtTsMs,
      payload: JSON.parse(JSON.stringify(early))
    });
    forged.close();

    expect(() => initializePaperStudyLedger({
      path,
      lane: "long_run",
      startedAtTsMs: PAPER_STUDY_REGISTERED_AT_TS_MS
    })).toThrow(/cannot start before 2026-07-18T07:03:55Z/);
  });

  it("limits the small-clock escape hatch to in-memory NODE_ENV=test fixtures", () => {
    const inMemory = initializePaperStudyLedger({
      path: ":memory:",
      lane: "bounty",
      startedAtTsMs: 1_000,
      testOnlyAllowPreRegistrationStart: true
    });
    inMemory.ledger.close();

    const directory = mkdtempSync(join(tmpdir(), "samaritan-paper-ledger-"));
    directories.push(directory);
    expect(() => initializePaperStudyLedger({
      path: join(directory, "persistent.sqlite"),
      lane: "bounty",
      startedAtTsMs: 1_000,
      testOnlyAllowPreRegistrationStart: true
    })).toThrow(/requires NODE_ENV=test and an in-memory ledger/);

    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(() => initializePaperStudyLedger({
        path: ":memory:",
        lane: "bounty",
        startedAtTsMs: 1_000,
        testOnlyAllowPreRegistrationStart: true
      })).toThrow(/requires NODE_ENV=test and an in-memory ledger/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("requires the exact registered protocol ID for operator initialization", () => {
    expect(() => assertPaperStudyRegistrationRequest(undefined)).toThrow(
      /--register paper-study-v2-2026-07-18/
    );
    expect(() => assertPaperStudyRegistrationRequest("paper-study-v2-candidate-2026-07-14"))
      .toThrow(/--register paper-study-v2-2026-07-18/);
    expect(() => assertPaperStudyRegistrationRequest(PAPER_STUDY_PROTOCOL_VERSION)).not.toThrow();
  });
});
