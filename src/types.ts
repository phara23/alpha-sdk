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
  /** Base URL for the Alpha REST API (default: https://partners.alphaarcade.com/api) */
  apiBaseUrl?: string;
  /** API key for the Alpha partners API. Optional -- if not provided, markets are loaded on-chain. */
  apiKey?: string;
  /** Market creator address for on-chain market discovery. Defaults to the Alpha Arcade mainnet creator. */
  marketCreatorAddress?: string;
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
