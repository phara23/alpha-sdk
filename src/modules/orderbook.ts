import * as algosdk from 'algosdk';
import type {
  AlphaClientConfig,
  FullOrderbookSnapshot,
  Orderbook,
  OrderbookEntry,
  EscrowGlobalState,
  OpenOrder,
} from '../types.js';
import { decodeGlobalState } from '../utils/state.js';
import { DEFAULT_API_BASE_URL } from '../constants.js';

type EscrowApp = {
  appId: number;
  globalState: EscrowGlobalState;
};

const ORDERBOOK_READ_MAX_ATTEMPTS = 3;
const ORDERBOOK_READ_INITIAL_BACKOFF_MS = 150;
const ORDERBOOK_READ_MAX_BACKOFF_MS = 1000;

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const getErrorStatus = (error: unknown): number | undefined => {
  if (!error || typeof error !== 'object') return undefined;

  const candidate = error as {
    status?: unknown;
    response?: { status?: unknown };
  };

  const status = candidate.status ?? candidate.response?.status;
  return typeof status === 'number' ? status : undefined;
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error';
};

const isTransientReadError = (error: unknown): boolean => {
  const status = getErrorStatus(error);
  if (status === 408 || status === 429) return true;
  if (typeof status === 'number' && status >= 500) return true;

  const message = getErrorMessage(error).toLowerCase();
  return [
    'network request error',
    'timeout',
    'timed out',
    'temporarily unavailable',
    'service unavailable',
    'socket hang up',
    'connection reset',
    'econnreset',
    'etimedout',
    'failed to fetch',
  ].some((token) => message.includes(token));
};

const withReadRetry = async <T>(operation: () => Promise<T>): Promise<T> => {
  let attempt = 1;
  let backoffMs = ORDERBOOK_READ_INITIAL_BACKOFF_MS;

  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= ORDERBOOK_READ_MAX_ATTEMPTS || !isTransientReadError(error)) {
        throw error;
      }

      await sleep(backoffMs);
      attempt += 1;
      backoffMs = Math.min(backoffMs * 2, ORDERBOOK_READ_MAX_BACKOFF_MS);
    }
  }
};

const normalizeMarketAppId = (marketAppId: number): number => {
  if (!Number.isSafeInteger(marketAppId) || marketAppId <= 0) {
    throw new Error('marketAppId must be a positive integer.');
  }

  return marketAppId;
};

const isAlphaMarketState = (state: Record<string, unknown>): boolean =>
  ['yes_asset_id', 'no_asset_id', 'collateral_asset_id'].some((key) => {
    const value = state[key];
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
  });

const lookupMarketApplicationState = async (
  config: AlphaClientConfig,
  marketAppId: number,
): Promise<Record<string, unknown>> => {
  const appInfo: any = await withReadRetry(() => config.algodClient.getApplicationByID(marketAppId).do());
  const rawState = appInfo.params?.globalState ?? appInfo.params?.['global-state'] ?? [];
  return decodeGlobalState(rawState);
};

const isKnownAssetId = async (
  config: AlphaClientConfig,
  assetId: number,
): Promise<boolean> => {
  try {
    await withReadRetry(() => config.algodClient.getAssetByID(assetId).do());
    return true;
  } catch (error) {
    if (getErrorStatus(error) === 404) {
      return false;
    }

    throw error;
  }
};

const assertValidMarketAppId = async (
  config: AlphaClientConfig,
  marketAppId: number,
): Promise<number> => {
  const normalizedMarketAppId = normalizeMarketAppId(marketAppId);

  try {
    const marketState = await lookupMarketApplicationState(config, normalizedMarketAppId);
    if (!isAlphaMarketState(marketState)) {
      throw new Error(
        `Application ${normalizedMarketAppId} is not an Alpha market app. Pass market.marketAppId instead of a market UUID or asset ID.`,
      );
    }

    return normalizedMarketAppId;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Application ')) {
      throw error;
    }

    if (getErrorStatus(error) === 404) {
      if (await isKnownAssetId(config, normalizedMarketAppId)) {
        throw new Error(
          `Expected marketAppId but received asset ID ${normalizedMarketAppId}. Use market.marketAppId instead of yesAssetId/noAssetId.`,
        );
      }

      throw new Error(
        `Market app ${normalizedMarketAppId} was not found on-chain. Pass the Alpha market app ID, not a market UUID or asset ID.`,
      );
    }

    throw new Error(`Failed to validate marketAppId ${normalizedMarketAppId}: ${getErrorMessage(error)}`);
  }
};

/**
 * Fetches all non-deleted applications created by an address (paginated).
 */
