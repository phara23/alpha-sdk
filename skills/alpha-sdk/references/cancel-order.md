# Cancel an Order

Cancelling an order deletes its escrow app and returns all locked funds to the order owner: USDC (for buy orders) or outcome tokens (for sell orders), plus 963,500 microALGO (escrow MBR).

You need the `escrowAppId` and `marketAppId` to cancel. You can get these from `getOpenOrders()` if you don't have them saved.

## Key parameters

| Param | Type | Description |
|-------|------|-------------|
| `marketAppId` | `number` | The market's Algorand app ID |
| `escrowAppId` | `number` | The escrow contract to cancel |
| `orderOwner` | `string` | Address of the order owner (must be the signer) |

## Example

```typescript
import dotenv from 'dotenv';
import algosdk from 'algosdk';
import { AlphaClient } from '@alpha-arcade/sdk';

dotenv.config();

const account = algosdk.mnemonicToSecretKey(process.env.ALPHA_MNEMONIC!);
const client = new AlphaClient({
  algodClient: new algosdk.Algodv2(
    process.env.ALGOD_TOKEN ?? '',
    process.env.ALGOD_SERVER ?? 'https://mainnet-api.algonode.cloud',
    Number(process.env.ALGOD_PORT ?? 443),
  ),
  indexerClient: new algosdk.Indexer(
    process.env.INDEXER_TOKEN ?? '',
    process.env.INDEXER_SERVER ?? 'https://mainnet-idx.algonode.cloud',
    Number(process.env.INDEXER_PORT ?? 443),
  ),
  signer: algosdk.makeBasicAccountTransactionSigner(account),
  activeAddress: account.addr.toString(),
  matcherAppId: Number(process.env.MATCHER_APP_ID ?? 3078581851),
  usdcAssetId: Number(process.env.USDC_ASSET_ID ?? 31566704),
  apiKey: process.env.ALPHA_API_KEY,
});

const marketAppId = Number(process.env.MARKET_APP_ID!);

// Fetch open orders for this market
const orders = await client.getOpenOrders(marketAppId);
console.log(`Found ${orders.length} open orders`);

if (orders.length === 0) {
  console.log('Nothing to cancel');
  process.exit(0);
}

// Cancel the first order
const order = orders[0];
console.log(`Cancelling escrow ${order.escrowAppId} — ${order.side === 1 ? 'BUY' : 'SELL'} ${order.position === 1 ? 'YES' : 'NO'} @ $${order.price / 1e6}`);

const result = await client.cancelOrder({
  marketAppId,
  escrowAppId: order.escrowAppId,
  orderOwner: account.addr.toString(),
});

console.log(`Cancelled: ${result.success}`);
```

## Cancelling all open orders

```typescript
const orders = await client.getOpenOrders(marketAppId);

for (const order of orders) {
  await client.cancelOrder({
    marketAppId,
    escrowAppId: order.escrowAppId,
    orderOwner: account.addr.toString(),
  });
  console.log(`Cancelled escrow ${order.escrowAppId}`);
}
```

## Notes

- Only the order owner can cancel their own orders.
- Partially filled orders can be cancelled — the unfilled portion is returned.
- Use `getWalletOrdersFromApi()` (requires `apiKey`) to fetch open orders across all markets at once instead of per-market.
- `cancelOrder` vs `amendOrder`: cancel is final; amend is cheaper if you just want to change price/quantity on an unfilled order.
