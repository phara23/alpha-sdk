---
name: alpha-sdk
description: >
  Guide for building applications with @alpha-arcade/sdk — the TypeScript SDK for
  Alpha Market, Algorand-based prediction markets. Use this skill whenever the user
  is working in the alpha-sdk repo, importing from @alpha-arcade/sdk, writing trading
  bots, building prediction market UIs, querying orderbooks, managing positions, or
  doing anything with Alpha Market on Algorand. Triggers on: AlphaClient, createLimitOrder,
  createMarketOrder, cancelOrder, amendOrder, prediction market, Alpha Arcade, orderbook,
  splitShares, mergeShares, claim, escrow, YES/NO tokens, matcherAppId, alpha-arcade.
---

# Alpha SDK — @alpha-arcade/sdk

TypeScript SDK for trading on **Alpha Arcade Market**: Algorand-based prediction markets with on-chain orderbooks, YES/NO outcome tokens, and escrow-based order execution.

## Reference guides

Detailed examples in `skills/alpha-sdk/references/` — load and read the relevant file for full working code:

| File | What it shows |
|------|--------------|
| `env-setup.md` | `.env` template, dotenv config, testnet switching |
| `place-limit-order.md` | Full limit order lifecycle: place → cancel, collateral explained |
| `place-market-order.md` | Market order with orderbook check + best-ask logic |
| `cancel-order.md` | Fetch open orders then cancel, including bulk cancel pattern |
| `split-merge.md` | Split USDC → YES+NO, check positions, merge back |
| `get-positions.md` | Display all wallet positions, find specific market position |
| `get-orders.md` | On-chain vs API order fetch, OpenOrder shape, decode patterns |
| `get-reward-markets.md` | Reward fields, units table, lastRewardTs caveat |
| `simple-trading-bot.md` | Polling bot pattern, rate limiting, strategy extensions |

---

## Installation

```bash
npm install @alpha-arcade/sdk algosdk dotenv
```

---

## Client Setup

All config comes from environment variables — load and read `./references/env-setup.md` for the full `.env` template. Mainnet Algonode endpoints are free and need no API key.

```typescript
import 'dotenv/config';
import algosdk from 'algosdk';
import { AlphaClient } from '@alpha-arcade/sdk';

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
  activeAddress: account.addr.toString(),   // must call .toString()
  matcherAppId: Number(process.env.ALPHA_MATCHER_APP_ID ?? 3078581851),
  usdcAssetId: Number(process.env.ALPHA_USDC_ASSET_ID ?? 31566704),
  apiKey: process.env.ALPHA_API_KEY,        // optional — enables REST API methods
});
```

**Required fields:** `algodClient`, `indexerClient`, `signer`, `activeAddress`, `matcherAppId`, `usdcAssetId`.

---

## Units — the most important thing to get right

All prices, quantities, and amounts use **microunits** (× 1,000,000):

| Human value | Microunit value |
|-------------|-----------------|
| $1.00 USDC  | `1_000_000`     |
| $0.50 price | `500_000`       |
| 1 share     | `1_000_000`     |
| $0.02 slippage | `20_000`     |

Always divide by `1e6` when displaying: `order.price / 1e6`, `pos.yesBalance / 1e6`.

**Exception:** `lastRewardTs` on reward markets is in **milliseconds** — pass directly to `new Date(lastRewardTs)`.

---

## Markets

```typescript
const markets = await client.getLiveMarkets();          // auto: API if key set, else on-chain
const markets = await client.getMarketsOnChain();       // on-chain only (no API key needed)
const markets = await client.getLiveMarketsFromApi();   // API only — richer data (requires apiKey)
const market  = await client.getMarketOnChain(appId);  // single market by app ID
const rewardMarkets = await client.getRewardMarkets();  // requires apiKey
```

**Market shape (key fields):**
```typescript
{
  marketAppId: number,    // use this for all operations
  yesAssetId: number,     // YES outcome token ASA ID
  noAssetId: number,      // NO outcome token ASA ID
  title: string,
  endTs: number,          // resolution timestamp in seconds
  isResolved?: boolean,
  isLive?: boolean,
  yesProb?: number,       // API only
  volume?: number,        // API only
  totalRewards?: number,  // reward markets — microunits
  lastRewardTs?: number,  // reward markets — milliseconds (not microunits!)
}
```

**Multi-choice markets:** title format is `"Parent : Option"`. Each option has its own `marketAppId` and must be traded separately.

**Rate limiting:** slice to `markets.slice(0, 10)` when scanning orderbooks in a loop — load and read `./references/simple-trading-bot.md`.

---

## Trading

**Position & side encoding:**
```typescript
// position: 1 = Yes, 0 = No
// isBuying: true = BUY, false = SELL
// Decoding from OpenOrder:
const side = order.side === 1 ? 'BUY' : 'SELL';
const position = order.position === 1 ? 'YES' : 'NO';
```

**Limit order** — load and read `./references/place-limit-order.md` for full example with collateral notes:
```typescript
const result = await client.createLimitOrder({ marketAppId, position, price, quantity, isBuying });
// result: { escrowAppId, txIds, confirmedRound, matchedQuantity?, matchedPrice? }
```

**Market order** — load and read `./references/place-market-order.md` for orderbook-check pattern:
```typescript
const result = await client.createMarketOrder({ marketAppId, position, price, quantity, isBuying, slippage });
```

