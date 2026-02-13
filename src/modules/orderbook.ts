import algosdk from 'algosdk';
import type { AlphaClientConfig, Orderbook, OrderbookEntry, EscrowGlobalState, OpenOrder } from '../types.js';
import { decodeGlobalState } from '../utils/state.js';

type EscrowApp = {
  appId: number;
  globalState: EscrowGlobalState;
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
    let query = indexerClient.lookupAccountCreatedApplications(address).limit(limit);
    if (nextToken) {
      query = query.nextToken(nextToken);
    }
    const response = await query.do();

    if (response.applications?.length) {
      applications = [...applications, ...response.applications];
    }

    if (response['next-token']) {
      nextToken = response['next-token'];
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
        const appInfo = await indexerClient.lookupApplications(appId).do();
        const globalState: EscrowGlobalState = {};
        const rawGlobalState = appInfo.application?.params?.['global-state'];

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
  const appAddress = algosdk.getApplicationAddress(marketAppId);
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
  const owner = walletAddress ?? config.activeAddress;
  const appAddress = algosdk.getApplicationAddress(marketAppId);
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
      marketAppId,
      position: (o.globalState.position ?? 0) as 0 | 1,
      side: o.globalState.side ?? 0,
      price: o.globalState.price ?? 0,
      quantity: o.globalState.quantity ?? 0,
      quantityFilled: o.globalState.quantity_filled ?? 0,
      slippage: o.globalState.slippage ?? 0,
      owner: o.globalState.owner ?? '',
    }));
};
