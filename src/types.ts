import type { Algodv2, Indexer, TransactionSigner } from 'algosdk';

// ============================================
// Client Configuration
// ============================================

/** Configuration for initializing the AlphaClient */
export type AlphaClientConfig = {
  /** Algorand algod client instance */
  algodClient: Algodv2;
  /** Algorand indexer client instance */
  indexerClient: Indexer;
  /** Transaction signer (wallet or account signer) */
  signer: TransactionSigner;
  /** The active Algorand address that will sign transactions */
  activeAddress: string;
  /** Matcher contract app ID (mainnet: 3078581851) */
  matcherAppId: number;
  /** USDC ASA ID on Algorand (mainnet: 31566704) */
  usdcAssetId: number;
  /** Base URL for the Alpha REST API (default: https://platform.alphaarcade.com/api) */
  apiBaseUrl?: string;
  /** API key for the Alpha partners API. Optional -- if not provided, markets are loaded on-chain. */
  apiKey?: string;
  /** Market creator address for on-chain market discovery. Defaults to the Alpha Arcade mainnet creator. */
  marketCreatorAddress?: string;
  /** ALPHA staking pool app ID (mainnet default: 3626756314) */
  stakingAppId?: number;
  /** ALPHA ASA ID (mainnet default: 2726252423) */
  alphaAssetId?: number;
};

// ============================================
// Market Types
// ============================================

/** A prediction market (from the Alpha API or on-chain discovery) */
export type Market = {
  /** Market ID (app ID as string for on-chain, UUID for API) */
  id: string;
  title: string;
  slug?: string;
  image?: string;
  marketAppId: number;
  yesAssetId: number;
  noAssetId: number;
  /** YES probability (API only -- not available from on-chain lookup) */
  yesProb?: number;
  /** NO probability (API only -- not available from on-chain lookup) */
  noProb?: number;
  /** Trading volume (API only -- not available from on-chain lookup) */
  volume?: number;
  /** End/resolution timestamp in seconds */
  endTs: number;
  resolution?: number;
  isResolved?: boolean;
  isLive?: boolean;
  categories?: string[];
  featured?: boolean;
  options?: MarketOption[];
  feeBase?: number;
  /** Liquidty Rewards Info */
  totalRewards?: number;
  totalPregameRewards?: number;
  rewardsPaidOut?: number;
  rewardsSpreadDistance?: number;
  pregameRewardsSpreadDistance?: number;
  rewardsMinContracts?: number;
  lastRewardAmount?: number;
  lastRewardTs?: number;
  midpoint?: number;
  currentMidpoint?: number;
  currentMidpointLiquidity?: number;
  livePolyYesAsk?: number;
  livePolyNoAsk?: number;
  strongestQualifiedYesBid?: number;
  strongestQualifiedNoBid?: number;
  clobYesTokenId?: string;
  clobNoTokenId?: string;
  seriesId?: string;
  gameStartTimeMs?: number;
  /** Data source: 'onchain' or 'api' */
  source?: 'onchain' | 'api';
  [key: string]: unknown;
};

/** An option within a multi-choice market */
export type MarketOption = {
  id: string;
  title: string;
  marketAppId: number;
  yesAssetId: number;
  noAssetId: number;
  yesProb: number;
  noProb: number;
  totalRewards?: number;
  totalPregameRewards?: number;
  rewardsPaidOut?: number;
  rewardsSpreadDistance?: number;
  pregameRewardsSpreadDistance?: number;
  rewardsMinContracts?: number;
  lastRewardAmount?: number;
  lastRewardTs?: number;
  midpoint?: number;
  currentMidpoint?: number;
  currentMidpointLiquidity?: number;
  livePolyYesAsk?: number;
  livePolyNoAsk?: number;
  strongestQualifiedYesBid?: number;
  strongestQualifiedNoBid?: number;
  clobYesTokenId?: string;
  clobNoTokenId?: string;
  seriesId?: string;
  gameStartTimeMs?: number;
  [key: string]: unknown;
};

