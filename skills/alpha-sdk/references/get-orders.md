# Get Open Orders

There are two ways to fetch open orders depending on your needs:

| Method | Scope | Requires API key |
|--------|-------|-----------------|
| `getOpenOrders(marketAppId)` | One market, reads on-chain | No |
| `getWalletOrdersFromApi(address)` | All markets, via API | Yes |

## Fetch orders for one market (on-chain)

```typescript
const myOrders = await client.getOpenOrders(marketAppId);
// Optionally check another wallet:
const theirOrders = await client.getOpenOrders(marketAppId, 'SOME_ADDRESS');
```

## Fetch all orders across all markets (API)

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

const orders = await client.getWalletOrdersFromApi(account.addr.toString());

if (orders.length === 0) {
  console.log('No open orders found.');
  process.exit(0);
}

for (const order of orders) {
  const side = order.side === 1 ? 'BUY' : 'SELL';
  const position = order.position === 1 ? 'YES' : 'NO';

  console.log(`Escrow ${order.escrowAppId} | Market ${order.marketAppId}`);
  console.log(`  ${side} ${position} @ $${order.price / 1e6}`);
  console.log(`  Qty: ${order.quantity / 1e6} | Filled: ${order.quantityFilled / 1e6}`);
}
```

## OpenOrder shape

```typescript
type OpenOrder = {
  escrowAppId: number,       // the escrow contract ID
  marketAppId: number,
  position: 0 | 1,          // 0 = No, 1 = Yes
  side: number,              // 0 = SELL, 1 = BUY
  price: number,             // microunits
  quantity: number,          // total quantity in microunits
  quantityFilled: number,    // how much has been matched so far
  slippage: number,          // 0 = limit order, >0 = market order
  owner: string,             // wallet address
}
```

## Decoding side and position

```typescript
const side = order.side === 1 ? 'BUY' : 'SELL';
const position = order.position === 1 ? 'YES' : 'NO';
const remaining = (order.quantity - order.quantityFilled) / 1e6;
const isLimitOrder = order.slippage === 0;
```

## Notes

- `quantityFilled > 0` means the order is partially filled. It can still be cancelled — only the unfilled portion is returned.
- `slippage === 0` identifies a limit order; any positive value is a market order.
- The escrow app is deleted when an order is fully filled or cancelled.
