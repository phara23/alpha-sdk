# @alpha-arcade/sdk

TypeScript SDK for trading on **Alpha Market** - Algorand prediction markets.

Place orders, manage positions, read orderbooks from the API or chain, and build automated trading bots.

## Installation

```bash
npm install @alpha-arcade/sdk algosdk @algorandfoundation/algokit-utils
```

`algosdk` and `@algorandfoundation/algokit-utils` are peer dependencies.

## Getting an API key

An API key is **optional**. Without it, you can still fetch markets on-chain, place orders, and use most SDK features. With an API key, you get richer market data, liquidity rewards information, wallet order lookups, routed liquidity, and RFQ endpoints.

To get an API key:

1. Go to [alphaarcade.com](https://alphaarcade.com) and **sign up** with your email or Google account.
2. Open the **Account** page 
3. Open the **Partners** tab.
4. Click **Create API key** and copy the key.
5. Add it to your environment (e.g. a `.env` file in the project root):

```bash
ALPHA_API_KEY=your_api_key_here
```

Then pass it when creating the client: `apiKey: process.env.ALPHA_API_KEY`.

## Quick Start

```typescript
import { AlphaClient } from '@alpha-arcade/sdk';
import algosdk from 'algosdk';

// 1. Setup clients
const algodClient = new algosdk.Algodv2('', 'https://mainnet-api.algonode.cloud', 443);
const indexerClient = new algosdk.Indexer('', 'https://mainnet-idx.algonode.cloud', 443);

// 2. Setup signer from mnemonic (or use any TransactionSigner)
const account = algosdk.mnemonicToSecretKey('your twenty five word mnemonic ...');
const signer = algosdk.makeBasicAccountTransactionSigner(account);

// 3. Initialize the client (no API key needed!)
const client = new AlphaClient({
  algodClient,
  indexerClient,
  signer,
  activeAddress: account.addr.toString(),
  matcherAppId: 3078581851,
  usdcAssetId: 31566704,
});

// 4. Fetch live markets (reads directly from chain)
const markets = await client.getLiveMarkets();
console.log(`Found ${markets.length} live markets`);

// 5. Place a limit buy order on the first market
const market = markets[0];
const result = await client.createLimitOrder({
  marketAppId: market.marketAppId,
  position: 1,        // 1 = Yes
  price: 500_000,     // $0.50
  quantity: 1_000_000, // 1 share
  isBuying: true,
});

console.log(`Order created! Escrow app ID: ${result.escrowAppId}`);
```

## Examples

The repo includes runnable examples (use `npx tsx examples/<script>.ts`). Scripts that call the API (e.g. `get-orders.ts`, `get-reward-markets.ts`) need `ALPHA_API_KEY` in your `.env` - see [Getting an API key](#getting-an-api-key). Trading examples also need `TEST_MNEMONIC`.

| Script | Description |
|--------|-------------|
| `get-orders.ts` | Fetch all open orders for a wallet via the API (`getWalletOrdersFromApi`) |
| `get-reward-markets.ts` | Fetch reward markets and show liquidity reward info (`getRewardMarkets`) |
| `get-positions.ts` | List token positions across markets (`getPositions`) |
| `place-limit-order.ts` | Place a limit order |
| `place-market-order.ts` | Place a market order |
| `cancel-order.ts` | Cancel an open order |
| `split-merge.ts` | Split USDC into YES/NO and merge back |
| `simple-trading-bot.ts` | Example bot that scans markets and places market orders |
| `place-rfq-trade.ts` | Test cross-venue RFQ quote logic for a market |
| `combo-rfq-maker.ts` | Run a combo RFQ maker over the platform WebSocket |
| `get-orderbook.ts` | Retrieves and logs combined routed orderbook |

## API Reference

### AlphaClient

#### Constructor

```typescript
new AlphaClient(config: AlphaClientConfig)
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `algodClient` | `algosdk.Algodv2` | Yes | Algorand algod client |
| `indexerClient` | `algosdk.Indexer` | Yes | Algorand indexer client |
| `signer` | `TransactionSigner` | Yes | Transaction signer |
| `activeAddress` | `string` | Yes | Your Algorand address |
| `matcherAppId` | `number` | Yes | Matcher contract app ID (mainnet: `3078581851`) |
| `usdcAssetId` | `number` | Yes | USDC ASA ID (mainnet: `31566704`) |
| `apiKey` | `string` | No | Alpha API key. If provided, `getLiveMarkets()` and related API methods use the platform for richer data (images, categories, volume, reward markets, wallet orders). If omitted, markets are discovered on-chain. |
| `apiBaseUrl` | `string` | No | API base URL (default: `https://platform.alphaarcade.com/api`) |
| `marketCreatorAddress` | `string` | No | Market creator address for on-chain discovery (defaults to Alpha Arcade mainnet) |

---

### Trading

#### `createLimitOrder(params)`

Creates a limit order that sits on the orderbook at your price.

```typescript
const result = await client.createLimitOrder({
  marketAppId: 123456789,
  position: 1,          // 1 = Yes, 0 = No
  price: 500_000,       // $0.50 in microunits
  quantity: 2_000_000,  // 2 shares in microunits
  isBuying: true,
});
// result: { escrowAppId, txIds, confirmedRound, matchedQuantity?, matchedPrice? }
```

#### `createMarketOrder(params)`

Creates a market order that auto-matches against the orderbook.

```typescript
const result = await client.createMarketOrder({
  marketAppId: 123456789,
  position: 1,
  price: 550_000,       // willing to pay up to $0.55
  quantity: 1_000_000,
  isBuying: true,
  slippage: 50_000,     // $0.05 slippage tolerance
});
// result: { escrowAppId, txIds, confirmedRound, matchedQuantity, matchedPrice }
```

#### `cancelOrder(params)`

Cancels an open order and returns funds to the owner.

```typescript
const result = await client.cancelOrder({
  marketAppId: 123456789,
  escrowAppId: 987654321,
  orderOwner: 'ALGO_ADDRESS...',
});
// result: { success, txIds }
```

#### `amendOrder(params)`

Edits an existing unfilled order in-place - cheaper and faster than cancel + recreate. The escrow contract adjusts collateral automatically: sends you a refund if the new value is lower, or requires extra funds (sent automatically) if higher.

Only works on orders with zero quantity filled.

```typescript
// Get your open orders to find the escrowAppId
const orders = await client.getOpenOrders(123456789);
const order = orders[0];

// Amend the order to a new price and quantity
const result = await client.amendOrder({
  marketAppId: 123456789,
  escrowAppId: order.escrowAppId,
  price: 600_000,       // new price: $0.60
  quantity: 3_000_000,  // new quantity: 3 shares
});
// result: { success, txIds, confirmedRound }
```

#### `proposeMatch(params)`

Manually matches an existing maker order against a taker.

```typescript
const result = await client.proposeMatch({
  marketAppId: 123456789,
  makerEscrowAppId: 987654321,
  makerAddress: 'MAKER_ALGO_ADDRESS...',
  quantityMatched: 500_000,
});
// result: { success, txIds }
```

---

### Positions

#### `splitShares(params)`

Splits USDC into equal YES + NO tokens. 1 USDC = 1 YES + 1 NO.

```typescript
const result = await client.splitShares({
  marketAppId: 123456789,
  amount: 5_000_000, // $5.00 USDC
});
// You now hold 5 YES + 5 NO tokens for this market
```

#### `mergeShares(params)`

Merges equal YES + NO tokens back into USDC.

```typescript
const result = await client.mergeShares({
  marketAppId: 123456789,
  amount: 3_000_000, // Merge 3 YES + 3 NO = $3.00 USDC
});
```

#### `claim(params)`

Claims USDC from a resolved market.

```typescript
const result = await client.claim({
  marketAppId: 123456789,
  assetId: 111222333, // The YES or NO token ASA ID
});
```

#### `getPositions(walletAddress?)`

Gets all token positions across all markets.

```typescript
const positions = await client.getPositions();
for (const pos of positions) {
  console.log(`Market ${pos.marketAppId}: ${pos.yesBalance / 1e6} YES, ${pos.noBalance / 1e6} NO`);
}
```

---

### Orderbook

#### `getOrderbook(marketAppId)`

Fetches the full on-chain orderbook for a single market app.

```typescript
const book = await client.getOrderbook(123456789);

console.log('Yes bids:', book.yes.bids.length);
console.log('Yes asks:', book.yes.asks.length);
console.log('No bids:', book.no.bids.length);
console.log('No asks:', book.no.asks.length);

// Best yes bid
if (book.yes.bids.length > 0) {
  const best = book.yes.bids.sort((a, b) => b.price - a.price)[0];
  console.log(`Best Yes bid: $${best.price / 1e6} for ${best.quantity / 1e6} shares`);
}
```

#### `getFullOrderbookFromApi(marketId)`

Fetches the full processed orderbook snapshot for a market from the Alpha REST API. Requires `apiKey`.

This returns the same shape as websocket `orderbook_changed.orderbook`: a record keyed by `marketAppId`, where each value includes:
- top-level aggregated `bids`, `asks`, and `spread`
- detailed `yes` and `no` bid/ask orders with `escrowAppId` and `owner`

```typescript
const snapshot = await client.getFullOrderbookFromApi('market-uuid-here');

for (const [appId, book] of Object.entries(snapshot)) {
  console.log(`App ${appId}: spread=${book.spread}`);
  console.log('Top-level bids:', book.bids);
  console.log('Detailed YES bids:', book.yes.bids);
}
```

#### `getRoutedOrderbook(marketId)`

Fetches the API-backed orderbook with native Alpha Arcade liquidity and routed Polymarket liquidity. Requires `apiKey`.

Use this when you want to show liquidity that can be matched on demand through the cross-venue flow. The native book remains unchanged under `native`; routed entries are source-tagged so they cannot be confused with real escrow orders.

```typescript
const routed = await client.getRoutedOrderbook('market-uuid-here');

for (const [appId, routedBook] of Object.entries(routed.orderbook)) {
  console.log(`App ${appId}`);

  for (const ask of routedBook.merged.asks) {
    if (ask.source === 'alpha') {
      console.log(`AA ask ${ask.escrowAppId}: $${ask.price / 1e6}`);
    } else {
      console.log(
        `Routed ask via ${ask.polyTokenId}: display $${ask.displayPriceMicro / 1e6}, source $${ask.polySourcePriceMicro / 1e6}`,
      );
    }
  }
}
```

Routed entries have `source: 'polymarket'` and `execution: 'crossVenue'`. They intentionally do not have `escrowAppId`, because the escrow does not exist until the cross-venue transaction group is signed and submitted.

Do not pass routed entries into `createMarketOrder()` or `calculateMatchingOrders()`. Those functions only match existing Alpha Arcade escrow orders. Use `requestRfqQuote()` for routed liquidity.

#### Cross-venue config and RFQ quotes

These methods wrap the routed-liquidity API. They require `apiKey`.

```typescript
const config = await client.getCrossVenueConfig();
console.log(`Cross-venue matcher app: ${config.matcherAppId}`);

const quote = await client.requestRfqQuote({
  marketId: 'market-uuid-here',
  marketAppId: 123456789,      // recommended for multi-choice markets
  userAddress: account.addr.toString(),
  userPosition: 1,             // 1 = YES, 0 = NO
  isBuying: true,
  quantity: 2_000_000,         // 2 shares
});

if (!quote.ok) {
  console.log(`No routed quote: ${quote.reason} ${quote.detail ?? ''}`);
} else {
  console.log(`Quote id: ${quote.quoteId}`);
  console.log(`Display price: $${quote.displayPriceMicro! / 1e6}`);
  console.log(`External source price: $${quote.polySourcePriceMicro! / 1e6}`);
  console.log(`Expires at: ${new Date(quote.expiresAt!).toISOString()}`);
  console.log(`User needs opt-in: ${quote.userNeedsOptIn}`);
  console.log(`MM needs opt-in: ${quote.mmNeedsOptIn}`);
}
```

`requestRfqQuote()` is a fresh quote for display and transaction construction. It is not final fill authorization. The backend re-fetches Polymarket liquidity and re-runs cross-venue validation when `submitRoutedOrder()` is called, then byte-compares the wallet-signed user legs before the market-maker signs.

#### `submitRoutedOrder(params)`

Submits a wallet-signed cross-venue order to the backend for final validation, market-maker signing, and on-chain submission.

```typescript
const result = await client.submitRoutedOrder({
  userAddress: account.addr.toString(),
  marketId: 'market-uuid-here',
  marketAppId: 123456789,
  userPosition: 1,
  isBuying: true,
  quantity: quote.quantity!,
  polyQuotedPriceMicro: quote.displayPriceMicro!,
  yesAssetId: quote.yesAssetId!,
  noAssetId: quote.noAssetId!,
  mmNeedsOptIn: quote.mmNeedsOptIn ?? false,
  userNeedsOptIn: quote.userNeedsOptIn ?? false,
  crossVenueTakerSlippageMicro: quote.takerSlippageMicro!,
  suggestedParams: {
    firstValid: 0,
    lastValid: 0,
    genesisHash: 'base64-genesis-hash',
    genesisID: 'mainnet-v1.0',
    fee: 0,
    minFee: 1000,
  },
  nonce: 'base64-8-byte-nonce',
  signedUserTxns: [
    'base64-signed-user-opt-in-or-payment',
    'base64-signed-user-funding',
    'base64-signed-user-create-escrow',
    'base64-signed-user-propose-match',
  ],
});
```

The SDK currently provides the HTTP wrapper for submit. Your wallet integration must build the canonical cross-venue group and collect the user signatures that `submit-for-wallet` expects. If the backend sees a stale price, wrong asset id, unexpected opt-in state, or any byte mismatch in the user-signed transactions, it rejects before the market-maker signs.

#### `getOpenOrders(marketAppId, walletAddress?)`

Gets open orders for a wallet on a specific market (from on-chain data).

```typescript
const orders = await client.getOpenOrders(123456789);
for (const order of orders) {
  const side = order.side === 1 ? 'BUY' : 'SELL';
  const pos = order.position === 1 ? 'YES' : 'NO';
  console.log(`${side} ${pos} @ $${order.price / 1e6} - ${order.quantity / 1e6} shares`);
}
```

#### `getWalletOrdersFromApi(walletAddress)`

Gets all open orders for a wallet across every live market via the Alpha REST API. Requires `apiKey`. Paginates automatically.

```typescript
const orders = await client.getWalletOrdersFromApi('ALGO_ADDRESS...');
for (const order of orders) {
  console.log(`Market ${order.marketAppId} | Escrow ${order.escrowAppId} | ${order.quantityFilled / 1e6} filled`);
}
```

---

### Markets

Markets can be loaded **on-chain** (default, no API key) or via the **REST API** (richer data, requires API key).

#### `getLiveMarkets()` / `getMarket(marketId)`

Smart defaults - uses the API if `apiKey` is set, otherwise reads from chain.

```typescript
const markets = await client.getLiveMarkets();
for (const m of markets) {
  console.log(`${m.title} - App ID: ${m.marketAppId}, source: ${m.source}`);
}

const market = await client.getMarket('12345'); // app ID string for on-chain, UUID for API
```

#### `getMarketsOnChain()` / `getMarketOnChain(marketAppId)`

Always reads from the blockchain. No API key needed. Returns core data: title, asset IDs, resolution time, fees.

```typescript
const markets = await client.getMarketsOnChain();
const market = await client.getMarketOnChain(3012345678);
```

#### `getLiveMarketsFromApi()` / `getMarketFromApi(marketId)`

Always uses the REST API. Requires `apiKey`. Returns richer data: images, categories, volume, probabilities.

```typescript
const markets = await client.getLiveMarketsFromApi();
const market = await client.getMarketFromApi('uuid-here');
```

#### `getRewardMarkets()`

Fetches markets that have liquidity rewards from the Alpha REST API. Requires `apiKey`. Returns the same `Market[]` shape with reward fields populated: `totalRewards`, `totalPregameRewards`, `rewardsPaidOut`, `rewardsSpreadDistance`, `rewardsMinContracts`, `lastRewardAmount`, `lastRewardTs`. For sports markets, pregame liquidity rewards may be exposed via `totalPregameRewards`.

```typescript
const rewardMarkets = await client.getRewardMarkets();
for (const m of rewardMarkets) {
  const rewardTotal = m.totalRewards ?? m.totalPregameRewards ?? 0;
  console.log(`${m.title}: $${rewardTotal / 1e6} total rewards`);
}
```

---

### WebSocket Streams

Real-time data streams via WebSocket. No API key or auth required. Replaces polling with push-based updates.

The SDK connects to the public platform websocket at `wss://platform-wss.alphaarcade.com`. The first
subscription is sent in the connection query string, and any later subscribe or unsubscribe calls use the
server's control-message envelope:

```json
{
  "id": "request-id",
  "method": "SUBSCRIBE",
  "params": [
    { "stream": "get-orderbook", "slug": "will-btc-hit-100k" }
  ]
}
```

Supported public streams:

- `get-live-markets`
- `get-market` with `slug`
- `get-orderbook` with `slug`
- `get-wallet-orders` with `wallet`

```typescript
import { AlphaWebSocket } from '@alpha-arcade/sdk';

// Node.js 22+ and browsers - native WebSocket, nothing extra needed
const ws = new AlphaWebSocket();

// Node.js < 22 - install `ws` and pass it in:
// npm install ws
import WebSocket from 'ws';
const ws = new AlphaWebSocket({ WebSocket });

// Subscribe to orderbook updates (~5s snapshots)
const unsub = ws.subscribeOrderbook('will-btc-hit-100k', (event) => {
  console.log('Orderbook:', event.orderbook);
});

// Unsubscribe when done
unsub();

// Close the connection
ws.close();
```

#### `subscribeLiveMarkets(callback)`

Receive incremental diffs whenever market probabilities change.

```typescript
ws.subscribeLiveMarkets((event) => {
  console.log('Markets changed at', event.ts, event);
});
```

#### `subscribeMarket(slug, callback)`

Receive change events for a single market. Uses the market **slug** (not `marketAppId`) - see note on `subscribeOrderbook` below.

```typescript
ws.subscribeMarket('will-btc-hit-100k', (event) => {
  console.log('Market update:', event);
});
```

#### `subscribeOrderbook(slug, callback)`

Receive full orderbook snapshots on every change (~5s interval). The payload matches `getFullOrderbookFromApi(marketId)`.

**Note:** The WebSocket API uses market **slugs** (URL-friendly names like `"will-btc-hit-100k"`), not `marketAppId` numbers. You can get a market's slug from the `slug` field on `Market` objects returned by `getLiveMarkets()` or `getMarket()`.

```typescript
ws.subscribeOrderbook('will-btc-hit-100k', (event) => {
  // Top-level bids/asks use decimal prices (cents)
  // Nested yes/no use raw microunit prices with escrowAppId and owner
  for (const [appId, book] of Object.entries(event.orderbook)) {
    console.log(`App ${appId}: spread=${book.spread}`);
    console.log('  Bids:', book.bids);
    console.log('  Yes bids:', book.yes.bids);
  }
});
```

#### `subscribeWalletOrders(wallet, callback)`

Receive updates when orders for a wallet are created or modified.

```typescript
ws.subscribeWalletOrders('MMU6X...', (event) => {
  console.log('Wallet orders changed:', event);
});
```

#### Unsubscribing

Each `subscribe*` method returns an unsubscribe function. Call it to stop receiving events for that stream:

```typescript
const unsub = ws.subscribeOrderbook('my-market', (event) => { /* ... */ });

// Later, stop listening
unsub();
```

#### Control Methods

```typescript
// List active subscriptions on this connection
const subs = await ws.listSubscriptions();

// Query server properties (`heartbeat` or `limits`)
const props = await ws.getProperty('heartbeat');
```

#### Configuration

```typescript
import WebSocket from 'ws'; // Only needed on Node.js < 22

const ws = new AlphaWebSocket({
  WebSocket,                                  // Pass `ws` on Node.js < 22 (not needed in browsers or Node 22+)
  url: 'wss://custom-endpoint.example.com',   // Override default URL
  reconnect: true,                            // Auto-reconnect (default: true)
  maxReconnectAttempts: 10,                   // Give up after 10 retries (default: Infinity)
  heartbeatIntervalMs: 60_000,                // Ping interval in ms (default: 60000)
});
```

#### Connection Details

| Setting | Value |
|---------|-------|
| Heartbeat | 60s (auto-handled) |
| Idle timeout | 180s |
| Rate limit | 5 messages/sec/connection |
| Reconnect | Exponential backoff (1s → 30s max) |

The client automatically responds to server pings, sends keepalive pings, and reconnects with exponential backoff on unexpected disconnects. All active subscriptions are restored after reconnect.

---

### Combo RFQ

Competitive quotes for **AND/OR combo purchases**. Your API key is required. Alpha always quotes as the house; connected partner makers can compete over the same platform WebSocket used for public streams.

This is separate from single-market cross-venue RFQ (`requestRfqQuote` / `submitRoutedOrder`).

#### Buy a combo (taker)

1. Request a quote with your combo tree and stake.
2. Sign the returned user legs.
3. Submit. If an external maker won, they get a short final look before the group lands on chain.

```typescript
import { signComboRfqTransactions, type ComboRfqTree } from '@alpha-arcade/sdk';

const tree: ComboRfqTree = {
  groups: [
    {
      op: 'AND',
      legs: [
        // AA-native market legs (esports, tennis, MLB, futures, …).
        { source: 'aa', marketId: 'market-uuid-1', selection: 'yes' },
        { source: 'aa', marketId: 'market-uuid-2', selection: 'no' },
        // Same-game (SGP) legs are also supported — identified by graderId +
        // the BlazeBuilder sgp token (from the /parlay/sgp/markets feed):
        // {
        //   source: 'sgp',
        //   graderId: 'DraftKings#<eventId>#Moneyline#<Team>',
        //   sgp: '<blazebuilder-token>',
        //   league: 'mlb',
        //   eventId: '<eventId>',
        // },
      ],
    },
  ],
  connectors: [], // op between consecutive groups; length = groups.length - 1
};

const quote = await client.requestComboRfqQuote({
  tree,
  grossStakeMicro: 10_000_000, // $10
  userAddress: account.addr.toString(),
});

console.log(quote.makerKind);      // "alpha" | "external"
console.log(quote.pricedYesMicro); // YES price in microunits (500_000 = $0.50)

if (!quote.unsignedUserTxns?.length) {
  throw new Error('Quote missing user legs. Pass userAddress on the quote request.');
}

const signedTakerTxns = await signComboRfqTransactions(
  quote.unsignedUserTxns,
  signer, // same TransactionSigner you passed to AlphaClient
);

const result = await client.submitComboRfqWallet({
  quoteId: quote.quoteId,
  userAddress: account.addr.toString(),
  signedTakerTxns,
});

console.log('Combo filled:', result.txId);
```

Important taker notes:

- Prices and stake use microunits (`1_000_000` = $1.00).
- After you sign, the fill is bound to the chosen maker. Decline or timeout means re-quote; there is no silent rematch.
- Common submit errors: `MAKER_DECLINED`, `MAKER_TIMEOUT`, `RFQ_EXPIRED`, `RFQ_DISABLED`, `NO_QUOTES`.

#### Quote combos as a maker

Connected partner makers compete to fill combos in a **reverse auction**: when a
trader prices a combo, every maker receives the full order over the platform
WebSocket and returns a YES price. The **lowest** price wins the trader's flow —
and you only win by **beating Alpha's house quote** (which is never broadcast to
you). Alpha is always the backstop, so there is no obligation to quote and no
adverse fill: you win only when you choose to and are cheaper.

**Prerequisites**

- A **partner API key** (contact the Alpha Arcade team to be provisioned).
- A **funded Algorand maker wallet** — `makerAddress`. It quotes and signs the
  fills, and is checked for capacity on every win: fund it with **USDC** (to post
  your side of fills) plus a little **ALGO** (fees + asset opt-ins). A maker that
  can't cover a fill is briefly auto-paused, not errored.
- The maker wallet is independent of the API key's account — pass it explicitly.

**Minimal maker loop**

```typescript
import algosdk from 'algosdk';
import { AlphaWebSocket } from '@alpha-arcade/sdk';

const maker = algosdk.mnemonicToSecretKey(process.env.MAKER_MNEMONIC!);
const signer = algosdk.makeBasicAccountTransactionSigner(maker);

const ws = new AlphaWebSocket({
  apiKey: process.env.ALPHA_API_KEY!,     // your partner key
  // On Node < 22: also pass WebSocket from the `ws` package.
});

const session = await ws.openComboRfqMakerSession({
  makerAddress: maker.addr.toString(),    // funded USDC + ALGO wallet
  signer,                                 // used by confirm() to sign maker legs
});

for await (const event of session) {
  if (event.type === 'combo_rfq_request') {
    // Anchor on the broadcast fair price and quote fair + your edge. Lower YES
    // price = more competitive. Skip if there's no profitable price for you.
    if (event.fairPriceMicro == null) continue;
    await session.quote(event, { priceMicro: event.fairPriceMicro + 5_000 });
    continue;
  }

  if (event.type === 'combo_rfq_fill_request') {
    // You won the auction — sign your maker legs within confirmBy (~2s).
    if (Date.now() > event.confirmBy) {
      await session.decline(event, 'expired');
      continue;
    }
    await session.confirm(event);         // signs maker legs with the session signer
  }
}
```

**Pricing the combo**

Every `combo_rfq_request` carries **`fairPriceMicro`** — the whole-combo FAIR
probability (pre-edge, in microunits). This is your anchor: it's computable by
any maker with the underlying odds (so it leaks none of Alpha's margin) and lets
you quote **without a round trip** to price the tree. Quote a hair above fair to
keep an edge while still undercutting Alpha's marked-up house price.

To price independently instead of anchoring, each leg tells you what it is:

- **AA legs** — `{ source: 'aa', marketId, marketAppId, selection, description }`.
  Read the on-chain order book directly by `marketAppId`, or call `/combo/price`.
- **SGP legs** — `{ source: 'sgp', graderId, sgp, league, eventId, description }`.
  Price from your own odds feed (OddsBlaze); same-game correlation uses the
  BlazeBuilder `sgp` token. `graderId` is `Book#eventId#Market#Selection`.
- **Tree shape** — each `tree.groups[]` combines its `legs` by `op` (`AND`/`OR`);
  `tree.connectors[]` join consecutive groups (length = `groups.length - 1`).
- `description` on each leg is a plain-english label
  (e.g. `"NFL Champion 2027 — Baltimore Ravens"`) for logging/UI.

**Latency** — you have **~1s to quote** and **~2s to sign the fill**. WebSocket
delivery + your price + the round trip must fit the first window, so serious
makers price from a **local model/cache** (or the fair anchor) rather than a live
API probe, and run **close to `us-east-1`**.

**Settlement is non-custodial and tamper-proof.** You sign only your own maker
legs, from your own wallet. On submit the server rebuilds the transaction group
**byte-for-byte** from the pinned quote and rejects any mismatch, then settles the
whole combo as one **atomic group in USDC on Algorand**. You fund the opposite
side of the trader's position — `(1e6 - priceMicro)` per contract — so a
long-shot combo's edge is realised on its likely miss.

Maker helpers on the session:

| Method | When |
|--------|------|
| `quote(event, { priceMicro })` | Respond during the ~1s auction |
| `cancel(event)` | Withdraw a quote you already sent |
| `confirm(event)` | Win final look: sign maker legs (~2s) |
| `decline(event, reason?)` | Refuse the fill |

Runnable example: `examples/combo-rfq-maker.ts`

```bash
ALPHA_API_KEY=... MAKER_MNEMONIC=... npx tsx examples/combo-rfq-maker.ts
```

---

### Utility Functions

These are exported for advanced users:

```typescript
import { calculateFee, calculateMatchingOrders, getMarketGlobalState } from '@alpha-arcade/sdk';

// Fee calculation
const fee = calculateFee(1_000_000, 500_000, 70_000); // quantity, price, feeBase

// Read market state directly
const state = await getMarketGlobalState(algodClient, marketAppId);
```

---

## Units & Conventions

| Concept | Unit | Example |
|---------|------|---------|
| Prices | Microunits (1M = $1.00) | `500_000` = $0.50 |
| Quantities | Microunits (1M = 1 share) | `2_000_000` = 2 shares |
| Position | `1` = Yes, `0` = No | `position: 1` |
| Side | `1` = Buy, `0` = Sell | Order side |
| Fee base | Microunits | `70_000` = 7% |

---

## Building a Trading Bot

```typescript
import { AlphaClient } from '@alpha-arcade/sdk';
import algosdk from 'algosdk';

const setup = () => {
  const algodClient = new algosdk.Algodv2('', 'https://mainnet-api.algonode.cloud', 443);
  const indexerClient = new algosdk.Indexer('', 'https://mainnet-idx.algonode.cloud', 443);
  const account = algosdk.mnemonicToSecretKey(process.env.MNEMONIC!);

  return new AlphaClient({
    algodClient,
    indexerClient,
    signer: algosdk.makeBasicAccountTransactionSigner(account),
    activeAddress: account.addr.toString(),
    matcherAppId: 3078581851,
    usdcAssetId: 31566704,
  });
};

const run = async () => {
  const client = setup();
  const markets = await client.getLiveMarkets(); // Loads from chain, no API key needed

  for (const market of markets) {
    const book = await client.getOrderbook(market.marketAppId);

    // Simple strategy: buy Yes if best ask < $0.30
    const bestAsk = book.yes.asks.sort((a, b) => a.price - b.price)[0];
    if (bestAsk && bestAsk.price < 300_000) {
      console.log(`Buying Yes on "${market.title}" at $${bestAsk.price / 1e6}`);

      await client.createMarketOrder({
        marketAppId: market.marketAppId,
        position: 1,
        price: bestAsk.price,
        quantity: 1_000_000,
        isBuying: true,
        slippage: 20_000, // $0.02 slippage
      });
    }
  }
};

run().catch(console.error);
```

## Network Configuration

### Mainnet (default)

```typescript
const algodClient = new algosdk.Algodv2('', 'https://mainnet-api.algonode.cloud', 443);
const indexerClient = new algosdk.Indexer('', 'https://mainnet-idx.algonode.cloud', 443);
```

### Testnet

```typescript
const algodClient = new algosdk.Algodv2('', 'https://testnet-api.algonode.cloud', 443);
const indexerClient = new algosdk.Indexer('', 'https://testnet-idx.algonode.cloud', 443);
```

## Error Handling

All methods throw on failure. Wrap calls in try/catch:

```typescript
try {
  const result = await client.createLimitOrder({ ... });
} catch (error) {
  if (error.message.includes('balance')) {
    console.error('Insufficient funds');
  } else {
    console.error('Order failed:', error.message);
  }
}
```

## License

MIT
