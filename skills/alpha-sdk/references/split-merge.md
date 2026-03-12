# Split and Merge Shares

## Concept

Every prediction market has two outcome tokens: YES and NO. Together they always equal $1.00 of USDC — this is the core invariant.

- **Split:** burn $X USDC → receive X YES tokens + X NO tokens
- **Merge:** burn X YES tokens + X NO tokens → receive $X USDC

This lets you get directional exposure without placing an order: split $1, sell the NO tokens on the orderbook, and you're long YES with no counterparty needed.

## Split USDC → YES + NO

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

// Split $0.50 USDC → 0.5 YES + 0.5 NO
const splitResult = await client.splitShares({
  marketAppId,
  amount: 500_000,  // $0.50 in microunits
});
console.log(`Split done! Round: ${splitResult.confirmedRound}`);
```

## Check positions after split

```typescript
const positions = await client.getPositions();
const pos = positions.find((p) => p.marketAppId === marketAppId);

if (pos) {
  console.log(`YES balance: ${pos.yesBalance / 1e6} shares`);
  console.log(`NO balance:  ${pos.noBalance / 1e6} shares`);
}
```

## Merge YES + NO → USDC

```typescript
// Requires equal amounts of YES and NO tokens
const mergeResult = await client.mergeShares({
  marketAppId,
  amount: 500_000,  // must match what you want to merge
});
console.log(`Merge done! Round: ${mergeResult.confirmedRound}`);
```

## Notes

- You must be opted into both the YES and NO ASAs before splitting. The SDK handles this automatically.
- `amount` in both `splitShares` and `mergeShares` is in microunits: `1_000_000` = $1.00 / 1 share.
- After a market resolves, merge is no longer the right tool — use `claim()` instead to redeem winning tokens for USDC.
- Split + sell one side is a common strategy to get pure directional exposure without needing a counterparty order on the book.
