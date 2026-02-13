import type {
  AlphaClientConfig,
  CreateLimitOrderParams,
  CreateMarketOrderParams,
  CancelOrderParams,
  ProposeMatchParams,
  SplitSharesParams,
  MergeSharesParams,
  ClaimParams,
  CreateOrderResult,
  CreateMarketOrderResult,
  CancelOrderResult,
  ProposeMatchResult,
  SplitMergeResult,
  ClaimResult,
  Orderbook,
  OpenOrder,
  WalletPosition,
  Market,
} from './types.js';
import {
  createLimitOrder,
  createMarketOrder,
  cancelOrder,
  proposeMatch,
} from './modules/trading.js';
import {
  splitShares,
  mergeShares,
  claim,
  getPositions,
} from './modules/positions.js';
import { getOrderbook, getOpenOrders } from './modules/orderbook.js';
import { getMarkets as fetchMarkets, getMarket as fetchMarket } from './modules/markets.js';

/**
 * The main client for interacting with Alpha Market prediction markets on Algorand.
 *
 * Provides methods for:
 * - **Trading**: Create limit/market orders, cancel orders, propose matches
 * - **Positions**: Split/merge shares, claim resolved tokens, view positions
 * - **Orderbook**: Read on-chain orderbook for any market
 * - **Markets**: Fetch live markets from the Alpha API
 *
 * @example
 * ```typescript
 * import { AlphaClient } from '@alpha-arcade/sdk';
 * import algosdk from 'algosdk';
 *
 * const algodClient = new algosdk.Algodv2('', 'https://mainnet-api.algonode.cloud', 443);
 * const indexerClient = new algosdk.Indexer('', 'https://mainnet-idx.algonode.cloud', 443);
 * const account = algosdk.mnemonicToSecretKey('your mnemonic ...');
 * const signer = algosdk.makeBasicAccountTransactionSigner(account);
 *
 * const client = new AlphaClient({
 *   algodClient,
 *   indexerClient,
 *   signer,
 *   activeAddress: account.addr,
 *   matcherAppId: 3078581851,
 *   usdcAssetId: 31566704,
 *   apiKey: 'YOUR_API_KEY',
 * });
 *
 * // Fetch markets
 * const markets = await client.getMarkets();
 *
 * // Place a limit order
 * const result = await client.createLimitOrder({
 *   marketAppId: markets[0].marketAppId,
 *   position: 1, // Yes
 *   price: 500_000, // $0.50
 *   quantity: 1_000_000, // 1 share
 *   isBuying: true,
 * });
 * ```
 */
export class AlphaClient {
  private config: AlphaClientConfig;

  constructor(config: AlphaClientConfig) {
    if (!config.algodClient) throw new Error('algodClient is required');
    if (!config.indexerClient) throw new Error('indexerClient is required');
    if (!config.signer) throw new Error('signer is required');
    if (!config.activeAddress) throw new Error('activeAddress is required');
    if (!config.matcherAppId) throw new Error('matcherAppId is required');
    if (!config.usdcAssetId) throw new Error('usdcAssetId is required');
    if (!config.apiKey) throw new Error('apiKey is required');

    this.config = {
      ...config,
      apiBaseUrl: config.apiBaseUrl ?? 'https://partners.alphaarcade.com/api',
    };
  }

  // ============================================
  // Trading
  // ============================================

  /**
   * Creates a limit order on a market.
   *
   * A limit order sits on the orderbook at your specified price until matched
   * or cancelled. Slippage is 0 — the order executes only at your exact price.
   *
   * @param params - Order parameters (marketAppId, position, price, quantity, isBuying)
   * @returns The created escrow app ID and transaction info
   */
  async createLimitOrder(params: CreateLimitOrderParams): Promise<CreateOrderResult> {
    return createLimitOrder(this.config, params);
  }

  /**
   * Creates a market order with automatic matching.
   *
   * Fetches the live orderbook, finds the best counterparty orders within your
   * slippage tolerance, then creates the order and proposes matches in a single
   * atomic transaction group.
   *
   * @param params - Order parameters (marketAppId, position, price, quantity, isBuying, slippage)
   * @returns The created escrow app ID, matched quantity, and transaction info
   */
  async createMarketOrder(params: CreateMarketOrderParams): Promise<CreateMarketOrderResult> {
    return createMarketOrder(this.config, params);
  }

