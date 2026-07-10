import { GammaMappingRefresher } from "../ingest/polymarket/gamma-discovery.js";

const refresher = new GammaMappingRefresher();
const registry = await refresher.refresh();
const summary = refresher.lastSummary;
if (!summary) throw new Error("Gamma discovery did not produce a summary");
const tradeableAssets = registry
  .assetIds()
  .filter((assetId) => registry.resolveAsset(assetId).tradeable).length;
const result = {
  sourceEvents: summary.discovery.sourceEvents,
  openMatchFamilyEvents: summary.discovery.matchEvents.length,
  refreshedCandidateRecords: summary.build.counts.mappingRecords,
  refreshedCandidateAssets: summary.build.counts.assets,
  mergedRegistryAssets: registry.assetIds().length,
  tradeableAssets
};
if (result.openMatchFamilyEvents === 0 || result.mergedRegistryAssets === 0 || tradeableAssets !== 0) {
  throw new Error(`Gamma discovery smoke failed: ${JSON.stringify(result)}`);
}
console.log(JSON.stringify(result, null, 2));
