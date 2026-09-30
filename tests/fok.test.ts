import * as algosdk from 'algosdk';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { AlphaClient } from '../src/client.js';
import { getOrderbook } from '../src/modules/orderbook.js';
import { getMarketGlobalState, checkAssetOptIn } from '../src/utils/state.js';
import { selectFokMatches } from '../src/utils/fok.js';
import type { AlphaClientConfig, CreateFokOrderParams, Orderbook, OrderbookEntry } from '../src/types.js';

vi.hoisted(() => vi.resetModules());

vi.mock('../src/modules/orderbook.js', () => ({ getOrderbook: vi.fn() }));
vi.mock('../src/utils/state.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/utils/state.js')>(),
  getMarketGlobalState: vi.fn(), checkAssetOptIn: vi.fn(),
}));

const owner = algosdk.generateAccount().addr.toString();
const maker = algosdk.generateAccount().addr.toString();
const feeAddress = algosdk.generateAccount().addr.toString();
const params: CreateFokOrderParams = {
  marketAppId: 100, position: 1, isBuying: true, price: 600_000, quantity: 100_000_000,
};
const entry = (escrowAppId: number, quantity: number, price = 600_000): OrderbookEntry =>
  ({ escrowAppId, quantity, price, owner: maker });
const book = (asks: OrderbookEntry[] = []): Orderbook => ({
  yes: { asks, bids: [] }, no: { asks: [], bids: [] },
});
const three = () => book([entry(200, 40_000_000, 550_000), entry(201, 35_000_000), entry(202, 25_000_000)]);

let config: AlphaClientConfig;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getOrderbook).mockResolvedValue(three());
  vi.mocked(checkAssetOptIn).mockResolvedValue(true);
  vi.mocked(getMarketGlobalState).mockResolvedValue({
    yes_asset_id: 101, no_asset_id: 102, collateral_asset_id: 103,
    fee_base_percent: 70_000, fee_address: feeAddress,
  } as Awaited<ReturnType<typeof getMarketGlobalState>>);
  config = {
    activeAddress: owner, signer: vi.fn(async () => []), matcherAppId: 104, usdcAssetId: 103,
    algodClient: {
      getTransactionParams: () => ({ do: async () => ({
        fee: 0, minFee: 1000, firstValid: 1000, lastValid: 1100,
        genesisHash: new Uint8Array(32), genesisID: 'test',
      }) }),
      getApplicationByID: () => ({ do: async () => ({
        params: { creator: algosdk.Address.fromString(owner), approvalProgram: new Uint8Array(), clearStateProgram: new Uint8Array() },
      }) }),
      pendingTransactionInformation: () => ({ do: async () => ({ innerTxns: [{ applicationIndex: 999n }] }) }),
    } as unknown as AlphaClientConfig['algodClient'],
    indexerClient: {} as AlphaClientConfig['indexerClient'],
  };
});
afterEach(() => { vi.restoreAllMocks(); });

describe('FOK liquidity selection', () => {
  it('combines direct and complementary makers, best price first, and trims the last fill', () => {
    const b = book([entry(200, 60_000_000, 590_000)]);
    b.no.bids = [entry(201, 50_000_000, 450_000)];
    expect(selectFokMatches(params, b, owner)).toEqual([
      { ...entry(201, 50_000_000, 550_000) }, entry(200, 50_000_000, 590_000),
    ]);
  });
  it.each([0, 1] as const)('supports sell price floors for position %s', position => {
    const b = book();
    const direct = position === 1 ? b.yes : b.no;
    const complement = position === 1 ? b.no : b.yes;
    direct.bids = [entry(200, 40_000_000, 610_000), entry(202, 100_000_000, 599_999)];
    complement.asks = [entry(201, 60_000_000, 350_000)];
    const fills = selectFokMatches({ ...params, position, isBuying: false }, b, owner);
    expect(fills.map(f => [f.escrowAppId, f.price])).toEqual([[201, 650_000], [200, 610_000]]);
  });
  it('supports NO buys and excludes self liquidity and prices above the limit', () => {
    const b = book();
    b.no.asks = [entry(200, 100_000_000, 600_001), { ...entry(201, 100_000_000), owner }];
    b.yes.bids = [entry(202, 100_000_000, 400_000)];
    expect(selectFokMatches({ ...params, position: 0 }, b, owner).map(f => f.escrowAppId)).toEqual([202]);
  });
  it('rejects insufficient liquidity rather than returning a partial fill', () => {
    expect(() => selectFokMatches(params, book([entry(200, 99_000_000)]), owner)).toThrow('exact full-quantity');
  });
  it('checks selected counterparties and uses current prices instead of caller metadata', () => {
    const fills = [entry(200, 100_000_000, 1)];
    expect(selectFokMatches({ ...params, matchingOrders: fills }, book([entry(200, 200_000_000)]), owner))
      .toEqual([entry(200, 100_000_000)]);
    expect(() => selectFokMatches({ ...params, matchingOrders: fills }, book([entry(200, 99_000_000)]), owner))
      .toThrow('insufficient quantity');
    expect(() => selectFokMatches({ ...params, matchingOrders: [{ ...fills[0], owner }] }, three(), owner))
      .toThrow('selected maker');
  });
  it('rejects duplicate makers, empty selections, and overfills', () => {
    const b = book([entry(200, 200_000_000)]);
    for (const fills of [[], [entry(200, 101_000_000)], [entry(200, 50_000_000), entry(200, 50_000_000)]]) {
      expect(() => selectFokMatches({ ...params, matchingOrders: fills }, b, owner)).toThrow('FOK');
    }
  });
  it('rejects depth that needs more than one group', () => {
    const b = book(Array.from({ length: 7 }, (_, i) => entry(200 + i, 1_000_000)));
    expect(() => selectFokMatches({ ...params, quantity: 7_000_000 }, b, owner)).toThrow('maximum 6');
  });
});

