import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { evaluatePaperStudyLedger } from "../metrics/paper-study-observations.js";
import {
  PAPER_STUDY_PROTOCOL_VERSION,
  PAPER_STUDY_REGISTRATION,
  assertPaperStudyRegistrationRequest,
  initializePaperStudyLedger
} from "./paper-study-ledger.js";

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
}

assertPaperStudyRegistrationRequest(argument("register", ""));
const root = resolve(argument("root", "data/paper/v2"));
const manifestPath = resolve(argument("manifest", "data/paper/v2/study-ledgers.json"));
const reportPath = resolve(argument("report", "data/paper/v2/registration.md"));
const now = Date.now();
const bountyLedgerPath = resolve(root, "bounty", "decision-ledger.sqlite");
const longRunLedgerPath = resolve(root, "long-run", "decision-ledger.sqlite");
const bounty = initializePaperStudyLedger({
  path: bountyLedgerPath,
  lane: "bounty",
  startedAtTsMs: now
});
const longRun = initializePaperStudyLedger({
  path: longRunLedgerPath,
  lane: "long_run",
  startedAtTsMs: now
});
try {
  const bountyChain = bounty.ledger.verifyChain();
  const longRunChain = longRun.ledger.verifyChain();
  const longRunReport = evaluatePaperStudyLedger({
    lane: "long_run",
    ledger: longRun.ledger,
    kickoffByFixtureId: new Map()
  });
  const manifest = {
    protocolId: PAPER_STUDY_PROTOCOL_VERSION,
    protocolVersion: bounty.initialization.protocolVersion,
    protocolStatus: bounty.initialization.protocolStatus,
    registration: PAPER_STUDY_REGISTRATION,
    configHash: bounty.initialization.configHash,
    realMoneyGate: "closed",
    bounty: {
      path: relative(process.cwd(), bountyLedgerPath),
      startedAtTsMs: bounty.initialization.startedAtTsMs,
      startedAt: bounty.initialization.startedAt,
      created: bounty.created,
      chain: bountyChain
    },
    longRun: {
      path: relative(process.cwd(), longRunLedgerPath),
      startedAtTsMs: longRun.initialization.startedAtTsMs,
      startedAt: longRun.initialization.startedAt,
      created: longRun.created,
      chain: longRunChain,
      report: longRunReport
    }
  };
  const markdown = [
    "# Paper Study Ledger Initialization",
    "",
    `Protocol: \`${manifest.protocolVersion}\`  `,
    `Protocol status: **${manifest.protocolStatus}**  `,
    `Registered by: **${manifest.registration.registeredBy}** at ${manifest.registration.registeredAt}  `,
    `Scope: **${manifest.registration.scope}**  `,
    `Frozen config SHA-256: \`${manifest.configHash}\`  `,
    "Real-money gate: **closed**",
    "",
    `- Bounty ledger start: ${manifest.bounty.startedAt}; chain rows: ${manifest.bounty.chain.rows}; status: exploratory.`,
    `- Long-run ledger start: ${manifest.longRun.startedAt}; chain rows: ${manifest.longRun.chain.rows}; report status: ${manifest.longRun.report.status}.`,
    `- Long-run stopping counts at initialization: ${manifest.longRun.report.counts.filledMatches} filled matches / ${manifest.longRun.report.counts.fills} fills.`,
    "- Fixtures before the long-run start timestamp are excluded from its stopping count.",
    "",
    "No wallet, venue authentication, token, deposit, approval, order, or money movement is part of either ledger initialization.",
    ""
  ].join("\n");
  await Promise.all([mkdir(dirname(manifestPath), { recursive: true }), mkdir(dirname(reportPath), { recursive: true })]);
  await Promise.all([
    writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`),
    writeFile(reportPath, markdown)
  ]);
  console.log(JSON.stringify({ manifestPath, reportPath, configHash: manifest.configHash, bounty: manifest.bounty, longRun: manifest.longRun }, null, 2));
} finally {
  bounty.ledger.close();
  longRun.ledger.close();
}