/** Global state of a market app read from on-chain */
export type MarketGlobalState = {
  collateral_asset_id: number;
  yes_asset_id: number;
  no_asset_id: number;
  yes_supply: number;
  no_supply: number;
  is_resolved: number;
  is_activated: number;
  outcome: number;
  resolution_time: number;
  fee_base_percent: number;
  fee_timer_threshold: number;
  title: string;
  rules: string;
  oracle_address: string;
  fee_address: string;
  market_friend_addr: string;
  escrow_cancel_address: string;
};

// ============================================
// Order Types
// ============================================

/** Position: 1 = Yes, 0 = No */
export type Position = 0 | 1;

/** Order side: 'BUY' or 'SELL' */
export type OrderSide = 'BUY' | 'SELL';

/** Parameters for creating a limit order */
export type CreateLimitOrderParams = {
  /** Market app ID */
  marketAppId: number;
  /** 1 for Yes, 0 for No */
  position: Position;
  /** Price in microunits (e.g. 500000 = $0.50) */
  price: number;
  /** Quantity in microunits (e.g. 1000000 = 1 share) */
  quantity: number;
  /** Whether this is a buy order */
  isBuying: boolean;
  /** Fee base in microunits (e.g. 70000 = 7%). If omitted, reads from market global state. */
  feeBase?: number;
};

/** Parameters for creating a market order */
export type CreateMarketOrderParams = {
  /** Market app ID */
  marketAppId: number;
  /** 1 for Yes, 0 for No */
  position: Position;
  /** Price in microunits (e.g. 500000 = $0.50) */
  price: number;
  /** Quantity in microunits (e.g. 1000000 = 1 share) */
  quantity: number;
  /** Whether this is a buy order */
  isBuying: boolean;
  /** Slippage tolerance in microunits (e.g. 50000 = $0.05) */
  slippage: number;
  /** Fee base in microunits. If omitted, reads from market global state. */
  feeBase?: number;
  /** Pre-computed matching orders. If omitted, auto-fetches orderbook and computes matches. */
  matchingOrders?: CounterpartyMatch[];
};

/** Parameters for cancelling an order */
export type CancelOrderParams = {
  /** Market app ID */
  marketAppId: number;
  /** The escrow app ID of the order to cancel */
  escrowAppId: number;
  /** The owner address of the order */
  orderOwner: string;
};

/** Parameters for proposing a match between two existing orders */
export type ProposeMatchParams = {
  /** Market app ID */
  marketAppId: number;
  /** The maker escrow app ID (existing order) */
  makerEscrowAppId: number;
  /** The maker's Algorand address */
  makerAddress: string;
  /** Quantity to match in microunits */
  quantityMatched: number;
};

/**
 * Parameters for matching two existing limit orders (e.g. after an amend).
 * The taker is the order placed last and pays the fee; the maker is the counterparty.
 */
export type ProcessMatchParams = {
  /** Market app ID */
  marketAppId: number;
  /** Maker escrow app ID (existing order — was on the book first) */
  makerEscrowAppId: number;
  /** Taker escrow app ID (existing order — placed last, pays the fee) */
  takerEscrowAppId: number;
};

/** Parameters for amending (editing) an existing unfilled order */
export type AmendOrderParams = {
  /** Market app ID */
  marketAppId: number;
  /** The escrow app ID of the order to amend */
  escrowAppId: number;
  /** New price in microunits (e.g. 500000 = $0.50) */
  price: number;
  /** New quantity in microunits (e.g. 1000000 = 1 share) */
  quantity: number;
  /** New slippage in microunits (default 0) */
  slippage?: number;
};

/** A counterparty order to match against */
export type CounterpartyMatch = {
  /** Escrow app ID of the counterparty order */
  escrowAppId: number;
  /** Quantity available to match in microunits */
  quantity: number;
  /** Owner address of the counterparty order */
  owner: string;
  /** Effective fill price in microunits (accounts for complementary matching, e.g. 1_000_000 - noPrice for YES buys) */
  price?: number;
};

