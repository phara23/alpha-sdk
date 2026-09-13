import { afterEach, expect, it, vi } from 'vitest';
import { getRewardMarkets } from '../src/modules/markets.js';
import type { AlphaClientConfig } from '../src/types.js';

afterEach(() => vi.unstubAllGlobals());

it('returns ALPHA campaigns and preserves child budgets without changing USDC fields', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ markets: [
    { id: 'alpha', totalRewards: 0, alphaLpRewards: { dailyMicro: 100_000_000 } },
    { id: 'dual', totalRewards: 25_000_000, alphaLpRewards: { dailyMicro: 50_000_000 } },
    { id: 'parent', options: [{ id: 'child', alphaLpRewards: { inGameMicro: 5_000_000 } }] },
    { id: 'inactive', alphaLpRewards: { dailyMicro: 0, startsAt: 9999999999999 } },
  ] }) }));
  const markets = await getRewardMarkets({ apiKey: 'test', apiBaseUrl: 'https://example.test' } as AlphaClientConfig);
  expect(markets.map(market => market.id)).toEqual(['alpha', 'dual', 'parent']);
  expect(markets[1].totalRewards).toBe(25_000_000);
  expect(markets[2].options?.[0].alphaLpRewards?.inGameMicro).toBe(5_000_000);
});
