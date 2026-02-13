import algosdk, { AtomicTransactionComposer, getApplicationAddress } from 'algosdk';
import * as algokit from '@algorandfoundation/algokit-utils';
import type { TransactionSignerAccount } from '@algorandfoundation/algokit-utils/types/account';
import { MarketAppClient } from '../contracts/market_app.js';
import { MatcherAppClient } from '../contracts/matcher_app.js';
import type {
  AlphaClientConfig,
  CreateLimitOrderParams,
  CreateMarketOrderParams,
  CancelOrderParams,
  ProposeMatchParams,
  CreateOrderResult,
  CreateMarketOrderResult,
  CancelOrderResult,
  ProposeMatchResult,
  CounterpartyMatch,
} from '../types.js';
import { calculateFee } from '../utils/fees.js';
import { getMarketGlobalState, checkAssetOptIn } from '../utils/state.js';
import { calculateMatchingOrders } from '../utils/matching.js';
import { getOrderbook } from './orderbook.js';

/**
 * Extracts the created escrow app ID from the transaction using retries.
 * First tries algod pendingTransactionInformation, then falls back to indexer with backoff.
 */
const extractEscrowAppId = async (
  algodClient: algosdk.Algodv2,
  indexerClient: algosdk.Indexer,
  targetTxId: string,
): Promise<number> => {
  // Try algod pending info first
  try {
    const pendingInfo = await algodClient.pendingTransactionInformation(targetTxId).do();
    if (pendingInfo?.['inner-txns']?.[0]?.['created-application-index']) {
      return pendingInfo['inner-txns'][0]['created-application-index'];
    }
  } catch {
    // Fall through to indexer
  }

  // Retry with indexer (exponential backoff)
  const backoffs = [1000, 1500, 2000, 3000, 5000, 8000];
  for (const delayMs of backoffs) {
    try {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      const txnLookup = await indexerClient.lookupTransactionByID(targetTxId).do();
      if (txnLookup?.transaction?.['inner-txns']?.[0]?.['created-application-index']) {
        return txnLookup.transaction['inner-txns'][0]['created-application-index'];
      }
    } catch {
      // Retry on 404/lag
    }
  }

  return 0;
};

/**
 * Creates a limit order (slippage = 0) on a market.
 *
 * Builds and executes an atomic transaction group:
 * 1. (Optional) Asset opt-in for the outcome token or USDC
 * 2. ALGO payment (957,000 microAlgos) to market app for escrow MBR
 * 3. Asset transfer (USDC if buying, outcome token if selling) to market app
 * 4. App call: market_app.create_escrow(price, quantity, 0, position)
 *
 * @param config - Alpha client config
 * @param params - Limit order parameters
 * @returns The created escrow app ID and transaction info
 */
export const createLimitOrder = async (
  config: AlphaClientConfig,
  params: CreateLimitOrderParams,
): Promise<CreateOrderResult> => {
  return createOrder(config, { ...params, slippage: 0, matchingOrders: [] });
};

/**
 * Creates a market order with automatic matching.
 *
 * Fetches the orderbook, computes matching counterparty orders, then builds
 * an atomic transaction group that creates the escrow + proposes matches.
 *
 * @param config - Alpha client config
 * @param params - Market order parameters
 * @returns The created escrow app ID, matched quantity, and transaction info
 */
export const createMarketOrder = async (
  config: AlphaClientConfig,
  params: CreateMarketOrderParams,
): Promise<CreateMarketOrderResult> => {
  // Auto-fetch matching orders if not provided
  let matchingOrders = params.matchingOrders;
  if (!matchingOrders) {
    const orderbook = await getOrderbook(config, params.marketAppId);
    matchingOrders = calculateMatchingOrders(
      orderbook,
      params.isBuying,
      params.position === 1,
      params.quantity,
      params.price,
      params.slippage,
    );
  }

  const totalMatchedQuantity = matchingOrders.reduce((sum, o) => sum + o.quantity, 0);
  const result = await createOrder(config, {
    ...params,
    matchingOrders,
  });

  return { ...result, matchedQuantity: totalMatchedQuantity };
};

/**
 * Internal: builds and executes the order creation atomic group.
 */