/** Result of creating an order */
export type CreateOrderResult = {
  /** The escrow app ID of the newly created order */
  escrowAppId: number;
  /** Transaction IDs from the atomic group */
  txIds: string[];
  /** Confirmed round number */
  confirmedRound: number;
  /** Total quantity that was matched */
  matchedQuantity?: number;
  /** Weighted average fill price in microunits (accounts for complementary matching) */
  matchedPrice?: number;
};

/** Result of cancelling an order */
export type CancelOrderResult = {
  /** Whether the cancellation succeeded */
  success: boolean;
  /** Transaction IDs */
  txIds: string[];
  /** Confirmed round number */
  confirmedRound: number;
};

/** Result of proposing a match */
export type ProposeMatchResult = {
  /** Whether the match succeeded */
  success: boolean;
  /** Transaction IDs */
  txIds: string[];
  /** Confirmed round number */
  confirmedRound: number;
};

/** Result of processing a match between two existing orders */
export type ProcessMatchResult = {
  /** Whether the match succeeded */
  success: boolean;
  /** Transaction IDs */
  txIds: string[];
  /** Confirmed round number */
  confirmedRound: number;
};

/** Result of amending an order */
export type AmendOrderResult = {
  /** Whether the amendment succeeded */
  success: boolean;
  /** Transaction IDs */
  txIds: string[];
  /** Confirmed round number */
  confirmedRound: number;
  /** Total quantity matched against counterparty orders (if matching was performed) */
  matchedQuantity?: number;
  /** Volume-weighted average fill price in microunits (if any matches) */
  matchedPrice?: number;
};

// ============================================
// Orderbook Types
// ============================================

/** A single entry in the orderbook (one price level, one order) */
export type OrderbookEntry = {
  /** Price in microunits (e.g. 500000 = $0.50) */
  price: number;
  /** Remaining quantity in microunits */
  quantity: number;
  /** Escrow app ID for this order */
  escrowAppId: number;
  /** Owner address */
  owner: string;
};

/** One side (bids or asks) of the orderbook */
export type OrderbookSide = {
  bids: OrderbookEntry[];
  asks: OrderbookEntry[];
};

/** Full orderbook for a market */
export type Orderbook = {
  yes: OrderbookSide;
  no: OrderbookSide;
};

/** Aggregated orderbook entry (multiple orders at same price) */
export type AggregatedOrderbookEntry = {
  /** Price in microunits */
  price: number;
  /** Total quantity at this price level in microunits */
  quantity: number;
  /** Number of orders at this price level */
  orderCount: number;
};

/** Aggregated orderbook side */
export type AggregatedOrderbookSide = {
  bids: AggregatedOrderbookEntry[];
  asks: AggregatedOrderbookEntry[];
};

/** Aggregated orderbook for display */
export type AggregatedOrderbook = {
  yes: AggregatedOrderbookSide;
  no: AggregatedOrderbookSide;
};

/**
 * Full processed market orderbook keyed by marketAppId.
 * Matches the REST `/get-full-orderbook` response and `orderbook_changed.orderbook`.
 */
export type FullOrderbookSnapshot = Record<string, WsOrderbookApp>;

export type LiquiditySource = 'alpha' | 'polymarket';

export type LiquidityExecution = 'escrow' | 'crossVenue';

export type PositionSide = 'yes' | 'no';

export type BookEntrySide = 'bid' | 'ask';

export type NativeLiquidityEntry = {
  price: number;
  quantity: number;
  total: number;
  escrowAppId: number;
  owner: string;
  source: 'alpha';
  execution: 'escrow';
  position: PositionSide;
  side: BookEntrySide;
};

export type RoutedLiquidityEntry = {
  price: number;
  quantity: number;
  total: number;
  source: 'polymarket';
  execution: 'crossVenue';
  position: PositionSide;
  side: BookEntrySide;
  polyTokenId: string;
  displayPriceMicro: number;
  polySourcePriceMicro: number;
  notionalMicroUsdc: number;
};

export type ExecutableLiquidityEntry = NativeLiquidityEntry | RoutedLiquidityEntry;

export type ExecutableOrderbookSide = {
  bids: ExecutableLiquidityEntry[];
  asks: ExecutableLiquidityEntry[];
};

