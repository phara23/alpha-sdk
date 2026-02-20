/**
 * Example: Fetch all reward markets via the Alpha API
 *
 * Usage: npx tsx examples/get-reward-markets.ts
 *
 * Requires ALPHA_API_KEY in your .env file.
 */
import dotenv from 'dotenv';
import algosdk from 'algosdk';
import { AlphaClient } from '../src/index.js';

dotenv.config();

const main = async () => {
    const account = algosdk.mnemonicToSecretKey(process.env.TEST_MNEMONIC!);
    const algodClient = new algosdk.Algodv2('', 'https://mainnet-api.algonode.cloud', 443);
    const indexerClient = new algosdk.Indexer('', 'https://mainnet-idx.algonode.cloud', 443);
  
    const client = new AlphaClient({
      algodClient,
      indexerClient,
      signer: algosdk.makeBasicAccountTransactionSigner(account),
      activeAddress: account.addr,
      matcherAppId: 741347297,
      usdcAssetId: 31566704,
      apiKey: process.env.ALPHA_API_KEY!,
    });

  const rewardMarkets = await client.getRewardMarkets();
  for (const pos of rewardMarkets) {
    console.log(`Market: ${pos.title} (app ID: ${pos.marketAppId})`);
    console.log(`  Total Rewards: $${pos.totalRewards ? pos.totalRewards / 1e6 : 0}`);
    console.log(`  Rewards Paid Out: $${pos.rewardsPaidOut ? pos.rewardsPaidOut / 1e6 : 0}`);
    console.log(`  Max Rewards Spread Distance: ${pos.rewardsSpreadDistance ? pos.rewardsSpreadDistance / 1e6 : 0}`);
    console.log(`  Rewards Min Contracts: ${pos.rewardsMinContracts ? pos.rewardsMinContracts / 1e6 : 0} shares`);
    console.log(`  Last Reward Amount: $${pos.lastRewardAmount ? pos.lastRewardAmount / 1e6 : 0}`);
    console.log(`  Last Reward Time: ${pos.lastRewardTs ? new Date(pos.lastRewardTs).toISOString() : 'N/A'}`);
    console.log();
  }
};

main().catch(console.error);
