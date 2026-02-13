import { describe, it, expect } from 'vitest';
import { calculateMatchingOrders } from '../src/utils/matching.js';
import type { Orderbook } from '../src/types.js';

describe('calculateMatchingOrders', () => {
  const emptyOrderbook: Orderbook = {
    yes: { bids: [], asks: [] },
    no: { bids: [], asks: [] },
  };

  it('returns empty array for empty orderbook', () => {
    const matches = calculateMatchingOrders(emptyOrderbook, true, true, 1_000_000, 500_000, 50_000);
    expect(matches).toEqual([]);
  });

  it('matches buy Yes against sell Yes (direct match)', () => {
    const orderbook: Orderbook = {
      yes: {
        bids: [],
        asks: [
          { price: 450_000, quantity: 2_000_000, escrowAppId: 100, owner: 'SELLER1' },
          { price: 500_000, quantity: 1_000_000, escrowAppId: 101, owner: 'SELLER2' },
        ],
      },
      no: { bids: [], asks: [] },
    };

    const matches = calculateMatchingOrders(orderbook, true, true, 1_500_000, 500_000, 50_000);

    expect(matches.length).toBe(1);
    expect(matches[0].escrowAppId).toBe(100);
    expect(matches[0].quantity).toBe(1_500_000); // takes 1.5M from the 2M order
  });

  it('matches buy Yes against buy No (complementary match)', () => {
    const orderbook: Orderbook = {
      yes: { bids: [], asks: [] },
      no: {
        bids: [
          // Buy No at 400_000 = effective Sell Yes at 600_000
          { price: 400_000, quantity: 1_000_000, escrowAppId: 200, owner: 'BUYER_NO' },
        ],
        asks: [],
      },
    };

    // Buy Yes at price 650_000. Complementary order price = 1M - 400K = 600K, which is <= 650K + 0 slippage
    const matches = calculateMatchingOrders(orderbook, true, true, 500_000, 650_000, 0);

    expect(matches.length).toBe(1);
    expect(matches[0].escrowAppId).toBe(200);
    expect(matches[0].quantity).toBe(500_000);
  });

  it('respects quantity limits', () => {
    const orderbook: Orderbook = {
      yes: {
        bids: [],
        asks: [
          { price: 400_000, quantity: 500_000, escrowAppId: 100, owner: 'S1' },
          { price: 450_000, quantity: 500_000, escrowAppId: 101, owner: 'S2' },
        ],
      },
      no: { bids: [], asks: [] },
    };

    // Want 700_000 — should match 500K from first, 200K from second
    const matches = calculateMatchingOrders(orderbook, true, true, 700_000, 500_000, 50_000);

    expect(matches.length).toBe(2);
    expect(matches[0].quantity).toBe(500_000);
    expect(matches[1].quantity).toBe(200_000);
  });

  it('respects slippage tolerance', () => {
    const orderbook: Orderbook = {
      yes: {
        bids: [],
        asks: [
          { price: 500_000, quantity: 1_000_000, escrowAppId: 100, owner: 'S1' },
          { price: 600_000, quantity: 1_000_000, escrowAppId: 101, owner: 'S2' },
        ],
      },
      no: { bids: [], asks: [] },
    };

    // Price 500K + slippage 50K = max 550K. Only first order qualifies.
    const matches = calculateMatchingOrders(orderbook, true, true, 2_000_000, 500_000, 50_000);

    expect(matches.length).toBe(1);
    expect(matches[0].escrowAppId).toBe(100);
  });

  it('handles sell Yes matching against buy Yes', () => {
    const orderbook: Orderbook = {
      yes: {
        bids: [
          { price: 600_000, quantity: 1_000_000, escrowAppId: 300, owner: 'BUYER1' },
          { price: 500_000, quantity: 1_000_000, escrowAppId: 301, owner: 'BUYER2' },
        ],
        asks: [],
      },
      no: { bids: [], asks: [] },
    };

    // Selling Yes at 500K, slippage 0. Bids >= 500K qualify.
    const matches = calculateMatchingOrders(orderbook, false, true, 1_500_000, 500_000, 0);

    expect(matches.length).toBe(2);
    expect(matches[0].escrowAppId).toBe(300); // Higher bid first
    expect(matches[0].quantity).toBe(1_000_000);
    expect(matches[1].quantity).toBe(500_000);
  });
});