export type RoutedOrderbookData = {
  yes: ExecutableOrderbookSide;
  no: ExecutableOrderbookSide;
};

export type MergedRoutedOrderbookData = RoutedOrderbookData & {
  asks: ExecutableLiquidityEntry[];
  bids: ExecutableLiquidityEntry[];
  spread: number;
};

export type RoutedOrderbookApp = {
  native: WsOrderbookApp;
  routed: RoutedOrderbookData;
  merged: MergedRoutedOrderbookData;
};

export type RoutedOrderbookResponse = {
  marketId: string;
  slug?: string;
  version: number;
  generatedAt: number;
  warnings?: string[];
  orderbook: Record<string, RoutedOrderbookApp>;
  config: {
    maxNotionalMicroUsdc: number;
    aaMarginBps: number;
  };
};

export type CrossVenueExecConfig = {
  ok: boolean;
  matcherAppId: number;
  mmAddress: string;
  usdcAssetId: number;
  feeAddress: string;
  escrowPreludePayMicroAlgo: number;
  matcherGroupFeeMicroAlgo: number;
  validityWindowRounds: number;
  maxNotionalMicroUsdc: number;
  avgPriceToleranceMicro: number;
  absoluteCeilingOffsetMicro: number;
  aaMarginBps: number;
};

export type CrossVenueRfqQuote = {
  ok: boolean;
  quoteId?: string;
  expiresAt?: number;
  marketId?: string;
  marketAppId?: number;
  userPosition?: Position;
  side?: OrderSide;
  quantity?: number;
  polyTokenId?: string;
  displayPriceMicro?: number;
  polySourcePriceMicro?: number;
  notionalMicroUsdc?: number;
  thresholdMicro?: number | null;
  takerSlippageMicro?: number;
  takerSlippageMinMicro?: number;
  takerSlippageMaxMicro?: number;
  mmNeedsOptIn?: boolean;
  userNeedsOptIn?: boolean;
  userReceivesAssetId?: number;
  mmReceivesAssetId?: number;
  yesAssetId?: number;
  noAssetId?: number;
  feeBase?: number;
  quoteTtlMs?: number;
  requiresWalletSignature?: boolean;
  source?: 'polymarket';
  execution?: 'crossVenue';
  reason?: string;
  detail?: string;
  /** Base64-encoded unsigned user-leg transactions (opt-in, pay, xfer, create_escrow). */
  unsignedUserTxns?: string[];
  /** Pinned algod params — pass verbatim to submitRoutedOrder. */
  suggestedParams?: {
    firstValid: number;
    lastValid: number;
    genesisHash: string;
    genesisID: string;
    fee: number;
    minFee?: number;
  };
  /** 8-byte nonce (base64) embedded in txn notes — pass verbatim to submitRoutedOrder. */
  nonce?: string;
};

export type RequestRfqQuoteParams = {
  marketId: string;
  marketAppId?: number;
  userAddress?: string;
  userPosition: Position;
  isBuying: boolean;
  quantity: number;
  takerSlippageMicro?: number;
};

export type SubmitRoutedOrderParams = {
  userAddress: string;
  marketId: string;
  marketAppId: number;
  userPosition: Position;
  isBuying: boolean;
  quantity: number;
  polyQuotedPriceMicro: number;
  yesAssetId: number;
  noAssetId: number;
  signedUserTxns: string[];
  suggestedParams: {
    firstValid: number;
    lastValid: number;
    genesisHash: string;
    genesisID: string;
    fee: number;
    minFee?: number;
  };
  nonce: string;
  mmNeedsOptIn: boolean;
  userNeedsOptIn: boolean;
  crossVenueTakerSlippageMicro: number;
};

export type SubmitRoutedOrderResult = {
  ok?: boolean;
  success?: boolean;
  txId?: string;
  txIds?: string[];
  freshAvgPriceMicro?: number;
  matchedPriceMicro?: number;
  [key: string]: unknown;
};

// ============================================
// Combo RFQ Types
// ============================================

export type ComboRfqSelection = 'yes' | 'no';
export type ComboRfqOp = 'AND' | 'OR';

