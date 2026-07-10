import { join } from "node:path";
import {
  fetchJson,
  fetchText,
  logManifest,
  parseArgs,
  SAMPLES_DIR,
  stringArg,
  timestampSlug,
  writeJson,
  writeText
} from "./lib.js";

type GammaMarket = Record<string, unknown> & {
  id?: string;
  question?: string;
  slug?: string;
  conditionId?: string;
  description?: string;
  active?: boolean;
  closed?: boolean;
  enableOrderBook?: boolean;
  clobTokenIds?: string;
  orderPriceMinTickSize?: number;
  orderMinSize?: number;
  volumeNum?: number;
  liquidityNum?: number;
};

type GammaEvent = Record<string, unknown> & {
  id?: string;
  slug?: string;
  title?: string;
  question?: string;
  endDate?: string;
  markets?: GammaMarket[];
};

function parseTokenIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function marketScore(market: GammaMarket): number {
  return Number(market.liquidityNum ?? 0) + Number(market.volumeNum ?? 0) / 100;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const runId = timestampSlug();
  const outDir = join(SAMPLES_DIR, "polymarket", runId);
  const explicitSlugs = stringArg(args, "event-slugs");
  const seedSlugs = explicitSlugs
    ? explicitSlugs.split(",").map((item) => item.trim()).filter(Boolean)
    : [
        "fifwc-fra-mar-2026-07-09",
        "fifwc-fra-mar-2026-07-09-more-markets",
        "fifwc-fra-mar-2026-07-09-exact-score",
        "world-cup-nation-to-reach-final",
        "world-cup-winner"
      ];

  const activeEventsUrl =
    "https://gamma-api.polymarket.com/events?active=true&closed=false&limit=100&order=volume&ascending=false";
  const activeEvents = await fetchJson<GammaEvent[]>(activeEventsUrl);
  await writeJson(join(outDir, "gamma-active-events-top100.json"), activeEvents);

  const discoveredSlugs = activeEvents
    .filter((event) => /world cup|fifwc|fifa/i.test(JSON.stringify(event)))
    .map((event) => event.slug)
    .filter((slug): slug is string => typeof slug === "string");
  const slugs = [...new Set([...seedSlugs, ...discoveredSlugs])].slice(0, 30);

  const events: GammaEvent[] = [];
  for (const slug of slugs) {
    const response = await fetchText(`https://gamma-api.polymarket.com/events/slug/${slug}`);
    if (!response.ok) continue;
    const event = JSON.parse(response.text) as GammaEvent;
    events.push(event);
    await writeText(join(outDir, "events", `${slug}.json`), response.text.endsWith("\n") ? response.text : `${response.text}\n`);
  }

  const markets = events
    .flatMap((event) => (event.markets ?? []).map((market) => ({ event, market })))
    .filter(({ market }) => market.active !== false && market.closed !== true && market.enableOrderBook === true)
    .filter(({ market }) => parseTokenIds(market.clobTokenIds).length > 0)
    .sort((a, b) => {
      const priority = (item: { event: GammaEvent; market: GammaMarket }) => {
        const eventSlug = String(item.event.slug ?? "");
        const question = String(item.market.question ?? "");
        let score = marketScore(item.market);
        if (eventSlug.startsWith("fifwc-")) score += 1_000_000_000;
        if (/will .+ win on|end in a draw/i.test(question)) score += 100_000_000;
        return score;
      };
      return priority(b) - priority(a);
    });

  const selected = markets[0];
  let book: unknown = null;
  let tick: unknown = null;
  let feeRate: unknown = null;
  if (selected) {
    const tokenId = parseTokenIds(selected.market.clobTokenIds)[0];
    book = await fetchJson(`https://clob.polymarket.com/book?token_id=${encodeURIComponent(tokenId)}`);
    tick = await fetchJson(`https://clob.polymarket.com/tick-size?token_id=${encodeURIComponent(tokenId)}`);
    feeRate = await fetchJson(`https://clob.polymarket.com/fee-rate?token_id=${encodeURIComponent(tokenId)}`);
    await writeJson(join(outDir, "selected-order-book.json"), book);
    await writeJson(join(outDir, "selected-tick-size.json"), tick);
    await writeJson(join(outDir, "selected-fee-rate.json"), feeRate);
  }

  const reportLines = [
    "# Polymarket Smoke Test",
    "",
    `Captured: ${new Date().toISOString()}`,
    `Events saved: ${events.length}`,
    `Order-book enabled markets found: ${markets.length}`,
    "",
    "## CLOB V2 Status",
    "",
    "Polymarket changelog says CLOB V2 is live on production at https://clob.polymarket.com and V1-signed orders are no longer production-compatible as of Apr 28, 2026.",
    "",
    "## Selected Book",
    "",
    selected
      ? [
          `Event: ${selected.event.slug ?? ""}`,
          `Market: ${selected.market.slug ?? ""}`,
          `Question: ${selected.market.question ?? ""}`,
          `ConditionId: ${selected.market.conditionId ?? ""}`,
          `TokenIds: ${parseTokenIds(selected.market.clobTokenIds).join(", ")}`,
          `Gamma min tick: ${selected.market.orderPriceMinTickSize ?? ""}`,
          `Gamma min size: ${selected.market.orderMinSize ?? ""}`,
          `CLOB tick response: ${JSON.stringify(tick)}`,
          `CLOB fee-rate response: ${JSON.stringify(feeRate)}`,
          `Order book saved: selected-order-book.json`
        ].join("\n")
      : "No eligible CLOB market found.",
    "",
    "## Remaining World Cup Market Metadata",
    "",
    "| Event | Market | ConditionId | Question | Rules text present | Token IDs |",
    "|---|---|---|---|---:|---|",
    ...markets.slice(0, 120).map(({ event, market }) => {
      const question = String(market.question ?? "").replaceAll("|", "\\|");
      return `| ${event.slug ?? ""} | ${market.slug ?? ""} | ${market.conditionId ?? ""} | ${question} | ${market.description ? "yes" : "no"} | ${parseTokenIds(market.clobTokenIds).join(", ")} |`;
    }),
    ""
  ];

  const reportPath = join(outDir, "REPORT.md");
  await writeText(reportPath, reportLines.join("\n"));
  await logManifest({
    type: "polymarket-smoke",
    endpoint: "Gamma events + CLOB book/tick/fee-rate",
    rows: markets.length,
    path: outDir
  });

  console.log(`Polymarket smoke saved: ${outDir}`);
  if (selected) {
    console.log(`Selected market: ${selected.market.question}`);
    console.log(`ConditionId: ${selected.market.conditionId}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