const createOrder = async (
  config: AlphaClientConfig,
  params: CreateLimitOrderParams & { slippage: number; matchingOrders: CounterpartyMatch[] },
): Promise<CreateOrderResult> => {
  const { algodClient, indexerClient, signer, activeAddress, matcherAppId, usdcAssetId } = config;
  const { marketAppId, position, price, quantity, isBuying, slippage, matchingOrders } = params;

  const globalState = await getMarketGlobalState(algodClient, marketAppId);
  const yesAssetId = globalState.yes_asset_id;
  const noAssetId = globalState.no_asset_id;
  const feeBase = params.feeBase ?? globalState.fee_base_percent;
  // Always use the market's on-chain fee address (must be in accounts array for matching)
  const marketFeeAddress = globalState.fee_address;

  const signerAccount: TransactionSignerAccount = { signer, addr: activeAddress };
  const marketClient = new MarketAppClient(
    { resolveBy: 'id', id: marketAppId, sender: signerAccount },
    algodClient,
  );
  const matcherClient = new MatcherAppClient(
    { resolveBy: 'id', id: matcherAppId, sender: signerAccount },
    algodClient,
  );

  let fee = 0;
  if (isBuying) {
    fee = calculateFee(quantity, price + slippage, feeBase);
  }

  const marketAddress = getApplicationAddress(marketAppId);
  const atc = new AtomicTransactionComposer();
  let createEscrowTxnIndex = 0;

  // Step 1: Optional asset opt-in
  if (!isBuying) {
    const hasUsdcOptIn = await checkAssetOptIn(algodClient, activeAddress, usdcAssetId);
    if (!hasUsdcOptIn) {
      const optInTxn = await algokit.transferAsset(
        { from: signerAccount, to: activeAddress, assetId: usdcAssetId, amount: 0, skipSending: true },
        algodClient,
      );
      atc.addTransaction({ txn: optInTxn.transaction, signer });
      createEscrowTxnIndex++;
    }
  } else {
    const assetId = position === 1 ? yesAssetId : noAssetId;
    const hasAssetOptIn = await checkAssetOptIn(algodClient, activeAddress, assetId);
    if (!hasAssetOptIn) {
      const optInTxn = await algokit.transferAsset(
        { from: signerAccount, to: activeAddress, assetId, amount: 0, skipSending: true },
        algodClient,
      );
      atc.addTransaction({ txn: optInTxn.transaction, signer });
      createEscrowTxnIndex++;
    }
  }

  // Step 2: ALGO payment for escrow MBR
  const paymentTxn = await algokit.transferAlgos(
    { from: signerAccount, to: marketAddress, amount: algokit.microAlgos(957_000), skipSending: true },
    algodClient,
  );
  atc.addTransaction({ txn: paymentTxn.transaction, signer });
  createEscrowTxnIndex++;

  // Step 3: Fund transfer (USDC if buying, outcome token if selling)
  const fundAmount = isBuying
    ? Math.floor((quantity * (price + slippage)) / 1_000_000) + fee
    : quantity;
  const fundAssetId = isBuying ? usdcAssetId : position === 1 ? yesAssetId : noAssetId;

  const assetTransferTxn = await algokit.transferAsset(
    { from: signerAccount, to: marketAddress, amount: fundAmount, assetId: fundAssetId, skipSending: true },
    algodClient,
  );
  atc.addTransaction({ txn: assetTransferTxn.transaction, signer });
  createEscrowTxnIndex++;

  // Step 4: Create escrow app call
  const createEscrowTxn = await marketClient.createEscrow(
    { price, quantity, slippage, position },
    { assets: [usdcAssetId, yesAssetId, noAssetId], sendParams: { skipSending: true } },
  );
  atc.addTransaction({ txn: createEscrowTxn.transaction, signer });

  // Step 5: Propose matches (for market orders)
  let matchIndex = 1;
  for (const matchingOrder of matchingOrders) {
    // ALGO payment to counterparty escrow
    const payCounterPartyTxn = await algokit.transferAlgos(
      {
        from: signerAccount,
        to: getApplicationAddress(matchingOrder.escrowAppId),
        amount: algokit.microAlgos(1000 * (isBuying ? 1 : 2)),
        skipSending: true,
      },
      algodClient,
    );
    atc.addTransaction({ txn: payCounterPartyTxn.transaction, signer });

    // Propose match — use the market's on-chain fee address so it's available to inner txns
    const proposeAMatchTxn = await matcherClient.proposeAMatch(
      {
        marketApp: marketAppId,
        maker: matchingOrder.escrowAppId,
        quantityMatched: Math.min(matchingOrder.quantity, quantity),
        takerAddress: activeAddress,
        makerAddress: matchingOrder.owner,
        feeAddress: marketFeeAddress,
        takerAppCreatedIndexOffset: matchIndex * 2,
      },
      {
        assets: [usdcAssetId, yesAssetId, noAssetId],
        accounts: [activeAddress, marketFeeAddress, matchingOrder.owner],
        sendParams: { skipSending: true, fee: algokit.microAlgos(10_000) },
      },
    );
    atc.addTransaction({ txn: proposeAMatchTxn.transaction, signer });
    matchIndex++;
  }

  // Execute the atomic group
  const result = await atc.execute(algodClient, 4);

  // Extract escrow app ID with retry logic
  const targetTxId = result.txIDs[createEscrowTxnIndex];
  const escrowAppId = await extractEscrowAppId(algodClient, indexerClient, targetTxId);

  return {
    escrowAppId,
    txIds: result.txIDs,
    confirmedRound: result.confirmedRound,
  };
};