describe('FOK transaction construction', () => {
  it('builds one unsigned group with exact quantities and correct new-escrow offsets', async () => {
    const built = await new AlphaClient(config).buildFokOrder(params);
    expect(built.transactions).toHaveLength(9);
    expect(built.createEscrowTxnIndex).toBe(2);
    expect(built.matchedQuantity).toBe(100_000_000);
    expect(built.estimatedMatchedPrice).toBe(580_000);
    expect(config.signer).not.toHaveBeenCalled();
    for (const txn of built.transactions) expect(txn.group).toEqual(built.groupId);
    const create = built.transactions[2].applicationCall!;
    expect(algosdk.decodeUint64(create.appArgs[2], 'safe')).toBe(params.quantity);
    expect(algosdk.decodeUint64(create.appArgs[3], 'safe')).toBe(0);
    for (const [i, quantity] of [40_000_000, 35_000_000, 25_000_000].entries()) {
      const call = built.transactions[4 + i * 2].applicationCall!;
      expect(algosdk.decodeUint64(call.appArgs[3], 'safe')).toBe(quantity);
      expect(algosdk.decodeUint64(call.appArgs[7], 'safe')).toBe(2 + i * 2);
    }
  });
  it('fits six makers plus an opt-in in one group and keeps offsets correct', async () => {
    vi.mocked(checkAssetOptIn).mockResolvedValue(false);
    vi.mocked(getOrderbook).mockResolvedValue(book(Array.from({ length: 6 }, (_, i) => entry(200 + i, 1_000_000))));
    const built = await new AlphaClient(config).buildFokOrder({ ...params, quantity: 6_000_000 });
    expect(built.transactions).toHaveLength(16);
    expect(built.createEscrowTxnIndex).toBe(3);
    expect(algosdk.decodeUint64(built.transactions[15].applicationCall!.appArgs[7], 'safe')).toBe(12);
  });
  it('rejects insufficient coverage before signing or building transactions', async () => {
    vi.mocked(getOrderbook).mockResolvedValue(book([entry(200, 99_000_000)]));
    await expect(new AlphaClient(config).createFokOrder(params)).rejects.toThrow('exact full-quantity');
    expect(config.signer).not.toHaveBeenCalled();
    expect(getMarketGlobalState).not.toHaveBeenCalled();
  });
  it('keeps existing market-order slippage and partial-fill behavior', async () => {
    const execute = vi.spyOn(algosdk.AtomicTransactionComposer.prototype, 'execute').mockImplementation(async function () {
      const txns = this.buildGroup();
      expect(algosdk.decodeUint64(txns[2].txn.applicationCall!.appArgs[3], 'safe')).toBe(10_000);
      return { confirmedRound: 1234n, txIDs: ['0', '1', '2'], methodResults: [] };
    });
    const result = await new AlphaClient(config).createMarketOrder({
      ...params, slippage: 10_000, matchingOrders: [entry(200, 40_000_000)],
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.matchedQuantity).toBe(40_000_000);
  });
  it('executes once and returns a confirmed full quantity', async () => {
    const execute = vi.spyOn(algosdk.AtomicTransactionComposer.prototype, 'execute').mockResolvedValue({
      confirmedRound: 1234n, txIDs: ['0', '1', '2'], methodResults: [],
    });
    const result = await new AlphaClient(config).createFokOrder(params);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ escrowAppId: 999, matchedQuantity: 100_000_000, estimatedMatchedPrice: 580_000 });
  });
  it('propagates a failed group without retrying or changing price', async () => {
    const execute = vi.spyOn(algosdk.AtomicTransactionComposer.prototype, 'execute').mockRejectedValue(new Error('maker rejected'));
    await expect(new AlphaClient(config).createFokOrder(params)).rejects.toThrow('maker rejected');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(getOrderbook).toHaveBeenCalledTimes(1);
  });
  it.each([0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid quantity %s before reads', async quantity => {
    await expect(new AlphaClient(config).buildFokOrder({ ...params, quantity })).rejects.toThrow('quantity');
    expect(getOrderbook).not.toHaveBeenCalled();
    expect(config.signer).not.toHaveBeenCalled();
  });
});
