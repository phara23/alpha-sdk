/**
 * Example: Simple automated trading bot
 *
 * Strategy: Scan all markets. If any Yes token has a best ask < $0.20,
 * buy 1 share. Runs in a loop every 60 seconds.
 *
 * Usage: npx tsx examples/simple-trading-bot.ts
 */
import dotenv from 'dotenv';
import algosdk from 'algosdk';
import { AlphaClient } from '../src/index.js';

dotenv.config();

const PRICE_THRESHOLD = 200_000; // $0.20
const QUANTITY = 1_000_000; // 1 share
const SLIPPAGE = 20_000; // $0.02
const POLL_INTERVAL_MS = 60_000; // 60 seconds

const setup = () => {
  const account = algosdk.mnemonicToSecretKey(process.env.TEST_MNEMONIC!);
  const algodClient = new algosdk.Algodv2('', 'https://mainnet-api.algonode.cloud', 443);
  const indexerClient = new algosdk.Indexer('', 'https://mainnet-idx.algonode.cloud', 443);

  return {
    client: new AlphaClient({
      algodClient,
      indexerClient,
      signer: algosdk.makeBasicAccountTransactionSigner(account),
      activeAddress: account.addr,
      matcherAppId: 741347297,
      usdcAssetId: 31566704,
      feeAddress: account.addr,
    apiKey: process.env.ALPHA_API_KEY!,
    }),
    address: account.addr,
  };
};

const scan = async (client: AlphaClient) => {
  console.log(`[${new Date().toISOString()}] Scanning markets...`);
  const markets = await client.getLiveMarkets();
  console.log(`Found ${markets.length} live markets`);

  for (const market of markets.slice(0, 10)) {
    // Only scan first 10 to avoid rate limits
    try {
      const book = await client.getOrderbook(market.marketAppId);
      const asks = book.yes.asks.sort((a, b) => a.price - b.price);

      if (asks.length > 0 && asks[0].price < PRICE_THRESHOLD) {
        console.log(`  OPPORTUNITY: "${market.title}" — Yes ask at $${asks[0].price / 1e6}`);

        // Uncomment to actually trade:
        // const result = await client.createMarketOrder({
        //   marketAppId: market.marketAppId,
        //   position: 1,
        //   price: asks[0].price,
        //   quantity: QUANTITY,
        //   isBuying: true,
        //   slippage: SLIPPAGE,
        // });
        // console.log(`  BOUGHT! Escrow: ${result.escrowAppId}`);
      }
    } catch (err) {
      console.error(`  Error scanning ${market.title}:`, (err as Error).message);
    }
  }
};

const main = async () => {
  const { client } = setup();

  // Run once immediately
  await scan(client);

  // Then loop
  setInterval(() => scan(client), POLL_INTERVAL_MS);
};

main().catch(console.error);
