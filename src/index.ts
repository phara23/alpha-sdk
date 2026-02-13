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
  CreateMarketOrderResult,
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

// Utility functions (for advanced users)
export { calculateFee, calculateFeeFromTotal } from './utils/fees.js';
export { calculateMatchingOrders } from './utils/matching.js';
export { decodeGlobalState, getMarketGlobalState, getEscrowGlobalState, checkAssetOptIn } from './utils/state.js';
