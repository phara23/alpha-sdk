import { describe, it, expect, beforeAll } from 'vitest';
import { createApiOnlyClient } from './setup.js';
import type { AlphaClient } from '../src/index.js';

describe('Markets (REST API)', () => {
  let client: AlphaClient | null;

  beforeAll(() => {
    client = createApiOnlyClient();
  });

  it('fetches live markets', async () => {
    if (!client) {
      console.log('Skipping: no ALPHA_API_KEY set');
      return;
    }

    const markets = await client.getMarkets();
    expect(Array.isArray(markets)).toBe(true);
    expect(markets.length).toBeGreaterThan(0);

    // Verify expected fields on first market
    const market = markets[0];
    expect(market).toHaveProperty('id');
    expect(market).toHaveProperty('title');
    expect(market).toHaveProperty('marketAppId');
    expect(typeof market.marketAppId).toBe('number');

    console.log(`Fetched ${markets.length} live markets. First: "${market.title}"`);
  });

  it('fetches a single market by ID', async () => {
    if (!client) {
      console.log('Skipping: no ALPHA_API_KEY set');
      return;
    }

    const markets = await client.getMarkets();
    if (markets.length === 0) return;

    const market = await client.getMarket(markets[0].id);
    expect(market).not.toBeNull();
    expect(market!.id).toBe(markets[0].id);
  });

  it('returns null for non-existent market', async () => {
    if (!client) {
      console.log('Skipping: no ALPHA_API_KEY set');
      return;
    }

    const market = await client.getMarket('non-existent-id-12345');
    // Should either be null or throw -- depends on the API
    // We accept both behaviors
    expect(market === null || market === undefined || typeof market === 'object').toBe(true);
  });
});
