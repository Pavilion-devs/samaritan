import { mkdir, readFile, writeFile, appendFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config({ path: resolve(process.cwd(), "../.env"), quiet: true });
dotenv.config({ path: resolve(process.cwd(), ".env"), quiet: true });

const thisFile = fileURLToPath(import.meta.url);
export const PHASE0_DIR = resolve(dirname(thisFile), "..");
export const ROOT_DIR = resolve(PHASE0_DIR, "..");
export const SAMPLES_DIR = join(ROOT_DIR, "samples");

export type NetworkName = "devnet" | "mainnet";

export type NetworkConfig = {
  name: NetworkName;
  rpcUrl: string;
  apiOrigin: string;
  programId: string;
  txlTokenMint: string;
  freeServiceLevelId: number;
};

export const NETWORKS: Record<NetworkName, NetworkConfig> = {
  devnet: {
    name: "devnet",
    rpcUrl: process.env.TXLINE_DEVNET_RPC_URL ?? "https://api.devnet.solana.com",
    apiOrigin: "https://txline-dev.txodds.com",
    programId: "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J",
    txlTokenMint: "4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG",
    freeServiceLevelId: 1
  },
  mainnet: {
    name: "mainnet",
    rpcUrl: process.env.TXLINE_MAINNET_RPC_URL ?? "https://api.mainnet-beta.solana.com",
    apiOrigin: "https://txline.txodds.com",
    programId: "9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA",
    txlTokenMint: "Zhw9TVKp68a1QrftncMSd6ELXKDtpVMNuMGr1jNwdeL",
    freeServiceLevelId: 12
  }
};

export type TokenFile = {
  network: NetworkName;
  publicKey: string;
  apiOrigin: string;
  serviceLevelId: number;
  weeks: number;
  txSig: string;
  jwt: string;
  apiToken: string;
  activatedAt: string;
};

export function parseArgs(argv = process.argv.slice(2)): Record<string, string | boolean | string[]> {
  const out: Record<string, string | boolean | string[]> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    const value = eq === -1 ? argv[i + 1] : arg.slice(eq + 1);
    const parsed: string | boolean =
      eq === -1 && (!value || value.startsWith("--")) ? true : value;
    if (parsed !== true && eq === -1) i += 1;
    if (out[key] === undefined) {
      out[key] = parsed;
    } else if (Array.isArray(out[key])) {
      (out[key] as string[]).push(String(parsed));
    } else {
      out[key] = [String(out[key]), String(parsed)];
    }
  }
  return out;
}

export function getNetwork(args: Record<string, string | boolean | string[]>): NetworkName {
  const value = String(args.network ?? "mainnet");
  if (value !== "devnet" && value !== "mainnet") {
    throw new Error(`Invalid --network ${value}; expected devnet or mainnet`);
  }
  return value;
}

export function boolArg(value: string | boolean | string[] | undefined): boolean {
  return value === true || value === "true" || value === "1" || value === "yes";
}

export function numberArg(
  args: Record<string, string | boolean | string[]>,
  key: string,
  fallback: number
): number {
  const value = args[key];
  if (value === undefined || value === true || Array.isArray(value)) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid --${key}: ${value}`);
  return parsed;
}

export function stringArg(
  args: Record<string, string | boolean | string[]>,
  key: string,
  fallback?: string
): string | undefined {
  const value = args[key];
  if (value === undefined || typeof value === "boolean" || Array.isArray(value)) return fallback;
  return value;
}

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function writeJson(path: string, data: unknown, mode?: number): Promise<void> {
  await ensureDir(dirname(path));
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, { mode });
}

export async function writeText(path: string, text: string, mode?: number): Promise<void> {
  await ensureDir(dirname(path));
  await writeFile(path, text, { mode });
}

export async function appendJsonl(path: string, data: unknown): Promise<void> {
  await ensureDir(dirname(path));
  await appendFile(path, `${JSON.stringify(data)}\n`);
}

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

export function tokenPath(network: NetworkName): string {
  return join(PHASE0_DIR, ".tokens", `${network}.json`);
}

export async function loadToken(network: NetworkName): Promise<TokenFile> {
  const path = tokenPath(network);
  if (!existsSync(path)) {
    throw new Error(`Missing token file ${path}. Run pnpm auth:${network} first.`);
  }
  return readJson<TokenFile>(path);
}

export function authHeaders(token: TokenFile): Record<string, string> {
  return {
    Authorization: `Bearer ${token.jwt}`,
    "X-Api-Token": token.apiToken
  };
}

export async function fetchText(url: string, init: RequestInit = {}): Promise<{
  ok: boolean;
  status: number;
  contentType: string;
  text: string;
}> {
  const res = await fetch(url, init);
  const text = await res.text();
  return {
    ok: res.ok,
    status: res.status,
    contentType: res.headers.get("content-type") ?? "",
    text
  };
}

export async function fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GET/POST ${url} failed ${res.status}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text) as T;
}

export function timestampSlug(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

export function epochDayFromDate(date: Date): number {
  return Math.floor(date.getTime() / 86_400_000);
}

export function epochDayFromIso(isoDate: string): number {
  return epochDayFromDate(new Date(`${isoDate}T00:00:00Z`));
}

export function dateFromEpochDay(epochDay: number): string {
  return new Date(epochDay * 86_400_000).toISOString().slice(0, 10);
}

export function walletPath(): string {
  return resolve(ROOT_DIR, process.env.TXLINE_WALLET_PATH ?? "phase0/.wallet/samaritan.json");
}

export async function logManifest(entry: Record<string, unknown>): Promise<void> {
  await appendJsonl(join(SAMPLES_DIR, "_logs", "manifest.jsonl"), {
    capturedAt: new Date().toISOString(),
    ...entry
  });
}

export async function listFilesRecursive(root: string): Promise<string[]> {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const name of await readdir(dir)) {
      const path = join(dir, name);
      const info = await stat(path);
      if (info.isDirectory()) await walk(path);
      if (info.isFile()) files.push(path);
    }
  }
  await walk(root);
  return files;
}
