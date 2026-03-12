# Place a Limit Order

A limit order sits on the orderbook at your specified price until it is matched or cancelled. Slippage is always 0 — the order executes only at your exact price.

The SDK automatically checks the live orderbook when you call `createLimitOrder`. If counterparty orders exist at your price, they fill immediately. Any unfilled remainder rests on-chain as an escrow app.

## Key parameters

| Param | Type | Description |
|-------|------|-------------|
| `marketAppId` | `number` | The market's Algorand app ID |
| `position` | `0 \| 1` | `1` = Yes, `0` = No |
| `price` | `number` | Price in microunits (e.g. `100_000` = $0.10) |
| `quantity` | `number` | Shares in microunits (e.g. `1_000_000` = 1 share) |
| `isBuying` | `boolean` | `true` = BUY, `false` = SELL |
| `feeBase` | `number?` | Optional — reads from chain if omitted |

## Result

```typescript
{
  escrowAppId: number,       // the created escrow contract — save this to cancel later
  txIds: string[],
  confirmedRound: number,
  matchedQuantity?: number,  // how many shares filled immediately
  matchedPrice?: number,     // volume-weighted avg fill price in microunits
}
```

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

// Pick a market
const markets = await client.getLiveMarkets();
const market = markets[0];
console.log(`Placing order on: ${market.title}`);

// Buy 1 Yes share at $0.10
const result = await client.createLimitOrder({
  marketAppId: market.marketAppId,
  position: 1,
  price: 100_000,
  quantity: 1_000_000,
  isBuying: true,
});

console.log(`Order created! Escrow: ${result.escrowAppId}`);
console.log(`Matched: ${(result.matchedQuantity ?? 0) / 1e6} shares`);

// Clean up — cancel if not filled
if (result.escrowAppId > 0) {
  const cancelResult = await client.cancelOrder({
    marketAppId: market.marketAppId,
    escrowAppId: result.escrowAppId,
    orderOwner: account.addr.toString(),
  });
  console.log(`Cancelled: ${cancelResult.success}`);
}
```

## Notes

- **Collateral for BUY:** `floor(quantity × (price + slippage) / 1_000_000) + fee`. USDC is locked in the escrow.
- **Collateral for SELL:** the outcome token quantity itself (YES or NO shares).
- The escrow also holds 963,500 microALGO (escrow MBR) which is returned on cancel.
- `escrowAppId` is the key identifier for managing the order later (cancel, amend).
