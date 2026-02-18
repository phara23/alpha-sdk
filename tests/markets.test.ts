import { describe, it, expect, beforeAll } from 'vitest';
import { createReadOnlyClient } from './setup.js';
import type { AlphaClient } from '../src/index.js';

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
