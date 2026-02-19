/**
 * Example: Split USDC into YES + NO tokens, then merge back
 *
 * Usage: npx tsx examples/split-merge.ts
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

  const marketAppId = Number(process.env.TEST_MARKET_APP_ID);
  if (!marketAppId) {
    console.error('Set TEST_MARKET_APP_ID in .env');
    return;
  }

  // Split $0.50 USDC into YES + NO tokens
  console.log('Splitting $0.50 USDC...');
  const splitResult = await client.splitShares({
    marketAppId,
    amount: 500_000, // $0.50
  });
  console.log(`Split done! Round: ${splitResult.confirmedRound}`);

  // Check positions
  const positions = await client.getPositions();
  const pos = positions.find((p) => p.marketAppId === marketAppId);
  if (pos) {
    console.log(`YES balance: ${pos.yesBalance / 1e6}, NO balance: ${pos.noBalance / 1e6}`);
  }

  // Merge back
  console.log('Merging back...');
  const mergeResult = await client.mergeShares({
    marketAppId,
    amount: 500_000,
  });
  console.log(`Merge done! Round: ${mergeResult.confirmedRound}`);
};

main().catch(console.error);
