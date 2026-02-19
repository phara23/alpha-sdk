/**
 * Example: View all your positions across markets
 *
 * Usage: npx tsx examples/get-positions.ts
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

  console.log(`Wallet: ${account.addr}`);
  console.log('Fetching positions...\n');

  const positions = await client.getPositions();

  if (positions.length === 0) {
    console.log('No positions found.');
    return;
  }

  for (const pos of positions) {
    console.log(`Market App ID: ${pos.marketAppId}`);
    console.log(`  YES (${pos.yesAssetId}): ${pos.yesBalance / 1e6} shares`);
    console.log(`  NO  (${pos.noAssetId}): ${pos.noBalance / 1e6} shares`);
    console.log();
  }
};

main().catch(console.error);