  /**
   * Cancels an open order by deleting its escrow app.
   *
   * Returns the escrowed funds (USDC or outcome tokens) to the order owner,
   * and reclaims the ALGO minimum balance used by the escrow app.
   *
   * @param params - Cancel parameters (marketAppId, escrowAppId, orderOwner)
   * @returns Whether the cancellation succeeded
   */
  async cancelOrder(params: CancelOrderParams): Promise<CancelOrderResult> {
    return cancelOrder(this.config, params);
  }

  /**
   * Proposes a match between an existing maker order and a new taker order.
   *
   * Use this for advanced matching scenarios where you want to explicitly
   * specify which orders to match against.
   *
   * @param params - Match parameters (marketAppId, makerEscrowAppId, makerAddress, quantityMatched)
   * @returns Whether the match succeeded
   */
  async proposeMatch(params: ProposeMatchParams): Promise<ProposeMatchResult> {
    return proposeMatch(this.config, params);
  }

  // ============================================
  // Positions
  // ============================================

  /**
   * Splits USDC into equal amounts of YES and NO outcome tokens.
   *
   * For example, splitting 1 USDC gives you 1 YES token + 1 NO token.
   * Together they're always worth $1.00 — you can trade them independently.
   *
   * @param params - Split parameters (marketAppId, amount in microunits)
   * @returns Transaction result
   */
  async splitShares(params: SplitSharesParams): Promise<SplitMergeResult> {
    return splitShares(this.config, params);
  }

  /**
   * Merges equal amounts of YES and NO tokens back into USDC.
   *
   * The inverse of split. 1 YES + 1 NO = 1 USDC, always.
   *
   * @param params - Merge parameters (marketAppId, amount in microunits)
   * @returns Transaction result
   */
  async mergeShares(params: MergeSharesParams): Promise<SplitMergeResult> {
    return mergeShares(this.config, params);
  }

  /**
   * Claims USDC from a resolved market by redeeming outcome tokens.
   *
   * - Winning tokens: redeemed 1:1 for USDC
   * - Voided market: redeemed at half value
   * - Losing tokens: burned (no USDC returned)
   *
   * @param params - Claim parameters (marketAppId, assetId, optional amount)
   * @returns Transaction result
   */
  async claim(params: ClaimParams): Promise<ClaimResult> {
    return claim(this.config, params);
  }

  /**
   * Gets all token positions for a wallet across all markets.
   *
   * Reads on-chain account info and maps ASA holdings to markets.
   * Returns raw token balances (YES/NO amounts per market).
   *
   * @param walletAddress - Optional wallet (defaults to activeAddress)
   * @returns Array of positions with market app IDs and token balances
   */
  async getPositions(walletAddress?: string): Promise<WalletPosition[]> {
    return getPositions(this.config, walletAddress);
  }

  // ============================================
  // Orderbook
  // ============================================

  /**
   * Fetches the full on-chain orderbook for a market.
   *
   * Reads all escrow apps created by the market contract, decodes their
   * global state, and organizes into yes/no bids and asks.
   * Only includes limit orders (slippage = 0) with unfilled quantity.
   *
   * @param marketAppId - The market app ID
   * @returns Orderbook with yes and no sides, each having bids and asks
   */
  async getOrderbook(marketAppId: number): Promise<Orderbook> {
    return getOrderbook(this.config, marketAppId);
  }

  /**
   * Gets open orders for a specific wallet on a market.
   *
   * @param marketAppId - The market app ID
   * @param walletAddress - Optional wallet (defaults to activeAddress)
   * @returns Array of open orders
   */
  async getOpenOrders(marketAppId: number, walletAddress?: string): Promise<OpenOrder[]> {
    return getOpenOrders(this.config, marketAppId, walletAddress);
  }

  // ============================================
  // Markets
  // ============================================

  /**
   * Fetches all live, tradeable markets from the Alpha API.
   *
   * Automatically paginates to retrieve all markets.
   *
   * @returns Array of live markets
   */
  async getMarkets(): Promise<Market[]> {
    return fetchMarkets(this.config);
  }

  /**
   * Fetches a single market by its ID.
   *
   * @param marketId - The market ID
   * @returns The market data, or null if not found
   */
  async getMarket(marketId: string): Promise<Market | null> {
    return fetchMarket(this.config, marketId);
  }
}
