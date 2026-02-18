/**
 * Example: Place a market order that auto-matches against the orderbook
 *
 * Usage: npx tsx examples/place-market-order.ts
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

  const markets = await client.getLiveMarkets();
  const market = markets[0];
  console.log(`Market: ${market.title}`);

  // Check the orderbook first
  const book = await client.getOrderbook(market.marketAppId);
  console.log(`Orderbook — Yes asks: ${book.yes.asks.length}, Yes bids: ${book.yes.bids.length}`);

  if (book.yes.asks.length === 0) {
    console.log('No asks available — cannot place market buy order');
    return;
  }

  const bestAsk = book.yes.asks.sort((a, b) => a.price - b.price)[0];
  console.log(`Best ask: $${bestAsk.price / 1e6}`);

  // Place a market order to buy 1 Yes share
  const result = await client.createMarketOrder({
    marketAppId: market.marketAppId,
    position: 1,
    price: bestAsk.price,
    quantity: 1_000_000,
    isBuying: true,
    slippage: 50_000, // $0.05 slippage
  });

  console.log(`Order created! Escrow: ${result.escrowAppId}`);
  console.log(`Matched quantity: ${result.matchedQuantity / 1e6} shares`);
};

main().catch(console.error);