export type ComboRfqLeg =
  | {
      source: 'aa';
      marketId: string;
      selection: ComboRfqSelection;
      /** The leg's own on-chain market/option escrow app id — read the order
       *  book straight from chain, no id→appId lookup. For a spread/total/futures
       *  OPTION leg this is the OPTION's app (each option is its own market). Set
       *  on the RFQ broadcast a maker receives; absent on legs a taker submits. */
      marketAppId?: number;
      /** Plain-english "<parent question> — <pick>" for the leg, e.g.
       *  "NFL Champion 2027 — Baltimore Ravens" or "LoL: DS vs BF — DS". Set on
       *  the RFQ broadcast a maker receives. */
      description?: string;
      label?: string;
      matchup?: string;
      sport?: string;
      marketType?: string;
    }
  | {
      source: 'sgp';
      graderId: string;
      sgp: string;
      league?: string;
      eventId?: string;
      /** Plain-english "<market> — <selection>" derived from the graderId, e.g.
       *  "Moneyline — Minnesota Twins". Set on the RFQ broadcast a maker receives. */
      description?: string;
      label?: string;
      matchup?: string;
      sport?: string;
      marketType?: string;
    };

export type ComboRfqGroup = {
  op: ComboRfqOp;
  legs: ComboRfqLeg[];
};

export type ComboRfqTree = {
  groups: ComboRfqGroup[];
  connectors: ComboRfqOp[];
};

export type ComboRfqQuote = {
  quoteId: string;
  poolAppId: number;
  yesAssetId: number;
  noAssetId: number;
  usdcAssetId: number;
  houseAddress: string;
  marketFriendAddress: string;
  feeAddress: string;
  matcherAppId: number;
  pricedYesMicro: number;
  fairYesMicro: number;
  quantityMicro: number;
  payoutMicro: number;
  platformFeeMicro: number;
  feeBase: number;
  suggestedParams: {
    firstValid: number;
    lastValid: number;
    genesisHash: string;
    genesisID: string;
    fee: number;
    minFee?: number;
  };
  nonce: string;
  expireAtSeconds: number;
  expireAt?: number;
  reservedUntilMs: number;
  rfqId?: string;
  makerKind?: 'alpha' | 'external';
  makerQuoteId?: string;
  makerAddress?: string;
  /** Present when quote was requested with userAddress — base64 unsigned user legs. */
  unsignedUserTxns?: string[];
  userLegIndices?: number[];
  [key: string]: unknown;
};

export type RequestComboRfqQuoteParams = {
  tree: ComboRfqTree;
  grossStakeMicro: number;
  userAddress: string;
  name?: string;
};

export type SubmitComboRfqWalletParams = {
  quoteId: string;
  userAddress: string;
  signedTakerTxns: string[];
};

export type SubmitComboRfqResult = {
  ok?: boolean;
  txId?: string;
  marketId?: string;
  pricedYesMicro?: number;
  [key: string]: unknown;
};

export type ComboRfqRequestEvent = {
  type: 'combo_rfq_request';
  rfqId: string;
  tree: ComboRfqTree;
  grossStakeMicro: number;
  /** Whole-combo FAIR probability (micro, pre-edge) — the maker's anchor. Fair
   *  is computable by any maker with the odds (leaks no Alpha margin) and lets
   *  you price without a /combo/price round trip. NOT per-leg and NOT Alpha's
   *  quoted price — quote below fair+edge to compete. */
  fairPriceMicro?: number;
  quoteDeadline: number;
  /** @deprecated Alpha house price is no longer broadcast to competing makers. */
  alphaPriceMicro?: number;
};

export type ComboRfqFillRequestEvent = {
  type: 'combo_rfq_fill_request';
  rfqId: string;
  quoteId: string;
  comboQuoteId: string;
  makerAddress: string;
  unsignedMakerTxns: string[];
  confirmBy: number;
};

export type ComboRfqQuoteReference = {
  rfqId: string;
  quoteId: string;
  priceMicro: number;
};

export type ComboRfqMakerSessionEvent =
  | ComboRfqRequestEvent
  | ComboRfqFillRequestEvent;

