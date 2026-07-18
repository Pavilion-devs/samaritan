import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  buildTxlinePulse,
  type TxlinePulseCredentials,
  type TxlinePulseOptions,
  type TxlinePulseResponse
} from "./txline-pulse.js";

type StoredMainnetToken = {
  network?: unknown;
  apiOrigin?: unknown;
  serviceLevelId?: unknown;
  jwt?: unknown;
  apiToken?: unknown;
};

export type NodeTxlinePulseOptions = Omit<TxlinePulseOptions, "credentials"> & {
  credentials?: TxlinePulseCredentials | null;
};

function envCredentials(): TxlinePulseCredentials | null {
  const jwt = process.env.TXLINE_JWT;
  const apiToken = process.env.TXLINE_API_TOKEN;
  if (!jwt || !apiToken || process.env.TXLINE_SERVICE_LEVEL_ID !== "12") return null;
  return { jwt, apiToken };
}

async function ignoredLocalCredentials(repoRoot: string): Promise<TxlinePulseCredentials | null> {
  try {
    const parsed = JSON.parse(
      await readFile(resolve(repoRoot, "phase0/.tokens/mainnet.json"), "utf8")
    ) as StoredMainnetToken;
    if (
      parsed.network !== "mainnet" ||
      parsed.apiOrigin !== "https://txline.txodds.com" ||
      parsed.serviceLevelId !== 12 ||
      typeof parsed.jwt !== "string" ||
      typeof parsed.apiToken !== "string"
    ) return null;
    return { jwt: parsed.jwt, apiToken: parsed.apiToken };
  } catch {
    return null;
  }
}

export async function buildNodeTxlinePulse(
  repoRoot: string,
  options: NodeTxlinePulseOptions = {}
): Promise<TxlinePulseResponse> {
  const credentials = Object.prototype.hasOwnProperty.call(options, "credentials")
    ? options.credentials ?? null
    : envCredentials() ?? await ignoredLocalCredentials(repoRoot);
  return buildTxlinePulse({
    credentials,
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.maxResponseBytes === undefined ? {} : { maxResponseBytes: options.maxResponseBytes })
  });
}
