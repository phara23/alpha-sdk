import type { AlphaClientConfig, Market } from '../types.js';

const DEFAULT_API_BASE_URL = 'https://partners.alphaarcade.com/api';

/**
 * Fetches all live, tradeable markets from the Alpha REST API.
 *
 * Paginates automatically through all results.
 *
 * @param config - Alpha client config
 * @returns Array of live markets
 */
export const getMarkets = async (config: AlphaClientConfig): Promise<Market[]> => {
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
      allMarkets.push(...data);
      hasMore = false;
    } else if (data.markets) {
      allMarkets.push(...data.markets);
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
 *
 * @param config - Alpha client config
 * @param marketId - The market ID
 * @returns The market data, or null if not found
 */
export const getMarket = async (
  config: AlphaClientConfig,
  marketId: string,
): Promise<Market | null> => {
  const baseUrl = config.apiBaseUrl ?? DEFAULT_API_BASE_URL;
  const url = `${baseUrl}/get-market?marketId=${encodeURIComponent(marketId)}`;
  const response = await fetch(url, { headers: { 'x-api-key': config.apiKey } });

  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`Alpha API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.market ?? data ?? null;
};
