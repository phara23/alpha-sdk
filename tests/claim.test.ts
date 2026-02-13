import { describe, it, expect, beforeAll } from 'vitest';
import { createTestClient } from './setup.js';
import type { AlphaClient } from '../src/index.js';

describe('Claim (on-chain)', () => {
  let client: AlphaClient | null;

  beforeAll(() => {
    client = createTestClient();
  });

  it('can read positions to find claimable tokens', async () => {
    if (!client) {
      console.log('Skipping: no TEST_MNEMONIC set');
      return;
    }

    // This test just verifies the claim flow can identify positions.
    // Actual claim requires a resolved market with winning tokens,
    // which we can't guarantee in automated tests.
    const positions = await client.getPositions();
    expect(Array.isArray(positions)).toBe(true);

    console.log(`Found ${positions.length} positions. Claim test requires a resolved market to execute.`);
    if (positions.length > 0) {
      const pos = positions[0];
      console.log(`  First position: marketAppId=${pos.marketAppId}, YES=${pos.yesBalance}, NO=${pos.noBalance}`);
    }
    // If you have a resolved market, uncomment below and set the values:
    // const result = await client.claim({
    //   marketAppId: RESOLVED_MARKET_APP_ID,
    //   assetId: WINNING_TOKEN_ASA_ID,
    // });
    // expect(result.success).toBe(true);
    // console.log(`Claimed tokens | Txn IDs: ${result.txIds.join(', ')}`);
  });
});
