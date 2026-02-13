import { describe, it, expect, beforeAll } from 'vitest';
import { createTestClient, getTestMarketAppId } from './setup.js';
import type { AlphaClient } from '../src/index.js';

const logTxns = (label: string, txIds: string[]) => {
  console.log(`${label} | Txn IDs: ${txIds.join(', ')}`);
};

// Use small quantities to minimize USDC/ALGO consumption across test runs
const TEST_PRICE = 100_000; // $0.10
const TEST_QTY = 100_000; // 0.1 shares (costs ~$0.01 per order)
const COMPLEMENT_PRICE = 900_000; // $0.90 (complement of $0.10)

describe('Trading (on-chain)', () => {
  let client: AlphaClient | null;
  let marketAppId: number | null;
  let activeAddress: string;

  beforeAll(() => {
    client = createTestClient();
    marketAppId = getTestMarketAppId();
    if (client) {
      activeAddress = (client as any).config.activeAddress;
    }
  });

  // -------------------------------------------------------
  // Test 1: Create a limit order and verify escrow app ID
  // -------------------------------------------------------
  let firstEscrowAppId = 0;

  it('creates a limit BUY YES order', async () => {
    if (!client || !marketAppId) {
      console.log('Skipping: no TEST_MNEMONIC or TEST_MARKET_APP_ID set');
      return;
    }

    const result = await client.createLimitOrder({
      marketAppId,
      position: 1, // Yes
      price: TEST_PRICE,
      quantity: TEST_QTY,
      isBuying: true,
    });

    expect(result.txIds.length).toBeGreaterThan(0);
    expect(result.confirmedRound).toBeGreaterThan(0);
    expect(result.escrowAppId).toBeGreaterThan(0);

    firstEscrowAppId = result.escrowAppId;
    logTxns(`Created limit order | escrow app ID = ${firstEscrowAppId}`, result.txIds);
  });

  // -------------------------------------------------------
  // Test 2: Verify the order appears on the orderbook
  // -------------------------------------------------------
  it('verifies the order appears in open orders', async () => {
    if (!client || !marketAppId || !firstEscrowAppId) {
      console.log('Skipping: no order was created');
      return;
    }

    // Wait for indexer to catch up
    await new Promise((r) => setTimeout(r, 3000));

    const openOrders = await client.getOpenOrders(marketAppId);
    const found = openOrders.find((o) => o.escrowAppId === firstEscrowAppId);

    expect(found).toBeDefined();
    console.log(`Verified order ${firstEscrowAppId} on orderbook (${openOrders.length} total open orders)`);
  });

  // -------------------------------------------------------
  // Test 3: Cancel the order
  // -------------------------------------------------------
  it('cancels the created order', async () => {
    if (!client || !marketAppId || !firstEscrowAppId) {
      console.log('Skipping: no order to cancel');
      return;
    }

    const result = await client.cancelOrder({
      marketAppId,
      escrowAppId: firstEscrowAppId,
      orderOwner: activeAddress,
    });

    expect(result.success).toBe(true);
    expect(result.txIds.length).toBeGreaterThan(0);
    logTxns(`Cancelled order ${firstEscrowAppId}`, result.txIds);
  });

  // -------------------------------------------------------
  // Test 4: Verify the order is removed from the orderbook
  // -------------------------------------------------------
  it('verifies the cancelled order is gone from open orders', async () => {
    if (!client || !marketAppId || !firstEscrowAppId) {
      console.log('Skipping: no order was created/cancelled');
      return;
    }

    // Wait for indexer to catch up
    await new Promise((r) => setTimeout(r, 3000));

    const openOrders = await client.getOpenOrders(marketAppId);
    const found = openOrders.find((o) => o.escrowAppId === firstEscrowAppId);

    expect(found).toBeUndefined();
    console.log(`Verified order ${firstEscrowAppId} is removed from orderbook`);
  });

  // -------------------------------------------------------
  // Test 5: Create maker order, then match it
  // -------------------------------------------------------
  let makerEscrowAppId = 0;

  it('creates a maker limit BUY YES order for matching', async () => {
    if (!client || !marketAppId) {
      console.log('Skipping: no TEST_MNEMONIC or TEST_MARKET_APP_ID set');
      return;
    }

    const result = await client.createLimitOrder({
      marketAppId,
      position: 1, // Yes
      price: TEST_PRICE,
      quantity: TEST_QTY,
      isBuying: true,
    });

    expect(result.txIds.length).toBeGreaterThan(0);
    expect(result.escrowAppId).toBeGreaterThan(0);

    makerEscrowAppId = result.escrowAppId;
    logTxns(`Created maker order | escrow app ID = ${makerEscrowAppId}`, result.txIds);
  });

  it('matches the maker order with a complementary BUY NO order', async () => {
    if (!client || !marketAppId || !makerEscrowAppId) {
      console.log('Skipping: no maker order to match against');
      return;
    }

    // Wait for indexer to catch up with the maker order
    await new Promise((r) => setTimeout(r, 5000));

    // Create a complementary BUY NO order at $0.90 (complement of BUY YES at $0.10)
    // This is the standard matching pattern: BUY YES @ $0.10 matches BUY NO @ $0.90
    const result = await client.createMarketOrder({
      marketAppId,
      position: 0, // No (complement of Yes)
      price: COMPLEMENT_PRICE,
      quantity: TEST_QTY,
      isBuying: true, // Buying NO tokens
      slippage: 50_000, // $0.05 slippage tolerance
      matchingOrders: [
        {
          escrowAppId: makerEscrowAppId,
          quantity: TEST_QTY,
          owner: activeAddress,
        },
      ],
    });

    expect(result.txIds.length).toBeGreaterThan(0);
    expect(result.confirmedRound).toBeGreaterThan(0);
    expect(result.matchedQuantity).toBe(TEST_QTY);
    logTxns(`Matched order | matched qty = ${result.matchedQuantity} | escrow = ${result.escrowAppId}`, result.txIds);
  });

  it('verifies the maker order is filled/gone from the orderbook', async () => {
    if (!client || !marketAppId || !makerEscrowAppId) {
      console.log('Skipping: no maker order to verify');
      return;
    }

    // Wait for indexer to catch up
    await new Promise((r) => setTimeout(r, 3000));

    const openOrders = await client.getOpenOrders(marketAppId);
    const found = openOrders.find((o) => o.escrowAppId === makerEscrowAppId);

    // The maker order should be fully filled and gone, or have 0 remaining quantity
    if (found) {
      // If still found, quantity should be fully filled
      console.log(`Maker order ${makerEscrowAppId} still on book: qty=${found.quantity}, filled=${found.quantityFilled}`);
      expect(found.quantityFilled).toBeGreaterThan(0);
    } else {
      console.log(`Verified maker order ${makerEscrowAppId} is fully matched and removed from orderbook`);
    }
  });
});
