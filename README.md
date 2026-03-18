# @alpha-arcade/sdk

TypeScript SDK for trading on **Alpha Market** — Algorand prediction markets.

Place orders, manage positions, read orderbooks from the API or chain, and build automated trading bots.

## Installation

```bash
npm install @alpha-arcade/sdk algosdk @algorandfoundation/algokit-utils
```

`algosdk` and `@algorandfoundation/algokit-utils` are peer dependencies.

## Getting an API key

An API key is **optional**. Without it, you can still fetch markets on-chain, place orders, and use most SDK features. With an API key, you get richer market data, liquidity rewards information, and wallet order lookups, and more.

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

The repo includes runnable examples (use `npx tsx examples/<script>.ts`). Scripts that call the API (e.g. `get-orders.ts`, `get-reward-markets.ts`) need `ALPHA_API_KEY` in your `.env` — see [Getting an API key](#getting-an-api-key). Trading examples also need `TEST_MNEMONIC`.

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

Edits an existing unfilled order in-place — cheaper and faster than cancel + recreate. The escrow contract adjusts collateral automatically: sends you a refund if the new value is lower, or requires extra funds (sent automatically) if higher.

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

Smart defaults — uses the API if `apiKey` is set, otherwise reads from chain.

```typescript
const markets = await client.getLiveMarkets();
for (const m of markets) {
  console.log(`${m.title} — App ID: ${m.marketAppId}, source: ${m.source}`);
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

Fetches markets that have liquidity rewards from the Alpha REST API. Requires `apiKey`. Returns the same `Market[]` shape with reward fields populated: `totalRewards`, `rewardsPaidOut`, `rewardsSpreadDistance`, `rewardsMinContracts`, `lastRewardAmount`, `lastRewardTs`.

```typescript
const rewardMarkets = await client.getRewardMarkets();
for (const m of rewardMarkets) {
  console.log(`${m.title}: $${(m.totalRewards ?? 0) / 1e6} total rewards`);
}
```

---

### WebSocket Streams

Real-time data streams via WebSocket. No API key or auth required. Replaces polling with push-based updates.

The SDK connects to the public platform websocket at `wss://wss.platform.alphaarcade.com`. The first
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

// Node.js 22+ and browsers — native WebSocket, nothing extra needed
const ws = new AlphaWebSocket();

// Node.js < 22 — install `ws` and pass it in:
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

Receive change events for a single market. Uses the market **slug** (not `marketAppId`) — see note on `subscribeOrderbook` below.

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