const getAllCreatedApplications = async (
  indexerClient: algosdk.Indexer,
  address: string,
  limit: number = 100,
): Promise<any[]> => {
  let applications: any[] = [];
  let nextToken: string | undefined;
  let hasMore = true;

  while (hasMore) {
    const response: any = await withReadRetry(async () => {
      let query = indexerClient.lookupAccountCreatedApplications(address).limit(limit);
      if (nextToken) {
        query = query.nextToken(nextToken);
      }
      return query.do();
    });

    if (response.applications?.length) {
      applications = [...applications, ...response.applications];
    }

    // v3: response.nextToken, v2 fallback: response['next-token']
    const token = response.nextToken ?? response['next-token'];
    if (token) {
      nextToken = token;
    } else {
      hasMore = false;
    }
  }

  return applications.filter((a: any) => a.deleted === false);
};

/**
 * Fetches global state for a list of applications.
 */
const fetchApplicationsGlobalState = async (
  indexerClient: algosdk.Indexer,
  applications: any[],
): Promise<EscrowApp[]> => {
  return Promise.all(
    applications.map(async (app) => {
      const appId = app.id;
      try {
        const appInfo: any = await withReadRetry(() => indexerClient.lookupApplications(appId).do());
        const globalState: EscrowGlobalState = {};
        // v3: appInfo.application?.params?.globalState, v2: ['global-state']
        const rawGlobalState = appInfo.application?.params?.globalState ?? appInfo.application?.params?.['global-state'];

        if (rawGlobalState) {
          const decoded = decodeGlobalState(rawGlobalState);
          Object.assign(globalState, decoded);
        }

        return { appId: Number(appId), globalState };
      } catch {
        return { appId: 0, globalState: {} as EscrowGlobalState };
      }
    }),
  );
};

/**
 * Transforms raw escrow apps into orderbook entries.
 */
const transformOrders = (orders: EscrowApp[]): OrderbookEntry[] =>
  orders
    .filter((o) => o.appId > 0)
    .map((o) => ({
      price: o.globalState.price ?? 0,
      quantity: (o.globalState.quantity ?? 0) - (o.globalState.quantity_filled ?? 0),
      escrowAppId: o.appId,
      owner: o.globalState.owner ?? '',
    }));

/**
 * Fetches the full on-chain orderbook for a market.
 *
 * Reads all escrow apps created by the market app, decodes their global state,
 * and categorizes into yes/no bids/asks. Only includes limit orders (slippage === 0)
 * with unfilled quantity.
 *
 * @param config - Alpha client config
 * @param marketAppId - The market app ID
 * @returns The full orderbook with yes/no bids and asks
 */
export const getOrderbook = async (
  config: AlphaClientConfig,
  marketAppId: number,
): Promise<Orderbook> => {
  const validatedMarketAppId = await assertValidMarketAppId(config, marketAppId);
  // v3: getApplicationAddress returns Address object, need .toString()
  const appAddress = algosdk.getApplicationAddress(validatedMarketAppId).toString();
  const applications = await getAllCreatedApplications(config.indexerClient, appAddress);
  const appsWithState = await fetchApplicationsGlobalState(config.indexerClient, applications);

  const isOpenLimitOrder = (o: EscrowApp) =>
    (o.globalState.quantity ?? 0) > (o.globalState.quantity_filled ?? 0) &&
    o.globalState.slippage === 0;

  const yesBuyOrders = appsWithState.filter(
    (o) => o.globalState.side === 1 && o.globalState.position === 1 && isOpenLimitOrder(o),
  );
  const yesSellOrders = appsWithState.filter(
    (o) => o.globalState.side === 0 && o.globalState.position === 1 && isOpenLimitOrder(o),
  );
  const noBuyOrders = appsWithState.filter(
    (o) => o.globalState.side === 1 && o.globalState.position === 0 && isOpenLimitOrder(o),
  );
  const noSellOrders = appsWithState.filter(
    (o) => o.globalState.side === 0 && o.globalState.position === 0 && isOpenLimitOrder(o),
  );

  return {
    yes: {
      bids: transformOrders(yesBuyOrders),
      asks: transformOrders(yesSellOrders),
    },
    no: {
      bids: transformOrders(noBuyOrders),
      asks: transformOrders(noSellOrders),
    },
  };
};

/**
 * Fetches the open orders for a specific wallet on a market.
 *
 * Reads all escrow apps created by the market, filters by owner address,
 * and returns only unfilled orders.
 *
 * @param config - Alpha client config
 * @param marketAppId - The market app ID
 * @param walletAddress - Optional wallet address (defaults to config.activeAddress)
 * @returns Array of open orders belonging to the wallet
 */
