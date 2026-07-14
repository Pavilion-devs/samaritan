import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { evaluatePaperStudyLedger } from "../metrics/paper-study-observations.js";
import {
  PAPER_STUDY_PROTOCOL_STATUS,
  initializePaperStudyLedger
} from "./paper-study-ledger.js";

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
}

const root = resolve(argument("root", "data/paper"));
const manifestPath = resolve(argument("manifest", "data/paper/study-ledgers.json"));
const reportPath = resolve(argument("report", "docs/research/paper-study-ledger-initialization.md"));
if (!process.argv.includes("--candidate")) {
  throw new Error(
    `Paper protocol is ${PAPER_STUDY_PROTOCOL_STATUS}; pass --candidate only for isolated engineering fixtures. ` +
    "Do not replace or append to the preserved v1 study ledgers before Deborah registers the corrected protocol."
  );
}
const now = Date.now();
const bounty = initializePaperStudyLedger({
  path: resolve(root, "bounty", "decision-ledger.sqlite"),
  lane: "bounty",
  startedAtTsMs: now
});
const longRun = initializePaperStudyLedger({
  path: resolve(root, "long-run", "decision-ledger.sqlite"),
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
    protocolVersion: bounty.initialization.protocolVersion,
    protocolStatus: bounty.initialization.protocolStatus,
    configHash: bounty.initialization.configHash,
    realMoneyGate: "closed",
    bounty: {
      path: "data/paper/bounty/decision-ledger.sqlite",
      startedAtTsMs: bounty.initialization.startedAtTsMs,
      startedAt: bounty.initialization.startedAt,
      created: bounty.created,
      chain: bountyChain
    },
    longRun: {
      path: "data/paper/long-run/decision-ledger.sqlite",
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