/**
 * Cancels an open order by deleting its escrow app.
 *
 * Calls market_app.delete_escrow(escrowAppId, algoReceiver) which deletes
 * the escrow app and returns funds to the owner.
 *
 * @param config - Alpha client config
 * @param params - Cancel order parameters
 * @returns Whether the cancellation succeeded
 */
export const cancelOrder = async (
  config: AlphaClientConfig,
  params: CancelOrderParams,
): Promise<CancelOrderResult> => {
  const { algodClient, signer, usdcAssetId } = config;
  const { marketAppId, escrowAppId, orderOwner } = params;

  const globalState = await getMarketGlobalState(algodClient, marketAppId);
  const yesAssetId = globalState.yes_asset_id;
  const noAssetId = globalState.no_asset_id;

  const signerAccount: TransactionSignerAccount = { signer, addr: orderOwner };
  const marketClient = new MarketAppClient(
    { resolveBy: 'id', id: marketAppId, sender: signerAccount },
    algodClient,
  );

  const atc = new AtomicTransactionComposer();

  const deleteCallTxn = await marketClient.deleteEscrow(
    { escrowAppId, algoReceiver: orderOwner },
    {
      apps: [escrowAppId],
      assets: [usdcAssetId, yesAssetId, noAssetId],
      accounts: [orderOwner],
      sendParams: { skipSending: true, fee: algokit.microAlgos(7_000) },
    },
  );
  atc.addTransaction({ txn: deleteCallTxn.transaction, signer });

  const result = await atc.execute(algodClient, 4);

  return {
    success: true,
    txIds: result.txIDs,
  };
};

/**
 * Proposes a match between an existing maker order and the taker (you).
 *
 * This creates a new taker escrow and matches it against the maker's existing order.
 * The matcher app orchestrates the inner transactions to settle the trade.
 *
 * @param config - Alpha client config
 * @param params - Match proposal parameters
 * @returns Whether the match succeeded
 */
export const proposeMatch = async (
  config: AlphaClientConfig,
  params: ProposeMatchParams,
): Promise<ProposeMatchResult> => {
  const { algodClient, signer, activeAddress, matcherAppId, usdcAssetId } = config;
  const { marketAppId, makerEscrowAppId, makerAddress, quantityMatched } = params;

  const globalState = await getMarketGlobalState(algodClient, marketAppId);
  const yesAssetId = globalState.yes_asset_id;
  const noAssetId = globalState.no_asset_id;
  // Always use the market's on-chain fee address
  const marketFeeAddress = globalState.fee_address;

  const signerAccount: TransactionSignerAccount = { signer, addr: activeAddress };
  const matcherClient = new MatcherAppClient(
    { resolveBy: 'id', id: matcherAppId, sender: signerAccount },
    algodClient,
  );

  const atc = new AtomicTransactionComposer();

  // ALGO payment to maker escrow
  const payMakerTxn = await algokit.transferAlgos(
    {
      from: signerAccount,
      to: getApplicationAddress(makerEscrowAppId),
      amount: algokit.microAlgos(2_000),
      skipSending: true,
    },
    algodClient,
  );
  atc.addTransaction({ txn: payMakerTxn.transaction, signer });

  // Propose match call — use the market's on-chain fee address
  const proposeTxn = await matcherClient.proposeAMatch(
    {
      marketApp: marketAppId,
      maker: makerEscrowAppId,
      quantityMatched,
      takerAddress: activeAddress,
      makerAddress,
      feeAddress: marketFeeAddress,
      takerAppCreatedIndexOffset: 0,
    },
    {
      assets: [usdcAssetId, yesAssetId, noAssetId],
      accounts: [activeAddress, marketFeeAddress, makerAddress],
      sendParams: { skipSending: true, fee: algokit.microAlgos(10_000) },
    },
  );
  atc.addTransaction({ txn: proposeTxn.transaction, signer });

  const result = await atc.execute(algodClient, 4);

  return {
    success: true,
    txIds: result.txIDs,
  };
};