export const getOpenOrders = async (
  config: AlphaClientConfig,
  marketAppId: number,
  walletAddress?: string,
): Promise<OpenOrder[]> => {
  const validatedMarketAppId = await assertValidMarketAppId(config, marketAppId);
  const owner = walletAddress ?? config.activeAddress;
  // v3: getApplicationAddress returns Address object, need .toString()
  const appAddress = algosdk.getApplicationAddress(validatedMarketAppId).toString();
  const applications = await getAllCreatedApplications(config.indexerClient, appAddress);
  const appsWithState = await fetchApplicationsGlobalState(config.indexerClient, applications);

  return appsWithState
    .filter(
      (o) =>
        o.globalState.owner === owner &&
        (o.globalState.quantity ?? 0) > (o.globalState.quantity_filled ?? 0),
    )
    .map((o) => ({
      escrowAppId: o.appId,
      marketAppId: validatedMarketAppId,
      position: (o.globalState.position ?? 0) as 0 | 1,
      side: o.globalState.side ?? 0,
      price: o.globalState.price ?? 0,
      quantity: o.globalState.quantity ?? 0,
      quantityFilled: o.globalState.quantity_filled ?? 0,
      slippage: o.globalState.slippage ?? 0,
      owner: o.globalState.owner ?? '',
    }));
};

// ============================================
// API-based order fetching (requires API key)
// ============================================

const normalizeApiOrder = (raw: any): OpenOrder => ({
  escrowAppId: Number(raw.escrowAppId ?? raw.orderId),
  marketAppId: Number(raw.marketAppId),
  position: (raw.orderPosition ?? 0) as 0 | 1,
  side: raw.orderSide === 'BUY' ? 1 : 0,
  price: raw.orderPrice ?? 0,
  quantity: raw.orderQuantity ?? 0,
  quantityFilled: raw.orderQuantityFilled ?? 0,
  slippage: raw.slippage ?? 0,
  owner: raw.senderWallet ?? '',
});

/**
 * Fetches all open orders for a wallet from the Alpha REST API.
 *
 * Paginates automatically through all results. Requires an API key.
 *
 * @param config - Alpha client config
 * @returns Array of open orders
 */
export const getWalletOrdersFromApi = async (config: AlphaClientConfig, walletAddress: string): Promise<OpenOrder[]> => {
  if (!config.apiKey) {
    throw new Error('apiKey is required for API-based market fetching. Retrieve an API key from the Alpha Arcade platform via the Account page and pass it to the client.');
  }

  const baseUrl = config.apiBaseUrl ?? DEFAULT_API_BASE_URL;
  const allOrders: OpenOrder[] = [];
  let cursor: string | undefined;
  let hasMore = true;

  while (hasMore) {
    const params = new URLSearchParams({ wallet: walletAddress, limit: '300' });
    if (cursor) {
      params.set('cursor', cursor);
    }

    const url = `${baseUrl}/get-wallet-orders?${params.toString()}`;
    const response = await fetch(url, { headers: { 'x-api-key': config.apiKey } });

    if (!response.ok) {
      throw new Error(`Alpha API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (Array.isArray(data)) {
      allOrders.push(...data.map(normalizeApiOrder));
      hasMore = false;
    } else if (data.orders) {
      allOrders.push(...data.orders.map(normalizeApiOrder));
      cursor = data.nextCursor ?? undefined;
      hasMore = data.hasMore === true && !!cursor;
    } else {
      hasMore = false;
    }
  }

  return allOrders;
};

/**
 * Fetches the full processed orderbook snapshot for a market from the Alpha REST API.
 *
 * Returns the same shape as websocket `orderbook_changed.orderbook`: a record keyed by
 * `marketAppId`, where each value contains aggregated bids/asks plus detailed yes/no orders.
 * Requires an API key.
 *
 * @param config - Alpha client config
 * @param marketId - The Alpha market UUID
 * @returns Full processed market orderbook keyed by marketAppId
 */
export const getFullOrderbookFromApi = async (
  config: AlphaClientConfig,
  marketId: string,
): Promise<FullOrderbookSnapshot> => {
  if (!config.apiKey) {
    throw new Error('apiKey is required for API-based orderbook fetching. Retrieve an API key from the Alpha Arcade platform via the Account page and pass it to the client.');
  }

  const baseUrl = config.apiBaseUrl ?? DEFAULT_API_BASE_URL;
  const url = `${baseUrl}/get-full-orderbook?marketId=${encodeURIComponent(marketId)}`;
  const response = await fetch(url, { headers: { 'x-api-key': config.apiKey } });

  if (!response.ok) {
    throw new Error(`Alpha API error: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<FullOrderbookSnapshot>;
};