**Cancel order** — load and read `./references/cancel-order.md` for bulk cancel pattern:
```typescript
await client.cancelOrder({ marketAppId, escrowAppId, orderOwner: account.addr.toString() });
// Returns: USDC or tokens + 963,500 microALGO (escrow MBR)
```

**Amend order** (edit in-place — cheaper than cancel + recreate, only on unfilled orders):
```typescript
await client.amendOrder({ marketAppId, escrowAppId, price, quantity, slippage });
// Escrow auto-adjusts collateral: refunds if lower, requires more if higher
```

**Propose match** (advanced — explicit counterparty):
```typescript
await client.proposeMatch({ marketAppId, makerEscrowAppId, makerAddress, quantityMatched });
```

### Matching mechanics

Two match types exist — both handled automatically by `createMarketOrder`:

**Direct:** BUY YES ↔ SELL YES asks (price ≤ your price + slippage). SELL YES ↔ BUY YES bids, highest bid first.

**Complementary:** BUY YES also matches BUY NO bids. A NO bid at `P_no` is equivalent to a SELL YES at `1_000_000 − P_no` (together they sum to $1.00):
```typescript
const effectiveSellPrice = 1_000_000 - noBidPrice;
// BUY YES @ 100_000 can fill against BUY NO @ 900_000
```

---

## Orderbook

```typescript
const book = await client.getOrderbook(marketAppId);
// book.yes.bids / book.yes.asks / book.no.bids / book.no.asks
// Each entry: { price, quantity, escrowAppId, owner }
// Orderbook is UNSORTED — sort yourself:
const bestAsk = book.yes.asks.sort((a, b) => a.price - b.price)[0];
const bestBid = book.yes.bids.sort((a, b) => b.price - a.price)[0];

const myOrders   = await client.getOpenOrders(marketAppId);              // on-chain, no key needed
const allOrders  = await client.getWalletOrdersFromApi(account.addr.toString()); // all markets, requires apiKey
```

Load and read `./references/get-orders.md` for OpenOrder shape and decode patterns.

---

## Positions

Load and read `./references/split-merge.md` for split/merge examples. Load and read `./references/get-positions.md` for position listing.

```typescript
await client.splitShares({ marketAppId, amount });  // USDC → YES + NO tokens
await client.mergeShares({ marketAppId, amount });  // YES + NO → USDC (equal amounts required)
const positions = await client.getPositions();       // optional: pass a wallet address
```

**Claim after resolution** (unique to SKILL.md — no separate reference file):
```typescript
// Winning tokens → 1:1 USDC. Voided market → 0.5:1. Losing tokens → burned.
const result = await client.claim({
  marketAppId,
  assetId: market.yesAssetId,  // the outcome token to redeem
  amount: 1_000_000,           // optional — claims full balance if omitted
});
// amountClaimed = tokens redeemed in microunits (≠ USDC received for voided markets)
```

---

## Utility exports

```typescript
import {
  calculateFee,             // fee = ceil(feeBase × qty × price × (1 − price)) / 1e6
  calculateFeeFromTotal,    // reverse: extract fee from a total amount
  calculateMatchingOrders,  // compute counterparty matches from an orderbook
  decodeGlobalState,        // decode raw on-chain key-value state
  getMarketGlobalState,     // fetch + decode market app global state
  getEscrowGlobalState,     // fetch + decode escrow app global state
  checkAssetOptIn,          // check if address has opted into an ASA
  DEFAULT_API_BASE_URL,
  DEFAULT_MARKET_CREATOR_ADDRESS,
} from '@alpha-arcade/sdk';
```

---

## Constants

**Config fields** (`AlphaClientConfig`) — set via env vars:

| Field | Env var | Mainnet default |
|-------|---------|-----------------|
| `matcherAppId` | `ALPHA_MATCHER_APP_ID` | `3078581851` |
| `usdcAssetId` | `ALPHA_USDC_ASSET_ID` | `31566704` |

**Exported SDK constants** (from `@alpha-arcade/sdk`):

| Constant | Mainnet | Testnet |
|----------|---------|---------|
| `DEFAULT_MARKET_CREATOR_ADDRESS` | `5P5Y6HTWUNG2E3VXBQDZN3ENZD3JPAIR5PKT3LOYJAPAUKOLFD6KANYTRY` | different on testnet |
| `DEFAULT_API_BASE_URL` | `https://platform.alphaarcade.com/api` | — |

**Endpoints:**

| | Mainnet | Testnet |
|-|---------|---------|
| Algod | `https://mainnet-api.algonode.cloud` | `https://testnet-api.algonode.cloud` |
| Indexer | `https://mainnet-idx.algonode.cloud` | `https://testnet-idx.algonode.cloud` |

---

## TypeScript gotchas

**`addr` is `Readonly<Address>`, not `string` — use `as any` for `TransactionSignerAccount`:**
```typescript
const signerAccount: TransactionSignerAccount = { signer, addr: activeAddress } as any;
```

**`confirmedRound` is `bigint` in algosdk v3:**
```typescript
confirmedRound: Number(result.confirmedRound),
```

**algosdk v3 renamed `'global-state'` → `globalState` (camelCase):**
```typescript
const rawState = appInfo.params?.globalState ?? (appInfo as any).params?.['global-state'] ?? [];
```

**`activeAddress` must be a plain string** — always call `account.addr.toString()`.

---

## Resources

- **Platform:** https://alphaarcade.com
- **GitHub (SDK):** https://github.com/phara23/alpha-sdk
- **API key:** Alpha Arcade platform → Account page