export type ComboRfqMakerSessionOptions = {
  /** Overrides the API key passed to AlphaWebSocket. */
  apiKey?: string;
  /**
   * Algorand wallet that will quote and sign fills. Required.
   * Independent of the API-key account's issued trading address — fund this wallet
   * with USDC + ALGO for capacity checks.
   */
  makerAddress: string;
  /** Optional signer used by `confirm(event)` to sign maker legs automatically. */
  signer?: TransactionSigner;
};

export type ComboRfqMakerSession = AsyncIterable<ComboRfqMakerSessionEvent> & {
  /** Settlement wallet bound at AUTH for this session. */
  makerAddress: string;
  quote: (
    event: ComboRfqRequestEvent | string,
    quote: { priceMicro: number },
  ) => Promise<ComboRfqQuoteReference>;
  cancel: (event: ComboRfqRequestEvent | string) => Promise<unknown>;
  confirm: (
    event: ComboRfqFillRequestEvent,
    signedMakerTxns?: string[],
  ) => Promise<unknown>;
  decline: (event: ComboRfqFillRequestEvent, reason?: string) => Promise<unknown>;
  close: () => void;
};

// ============================================
// Position Types
// ============================================

/** Parameters for split shares */
export type SplitSharesParams = {
  /** Market app ID */
  marketAppId: number;
  /** Amount to split in microunits (e.g. 1000000 = $1.00 USDC) */
  amount: number;
};

/** Parameters for merge shares */
export type MergeSharesParams = {
  /** Market app ID */
  marketAppId: number;
  /** Amount to merge in microunits */
  amount: number;
};

/** Parameters for claiming resolved tokens */
export type ClaimParams = {
  /** Market app ID */
  marketAppId: number;
  /** The outcome token ASA ID to redeem */
  assetId: number;
  /** Amount to claim in microunits. If omitted, claims entire balance. */
  amount?: number;
};

/** Result of a split or merge operation */
export type SplitMergeResult = {
  success: boolean;
  txIds: string[];
  confirmedRound: number;
};

/** Result of a claim operation */
export type ClaimResult = {
  success: boolean;
  txIds: string[];
  confirmedRound: number;
  /** Amount of tokens claimed in microunits */
  amountClaimed: number;
};

/** A wallet's token position in a market */
export type WalletPosition = {
  /** Market app ID */
  marketAppId: number;
  /** Market title (fetched from on-chain global state) */
  title: string;
  /** YES token ASA ID */
  yesAssetId: number;
  /** NO token ASA ID */
  noAssetId: number;
  /** YES token balance in microunits */
  yesBalance: number;
  /** NO token balance in microunits */
  noBalance: number;
};

/** An open order belonging to the wallet */
export type OpenOrder = {
  /** Escrow app ID */
  escrowAppId: number;
  /** Market app ID */
  marketAppId: number;
  /** Position: 0=No, 1=Yes */
  position: Position;
  /** Side: 0=Sell, 1=Buy */
  side: number;
  /** Price in microunits */
  price: number;
  /** Total quantity in microunits */
  quantity: number;
  /** Filled quantity in microunits */
  quantityFilled: number;
  /** Slippage in microunits (0 = limit order) */
  slippage: number;
  /** Owner address */
  owner: string;
};

// ============================================
// Escrow Global State (raw on-chain)
// ============================================

/** Raw global state of an escrow app */
export type EscrowGlobalState = {
  position?: number;
  side?: number;
  price?: number;
  quantity?: number;
  quantity_filled?: number;
  slippage?: number;
  owner?: string;
  market_app_id?: number;
  asset_listed?: number;
  fee_timer_start?: number;
};

// ============================================
// WebSocket Types
// ============================================

