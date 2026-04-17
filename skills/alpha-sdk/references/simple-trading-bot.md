# Simple Trading Bot

A polling bot that scans markets on a fixed interval, looking for pricing opportunities. This example shows the core pattern: setup once, scan in a loop.

## Strategy

Scan the first 10 live markets every 60 seconds. If any YES token has a best ask below $0.20, log the opportunity (and optionally execute a buy).

The `slice(0, 10)` limit is important — fetching orderbooks for many markets in rapid succession can hit indexer rate limits.

## Full example

```typescript
import dotenv from 'dotenv';
import algosdk from 'algosdk';
import { AlphaClient } from '@alpha-arcade/sdk';

dotenv.config();

const PRICE_THRESHOLD = 200_000;  // $0.20
const QUANTITY        = 1_000_000; // 1 share
const SLIPPAGE        = 20_000;    // $0.02
const POLL_INTERVAL   = 60_000;    // 60 seconds

// Build client once outside the loop
const account = algosdk.mnemonicToSecretKey(process.env.ALPHA_MNEMONIC!);
const client = new AlphaClient({
  algodClient: new algosdk.Algodv2(
    process.env.ALPHA_ALGOD_TOKEN ?? '',
    process.env.ALPHA_ALGOD_SERVER ?? 'https://mainnet-api.algonode.cloud',
    Number(process.env.ALPHA_ALGOD_PORT ?? 443),
  ),
  indexerClient: new algosdk.Indexer(
    process.env.ALPHA_INDEXER_TOKEN ?? '',
    process.env.ALPHA_INDEXER_SERVER ?? 'https://mainnet-idx.algonode.cloud',
    Number(process.env.ALPHA_INDEXER_PORT ?? 443),
  ),
  signer: algosdk.makeBasicAccountTransactionSigner(account),
  activeAddress: account.addr.toString(),
  matcherAppId: Number(process.env.ALPHA_MATCHER_APP_ID ?? 3078581851),
  usdcAssetId: Number(process.env.ALPHA_USDC_ASSET_ID ?? 31566704),
  apiKey: process.env.ALPHA_API_KEY,
});

const scan = async () => {
  console.log(`[${new Date().toISOString()}] Scanning...`);

  const markets = await client.getLiveMarkets();
  console.log(`${markets.length} live markets`);

  for (const market of markets.slice(0, 10)) {  // cap to avoid rate limits
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
      // Don't let one market failure kill the whole scan
      console.error(`  Error on "${market.title}":`, (err as Error).message);
    }
  }
};

// Run immediately, then on interval
await scan();
setInterval(scan, POLL_INTERVAL);
```

## Key patterns

**Build the client once** outside the loop — not on every tick. Avoids repeated setup overhead.

**Wrap each market in try/catch** — a single bad market (indexer lag, deleted app) should not stop the whole scan.

**Sort asks ascending** to find the best (cheapest) offer:
```typescript
const asks = book.yes.asks.sort((a, b) => a.price - b.price);
```

**Guard before trading** — verify `asks.length > 0` before accessing `asks[0]`.

**Use `setInterval` for polling.** For production bots, consider a proper scheduler with jitter to avoid thundering herd issues if running multiple instances.

## Extending the strategy

- Scan **both** YES and NO asks for arbitrage between positions
- Track which markets you've already bought to avoid duplicate fills
- Add a position size cap: fetch `getPositions()` and skip markets where you're already exposed
- Use `getLiveMarketsFromApi()` (with `apiKey`) for richer market data like `yesProb` to filter by probability range
