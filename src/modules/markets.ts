import algosdk from 'algosdk';
import type { AlphaClientConfig, Market, MarketGlobalState } from '../types.js';
import { decodeGlobalState } from '../utils/state.js';

const DEFAULT_API_BASE_URL = 'https://partners.alphaarcade.com/api';

/** The default Alpha Arcade mainnet market creator address */
export const DEFAULT_MARKET_CREATOR_ADDRESS = '5P5Y6HTWUNG2E3VXBQDZN3ENZD3JPAIR5PKT3LOYJAPAUKOLFD6KANYTRY';

/**
 * Groups multi-choice option markets under parent markets.
 *
 * Multi-choice options have titles in the format "Parent Title : Option Name".
 * Binary markets (no " : " in title) are returned as-is.
 * Multi-choice options are grouped into a single parent Market entry with an `options` array.
 */
const groupMultiChoiceMarkets = (flatMarkets: Market[]): Market[] => {
  const parentMap = new Map<string, Market>();
  const result: Market[] = [];

  for (const m of flatMarkets) {
    const separatorIdx = m.title.lastIndexOf(' : ');
    if (separatorIdx === -1) {
      // Binary market -- no grouping needed
      result.push(m);
      continue;
    }

    const parentTitle = m.title.substring(0, separatorIdx).trim();
    const optionTitle = m.title.substring(separatorIdx + 3).trim();

    let parent = parentMap.get(parentTitle);
    if (!parent) {
      // Create parent entry using the first option's metadata
      parent = {
        id: `group:${parentTitle}`,
        title: parentTitle,
        marketAppId: m.marketAppId, // Use first option's app ID as the parent's
        yesAssetId: 0,
        noAssetId: 0,
        endTs: m.endTs,
        isResolved: m.isResolved,
        isLive: m.isLive,
        feeBase: m.feeBase,
        source: 'onchain',
        options: [],
      };
      parentMap.set(parentTitle, parent);
      result.push(parent);
    }

    parent.options!.push({
      id: m.id,
      title: optionTitle,
      marketAppId: m.marketAppId,
      yesAssetId: m.yesAssetId,
      noAssetId: m.noAssetId,
      yesProb: 0,
      noProb: 0,
    });
  }

  return result;
};

// ============================================
// On-chain market discovery (no API key needed)
// ============================================

/**
 * Fetches all live, tradeable markets directly from the Algorand blockchain.
 *
 * Discovers markets by looking up all applications created by the market creator
 * address, then reading their global state. No API key required.
 *
 * @param config - Alpha client config
 * @param options - Optional filters
 * @returns Array of live markets
 */
export const getMarketsOnChain = async (
  config: AlphaClientConfig,
  options?: { activeOnly?: boolean },
): Promise<Market[]> => {
  const creatorAddress = config.marketCreatorAddress ?? DEFAULT_MARKET_CREATOR_ADDRESS;
  const activeOnly = options?.activeOnly ?? true;

  // Paginate through all created applications
  const allApps: any[] = [];
  let nextToken: string | undefined;
  let hasMore = true;

  while (hasMore) {
    let query = config.indexerClient.lookupAccountCreatedApplications(creatorAddress).limit(100);
    if (nextToken) {
      query = query.nextToken(nextToken);
    }
    const response = await query.do();

    if (response.applications?.length) {
      allApps.push(...response.applications);
    }

    if (response['next-token']) {
      nextToken = response['next-token'];
    } else {
      hasMore = false;
    }
  }

  // Filter out deleted apps and decode global state
  const flatMarkets: Market[] = [];
  for (const app of allApps) {
    if (app.deleted) continue;

    const rawState = app.params?.['global-state'];
    if (!rawState) continue;

    const state = decodeGlobalState(rawState) as MarketGlobalState;

    // Skip non-activated markets (no YES/NO tokens yet)
    if (activeOnly && !state.is_activated) continue;

    // Skip already resolved markets if activeOnly
    if (activeOnly && state.is_resolved) continue;

    // Skip markets past their resolution time (expired but not yet resolved)
    if (activeOnly && state.resolution_time && state.resolution_time < Math.floor(Date.now() / 1000)) continue;

    const appId = Number(app.id);

    flatMarkets.push({
      id: String(appId),
      title: state.title || '',
      marketAppId: appId,
      yesAssetId: state.yes_asset_id || 0,
      noAssetId: state.no_asset_id || 0,
      endTs: state.resolution_time || 0,
      isResolved: !!state.is_resolved,
      isLive: !!state.is_activated && !state.is_resolved,
      feeBase: state.fee_base_percent,
      source: 'onchain',
    });
  }

  // Group multi-choice options under parent markets.
  // Multi-choice titles use the format "Parent Title : Option Name"
  return groupMultiChoiceMarkets(flatMarkets);
};