/** Configuration for AlphaWebSocket */
export type AlphaWebSocketConfig = {
  /** WebSocket URL override (default: wss://platform-wss.alphaarcade.com) */
  url?: string;
  /** Enable auto-reconnect on unexpected disconnect (default: true) */
  reconnect?: boolean;
  /** Maximum reconnect attempts before giving up (default: Infinity) */
  maxReconnectAttempts?: number;
  /** Heartbeat interval in ms (default: 60000) */
  heartbeatIntervalMs?: number;
  /** API key used to authenticate RFQ maker methods on the existing platform WebSocket. */
  apiKey?: string;
  /**
   * WebSocket constructor to use. Defaults to the global `WebSocket`.
   * On Node.js < 22, pass the `ws` package: `import WebSocket from 'ws'; new AlphaWebSocket({ WebSocket })`
   */
  WebSocket?: unknown;
};

/** Orderbook bid/ask entry at the top level (decimal cents) */
export type WsOrderbookAggregatedEntry = {
  price: number;
  quantity: number;
  total: number;
};

/** Orderbook bid/ask entry with escrow details (raw microunit prices) */
export type WsOrderbookDetailEntry = {
  price: number;
  quantity: number;
  total: number;
  escrowAppId: number;
  owner: string;
};

/** Per-side orderbook detail (yes or no) */
export type WsOrderbookDetailSide = {
  bids: WsOrderbookDetailEntry[];
  asks: WsOrderbookDetailEntry[];
};

/** Orderbook data for a single app within the orderbook payload */
export type WsOrderbookApp = {
  bids: WsOrderbookAggregatedEntry[];
  asks: WsOrderbookAggregatedEntry[];
  spread: number;
  yes: WsOrderbookDetailSide;
  no: WsOrderbookDetailSide;
};

/** Payload for orderbook_changed events */
export type OrderbookChangedEvent = {
  type: 'orderbook_changed';
  ts: number;
  marketId: string;
  slug?: string;
  version: number;
  orderbook: FullOrderbookSnapshot;
};

/** Payload for markets_changed events (incremental diffs) */
export type MarketsChangedEvent = {
  type: 'markets_changed';
  ts: number;
  [key: string]: unknown;
};

/** Payload for market_changed events (single market) */
export type MarketChangedEvent = {
  type: 'market_changed';
  ts: number;
  [key: string]: unknown;
};

/** Payload for wallet_orders_changed events */
export type WalletOrdersChangedEvent = {
  type: 'wallet_orders_changed';
  ts: number;
  [key: string]: unknown;
};

/** Discriminated union of all WebSocket stream events */
export type WebSocketStreamEvent =
  | MarketsChangedEvent
  | MarketChangedEvent
  | OrderbookChangedEvent
  | WalletOrdersChangedEvent
  | ComboRfqRequestEvent
  | ComboRfqFillRequestEvent;

// ============================================
// Staking Types
// ============================================

/** Stake ALPHA into the fee-sharing pool (microunits, 6 decimals). */
export type StakeAlphaParams = {
  /** Amount of ALPHA to stake, in microunits (1_000_000 = 1 ALPHA) */
  amount: number;
};

/** Unstake ALPHA from the pool (microunits, 6 decimals). */
export type UnstakeAlphaParams = {
  /** Amount of ALPHA to unstake, in microunits (1_000_000 = 1 ALPHA) */
  amount: number;
};

/** Result of a staking write action (stake / unstake / claim). */
export type StakingActionResult = {
  success: boolean;
  txIds: string[];
  confirmedRound: number;
};

/**
 * On-chain staking position for a wallet.
 * Amounts are microunits. Claimable excludes USDC fees that have arrived at the
 * pool but have not yet been folded into the reward accumulator.
 */
export type StakingPosition = {
  /** Whether the wallet has opted into the staking app */
  optedIn: boolean;
  /** ALPHA currently staked by this wallet (microunits) */
  staked: number;
  /** Pending USDC rewards already accrued into local state (microunits) */
  pending: number;
  /** Claimable USDC right now (pending + accrued vs current accumulator) */
  claimable: number;
  /** Unix timestamp (seconds) when this wallet's stake last became non-zero */
  stakedSince: number;
  /** Total ALPHA staked in the pool (microunits) */
  totalStaked: number;
  /** USDC currently held by the pool app address (microunits) */
  poolUsdcBalance: number;
  /** Share of the pool in basis points (staked / totalStaked * 10_000), or 0 */
  poolShareBps: number;
};
