/**
 * Example: Place a limit order on a market
 *
 * Usage: npx tsx examples/place-limit-order.ts
 *
 * Requires .env with TEST_MNEMONIC set
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

  // Fetch a market
  const markets = await client.getLiveMarkets();
  const market = markets[0];
  console.log(`Placing order on: ${market.title}`);

  // Place a limit buy order: 1 Yes share at $0.10
  const result = await client.createLimitOrder({
    marketAppId: market.marketAppId,
    position: 1,
    price: 100_000,
    quantity: 1_000_000,
    isBuying: true,
  });

  console.log(`Order created! Escrow: ${result.escrowAppId}`);
  console.log(`Tx IDs: ${result.txIds.join(', ')}`);

  // Cancel the order to clean up
  if (result.escrowAppId > 0) {
    const cancelResult = await client.cancelOrder({
      marketAppId: market.marketAppId,
      escrowAppId: result.escrowAppId,
      orderOwner: account.addr,
    });
    console.log(`Order cancelled: ${cancelResult.success}`);
  }
};

main().catch(console.error);