/**
 * Fetches a single market by its app ID directly from the Algorand blockchain.
 *
 * @param config - Alpha client config
 * @param marketAppId - The market app ID (number or string)
 * @returns The market data, or null if not found
 */
export const getMarketOnChain = async (
  config: AlphaClientConfig,
  marketAppId: number | string,
): Promise<Market | null> => {
  try {
    const appId = typeof marketAppId === 'string' ? Number(marketAppId) : marketAppId;
    const appInfo = await config.algodClient.getApplicationByID(appId).do();
    const rawState = appInfo.params?.['global-state'] ?? appInfo['params']?.['global-state'] ?? [];
    const state = decodeGlobalState(rawState) as MarketGlobalState;

    return {
      id: String(appId),
      title: state.title || '',
      marketAppId: appId,
      yesAssetId: state.yes_asset_id || 0,
      noAssetId: state.no_asset_id || 0,
      endTs: state.resolution_time || 0,
      isResolved: !!state.is_resolved,
      isLive: !!state.is_activated && !state.is_resolved,
      feeBase: state.fee_base_percent,
      source: 'onchain',
    };
  } catch {
    return null;
  }
};

// ============================================
// API-based market fetching (requires API key)
// ============================================

/**
 * Fetches all live, tradeable markets from the Alpha REST API.
 *
 * Paginates automatically through all results. Requires an API key.
 * Returns richer data than on-chain lookup (images, categories, volume, probabilities).
 *
 * @param config - Alpha client config
 * @returns Array of live markets
 */
export const getMarketsFromApi = async (config: AlphaClientConfig): Promise<Market[]> => {
  if (!config.apiKey) {
    throw new Error('apiKey is required for API-based market fetching. Use getMarketsOnChain() instead, or pass an apiKey.');
  }

  const baseUrl = config.apiBaseUrl ?? DEFAULT_API_BASE_URL;
  const allMarkets: Market[] = [];
  let lastEvaluatedKey: string | undefined;
  let hasMore = true;

  while (hasMore) {
    const params = new URLSearchParams({ activeOnly: 'true', limit: '300' });
    if (lastEvaluatedKey) {
      params.set('lastEvaluatedKey', lastEvaluatedKey);
    }

    const url = `${baseUrl}/get-live-markets?${params.toString()}`;
    const response = await fetch(url, { headers: { 'x-api-key': config.apiKey } });

    if (!response.ok) {
      throw new Error(`Alpha API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (Array.isArray(data)) {
      allMarkets.push(...(data.map((m: any) => ({ ...m, source: 'api' as const }))));
      hasMore = false;
    } else if (data.markets) {
      allMarkets.push(...(data.markets.map((m: any) => ({ ...m, source: 'api' as const }))));
      lastEvaluatedKey = data.lastEvaluatedKey;
      hasMore = !!lastEvaluatedKey;
    } else {
      hasMore = false;
    }
  }

  return allMarkets;
};

/**
 * Fetches a single market by its ID from the Alpha REST API.
 * Requires an API key.
 *
 * @param config - Alpha client config
 * @param marketId - The market ID
 * @returns The market data, or null if not found
 */
export const getMarketFromApi = async (
  config: AlphaClientConfig,
  marketId: string,
): Promise<Market | null> => {
  if (!config.apiKey) {
    throw new Error('apiKey is required for API-based market fetching. Use getMarketOnChain() instead, or pass an apiKey.');
  }

  const baseUrl = config.apiBaseUrl ?? DEFAULT_API_BASE_URL;
  const url = `${baseUrl}/get-market?marketId=${encodeURIComponent(marketId)}`;
  const response = await fetch(url, { headers: { 'x-api-key': config.apiKey } });

  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`Alpha API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const market = data.market ?? data ?? null;
  if (market) market.source = 'api';
  return market;
};

// ============================================
// Smart defaults (on-chain first, API if key provided)
// ============================================

/**
 * Fetches all live markets. Uses the API if an apiKey is configured, otherwise falls back to on-chain discovery.
 *
 * @param config - Alpha client config
 * @returns Array of live markets
 */
export const getMarkets = async (config: AlphaClientConfig): Promise<Market[]> => {
  if (config.apiKey) {
    return getMarketsFromApi(config);
  }
  return getMarketsOnChain(config);
};

/**
 * Fetches a single market by ID. Uses the API if an apiKey is configured, otherwise reads from chain.
 *
 * @param config - Alpha client config
 * @param marketId - The market ID (UUID for API, app ID string for on-chain)
 * @returns The market data, or null if not found
 */
export const getMarket = async (
  config: AlphaClientConfig,
  marketId: string,
): Promise<Market | null> => {
  if (config.apiKey) {
    return getMarketFromApi(config, marketId);
  }
  return getMarketOnChain(config, marketId);
};
