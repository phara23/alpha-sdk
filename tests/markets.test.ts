import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { createReadOnlyClient } from './setup.js';
import type { AlphaClient } from '../src/index.js';
import { getRewardMarkets } from '../src/modules/markets.js';

describe('Markets (on-chain)', () => {
  let client: AlphaClient;

  beforeAll(() => {
    client = createReadOnlyClient();
  });

  it('fetches live markets from chain', async () => {
    const markets = await client.getMarketsOnChain();
    expect(Array.isArray(markets)).toBe(true);
    expect(markets.length).toBeGreaterThan(0);

    const market = markets[0];
    expect(market).toHaveProperty('id');
    expect(market).toHaveProperty('title');
    expect(market).toHaveProperty('marketAppId');
    expect(typeof market.marketAppId).toBe('number');
    expect(market.yesAssetId).toBeGreaterThan(0);
    expect(market.noAssetId).toBeGreaterThan(0);
    expect(market.source).toBe('onchain');

    console.log(`Fetched ${markets.length} live markets on-chain. First: "${market.title}"`);
  });

  it('fetches a single market by app ID from chain', async () => {
    const markets = await client.getMarketsOnChain();
    if (markets.length === 0) return;

    const market = await client.getMarketOnChain(markets[0].marketAppId);
    expect(market).not.toBeNull();
    expect(market!.marketAppId).toBe(markets[0].marketAppId);
    expect(market!.title).toBe(markets[0].title);
    expect(market!.source).toBe('onchain');
  });

  it('returns null for non-existent market app ID', async () => {
    const market = await client.getMarketOnChain(999999999);
    expect(market).toBeNull();
  });
});

describe('Markets (REST API)', () => {
  let client: AlphaClient;

  beforeAll(() => {
    client = createReadOnlyClient();
  });

  it('fetches live markets from API', async () => {
    if (!process.env.ALPHA_API_KEY) {
      console.log('Skipping API test: no ALPHA_API_KEY set');
      return;
    }

    const markets = await client.getLiveMarketsFromApi();
    expect(Array.isArray(markets)).toBe(true);
    expect(markets.length).toBeGreaterThan(0);

    const market = markets[0];
    expect(market).toHaveProperty('id');
    expect(market).toHaveProperty('title');
    expect(market.source).toBe('api');

    console.log(`Fetched ${markets.length} live markets from API. First: "${market.title}"`);
  });

  it('fetches a single market by ID from API', async () => {
    if (!process.env.ALPHA_API_KEY) {
      console.log('Skipping API test: no ALPHA_API_KEY set');
      return;
    }

    const markets = await client.getLiveMarketsFromApi();
    if (markets.length === 0) return;

    const market = await client.getMarketFromApi(markets[0].id);
    expect(market).not.toBeNull();
    expect(market!.id).toBe(markets[0].id);
  });
});

describe('getRewardMarkets', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('includes top-level, pregame, and grouped option reward markets', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: 'classic-reward',
          title: 'Classic reward market',
          marketAppId: 1,
          yesAssetId: 11,
          noAssetId: 12,
          endTs: 1774323000000,
          totalRewards: 5_000_000,
        },
        {
          id: 'pregame-reward',
          title: 'Spread reward market',
          marketAppId: 2,
          yesAssetId: 21,
          noAssetId: 22,
          endTs: 1774323000000,
          totalRewards: 0,
          totalPregameRewards: 5_000_000,
        },
        {
          id: 'grouped-parent',
          title: 'Grouped reward market',
          marketAppId: 3,
          yesAssetId: 31,
          noAssetId: 32,
          endTs: 1774323000000,
          totalRewards: 0,
          options: [
            {
              id: 'grouped-child',
              title: 'Child option',
              marketAppId: 33,
              yesAssetId: 331,
              noAssetId: 332,
              yesProb: 0,
              noProb: 0,
              totalRewards: 7_500_000,
            },
          ],
        },
        {
          id: 'no-reward',
          title: 'No reward market',
          marketAppId: 4,
          yesAssetId: 41,
          noAssetId: 42,
          endTs: 1774323000000,
          totalRewards: 0,
          totalPregameRewards: 0,
        },
      ],
    });

    vi.stubGlobal('fetch', fetchMock);

    const markets = await getRewardMarkets({
      apiKey: 'test-api-key',
      apiBaseUrl: 'https://example.com/api',
    } as any);

    expect(markets.map((market) => market.id)).toEqual([
      'classic-reward',
      'pregame-reward',
      'grouped-parent',
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/api/get-live-markets-cached?limit=500',
      { headers: { 'x-api-key': 'test-api-key' } },
    );
  });

  it('paginates reward markets from the cached API endpoint', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          markets: [
            {
              id: 'first-page-reward',
              title: 'First page reward market',
              marketAppId: 1,
              yesAssetId: 11,
              noAssetId: 12,
              endTs: 1774323000000,
              totalRewards: 5_000_000,
            },
          ],
          lastEvaluatedKey: 'next-page',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          markets: [
            {
              id: 'second-page-reward',
              title: 'Second page reward market',
              marketAppId: 2,
              yesAssetId: 21,
              noAssetId: 22,
              endTs: 1774323000000,
              totalPregameRewards: 5_000_000,
            },
          ],
        }),
      });

    vi.stubGlobal('fetch', fetchMock);

    const markets = await getRewardMarkets({
      apiKey: 'test-api-key',
      apiBaseUrl: 'https://example.com/api',
    } as any);

    expect(markets.map((market) => market.id)).toEqual([
      'first-page-reward',
      'second-page-reward',
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://example.com/api/get-live-markets-cached?limit=500&lastEvaluatedKey=next-page',
      { headers: { 'x-api-key': 'test-api-key' } },
    );
  });
});
