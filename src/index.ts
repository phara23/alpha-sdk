// Main client
export { AlphaClient } from './client.js';

// All types
export type {
  // Config
  AlphaClientConfig,
  // Market
  Market,
  MarketOption,
  MarketGlobalState,
  // Orders
  Position,
  OrderSide,
  CreateLimitOrderParams,
  CreateMarketOrderParams,
  CancelOrderParams,
  ProposeMatchParams,
  CounterpartyMatch,
  CreateOrderResult,
  CancelOrderResult,
  ProposeMatchResult,
  // Orderbook
  OrderbookEntry,
  OrderbookSide,
  Orderbook,
  AggregatedOrderbookEntry,
  AggregatedOrderbookSide,
  AggregatedOrderbook,
  // Positions
  SplitSharesParams,
  MergeSharesParams,
  ClaimParams,
  SplitMergeResult,
  ClaimResult,
  WalletPosition,
  OpenOrder,
  // Escrow
  EscrowGlobalState,
} from './types.js';

// Market discovery
export { DEFAULT_MARKET_CREATOR_ADDRESS, getMarketsOnChain, getMarketOnChain, getLiveMarketsFromApi, getMarketFromApi } from './modules/markets.js';

// Utility functions (for advanced users)
export { calculateFee, calculateFeeFromTotal } from './utils/fees.js';
export { calculateMatchingOrders } from './utils/matching.js';
export { decodeGlobalState, getMarketGlobalState, getEscrowGlobalState, checkAssetOptIn } from './utils/state.js';
