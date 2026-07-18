import { lstat, readFile, readdir } from "node:fs/promises";
import { basename, extname, relative, resolve, sep } from "node:path";

export const DEFAULT_PUBLIC_ARTIFACT_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const DEFAULT_PUBLIC_ARTIFACT_MAX_TOTAL_BYTES = 25 * 1024 * 1024;

export type PublicArtifactAuditMode = "bundle" | "source";

export type PublicArtifactViolationCode =
  | "NO_EXPLICIT_ALLOWLIST"
  | "NO_ALLOWLISTED_BUNDLE"
  | "EMPTY_ALLOWLISTED_BUNDLE"
  | "ALLOWLIST_PATH_MISSING"
  | "ALLOWLIST_PATH_UNREADABLE"
  | "UNSUPPORTED_FILE_TYPE"
  | "SYMLINK_NOT_ALLOWED"
  | "SENSITIVE_FILENAME"
  | "RAW_CAPTURE_FILENAME"
  | "RAW_CAPTURE_EXTENSION"
  | "FILE_TOO_LARGE"
  | "BUNDLE_TOO_LARGE"
  | "UNPARSEABLE_ARTIFACT_DATA"
  | "OPAQUE_DATA_ARTIFACT"
  | "RAW_TXLINE_KEY"
  | "RAW_TXLINE_ENVELOPE"
  | "EXACT_TXLINE_CONSENSUS"
  | "RECONSTRUCTIVE_TXLINE_SHAPE"
  | "SENSITIVE_DATA_KEY"
  | "SECRET_VALUE_PATTERN"
  | "PRIVATE_ABSOLUTE_PATH";

export type PublicArtifactViolation = {
  code: PublicArtifactViolationCode;
  path: string;
  message: string;
  jsonPath?: string;
};

export type PublicArtifactAuditOptions = {
  /**
   * The only files or directories the auditor may visit. There is deliberately
   * no cwd/repository fallback: release callers must name the public surface.
   */
  allowlistedPaths: readonly string[];
  mode?: PublicArtifactAuditMode;
  cwd?: string;
  maxFileBytes?: number;
  maxTotalBytes?: number;
};

export type PublicArtifactAuditReport = {
  ok: boolean;
  mode: PublicArtifactAuditMode;
  allowlistedPaths: string[];
  existingAllowlistedRoots: number;
  filesScanned: number;
  bytesScanned: number;
  limits: {
    maxFileBytes: number;
    maxTotalBytes: number;
  };
  violations: PublicArtifactViolation[];
};

const RAW_CAPTURE_EXTENSIONS = [
  ".ndjson",
  ".jsonl",
  ".sqlite",
  ".sqlite3",
  ".duckdb",
  ".parquet",
  ".pcap",
  ".pcapng",
  ".har",
  ".gz",
  ".gzip",
  ".zst",
  ".tar",
  ".tgz",
  ".zip"
] as const;

const DATA_EXTENSIONS = new Set([".json", ".yaml", ".yml", ".csv", ".tsv"]);
const SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".cts",
  ".html",
  ".js",
  ".jsx",
  ".mjs",
  ".map",
  ".mts",
  ".scss",
  ".ts",
  ".tsx"
]);
const STATIC_BINARY_EXTENSIONS = new Set([
  ".avif",
  ".eot",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".mp3",
  ".mp4",
  ".ogg",
  ".otf",
  ".pdf",
  ".png",
  ".ttf",
  ".wav",
  ".webm",
  ".webp",
  ".woff",
  ".woff2"
]);

const SENSITIVE_FILENAMES = [
  /^\.env(?:\.|$)/i,
  /^\.npmrc$/i,
  /^\.pypirc$/i,
  /^credentials(?:\.|$)/i,
  /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.|$)/i,
  /(?:^|[-_.])(?:mnemonic|seed[-_.]?phrase|wallet[-_.]?secret)(?:[-_.]|$)/i,
  /\.(?:key|keystore|pem|p12|pfx)$/i
] as const;

