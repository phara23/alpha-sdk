/**
 * Example: Cancel an open order
 *
 * Usage: npx tsx examples/cancel-order.ts
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
    feeAddress: account.addr,
    apiKey: process.env.ALPHA_API_KEY!,
  });

  const marketAppId = Number(process.env.TEST_MARKET_APP_ID);
  if (!marketAppId) {
    console.error('Set TEST_MARKET_APP_ID in .env');
    return;
  }

  // Get open orders
  const orders = await client.getOpenOrders(marketAppId);
  console.log(`Found ${orders.length} open orders`);

  if (orders.length === 0) {
    console.log('No open orders to cancel');
    return;
  }

  // Cancel the first order
  const order = orders[0];
  console.log(`Cancelling order ${order.escrowAppId}...`);

  const result = await client.cancelOrder({
    marketAppId,
    escrowAppId: order.escrowAppId,
    orderOwner: account.addr,
  });

  console.log(`Cancelled: ${result.success}`);
};

main().catch(console.error);
