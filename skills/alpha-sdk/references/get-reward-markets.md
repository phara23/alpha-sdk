# Get Reward Markets

Reward markets are markets that offer USDC incentives to liquidity providers — wallets that post limit orders within a certain spread distance of the mid-price and hold them for a minimum contract size.

`getRewardMarkets()` requires an API key and returns all live markets that have a `totalRewards > 0`.

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

const rewardMarkets = await client.getRewardMarkets();

for (const market of rewardMarkets) {
  console.log(`\n${market.title} (app ID: ${market.marketAppId})`);
  console.log(`  Total Rewards:      $${market.totalRewards ? market.totalRewards / 1e6 : 0}`);
  console.log(`  Rewards Paid Out:   $${market.rewardsPaidOut ? market.rewardsPaidOut / 1e6 : 0}`);
  console.log(`  Spread Distance:    ${market.rewardsSpreadDistance ? market.rewardsSpreadDistance / 1e6 : 0}`);
  console.log(`  Min Contracts:      ${market.rewardsMinContracts ? market.rewardsMinContracts / 1e6 : 0} shares`);
  console.log(`  Last Reward Amount: $${market.lastRewardAmount ? market.lastRewardAmount / 1e6 : 0}`);
  // lastRewardTs is milliseconds — pass directly to new Date(), do NOT divide by 1e6
  console.log(`  Last Reward Time:   ${market.lastRewardTs ? new Date(market.lastRewardTs).toISOString() : 'N/A'}`);
}
```

## Reward market fields

| Field | Unit | Description |
|-------|------|-------------|
| `totalRewards` | microunits (÷1e6 → $) | Total USDC reward pool for this market |
| `rewardsPaidOut` | microunits (÷1e6 → $) | How much has already been distributed |
| `rewardsSpreadDistance` | microunits (÷1e6) | Max spread from mid-price to qualify for rewards |
| `rewardsMinContracts` | microunits (÷1e6 → shares) | Minimum position size to qualify |
| `lastRewardAmount` | microunits (÷1e6 → $) | Amount of the most recent reward payout |
| `lastRewardTs` | **milliseconds** | Timestamp of last payout — use `new Date(ts)` directly |

## Notes

- `lastRewardTs` is the only timestamp field that is **not** in microunits. All other reward fields divide by `1e6`.
- `rewardsSpreadDistance` defines how tight your orders must be: e.g. `0.05` means within $0.05 of the mid-price on both sides.
- To participate in rewards, post limit orders within `rewardsSpreadDistance` of mid, with quantity ≥ `rewardsMinContracts`.
