import { afterEach, expect, it, vi } from 'vitest';
import { getRewardMarkets, getLiveMarketsFromApi, getMarketFromApi } from '../src/modules/markets.js';
import type { AlphaClientConfig } from '../src/types.js';

afterEach(() => vi.unstubAllGlobals());

it('returns ALPHA campaigns and preserves child budgets without changing USDC fields', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ markets: [
    { id: 'alpha', totalRewards: 0, alphaLpRewards: { dailyMicro: 100_000_000 } },
    { id: 'dual', totalRewards: 25_000_000, alphaLpRewards: { dailyMicro: 50_000_000 } },
    { id: 'parent', options: [{ id: 'child', alphaLpRewards: { inGameMicro: 5_000_000 } }] },
    { id: 'inactive', alphaLpRewards: { dailyMicro: 0, startsAt: 9999999999999 } },
  ] }) }));
  const markets = await getRewardMarkets({ apiKey: 'test', apiBaseUrl: 'https://example.test' });
  expect(markets.map(market => market.id)).toEqual(['alpha', 'dual', 'parent']);
  expect(markets[1].totalRewards).toBe(25_000_000);
  expect(markets[2].options?.[0].alphaLpRewards?.inGameMicro).toBe(5_000_000);
});

it('preserves ALPHA units and start time across live-list and single-market API reads', async () => {
  const alphaLpRewards = { dailyMicro: 12_345_678, startsAt: 1_800_000_000_000 };
  const market = { id: 'dual', marketAppId: 123, totalRewards: 25_000_000, endTs: 1_900_000_000_000, alphaLpRewards };
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ markets: [market] }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ market }) }));
  const config = { apiKey: 'test', apiBaseUrl: 'https://example.test' } as AlphaClientConfig;
  const live = await getLiveMarketsFromApi(config);
  const single = await getMarketFromApi(config, 'dual');
  for (const result of [live[0], single]) {
    expect(result?.alphaLpRewards).toEqual(alphaLpRewards);
    expect(result?.totalRewards).toBe(25_000_000);
    expect(result?.endTs).toBe(1_900_000_000);
  }
});
