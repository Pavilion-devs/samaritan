import { Connection, PublicKey } from "@solana/web3.js";
import { NETWORKS, parseArgs, walletPath, numberArg } from "./lib.js";
import { readFile } from "node:fs/promises";
import { Keypair } from "@solana/web3.js";

async function main(): Promise<void> {
  const args = parseArgs();
  const lamportsSol = numberArg(args, "sol", 0.25);
  const keypairBytes = JSON.parse(await readFile(walletPath(), "utf8")) as number[];
  const pubkey = Keypair.fromSecretKey(Uint8Array.from(keypairBytes)).publicKey;
  const connection = new Connection(NETWORKS.devnet.rpcUrl, "confirmed");
  const before = await connection.getBalance(pubkey);
  console.log(`Devnet wallet: ${pubkey.toBase58()}`);
  console.log(`Balance before: ${before / 1_000_000_000} SOL`);
  const sig = await connection.requestAirdrop(new PublicKey(pubkey), lamportsSol * 1_000_000_000);
  const latest = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ signature: sig, ...latest }, "confirmed");
  const after = await connection.getBalance(pubkey);
  console.log(`Airdrop transaction: ${sig}`);
  console.log(`Balance after: ${after / 1_000_000_000} SOL`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
