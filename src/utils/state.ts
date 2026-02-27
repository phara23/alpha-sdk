import * as algosdk from 'algosdk';
import type { EscrowGlobalState, MarketGlobalState } from '../types.js';

/**
 * Decodes raw Algorand global state array into a key-value object.
 * Supports both v2 (kebab-case) and v3 (camelCase) response shapes.
 *
 * @param rawState - The raw global-state array from algod/indexer
 * @returns Decoded key-value object
 */
export const decodeGlobalState = (rawState: any[]): Record<string, any> => {
  const state: Record<string, any> = {};

  for (const item of rawState) {
    const rawKey = item.key;
    const key = typeof rawKey === 'string'
      ? Buffer.from(rawKey, 'base64').toString()
      : rawKey instanceof Uint8Array
        ? Buffer.from(rawKey).toString()
        : String(rawKey);

    const val = item.value;
    const type = val.type;

    if (type === 1) {
      // Bytes value
      if (key === 'owner' || key === 'oracle_address' || key === 'fee_address' ||
        key === 'market_friend_addr' || key === 'escrow_cancel_address') {
        try {
          const rawBytes = val.bytes;
          const addressBytes = typeof rawBytes === 'string'
            ? Buffer.from(rawBytes, 'base64')
            : rawBytes instanceof Uint8Array
              ? rawBytes
              : Buffer.from(String(rawBytes), 'base64');
          if (addressBytes.length === 32) {
            state[key] = algosdk.encodeAddress(new Uint8Array(addressBytes));
          } else {
            state[key] = val.bytes;
          }
        } catch {
          state[key] = val.bytes;
        }
      } else {
        try {
          const rawBytes = val.bytes;
          if (typeof rawBytes === 'string') {
            state[key] = Buffer.from(rawBytes, 'base64').toString();
          } else if (rawBytes instanceof Uint8Array) {
            state[key] = Buffer.from(rawBytes).toString();
          } else {
            state[key] = rawBytes;
          }
        } catch {
          state[key] = val.bytes;
        }
      }
    } else {
      // Uint value
      state[key] = Number(val.uint);
    }
  }

  return state;
};

/**
 * Reads the global state of a market app from the chain.
 *
 * @param algodClient - Algod client
 * @param marketAppId - The market app ID
 * @returns Decoded market global state
 */
export const getMarketGlobalState = async (
  algodClient: algosdk.Algodv2,
  marketAppId: number,
): Promise<MarketGlobalState> => {
  const appInfo: any = await algodClient.getApplicationByID(marketAppId).do();
  // v3: appInfo.params.globalState, v2 fallback: appInfo.params?.['global-state']
  const rawState = appInfo.params?.globalState ?? appInfo.params?.['global-state'] ?? [];
  return decodeGlobalState(rawState) as MarketGlobalState;
};

/**
 * Reads the global state of an escrow app via the indexer.
 *
 * @param indexerClient - Indexer client
 * @param escrowAppId - The escrow app ID
 * @returns Decoded escrow global state
 */
export const getEscrowGlobalState = async (
  indexerClient: algosdk.Indexer,
  escrowAppId: number,
): Promise<EscrowGlobalState> => {
  const appInfo: any = await indexerClient.lookupApplications(escrowAppId).do();
  // v3: appInfo.application?.params?.globalState, v2 fallback: ['global-state']
  const rawState = appInfo.application?.params?.globalState ?? appInfo.application?.params?.['global-state'] ?? [];
  return decodeGlobalState(rawState) as EscrowGlobalState;
};

/**
 * Checks if an address has opted into an ASA.
 *
 * @param algodClient - Algod client
 * @param address - The Algorand address to check
 * @param assetId - The ASA ID to check
 * @returns True if opted in
 */
export const checkAssetOptIn = async (
  algodClient: algosdk.Algodv2,
  address: string,
  assetId: number,
): Promise<boolean> => {
  try {
    const accountInfo: any = await algodClient.accountInformation(address).do();
    const assets = accountInfo.assets || [];
    // v3: a.assetId (bigint), v2: a['asset-id'] (number)
    return assets.some((a: any) => Number(a.assetId ?? a['asset-id']) === assetId);
  } catch {
    return false;
  }
};
