import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
  TransactionInstruction
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID
} from "@solana/spl-token";
import nacl from "tweetnacl";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  ensureDir,
  fetchJson,
  NETWORKS,
  NetworkName,
  numberArg,
  parseArgs,
  PHASE0_DIR,
  tokenPath,
  walletPath,
  writeJson,
  getNetwork,
  stringArg
} from "./lib.js";

type IdlInstruction = {
  name: string;
  discriminator: number[];
  accounts: Array<{ name: string; writable?: boolean; signer?: boolean }>;
  args: Array<{ name: string; type: string }>;
};

type Idl = {
  address: string;
  instructions: IdlInstruction[];
};

function u16Le(value: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value, 0);
  return buffer;
}

function u8(value: number): Buffer {
  const buffer = Buffer.alloc(1);
  buffer.writeUInt8(value, 0);
  return buffer;
}

async function readKeypair(): Promise<Keypair> {
  const bytes = JSON.parse(await readFile(walletPath(), "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

function extractFirstJsonCodeBlock(markdown: string): unknown {
  const match = markdown.match(/```json[^\n]*\n([\s\S]*?)\n\s*```/);
  if (!match) throw new Error("Could not find JSON IDL code block in TxLine docs markdown");
  return JSON.parse(match[1]);
}

async function loadIdl(network: NetworkName): Promise<Idl> {
  const idlPath = join(PHASE0_DIR, "idl", `${network}.json`);
  if (existsSync(idlPath)) return JSON.parse(await readFile(idlPath, "utf8")) as Idl;

  const url = `https://txline.txodds.com/documentation/programs/${network}.md`;
  const res = await fetch(url);
  const markdown = await res.text();
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status} ${markdown.slice(0, 200)}`);
  const idl = extractFirstJsonCodeBlock(markdown) as Idl;
  await writeJson(idlPath, idl);
  return idl;
}

async function startGuestSession(apiOrigin: string): Promise<string> {
  const response = await fetch(`${apiOrigin}/auth/guest/start`, { method: "POST" });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`/auth/guest/start failed ${response.status}: ${text.slice(0, 300)}`);
  }
  try {
    const json = JSON.parse(text) as { token?: string };
    if (json.token) return json.token;
  } catch {
    // Some endpoints return plain text. Fall through.
  }
  return text.trim();
}

function buildSubscribeInstruction(
  network: NetworkName,
  idl: Idl,
  payer: PublicKey,
  serviceLevelId: number,
  weeks: number
): TransactionInstruction {
  const config = NETWORKS[network];
  const programId = new PublicKey(config.programId);
  const txlTokenMint = new PublicKey(config.txlTokenMint);
  const subscribeIx = idl.instructions.find((ix) => ix.name === "subscribe");
  if (!subscribeIx) throw new Error("Subscribe instruction not present in TxLine IDL");
  if (
    subscribeIx.args.length !== 2 ||
    subscribeIx.args[0]?.type !== "u16" ||
    subscribeIx.args[1]?.type !== "u8"
  ) {
    throw new Error("Subscribe instruction args differ from expected u16 service_level_id, u8 weeks");
  }

  const [tokenTreasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_treasury_v2")],
    programId
  );
  const tokenTreasuryVault = getAssociatedTokenAddressSync(
    txlTokenMint,
    tokenTreasuryPda,
    true,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const [pricingMatrixPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pricing_matrix")],
    programId
  );
  const userTokenAccount = getAssociatedTokenAddressSync(
    txlTokenMint,
    payer,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const accounts: Record<string, PublicKey> = {
    user: payer,
    pricing_matrix: pricingMatrixPda,
    token_mint: txlTokenMint,
    user_token_account: userTokenAccount,
    token_treasury_vault: tokenTreasuryVault,
    token_treasury_pda: tokenTreasuryPda,
    token_program: TOKEN_2022_PROGRAM_ID,
    system_program: SystemProgram.programId,
    associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID
  };

  const keys = subscribeIx.accounts.map((account) => {
    const pubkey = accounts[account.name];
    if (!pubkey) throw new Error(`No account mapping for subscribe account ${account.name}`);
    return {
      pubkey,
      isSigner: account.signer === true,
      isWritable: account.writable === true
    };
  });

  const data = Buffer.concat([
    Buffer.from(subscribeIx.discriminator),
    u16Le(serviceLevelId),
    u8(weeks)
  ]);

  return new TransactionInstruction({ programId, keys, data });
}

function buildUserTokenAccountInstruction(network: NetworkName, payer: PublicKey): TransactionInstruction {
  const config = NETWORKS[network];
  const txlTokenMint = new PublicKey(config.txlTokenMint);
  const userTokenAccount = getAssociatedTokenAddressSync(
    txlTokenMint,
    payer,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  return createAssociatedTokenAccountIdempotentInstruction(
    payer,
    userTokenAccount,
    payer,
    txlTokenMint,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
}

async function sendSubscriptionTx(
  network: NetworkName,
  payer: Keypair,
  serviceLevelId: number,
  weeks: number
): Promise<string> {
  const config = NETWORKS[network];
  const connection = new Connection(config.rpcUrl, "confirmed");
  const balance = await connection.getBalance(payer.publicKey);
  if (balance < 10_000_000) {
    const note =
      network === "mainnet"
        ? "Ask Deborah to fund this dedicated public key with about 0.05 SOL on mainnet."
        : "Run pnpm airdrop:devnet or use a devnet faucet for this public key.";
    throw new Error(
      `${network} wallet balance is too low (${balance / 1_000_000_000} SOL). ${note}`
    );
  }

  const idl = await loadIdl(network);
  if (idl.address !== config.programId) {
    throw new Error(`Fetched ${network} IDL address ${idl.address} does not match ${config.programId}`);
  }
  const initUserTokenAccount = buildUserTokenAccountInstruction(network, payer.publicKey);
  const instruction = buildSubscribeInstruction(network, idl, payer.publicKey, serviceLevelId, weeks);
  const transaction = new Transaction().add(initUserTokenAccount, instruction);
  return sendAndConfirmTransaction(connection, transaction, [payer], {
    commitment: "confirmed",
    skipPreflight: false
  });
}

async function activateToken(
  network: NetworkName,
  jwt: string,
  txSig: string,
  payer: Keypair
): Promise<string> {
  const leagues: number[] = [];
  const message = new TextEncoder().encode(`${txSig}:${leagues.join(",")}:${jwt}`);
  const walletSignature = Buffer.from(nacl.sign.detached(message, payer.secretKey)).toString("base64");
  const response = await fetch(`${NETWORKS[network].apiOrigin}/api/token/activate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`
    },
    body: JSON.stringify({ txSig, walletSignature, leagues })
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`/api/token/activate failed ${response.status}: ${text.slice(0, 300)}`);
  }
  try {
    const json = JSON.parse(text) as { token?: string };
    if (json.token) return json.token;
  } catch {
    // Text response is documented.
  }
  return text.trim();
}

async function main(): Promise<void> {
  const args = parseArgs();
  const network = getNetwork(args);
  const config = NETWORKS[network];
  const serviceLevelId = numberArg(args, "service-level", config.freeServiceLevelId);
  const weeks = numberArg(args, "weeks", 4);
  const txSigArg = stringArg(args, "tx-sig");
  const payer = await readKeypair();

  await ensureDir(join(PHASE0_DIR, ".tokens"));
  console.log(`Network: ${network}`);
  console.log(`Wallet public key: ${payer.publicKey.toBase58()}`);
  console.log(`Service level: ${serviceLevelId}; weeks: ${weeks}`);

  const jwt = await startGuestSession(config.apiOrigin);
  const txSig = txSigArg ?? (await sendSubscriptionTx(network, payer, serviceLevelId, weeks));
  const apiToken = await activateToken(network, jwt, txSig, payer);

  await writeJson(
    tokenPath(network),
    {
      network,
      publicKey: payer.publicKey.toBase58(),
      apiOrigin: config.apiOrigin,
      serviceLevelId,
      weeks,
      txSig,
      jwt,
      apiToken,
      activatedAt: new Date().toISOString()
    },
    0o600
  );

  console.log(`Subscription transaction: ${txSig}`);
  console.log(`Stored credentials: ${tokenPath(network)}`);
  console.log("JWT and API token were not printed.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
