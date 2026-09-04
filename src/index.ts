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
  ClaimStakingParams,
  StakingActionResult,
  StakingPosition,
  // Perps
  ClosePerpParams,
  LpWithdrawParams,
  PerpActionResult,
  PerpsMarket,
  PerpPosition,
  PerpPositionView,
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
  ComboRfqSide,
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
export {
  getResolutionState,
  proposeResolution,
  disputeResolution,
  finalizeResolution,
  claimResolutionBond,
  getResolutionMarkets,
  getWalletResolutionBonds,
} from './modules/resolution.js';
export type {
  ResolutionState,
  ResolutionBondSlot,
  ResolutionOutcomeValue,
  ResolutionActionResult,
  ProposeResolutionParams,
  DisputeResolutionParams,
  FinalizeResolutionParams,
  ClaimResolutionBondParams,
  ResolutionMarketSummary,
  WalletResolutionBond,
} from './types.js';
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
  closePosition as closePerpPosition,
  liquidate as liquidatePerp,
  lpWithdraw as perpsLpWithdraw,
  poke as perpsPoke,
  reportOracleDown as perpsReportOracleDown,
  readAllPositions as readAllPerpPositions,
  getPerpsMarket,
  getPosition as getPerpPosition,
  getPositionView as getPerpPositionView,
  getLpShares as getPerpsLpShares,
  getMark as getPerpsMark,
  execPrice as perpsExecPrice,
  limitFromMark as perpsLimitFromMark,
  buildPositionView as buildPerpPositionView,
} from './modules/perps.js';
export {
  DEFAULT_API_BASE_URL,
  DEFAULT_WSS_BASE_URL,
  DEFAULT_MARKET_CREATOR_ADDRESS,
  DEFAULT_STAKING_APP_ID,
  DEFAULT_ALPHA_ASSET_ID,
  TINYMAN_ALPHA_USDC_LP_ASSET_ID,
  TINYMAN_ALPHA_ALGO_LP_ASSET_ID,
  MYTH_ALPHA_ALGO_ASSET_ID,
  DEFAULT_STAKING_POOLS,
  STAKING_REWARD_PRECISION,
  RESOLUTION_OUTCOME,
  DEFAULT_LITE_REWARDS_APP_ID,
} from './constants.js';
export type { StakingPoolKind } from './constants.js';

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