const RAW_CAPTURE_FILENAME =
  /(?:^|[-_.])(?:raw|capture|captured|sse|txline[-_.]?(?:odds|scores)?|odds[-_.]?(?:stream|snapshot|updates)|scores[-_.]?(?:stream|snapshot|updates))(?:[-_.]|$)/i;

const RAW_CAPTURE_LIKE_EXTENSIONS = new Set([
  ".csv",
  ".db",
  ".duckdb",
  ".har",
  ".json",
  ".jsonl",
  ".ndjson",
  ".parquet",
  ".sqlite",
  ".sqlite3",
  ".tsv"
]);

const SENSITIVE_NORMALIZED_KEYS = new Set([
  "anthropicapikey",
  "apikey",
  "apitoken",
  "authorization",
  "bearertoken",
  "clientsecret",
  "credential",
  "credentials",
  "jwt",
  "mnemonic",
  "password",
  "privatekey",
  "refreshtoken",
  "secret",
  "secretkey",
  "seedphrase",
  "txlineapitoken",
  "walletprivatekey",
  "walletsecret",
  "walletsecretkey",
  "xapitoken"
]);

const EXACT_CONSENSUS_KEYS = new Set([
  "consensuslevel",
  "consensuslevels",
  "consensusprice",
  "consensusprices",
  "consensusprobabilities",
  "consensusprobability",
  "consensusprobabilityseries",
  "consensusseries",
  "consensusvalues",
  "stableprice",
  "stableprices",
  "stablepriceprobabilities",
  "stablepriceprobability",
  "stablepriceseries",
  "txlinefairprobability",
  "txlinepct",
  "txlineprobabilities",
  "txlineprobability",
  "txlineprobabilityseries",
  "txlineprices",
  "txlineseries"
]);

const RAW_ENVELOPE_KEYS = new Set([
  "Action",
  "Bookmaker",
  "BookmakerId",
  "Clock",
  "FixtureId",
  "GameState",
  "InRunning",
  "MarketParameters",
  "MarketPeriod",
  "MessageId",
  "Pct",
  "PossibleEvent",
  "PriceNames",
  "Prices",
  "Stats",
  "SuperOddsType",
  "Ts"
]);

const RAW_ENVELOPE_SIGNATURE_KEYS = new Set([
  "Action",
  "Bookmaker",
  "BookmakerId",
  "GameState",
  "InRunning",
  "MessageId",
  "Pct",
  "PossibleEvent",
  "PriceNames",
  "Prices",
  "Stats",
  "SuperOddsType"
]);

const RECONSTRUCTIVE_PRICE_KEYS = new Set([
  "polymarketmid",
  "polymarketmidpoint",
  "polymarketprice",
  "polymarketprobability"
]);

const RECONSTRUCTIVE_GAP_KEYS = new Set([
  "consensusedgebps",
  "crossmarketgap",
  "crossmarketgapbps",
  "rawgap",
  "txlinegap",
  "txlinegapbps"
]);

const SOURCE_LEVEL_KEYS = new Set([
  "level",
  "levels",
  "pct",
  "price",
  "prices",
  "probabilities",
  "probability",
  "series",
  "values"
]);

const SECRET_TEXT_PATTERNS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  {
    label: "private-key PEM block",
    pattern: /-----BEGIN (?:EC |OPENSSH |PGP |RSA )?PRIVATE KEY-----/
  },
  {
    label: "Anthropic/OpenAI-style API key",
    pattern: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}\b/
  },
  {
    label: "AWS access key",
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/
  },
  {
    label: "JWT",
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/
  },
  {
    label: "Authorization bearer credential",
    pattern: /\bBearer[ \t]+[A-Za-z0-9._~+/=-]{20,}\b/i
  },
  {
    label: "assigned API token/key",
    pattern:
      /\b(?:ANTHROPIC_API_KEY|OPENAI_API_KEY|TXLINE_API_TOKEN|TXLINE_JWT|SOLANA_PRIVATE_KEY|WALLET_PRIVATE_KEY)\b[ \t]*[:=][ \t]*["']?(?!redacted\b|placeholder\b|example\b|<)[A-Za-z0-9._~+/=-]{12,}/i
  }
];

