/**
 * Read USDC and ALPHA LP pools for each executable outcome.
 * Usage: npx tsx examples/get-reward-markets.ts
 * Requires ALPHA_API_KEY. No mnemonic or signing wallet is needed.
 */
import dotenv from 'dotenv';
import { getRewardMarkets, type Market, type MarketOption } from '../src/index.js';

dotenv.config();

const printPool = (outcome: Market | MarketOption, sport: boolean) => {
  console.log(`  Outcome: ${outcome.title} (app ID: ${outcome.marketAppId})`);
  console.log(`    USDC ${sport ? 'game pool' : 'per day'}: ${(outcome.totalRewards ?? 0) / 1e6}`);
  if (sport) console.log(`    USDC pregame per day: ${(outcome.totalPregameRewards ?? 0) / 1e6}`);
  console.log(`    USDC paid out: ${(outcome.rewardsPaidOut ?? 0) / 1e6}`);
  const alpha = outcome.alphaLpRewards;
  if (alpha) {
    console.log(`    ALPHA per day: ${(alpha.dailyMicro ?? 0) / 1e6}`);
    console.log(`    ALPHA pregame per day: ${(alpha.pregameDailyMicro ?? 0) / 1e6}`);
    console.log(`    ALPHA game pool: ${(alpha.inGameMicro ?? 0) / 1e6}`);
    if (alpha.startsAt) console.log(`    ALPHA starts: ${new Date(alpha.startsAt).toISOString()}`);
  }
  console.log(`    Maximum spread distance: ${(outcome.rewardsSpreadDistance ?? 0) / 1e6}`);
  console.log(`    Minimum order size: ${(outcome.rewardsMinContracts ?? 0) / 1e6} shares`);
};

const main = async () => {
  const markets = await getRewardMarkets({
    apiKey: process.env.ALPHA_API_KEY,
    apiBaseUrl: process.env.ALPHA_API_BASE_URL,
  });
  for (const market of markets) {
    console.log(`Market: ${market.title}`);
    const sport = typeof market.gameStartTimeMs === 'number' && !market.categories?.includes('Crypto');
    const outcomes = market.options?.length ? market.options : [market];
    for (const outcome of outcomes) printPool(outcome, sport);
  }
  console.log('Amounts above are market pools, not personal earnings estimates.');
  console.log('ALPHA requires asset opt-in at each scoring sample. USDC remains eligible without ALPHA opt-in.');
  console.log('Both tokens pay hourly. A later ALPHA opt-in does not earn earlier sample allocations.');
};

main().catch(error => { console.error(error); process.exitCode = 1; });
