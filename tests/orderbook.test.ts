import { describe, it, expect, beforeAll } from 'vitest';
import { createTestClient, getTestMarketAppId } from './setup.js';
import type { AlphaClient } from '../src/index.js';

describe('Orderbook (on-chain read)', () => {
  let client: AlphaClient | null;
  let marketAppId: number | null;

  beforeAll(() => {
    client = createTestClient();
    marketAppId = getTestMarketAppId();
  });

  it('fetches orderbook for a market', async () => {
    if (!client || !marketAppId) {
      console.log('Skipping: no TEST_MNEMONIC or TEST_MARKET_APP_ID set');
      return;
    }

    const book = await client.getOrderbook(marketAppId);

    expect(book).toHaveProperty('yes');
    expect(book).toHaveProperty('no');
    expect(book.yes).toHaveProperty('bids');
    expect(book.yes).toHaveProperty('asks');
    expect(book.no).toHaveProperty('bids');
    expect(book.no).toHaveProperty('asks');
    expect(Array.isArray(book.yes.bids)).toBe(true);
    expect(Array.isArray(book.yes.asks)).toBe(true);

    // Verify entry structure if orders exist
    const allEntries = [...book.yes.bids, ...book.yes.asks, ...book.no.bids, ...book.no.asks];
    if (allEntries.length > 0) {
      const entry = allEntries[0];
      expect(entry).toHaveProperty('price');
      expect(entry).toHaveProperty('quantity');
      expect(entry).toHaveProperty('escrowAppId');
      expect(entry).toHaveProperty('owner');
      expect(typeof entry.price).toBe('number');
      expect(typeof entry.quantity).toBe('number');
    }

    console.log(
      `Orderbook: ${book.yes.bids.length} YES bids, ${book.yes.asks.length} YES asks, ` +
      `${book.no.bids.length} NO bids, ${book.no.asks.length} NO asks ` +
      `(${allEntries.length} total orders)`,
    );
  });

  it('fetches open orders for a wallet', async () => {
    if (!client || !marketAppId) {
      console.log('Skipping: no TEST_MNEMONIC or TEST_MARKET_APP_ID set');
      return;
    }

    const orders = await client.getOpenOrders(marketAppId);
    expect(Array.isArray(orders)).toBe(true);

    // Orders may be empty if wallet has none on this market
    if (orders.length > 0) {
      const order = orders[0];
      expect(order).toHaveProperty('escrowAppId');
      expect(order).toHaveProperty('price');
      expect(order).toHaveProperty('quantity');
      expect(order).toHaveProperty('owner');
    }

    console.log(`Found ${orders.length} open orders for wallet on this market`);
  });
});
