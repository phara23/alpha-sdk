import { describe, it, expect, beforeAll } from 'vitest';
import { createTestClient, getTestMarketAppId } from './setup.js';
import type { AlphaClient } from '../src/index.js';

const logTxns = (label: string, txIds: string[]) => {
  console.log(`${label} | Txn IDs: ${txIds.join(', ')}`);
};

describe('Positions (on-chain)', () => {
  let client: AlphaClient | null;
  let marketAppId: number | null;

  beforeAll(() => {
    client = createTestClient();
    marketAppId = getTestMarketAppId();
  });

  it('gets wallet positions', async () => {
    if (!client) {
      console.log('Skipping: no TEST_MNEMONIC set');
      return;
    }

    const positions = await client.getPositions();
    expect(Array.isArray(positions)).toBe(true);

    if (positions.length > 0) {
      const pos = positions[0];
      expect(pos).toHaveProperty('marketAppId');
      expect(pos).toHaveProperty('yesAssetId');
      expect(pos).toHaveProperty('noAssetId');
      expect(pos).toHaveProperty('yesBalance');
      expect(pos).toHaveProperty('noBalance');
    }
    console.log(`Found ${positions.length} positions`);
  });

  it('splits USDC into YES + NO tokens', async () => {
    if (!client || !marketAppId) {
      console.log('Skipping: no TEST_MNEMONIC or TEST_MARKET_APP_ID set');
      return;
    }

    // Split a small amount: $0.10 USDC
    const result = await client.splitShares({
      marketAppId,
      amount: 100_000, // $0.10
    });

    expect(result.success).toBe(true);
    expect(result.txIds.length).toBeGreaterThan(0);
    expect(result.confirmedRound).toBeGreaterThan(0);
    logTxns('Split $0.10 USDC into YES + NO tokens', result.txIds);
  });

  it('merges YES + NO tokens back into USDC', async () => {
    if (!client || !marketAppId) {
      console.log('Skipping: no TEST_MNEMONIC or TEST_MARKET_APP_ID set');
      return;
    }

    // Merge back the same amount we just split
    const result = await client.mergeShares({
      marketAppId,
      amount: 100_000, // $0.10
    });

    expect(result.success).toBe(true);
    expect(result.txIds.length).toBeGreaterThan(0);
    expect(result.confirmedRound).toBeGreaterThan(0);
    logTxns('Merged YES + NO tokens back into $0.10 USDC', result.txIds);
  });
});
