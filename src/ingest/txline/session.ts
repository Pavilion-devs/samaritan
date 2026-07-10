import { readFile } from "node:fs/promises";
import { z } from "zod";

export type TxLineNetwork = "devnet" | "mainnet";

export const TXLINE_ORIGINS: Record<TxLineNetwork, string> = {
  devnet: "https://txline-dev.txodds.com",
  mainnet: "https://txline.txodds.com"
};

const credentialsSchema = z.object({
  jwt: z.string().min(1),
  apiToken: z.string().min(1)
});

export type TxLineCredentials = z.infer<typeof credentialsSchema>;
export type RefreshCredentials = () => Promise<TxLineCredentials>;

function jwtExpiryMs(jwt: string): number | null {
  const payload = jwt.split(".")[1];
  if (!payload) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      exp?: unknown;
    };
    return typeof decoded.exp === "number" ? decoded.exp * 1_000 : null;
  } catch {
    return null;
  }
}

export class TxLineSessionManager {
  #credentials: TxLineCredentials | null;

  constructor(
    credentials: TxLineCredentials | null,
    readonly refreshCredentials?: RefreshCredentials
  ) {
    this.#credentials = credentials === null ? null : credentialsSchema.parse(credentials);
  }

  static async fromTokenFile(path: string, refreshCredentials?: RefreshCredentials): Promise<TxLineSessionManager> {
    const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
    return new TxLineSessionManager(credentialsSchema.parse(raw), refreshCredentials);
  }

  async headers(nowMs = Date.now()): Promise<Record<string, string>> {
    const expiresAt = this.#credentials === null ? null : jwtExpiryMs(this.#credentials.jwt);
    if (this.#credentials === null || (expiresAt !== null && expiresAt <= nowMs + 30_000)) {
      if (!this.refreshCredentials) {
        throw new Error(
          "TXLine session is absent or expired. Re-run the proven wallet activation flow; no undocumented refresh endpoint is assumed."
        );
      }
      this.#credentials = credentialsSchema.parse(await this.refreshCredentials());
    }
    return {
      Authorization: `Bearer ${this.#credentials.jwt}`,
      "X-Api-Token": this.#credentials.apiToken
    };
  }
}
