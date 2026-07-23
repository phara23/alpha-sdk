/**
 * Example: Stake ALPHA into the fee-sharing pool (fully on-chain)
 *
 * Usage: npx tsx examples/stake-alpha.ts
 *
 * Requires .env with TEST_MNEMONIC. Optional:
 *   STAKE_AMOUNT_MICRO  — micro-ALPHA to stake (default 1_000_000 = 1 ALPHA)
 *   UNSTAKE_AFTER       — set to "1" to unstake the same amount after staking
 *
 * No Alpha API key needed — this path only talks to algod.
 */
import dotenv from 'dotenv';
import algosdk from 'algosdk';
import { AlphaClient, DEFAULT_STAKING_APP_ID, DEFAULT_ALPHA_ASSET_ID } from '../src/index.js';

dotenv.config();

const MICRO = 1_000_000;

const main = async () => {
  if (!process.env.TEST_MNEMONIC) {
    console.error('Set TEST_MNEMONIC in .env');
    return;
  }

  const account = algosdk.mnemonicToSecretKey(process.env.TEST_MNEMONIC);
  const algodClient = new algosdk.Algodv2('', 'https://mainnet-api.algonode.cloud', 443);
  const indexerClient = new algosdk.Indexer('', 'https://mainnet-idx.algonode.cloud', 443);

  const client = new AlphaClient({
    algodClient,
    indexerClient,
    signer: algosdk.makeBasicAccountTransactionSigner(account),
    activeAddress: account.addr.toString(),
    matcherAppId: 3078581851,
    usdcAssetId: 31566704,
    // Optional — these are the mainnet defaults:
    stakingAppId: DEFAULT_STAKING_APP_ID,
    alphaAssetId: DEFAULT_ALPHA_ASSET_ID,
  });

  const amount = Number(process.env.STAKE_AMOUNT_MICRO ?? MICRO);
  console.log(`Wallet: ${account.addr.toString()}`);
  console.log(`Staking ${amount / MICRO} ALPHA (${amount} micro) into app ${DEFAULT_STAKING_APP_ID}...`);

  const before = await client.getStakingPosition();
  console.log('Before:', {
    optedIn: before.optedIn,
    staked: before.staked / MICRO,
    claimableUsdc: before.claimable / MICRO,
    totalStaked: before.totalStaked / MICRO,
    poolShareBps: before.poolShareBps,
  });

  const stakeResult = await client.stakeAlpha({ amount });
  console.log(`Staked! Round ${stakeResult.confirmedRound}`);
  console.log(`Tx IDs: ${stakeResult.txIds.join(', ')}`);

  const after = await client.getStakingPosition();
  console.log('After:', {
    optedIn: after.optedIn,
    staked: after.staked / MICRO,
    claimableUsdc: after.claimable / MICRO,
    totalStaked: after.totalStaked / MICRO,
    poolShareBps: after.poolShareBps,
  });

  if (process.env.UNSTAKE_AFTER === '1') {
    console.log(`Unstaking ${amount / MICRO} ALPHA...`);
    const unstakeResult = await client.unstakeAlpha({ amount });
    console.log(`Unstaked! Round ${unstakeResult.confirmedRound}`);
  }
};

main().catch(console.error);