const PRIVATE_PATH_PATTERNS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  {
    label: "macOS user-home path",
    pattern: /(?:^|[\s"'`=(])\/Users\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9 ._@%+,:=-]+)*/
  },
  {
    label: "Linux user-home path",
    pattern: /(?:^|[\s"'`=(])\/(?:home|root)\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9 ._@%+,:=-]+)*/
  },
  {
    label: "Windows user-home path",
    pattern: /\b[A-Za-z]:\\{1,2}Users\\{1,2}[^\\\s"']+(?:\\{1,2}[^\r\n"']+)*/
  },
  {
    label: "file URI",
    pattern: /\bfile:\/\/(?:\/Users\/|\/home\/|\/root\/|[A-Za-z]:\/Users\/)/i
  }
];

type MutableAuditState = {
  cwd: string;
  mode: PublicArtifactAuditMode;
  maxFileBytes: number;
  maxTotalBytes: number;
  existingAllowlistedRoots: number;
  filesScanned: number;
  bytesScanned: number;
  filePathsSeen: Set<string>;
  violations: PublicArtifactViolation[];
};

function normalizedKey(key: string): string {
  return key.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
}

function displayPath(path: string, cwd: string): string {
  const rel = relative(cwd, path);
  if (rel === "") return ".";
  if (rel !== ".." && !rel.startsWith(`..${sep}`)) return rel;
  return path;
}

function addViolation(
  state: MutableAuditState,
  code: PublicArtifactViolationCode,
  path: string,
  message: string,
  jsonPath?: string
): void {
  const violation: PublicArtifactViolation = {
    code,
    path: displayPath(path, state.cwd),
    message
  };
  if (jsonPath !== undefined) violation.jsonPath = jsonPath;
  state.violations.push(violation);
}

function safeIntegerLimit(value: number | undefined, fallback: number, name: string): number {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return selected;
}

function hasRawCaptureExtension(filename: string): boolean {
  const lower = filename.toLowerCase();
  return RAW_CAPTURE_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

function isSensitiveFilename(filename: string): boolean {
  return SENSITIVE_FILENAMES.some((pattern) => pattern.test(filename));
}

function isRawCaptureFilename(filename: string): boolean {
  const extension = extname(filename).toLowerCase();
  return RAW_CAPTURE_LIKE_EXTENSIONS.has(extension) && RAW_CAPTURE_FILENAME.test(filename);
}

function jsonPathChild(parent: string, key: string): string {
  return `${parent}[${JSON.stringify(key)}]`;
}

function collectDescendantKeys(value: unknown, keys: Set<string>): void {
  if (Array.isArray(value)) {
    for (const nested of value) collectDescendantKeys(nested, keys);
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    keys.add(normalizedKey(key));
    collectDescendantKeys(nested, keys);
  }
}

function isExactConsensusValue(key: string, value: unknown): boolean {
  const normalized = normalizedKey(key);
  if (EXACT_CONSENSUS_KEYS.has(normalized)) return true;
  if (normalized !== "consensus") return false;
  if (typeof value === "number") return true;
  if (Array.isArray(value)) return value.some((entry) => typeof entry === "number" || typeof entry === "object");
  return value !== null && typeof value === "object";
}

function scanStructuredValue(
  value: unknown,
  path: string,
  state: MutableAuditState,
  filePath: string,
  enforceTxlineDataPolicy: boolean
): void {
  if (Array.isArray(value)) {
    for (const [index, nested] of value.entries()) {
      scanStructuredValue(nested, `${path}[${index}]`, state, filePath, enforceTxlineDataPolicy);
    }
    return;
  }
  if (value === null || typeof value !== "object") return;

  const entries = Object.entries(value);
  const directKeys = new Set(entries.map(([key]) => key));
  const descendantKeys = new Set<string>();
  collectDescendantKeys(value, descendantKeys);

  if (enforceTxlineDataPolicy) {
    const rawEnvelopeKeyCount = [...directKeys].filter((key) => RAW_ENVELOPE_KEYS.has(key)).length;
    const hasRawSignature = [...directKeys].some((key) => RAW_ENVELOPE_SIGNATURE_KEYS.has(key));
    if (rawEnvelopeKeyCount >= 3 && hasRawSignature) {
      addViolation(
        state,
        "RAW_TXLINE_ENVELOPE",
        filePath,
        "Artifact data contains a TXLine-shaped raw odds/score envelope",
        path
      );
    }

    const hasReconstructivePrice = [...descendantKeys].some((key) => RECONSTRUCTIVE_PRICE_KEYS.has(key));
    const hasReconstructiveGap = [...descendantKeys].some((key) => RECONSTRUCTIVE_GAP_KEYS.has(key));
    const childAlreadyContainsPair = entries.some(([, nested]) => {
      if (nested === null || typeof nested !== "object") return false;
      const childKeys = new Set<string>();
      collectDescendantKeys(nested, childKeys);
      return (
        [...childKeys].some((key) => RECONSTRUCTIVE_PRICE_KEYS.has(key)) &&
        [...childKeys].some((key) => RECONSTRUCTIVE_GAP_KEYS.has(key))
      );
    });
    if (hasReconstructivePrice && hasReconstructiveGap && !childAlreadyContainsPair) {
      addViolation(
        state,
        "RECONSTRUCTIVE_TXLINE_SHAPE",
        filePath,
        "Exact Polymarket level plus a consensus/TXLine gap can reconstruct the licensed consensus level",
        path
      );
    }

    const sourceEntry = entries.find(([key]) => normalizedKey(key) === "source");
    if (sourceEntry && typeof sourceEntry[1] === "string" && /^txline$/i.test(sourceEntry[1])) {
      const sourceDataKeys = new Set<string>();
      collectDescendantKeys(value, sourceDataKeys);
      if ([...sourceDataKeys].some((key) => SOURCE_LEVEL_KEYS.has(key))) {
        addViolation(
          state,
          "EXACT_TXLINE_CONSENSUS",
          filePath,
          "A TXLine-labelled data object exposes exact levels/series instead of hash-only or derived evidence",
          path
        );
      }
    }
  }

  for (const [key, nested] of entries) {
    const nestedPath = jsonPathChild(path, key);
    const normalized = normalizedKey(key);

    if (SENSITIVE_NORMALIZED_KEYS.has(normalized)) {
      addViolation(
        state,
        "SENSITIVE_DATA_KEY",
        filePath,
        `Artifact data contains sensitive credential field ${JSON.stringify(key)}`,
        nestedPath
      );
    }

    if (enforceTxlineDataPolicy) {
      if (key === "Pct" || key === "Prices" || key === "Bookmaker" || key === "BookmakerId") {
        addViolation(
          state,
          "RAW_TXLINE_KEY",
          filePath,
          `Artifact data exposes forbidden raw TXLine field ${JSON.stringify(key)}`,
          nestedPath
        );
      }
      if (isExactConsensusValue(key, nested)) {
        addViolation(
          state,
          "EXACT_TXLINE_CONSENSUS",
          filePath,
          `Artifact data exposes exact consensus/TXLine level field ${JSON.stringify(key)}`,
          nestedPath
        );
      }
      if (typeof nested === "string" && nested === "TXLineStablePriceDemargined") {
        addViolation(
          state,
          "EXACT_TXLINE_CONSENSUS",
          filePath,
          "Artifact data exposes the internal raw TXLine consensus source label",
          nestedPath
        );
      }
    }

    scanStructuredValue(nested, nestedPath, state, filePath, enforceTxlineDataPolicy);
  }
}

function scanTextSafety(text: string, state: MutableAuditState, filePath: string): void {
  for (const { label, pattern } of SECRET_TEXT_PATTERNS) {
    if (pattern.test(text)) {
      addViolation(state, "SECRET_VALUE_PATTERN", filePath, `File contains a ${label}`);
    }
  }
  for (const { label, pattern } of PRIVATE_PATH_PATTERNS) {
    if (pattern.test(text)) {
      addViolation(state, "PRIVATE_ABSOLUTE_PATH", filePath, `File contains a private ${label}`);
    }
  }
}

function scanConcreteSourceDataLiterals(text: string, state: MutableAuditState, filePath: string): void {
  const rawFieldLiteral = /(?:["'](?:Pct|Prices|Bookmaker|BookmakerId)["']|\b(?:Pct|Prices|Bookmaker|BookmakerId))\s*:\s*(?:\[|["']|[-+]?\d)/u;
  if (rawFieldLiteral.test(text)) {
    addViolation(
      state,
      "RAW_TXLINE_KEY",
      filePath,
      "Source-like artifact embeds a concrete raw TXLine field value (not merely an implementation identifier)"
    );
  }

  const exactConsensusLiteral =
    /(?:["'](?:consensusProbability|consensusSeries|stablePrice|stablePriceSeries|txlineProbability|txlineSeries)["']|\b(?:consensusProbability|consensusSeries|stablePrice|stablePriceSeries|txlineProbability|txlineSeries))\s*:\s*(?:\[|[-+]?\d)/u;
  if (exactConsensusLiteral.test(text)) {
    addViolation(
      state,
      "EXACT_TXLINE_CONSENSUS",
      filePath,
      "Source-like artifact embeds a concrete exact consensus/TXLine level or series"
    );
  }
}

function scanDelimitedHeader(
  text: string,
  delimiter: "," | "\t",
  state: MutableAuditState,
  filePath: string,
  enforceTxlineDataPolicy: boolean
): void {
  const header = text.split(/\r?\n/u).find((line) => line.trim().length > 0);
  if (!header) return;
  const keys = header.split(delimiter).map((key) => key.trim().replace(/^['"]|['"]$/g, ""));
  const shape = Object.fromEntries(keys.map((key) => [key, null]));
  scanStructuredValue(shape, "$header", state, filePath, enforceTxlineDataPolicy);
}

function scanYamlKeys(
  text: string,
  state: MutableAuditState,
  filePath: string,
  enforceTxlineDataPolicy: boolean
): void {
  const keys = [...text.matchAll(/^\s*(?:-\s*)?([A-Za-z_][A-Za-z0-9_.-]*)\s*:/gmu)].map((match) => match[1]!);
  const shape = Object.fromEntries(keys.map((key) => [key, null]));
  scanStructuredValue(shape, "$yaml", state, filePath, enforceTxlineDataPolicy);
}

function scanEmbeddedJson(
  text: string,
  state: MutableAuditState,
  filePath: string,
  enforceTxlineDataPolicy: boolean
): void {
  const embeddedPattern = /<script\b[^>]*\btype=["']application\/(?:ld\+)?json["'][^>]*>([\s\S]*?)<\/script>/giu;
  let index = 0;
  for (const match of text.matchAll(embeddedPattern)) {
    const body = match[1]?.trim();
    if (!body) continue;
    try {
      scanStructuredValue(JSON.parse(body) as unknown, `$embedded[${index}]`, state, filePath, enforceTxlineDataPolicy);
    } catch {
      addViolation(
        state,
        "UNPARSEABLE_ARTIFACT_DATA",
        filePath,
        "HTML contains an invalid application/json data block",
        `$embedded[${index}]`
      );
    }
    index += 1;
  }
}

function appearsBinary(buffer: Buffer): boolean {
  const sampleLength = Math.min(buffer.byteLength, 8_192);
  for (let index = 0; index < sampleLength; index += 1) {
    if (buffer[index] === 0) return true;
  }
  return false;
}

async function scanFile(filePath: string, state: MutableAuditState): Promise<void> {
  if (state.filePathsSeen.has(filePath)) return;
  state.filePathsSeen.add(filePath);

  const filename = basename(filePath);
  const extension = extname(filename).toLowerCase();
  let info;
  try {
    info = await lstat(filePath);
  } catch (error) {
    addViolation(
      state,
      "ALLOWLIST_PATH_UNREADABLE",
      filePath,
      `Cannot inspect file: ${error instanceof Error ? error.message : String(error)}`
    );
    return;
  }

  state.filesScanned += 1;
  state.bytesScanned += info.size;

  if (isSensitiveFilename(filename)) {
    addViolation(state, "SENSITIVE_FILENAME", filePath, "Sensitive credential/key filename is forbidden");
  }
  if (state.mode === "bundle" && hasRawCaptureExtension(filename)) {
    addViolation(state, "RAW_CAPTURE_EXTENSION", filePath, "Raw/archive capture extension is forbidden in a public bundle");
  }
  if (state.mode === "bundle" && isRawCaptureFilename(filename)) {
    addViolation(state, "RAW_CAPTURE_FILENAME", filePath, "Raw TXLine/capture-style data filename is forbidden");
  }
  if (info.size > state.maxFileBytes) {
    addViolation(
      state,
      "FILE_TOO_LARGE",
      filePath,
      `File is ${info.size} bytes; the public-artifact limit is ${state.maxFileBytes}`
    );
    return;
  }

  let buffer: Buffer;
  try {
    buffer = await readFile(filePath);
  } catch (error) {
    addViolation(
      state,
      "ALLOWLIST_PATH_UNREADABLE",
      filePath,
      `Cannot read file: ${error instanceof Error ? error.message : String(error)}`
    );
    return;
  }

  // Even approved static binaries get a narrow printable-string scan for key,
  // token, and private-path leaks. Their opaque payload is not parsed as data.
  const text = buffer.toString("utf8");
  scanTextSafety(text, state, filePath);
  if (STATIC_BINARY_EXTENSIONS.has(extension)) return;

  const binary = appearsBinary(buffer);
  if (binary) {
    addViolation(state, "OPAQUE_DATA_ARTIFACT", filePath, "Unapproved opaque binary artifact cannot be safety-inspected");
    return;
  }

  const enforceTxlineDataPolicy = state.mode === "bundle";
  if (enforceTxlineDataPolicy && SOURCE_EXTENSIONS.has(extension)) {
    scanConcreteSourceDataLiterals(text, state, filePath);
  }
  if (extension === ".json") {
    try {
      scanStructuredValue(JSON.parse(text) as unknown, "$", state, filePath, enforceTxlineDataPolicy);
    } catch {
      addViolation(state, "UNPARSEABLE_ARTIFACT_DATA", filePath, "Public JSON artifact is not valid JSON");
    }
    return;
  }
  if (extension === ".csv" || extension === ".tsv") {
    scanDelimitedHeader(text, extension === ".csv" ? "," : "\t", state, filePath, enforceTxlineDataPolicy);
    return;
  }
  if (extension === ".yaml" || extension === ".yml") {
    scanYamlKeys(text, state, filePath, enforceTxlineDataPolicy);
    return;
  }
  if (extension === ".html") {
    scanEmbeddedJson(text, state, filePath, enforceTxlineDataPolicy);
    return;
  }
  const trimmed = text.trimStart();
  if (
    enforceTxlineDataPolicy &&
    !SOURCE_EXTENSIONS.has(extension) &&
    (trimmed.startsWith("{") || trimmed.startsWith("["))
  ) {
    try {
      scanStructuredValue(JSON.parse(text) as unknown, "$", state, filePath, true);
    } catch {
      // An unknown text file that merely begins with punctuation is not
      // automatically data. Known data extensions fail closed above.
    }
  }
}

async function walk(path: string, state: MutableAuditState): Promise<void> {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    addViolation(
      state,
      "ALLOWLIST_PATH_MISSING",
      path,
      `Allowlisted path does not exist or cannot be inspected: ${error instanceof Error ? error.message : String(error)}`
    );
    return;
  }

  if (info.isSymbolicLink()) {
    addViolation(state, "SYMLINK_NOT_ALLOWED", path, "Symlinks are forbidden because they can escape the explicit allowlist");
    return;
  }
  if (info.isFile()) {
    await scanFile(path, state);
    return;
  }
  if (!info.isDirectory()) {
    addViolation(state, "UNSUPPORTED_FILE_TYPE", path, "Only regular files and directories may be audited");
    return;
  }

  let children;
  try {
    children = await readdir(path, { withFileTypes: true });
  } catch (error) {
    addViolation(
      state,
      "ALLOWLIST_PATH_UNREADABLE",
      path,
      `Cannot enumerate allowlisted directory: ${error instanceof Error ? error.message : String(error)}`
    );
    return;
  }
  children.sort((left, right) => left.name.localeCompare(right.name));
  for (const child of children) {
    await walk(resolve(path, child.name), state);
  }
}

function deduplicateAndSort(violations: PublicArtifactViolation[]): PublicArtifactViolation[] {
  const byIdentity = new Map<string, PublicArtifactViolation>();
  for (const violation of violations) {
    const identity = `${violation.code}\u0000${violation.path}\u0000${violation.jsonPath ?? ""}\u0000${violation.message}`;
    byIdentity.set(identity, violation);
  }
  return [...byIdentity.values()].sort((left, right) => {
    return (
      left.path.localeCompare(right.path) ||
      left.code.localeCompare(right.code) ||
      (left.jsonPath ?? "").localeCompare(right.jsonPath ?? "") ||
      left.message.localeCompare(right.message)
    );
  });
}

export async function auditPublicArtifacts(options: PublicArtifactAuditOptions): Promise<PublicArtifactAuditReport> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const mode = options.mode ?? "bundle";
  const maxFileBytes = safeIntegerLimit(
    options.maxFileBytes,
    DEFAULT_PUBLIC_ARTIFACT_MAX_FILE_BYTES,
    "maxFileBytes"
  );
  const maxTotalBytes = safeIntegerLimit(
    options.maxTotalBytes,
    DEFAULT_PUBLIC_ARTIFACT_MAX_TOTAL_BYTES,
    "maxTotalBytes"
  );
  const allowlistedPaths = [...new Set(options.allowlistedPaths.map((path) => path.trim()).filter(Boolean))].map((path) =>
    resolve(cwd, path)
  );
  const state: MutableAuditState = {
    cwd,
    mode,
    maxFileBytes,
    maxTotalBytes,
    existingAllowlistedRoots: 0,
    filesScanned: 0,
    bytesScanned: 0,
    filePathsSeen: new Set(),
    violations: []
  };

  if (allowlistedPaths.length === 0) {
    addViolation(
      state,
      "NO_EXPLICIT_ALLOWLIST",
      cwd,
      mode === "bundle"
        ? "Bundle audit requires at least one explicit allowlisted bundle path"
        : "Source audit requires at least one explicit allowlisted repository path"
    );
  } else {
    for (const path of allowlistedPaths) {
      try {
        await lstat(path);
        state.existingAllowlistedRoots += 1;
      } catch {
        // walk emits the path-specific failure below.
      }
      await walk(path, state);
    }
  }

  if (mode === "bundle" && state.existingAllowlistedRoots === 0) {
    addViolation(
      state,
      "NO_ALLOWLISTED_BUNDLE",
      cwd,
      "No explicit allowlisted public bundle exists; use --source-audit only for an intentional repository-source audit"
    );
  }
  if (mode === "bundle" && state.existingAllowlistedRoots > 0 && state.filesScanned === 0) {
    addViolation(
      state,
      "EMPTY_ALLOWLISTED_BUNDLE",
      cwd,
      "The allowlisted public bundle contains no regular files, so there is nothing to approve"
    );
  }
  if (state.bytesScanned > maxTotalBytes) {
    addViolation(
      state,
      "BUNDLE_TOO_LARGE",
      cwd,
      `Allowlisted artifacts total ${state.bytesScanned} bytes; the limit is ${maxTotalBytes}`
    );
  }

  const violations = deduplicateAndSort(state.violations);
  return {
    ok: violations.length === 0,
    mode,
    allowlistedPaths,
    existingAllowlistedRoots: state.existingAllowlistedRoots,
    filesScanned: state.filesScanned,
    bytesScanned: state.bytesScanned,
    limits: { maxFileBytes, maxTotalBytes },
    violations
  };
}

export function assertPublicArtifactsSafe(report: PublicArtifactAuditReport): void {
  if (report.ok) return;
  const summary = report.violations
    .map((violation) => {
      const location = violation.jsonPath ? `${violation.path}${violation.jsonPath}` : violation.path;
      return `[${violation.code}] ${location}: ${violation.message}`;
    })
    .join("\n");
  throw new Error(`Public artifact safety audit failed (${report.violations.length} violation(s)):\n${summary}`);
}
