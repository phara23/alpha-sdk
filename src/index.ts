// Main client
export { AlphaClient } from './client.js';

// WebSocket client
export { AlphaWebSocket } from './websocket.js';

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
  ProcessMatchParams,
  AmendOrderParams,
  CounterpartyMatch,
  CreateOrderResult,
  CancelOrderResult,
  ProposeMatchResult,
  ProcessMatchResult,
  AmendOrderResult,
  // Orderbook
  OrderbookEntry,
  OrderbookSide,
  Orderbook,
  FullOrderbookSnapshot,
  LiquiditySource,
  LiquidityExecution,
  PositionSide,
  BookEntrySide,
  NativeLiquidityEntry,
  RoutedLiquidityEntry,
  ExecutableLiquidityEntry,
  ExecutableOrderbookSide,
  RoutedOrderbookData,
  MergedRoutedOrderbookData,
  RoutedOrderbookApp,
  RoutedOrderbookResponse,
  CrossVenueExecConfig,
  CrossVenueRfqQuote,
  RequestRfqQuoteParams,
  SubmitRoutedOrderParams,
  SubmitRoutedOrderResult,
  ComboRfqLeg,
  ComboRfqGroup,
  ComboRfqTree,
  ComboRfqQuote,
  RequestComboRfqQuoteParams,
  SubmitComboRfqWalletParams,
  SubmitComboRfqResult,
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
  // Staking
  StakeAlphaParams,
  UnstakeAlphaParams,
  StakingActionResult,
  StakingPosition,
  // WebSocket
  AlphaWebSocketConfig,
  WsOrderbookAggregatedEntry,
  WsOrderbookDetailEntry,
  WsOrderbookDetailSide,
  WsOrderbookApp,
  OrderbookChangedEvent,
  MarketsChangedEvent,
  MarketChangedEvent,
  WalletOrdersChangedEvent,
  ComboRfqRequestEvent,
  ComboRfqFillRequestEvent,
  ComboRfqQuoteReference,
  ComboRfqMakerSessionEvent,
  ComboRfqMakerSessionOptions,
  ComboRfqMakerSession,
  WebSocketStreamEvent,
} from './types.js';

// Market discovery
export { getMarketsOnChain, getMarketOnChain, getLiveMarketsFromApi, getMarketFromApi } from './modules/markets.js';
export { getRoutedOrderbookFromApi } from './modules/orderbook.js';
export { getCrossVenueConfig, requestRfqQuote, submitRoutedOrder } from './modules/crossVenue.js';
export { requestComboRfqQuote, submitComboRfqWallet, signComboRfqTransactions } from './modules/comboRfq.js';
export {
  stakeAlpha,
  unstakeAlpha,
  claimStakingRewards,
  getStakingPosition,
} from './modules/staking.js';
export {
  DEFAULT_API_BASE_URL,
  DEFAULT_WSS_BASE_URL,
  DEFAULT_MARKET_CREATOR_ADDRESS,
  DEFAULT_STAKING_APP_ID,
  DEFAULT_ALPHA_ASSET_ID,
  STAKING_REWARD_PRECISION,
} from './constants.js';

// Utility functions (for advanced users)
export { calculateFee, calculateFeeFromTotal } from './utils/fees.js';
export { calculateMatchingOrders } from './utils/matching.js';
export { resolveRfqTradeTarget } from './utils/rfq.js';
export type { RfqTradeTarget, ResolveRfqTradeTargetParams } from './utils/rfq.js';
export {
  decodeGlobalState,
  getMarketGlobalState,
  getEscrowGlobalState,
  checkAssetOptIn,
  checkAppOptIn,
} from './utils/state.js';
