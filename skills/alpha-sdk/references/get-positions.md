# Get Wallet Positions

`getPositions()` reads the wallet's on-chain token balances and maps them to markets. It returns all markets where the wallet holds any YES or NO tokens.

This is a read-only operation — no transaction required.

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

console.log(`Wallet: ${account.addr.toString()}`);

const positions = await client.getPositions();
// Optionally check another wallet: client.getPositions('SOME_ADDRESS')

if (positions.length === 0) {
  console.log('No positions found.');
  process.exit(0);
}

for (const pos of positions) {
  console.log(`\nMarket: ${pos.title} (app ID: ${pos.marketAppId})`);
  console.log(`  YES (ASA ${pos.yesAssetId}): ${pos.yesBalance / 1e6} shares`);
  console.log(`  NO  (ASA ${pos.noAssetId}): ${pos.noBalance / 1e6} shares`);
}
```

## Position shape

```typescript
type WalletPosition = {
  marketAppId: number,   // Algorand app ID of the market
  title: string,         // market title from on-chain global state
  yesAssetId: number,    // YES token ASA ID
  noAssetId: number,     // NO token ASA ID
  yesBalance: number,    // YES tokens held, in microunits
  noBalance: number,     // NO tokens held, in microunits
}
```

## Finding a specific market's position

```typescript
const marketAppId = Number(process.env.MARKET_APP_ID!);
const positions = await client.getPositions();
const pos = positions.find((p) => p.marketAppId === marketAppId);

if (pos) {
  console.log(`YES: ${pos.yesBalance / 1e6}, NO: ${pos.noBalance / 1e6}`);
} else {
  console.log('No position in this market');
}
```

## Notes

- Only markets where the wallet holds a non-zero balance of YES or NO tokens appear in the results.
- Alpha Market outcome tokens are identified internally by their ASA unit name prefix `ALPHA-` — any ASA without this prefix is ignored.
- Open orders (escrowed tokens) are **not** reflected here — those are in `getOpenOrders()`.
- After a market resolves, winning tokens still appear here until you call `claim()`.
