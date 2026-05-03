# Place a Market Order

A market order auto-matches against the best available counterparty orders on the orderbook. It fills immediately up to your quantity and slippage tolerance, then any unmatched remainder rests on-chain as a limit order.

Always check the orderbook before placing a market buy — if there are no asks, the order cannot fill.

## Key parameters

| Param | Type | Description |
|-------|------|-------------|
| `marketAppId` | `number` | The market's Algorand app ID |
| `position` | `0 \| 1` | `1` = Yes, `0` = No |
| `price` | `number` | Your target price in microunits |
| `quantity` | `number` | Shares to buy/sell in microunits |
| `isBuying` | `boolean` | `true` = BUY, `false` = SELL |
| `slippage` | `number` | Max price deviation in microunits (e.g. `50_000` = $0.05) |
| `matchingOrders` | `CounterpartyMatch[]?` | Pre-computed matches — auto-fetched if omitted |

## Example

```typescript
import dotenv from 'dotenv';
import algosdk from 'algosdk';
import { AlphaClient } from '@alpha-arcade/sdk';

dotenv.config();

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

const markets = await client.getLiveMarkets();
const market = markets[0];

// Always check orderbook first
const book = await client.getOrderbook(market.marketAppId);
console.log(`Yes asks: ${book.yes.asks.length}, Yes bids: ${book.yes.bids.length}`);

if (book.yes.asks.length === 0) {
  console.log('No asks available — cannot place market buy order');
  process.exit(0);
}

// Find best (lowest) ask
const bestAsk = book.yes.asks.sort((a, b) => a.price - b.price)[0];
console.log(`Best ask: $${bestAsk.price / 1e6}`);

// Buy 1 Yes share at market price
const result = await client.createMarketOrder({
  marketAppId: market.marketAppId,
  position: 1,
  price: bestAsk.price,
  quantity: 1_000_000,
  isBuying: true,
  slippage: 50_000,  // $0.05 tolerance
});

console.log(`Escrow: ${result.escrowAppId}`);
console.log(`Matched: ${(result.matchedQuantity ?? 0) / 1e6} shares @ avg $${(result.matchedPrice ?? 0) / 1e6}`);
```

## Notes

- `slippage` controls how far from your `price` the SDK will still accept a fill. Orders priced worse than `price + slippage` (for buys) are ignored.
- `matchedQuantity` and `matchedPrice` in the result tell you what actually filled. `matchedPrice` is a volume-weighted average.
- If no counterparty orders match, the result is the same as a limit order — the escrow rests on-chain unfilled.
- Sorting asks ascending (`a.price - b.price`) gives you the cheapest first; sorting bids descending gives you the most generous buyer first.
- **Two match types exist:** direct (BUY YES vs SELL YES asks) and complementary (BUY YES vs BUY NO bids, where complement price = `1_000_000 - noPrice`). The SDK handles both automatically — you don't need to think about this unless building custom matching logic.
- **Fractional shares are valid** — minimum unit is 1 microunit. For example, `100_000` is 0.1 shares (~$0.01 cost at a $0.10 price).
