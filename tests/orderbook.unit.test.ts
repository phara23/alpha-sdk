import algosdk from 'algosdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getOpenOrders, getOrderbook } from '../src/modules/orderbook.js';
import type { AlphaClientConfig } from '../src/types.js';

const encodeUintState = (key: string, value: number) => ({
  key: Buffer.from(key).toString('base64'),
  value: { type: 2, uint: value },
});

const encodeAddressState = (key: string, address: string) => ({
  key: Buffer.from(key).toString('base64'),
  value: {
    type: 1,
    bytes: Buffer.from(algosdk.decodeAddress(address).publicKey).toString('base64'),
  },
});

const createConfig = (): AlphaClientConfig => {
  const account = algosdk.generateAccount();

  return {
    algodClient: {} as AlphaClientConfig['algodClient'],
    indexerClient: {} as AlphaClientConfig['indexerClient'],
    signer: (async () => []) as AlphaClientConfig['signer'],
    activeAddress: account.addr.toString(),
    matcherAppId: 1,
    usdcAssetId: 31566704,
  };
};

describe('orderbook module', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects asset IDs before scanning escrow apps', async () => {
    const config = createConfig();
    const getApplicationByID = vi.fn(() => ({
      do: vi.fn().mockRejectedValue({ status: 404, message: 'app not found' }),
    }));
    const getAssetByID = vi.fn(() => ({
      do: vi.fn().mockResolvedValue({}),
    }));

    config.algodClient = {
      getApplicationByID,
      getAssetByID,
    } as unknown as AlphaClientConfig['algodClient'];
    config.indexerClient = {
      lookupAccountCreatedApplications: vi.fn(),
      lookupApplications: vi.fn(),
    } as unknown as AlphaClientConfig['indexerClient'];

    await expect(getOrderbook(config, 3135300076)).rejects.toThrow(
      'Expected marketAppId but received asset ID 3135300076',
    );
    expect(getApplicationByID).toHaveBeenCalledWith(3135300076);
    expect(getAssetByID).toHaveBeenCalledWith(3135300076);
  });

  it('retries transient created-app lookups before building the orderbook', async () => {
    const config = createConfig();
    let createdAppsAttempts = 0;

    config.algodClient = {
      getApplicationByID: vi.fn(() => ({
        do: vi.fn().mockResolvedValue({
          params: {
            globalState: [
              encodeUintState('yes_asset_id', 11),
              encodeUintState('no_asset_id', 12),
              encodeUintState('collateral_asset_id', 31566704),
            ],
          },
        }),
      })),
      getAssetByID: vi.fn(),
    } as unknown as AlphaClientConfig['algodClient'];

    config.indexerClient = {
      lookupAccountCreatedApplications: vi.fn(() => ({
        limit: vi.fn().mockReturnThis(),
        nextToken: vi.fn().mockReturnThis(),
        do: vi.fn().mockImplementation(async () => {
          createdAppsAttempts += 1;
          if (createdAppsAttempts === 1) {
            throw { status: 503, message: 'service unavailable' };
          }

          return {
            applications: [{ id: 9001, deleted: false }],
          };
        }),
      })),
      lookupApplications: vi.fn(() => ({
        do: vi.fn().mockResolvedValue({
          application: {
            params: {
              globalState: [],
            },
          },
        }),
      })),
    } as unknown as AlphaClientConfig['indexerClient'];

    const orderbook = await getOrderbook(config, 3135299970);

    expect(createdAppsAttempts).toBe(2);
    expect(orderbook).toEqual({
      yes: { bids: [], asks: [] },
      no: { bids: [], asks: [] },
    });
  });

  it('retries transient escrow reads before returning open orders', async () => {
    const config = createConfig();
    let lookupApplicationsAttempts = 0;

    config.algodClient = {
      getApplicationByID: vi.fn(() => ({
        do: vi.fn().mockResolvedValue({
          params: {
            globalState: [
              encodeUintState('yes_asset_id', 11),
              encodeUintState('no_asset_id', 12),
              encodeUintState('collateral_asset_id', 31566704),
            ],
          },
        }),
      })),
      getAssetByID: vi.fn(),
    } as unknown as AlphaClientConfig['algodClient'];

    config.indexerClient = {
      lookupAccountCreatedApplications: vi.fn(() => ({
        limit: vi.fn().mockReturnThis(),
        nextToken: vi.fn().mockReturnThis(),
        do: vi.fn().mockResolvedValue({
          applications: [{ id: 9002, deleted: false }],
        }),
      })),
      lookupApplications: vi.fn(() => ({
        do: vi.fn().mockImplementation(async () => {
          lookupApplicationsAttempts += 1;
          if (lookupApplicationsAttempts === 1) {
            throw { status: 502, message: 'network request error' };
          }

          return {
            application: {
              params: {
                globalState: [
                  encodeUintState('position', 1),
                  encodeUintState('side', 1),
                  encodeUintState('price', 525000),
                  encodeUintState('quantity', 1000000),
                  encodeUintState('quantity_filled', 250000),
                  encodeUintState('slippage', 0),
                  encodeAddressState('owner', config.activeAddress),
                ],
              },
            },
          };
        }),
      })),
    } as unknown as AlphaClientConfig['indexerClient'];

    const orders = await getOpenOrders(config, 3135299970);

    expect(lookupApplicationsAttempts).toBe(2);
    expect(orders).toEqual([
      {
        escrowAppId: 9002,
        marketAppId: 3135299970,
        position: 1,
        side: 1,
        price: 525000,
        quantity: 1000000,
        quantityFilled: 250000,
        slippage: 0,
        owner: config.activeAddress,
      },
    ]);
  });
});
