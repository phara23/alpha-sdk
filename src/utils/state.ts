import algosdk from 'algosdk';
import type { EscrowGlobalState, MarketGlobalState } from '../types.js';

/**
 * Decodes raw Algorand global state array into a key-value object.
 *
 * @param rawState - The raw global-state array from algod/indexer
 * @returns Decoded key-value object
 */
export const decodeGlobalState = (rawState: any[]): Record<string, any> => {
  const state: Record<string, any> = {};

  for (const item of rawState) {
    const key = Buffer.from(item.key, 'base64').toString();

    if (item.value.type === 1) {
      // Bytes value
      if (key === 'owner' || key === 'oracle_address' || key === 'fee_address' ||
        key === 'market_friend_addr' || key === 'escrow_cancel_address') {
        try {
          const addressBytes = Buffer.from(item.value.bytes, 'base64');
          if (addressBytes.length === 32) {
            state[key] = algosdk.encodeAddress(addressBytes);
          } else {
            state[key] = item.value.bytes;
          }
        } catch {
          state[key] = item.value.bytes;
        }
      } else {
        try {
          state[key] = Buffer.from(item.value.bytes, 'base64').toString();
        } catch {
          state[key] = item.value.bytes;
        }
      }
    } else {
      // Uint value
      state[key] = Number(item.value.uint);
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
  const appInfo = await algodClient.getApplicationByID(marketAppId).do();
  const rawState = appInfo.params?.['global-state'] ?? appInfo['params']?.['global-state'] ?? [];
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
  const appInfo = await indexerClient.lookupApplications(escrowAppId).do();
  const rawState = appInfo.application?.params?.['global-state'] ?? [];
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
    const accountInfo = await algodClient.accountInformation(address).do();
    const assets = accountInfo.assets || accountInfo['assets'] || [];
    return assets.some((a: any) => (a['asset-id'] ?? a.assetId) === assetId);
  } catch {
    return false;
  }
};
