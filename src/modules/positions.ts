import algosdk, { AtomicTransactionComposer, getApplicationAddress } from 'algosdk';
import * as algokit from '@algorandfoundation/algokit-utils';
import type { TransactionSignerAccount } from '@algorandfoundation/algokit-utils/types/account';
import { MarketAppClient } from '../contracts/market_app.js';
import type {
  AlphaClientConfig,
  SplitSharesParams,
  MergeSharesParams,
  ClaimParams,
  SplitMergeResult,
  ClaimResult,
  WalletPosition,
} from '../types.js';
import { getMarketGlobalState, checkAssetOptIn } from '../utils/state.js';

/**
 * Splits USDC into equal amounts of YES and NO outcome tokens.
 *
 * Builds and executes an atomic transaction group:
 * 1. (Optional) Asset opt-in for YES token
 * 2. (Optional) Asset opt-in for NO token
 * 3. ALGO payment to market app (covers inner txn fees)
 * 4. USDC transfer to market app
 * 5. App call: market_app.split_shares()
 *
 * @param config - Alpha client config
 * @param params - Split parameters (marketAppId, amount in microunits)
 * @returns Transaction result
 */
export const splitShares = async (
  config: AlphaClientConfig,
  params: SplitSharesParams,
): Promise<SplitMergeResult> => {
  const { algodClient, signer, activeAddress, usdcAssetId } = config;
  const { marketAppId, amount } = params;

  const globalState = await getMarketGlobalState(algodClient, marketAppId);
  const yesAssetId = globalState.yes_asset_id;
  const noAssetId = globalState.no_asset_id;

  const signerAccount: TransactionSignerAccount = { signer, addr: activeAddress };
  const marketClient = new MarketAppClient(
    { resolveBy: 'id', id: marketAppId, sender: signerAccount },
    algodClient,
  );
  const marketAddress = getApplicationAddress(marketAppId);

  const atc = new AtomicTransactionComposer();
  let optInCosts = 0;

  // Optional YES token opt-in
  const hasYesOptIn = await checkAssetOptIn(algodClient, activeAddress, yesAssetId);
  if (!hasYesOptIn) {
    const optInTxn = await algokit.transferAsset(
      { from: signerAccount, to: activeAddress, assetId: yesAssetId, amount: 0, skipSending: true },
      algodClient,
    );
    atc.addTransaction({ txn: optInTxn.transaction, signer });
    optInCosts += 1000;
  }

  // Optional NO token opt-in
  const hasNoOptIn = await checkAssetOptIn(algodClient, activeAddress, noAssetId);
  if (!hasNoOptIn) {
    const optInTxn = await algokit.transferAsset(
      { from: signerAccount, to: activeAddress, assetId: noAssetId, amount: 0, skipSending: true },
      algodClient,
    );
    atc.addTransaction({ txn: optInTxn.transaction, signer });
    optInCosts += 1000;
  }

  // ALGO payment for inner txn fees
  const algoPayment = await algokit.transferAlgos(
    { from: signerAccount, to: marketAddress, amount: algokit.microAlgos(5000 + optInCosts), skipSending: true },
    algodClient,
  );
  atc.addTransaction({ txn: algoPayment.transaction, signer });

  // USDC transfer
  const usdcTransfer = await algokit.transferAsset(
    { from: signerAccount, to: marketAddress, amount, assetId: usdcAssetId, skipSending: true },
    algodClient,
  );
  atc.addTransaction({ txn: usdcTransfer.transaction, signer });

  // split_shares() app call
  const splitTxn = await marketClient.splitShares(
    {},
    { assets: [usdcAssetId, yesAssetId, noAssetId], sendParams: { skipSending: true } },
  );
  atc.addTransaction({ txn: splitTxn.transaction, signer });

  const result = await atc.execute(algodClient, 4);

  return {
    success: true,
    txIds: result.txIDs,
    confirmedRound: result.confirmedRound,
  };
};

/**
 * Merges equal amounts of YES and NO outcome tokens back into USDC.
 *
 * Builds and executes an atomic transaction group:
 * 1. (Optional) Asset opt-in for USDC
 * 2. ALGO payment to market app (covers inner txn fees)
 * 3. YES token transfer to market app
 * 4. NO token transfer to market app
 * 5. App call: market_app.merge_shares()
 *
 * @param config - Alpha client config
 * @param params - Merge parameters (marketAppId, amount in microunits)
 * @returns Transaction result
 */
export const mergeShares = async (
  config: AlphaClientConfig,
  params: MergeSharesParams,
): Promise<SplitMergeResult> => {
  const { algodClient, signer, activeAddress, usdcAssetId } = config;
  const { marketAppId, amount } = params;

  const globalState = await getMarketGlobalState(algodClient, marketAppId);
  const yesAssetId = globalState.yes_asset_id;
  const noAssetId = globalState.no_asset_id;

  const signerAccount: TransactionSignerAccount = { signer, addr: activeAddress };
  const marketClient = new MarketAppClient(
    { resolveBy: 'id', id: marketAppId, sender: signerAccount },
    algodClient,
  );
  const marketAddress = getApplicationAddress(marketAppId);

  const atc = new AtomicTransactionComposer();
  let optInCosts = 0;

  // Optional USDC opt-in
  const hasUsdcOptIn = await checkAssetOptIn(algodClient, activeAddress, usdcAssetId);
  if (!hasUsdcOptIn) {
    const optInTxn = await algokit.transferAsset(
      { from: signerAccount, to: activeAddress, assetId: usdcAssetId, amount: 0, skipSending: true },
      algodClient,
    );
    atc.addTransaction({ txn: optInTxn.transaction, signer });
    optInCosts += 1000;
  }

  // ALGO payment
  const algoPayment = await algokit.transferAlgos(
    { from: signerAccount, to: marketAddress, amount: algokit.microAlgos(5000 + optInCosts), skipSending: true },
    algodClient,
  );
  atc.addTransaction({ txn: algoPayment.transaction, signer });

  // YES token transfer
  const yesTransfer = await algokit.transferAsset(
    { from: signerAccount, to: marketAddress, amount, assetId: yesAssetId, skipSending: true },
    algodClient,
  );
  atc.addTransaction({ txn: yesTransfer.transaction, signer });

  // NO token transfer
  const noTransfer = await algokit.transferAsset(
    { from: signerAccount, to: marketAddress, amount, assetId: noAssetId, skipSending: true },
    algodClient,
  );
  atc.addTransaction({ txn: noTransfer.transaction, signer });

  // merge_shares() app call
  const mergeTxn = await marketClient.mergeShares(
    {},
    { assets: [usdcAssetId], sendParams: { skipSending: true } },
  );
  atc.addTransaction({ txn: mergeTxn.transaction, signer });

  const result = await atc.execute(algodClient, 4);

  return {
    success: true,
    txIds: result.txIDs,
    confirmedRound: result.confirmedRound,
  };
};

/**
 * Claims USDC from a resolved market by redeeming outcome tokens.
 *
 * If the market resolved in your favor, you get USDC 1:1.
 * If voided, you get USDC at half value.
 * Losing tokens are "burned" (returned to contract, no USDC back).
 *
 * Builds and executes an atomic transaction group:
 * 1. Token transfer to market app
 * 2. App call: market_app.claim()
 * 3. Asset opt-out (close remainder to market app)
 *
 * @param config - Alpha client config
 * @param params - Claim parameters
 * @returns Transaction result
 */
export const claim = async (
  config: AlphaClientConfig,
  params: ClaimParams,
): Promise<ClaimResult> => {
  const { algodClient, signer, activeAddress, usdcAssetId } = config;
  const { marketAppId, assetId } = params;

  const signerAccount: TransactionSignerAccount = { signer, addr: activeAddress };
  const marketClient = new MarketAppClient(
    { resolveBy: 'id', id: marketAppId, sender: signerAccount },
    algodClient,
  );
  const marketAddress = getApplicationAddress(marketAppId);

  // Get token balance
  let tokenBalance = params.amount;
  if (!tokenBalance) {
    const accountInfo = await algodClient.accountInformation(activeAddress).do();
    const assets = accountInfo.assets || accountInfo['assets'] || [];
    const asset = assets.find((a: any) => (a['asset-id'] ?? a.assetId) === assetId);
    tokenBalance = asset ? Number(asset.amount) : 0;
  }
  if (tokenBalance <= 0) {
    throw new Error('No tokens to claim');
  }

  const atc = new AtomicTransactionComposer();

  // Token transfer to market app
  const tokenTransfer = await algokit.transferAsset(
    { from: signerAccount, to: marketAddress, amount: tokenBalance, assetId, skipSending: true },
    algodClient,
  );
  atc.addTransaction({ txn: tokenTransfer.transaction, signer });

  // claim() app call
  const claimTxn = await marketClient.claim(
    {},
    {
      assets: [usdcAssetId, assetId],
      sendParams: { skipSending: true, fee: algokit.microAlgos(1000) },
    },
  );
  atc.addTransaction({ txn: claimTxn.transaction, signer });

  // Opt-out: close remainder to market app
  const sp = await algodClient.getTransactionParams().do();
  const closeOutTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    from: activeAddress,
    to: marketAddress,
    amount: 0,
    assetIndex: assetId,
    closeRemainderTo: marketAddress,
    suggestedParams: sp,
  });
  atc.addTransaction({ txn: closeOutTxn, signer });

  const result = await atc.execute(algodClient, 4);

  return {
    success: true,
    txIds: result.txIDs,
    confirmedRound: result.confirmedRound,
  };
};

/**
 * Gets the wallet's token positions across all markets.
 *
 * Reads on-chain account info to find all ASA holdings, then maps
 * them to markets using indexer lookups.
 *
 * Note: This returns raw token balances. For cost basis and PnL,
 * use the Alpha API's position endpoints.
 *
 * @param config - Alpha client config
 * @param walletAddress - Optional wallet address (defaults to config.activeAddress)
 * @returns Array of wallet positions (market app ID + yes/no token balances)
 */
export const getPositions = async (
  config: AlphaClientConfig,
  walletAddress?: string,
): Promise<WalletPosition[]> => {
  const { algodClient, indexerClient } = config;
  const address = walletAddress ?? config.activeAddress;

  // Get all ASA holdings
  const accountInfo = await algodClient.accountInformation(address).do();
  const assets = accountInfo.assets || accountInfo['assets'] || [];

  // Filter to non-zero holdings
  const nonZeroAssets = assets.filter((a: any) => Number(a.amount) > 0);
  if (nonZeroAssets.length === 0) return [];

  // Alpha Market tokens are named "Alpha Market {appId} Yes" or "Alpha Market {appId} No".
  // We parse the market app ID directly from the asset name, which is far more
  // reliable than trying to reverse-lookup the app from the creator address
  // (the creator address is the market app address, and lookupAccountCreatedApplications
  // on it returns escrow apps, not the market app itself).
  const positions = new Map<number, WalletPosition>();

  for (const asset of nonZeroAssets) {
    const assetId = asset['asset-id'] ?? asset.assetId;
    const amount = Number(asset.amount);

    try {
      const assetInfo = await indexerClient.lookupAssetByID(assetId).do();
      const assetName: string = assetInfo.asset?.params?.name ?? '';
      const unitName: string = assetInfo.asset?.params?.['unit-name'] ?? '';

      // Only process Alpha Market outcome tokens
      if (!unitName.startsWith('ALPHA-')) continue;

      // Parse market app ID from asset name: "Alpha Market {appId} Yes" or "Alpha Market {appId} No"
      const match = assetName.match(/^Alpha Market (\d+) (Yes|No)$/);
      if (!match) continue;

      const marketAppId = Number(match[1]);
      const side = match[2] as 'Yes' | 'No';

      // Look up the market app's global state to get both asset IDs
      const existing = positions.get(marketAppId);
      if (existing) {
        // We already have this market from the other token; just add the balance
        if (side === 'Yes') {
          existing.yesBalance = amount;
        } else {
          existing.noBalance = amount;
        }
      } else {
        // First time seeing this market -- fetch global state for both asset IDs
        try {
          const appInfo = await indexerClient.lookupApplications(marketAppId).do();
          const rawState = appInfo.application?.params?.['global-state'];
          if (!rawState) continue;

          let yesAssetIdOnChain = 0;
          let noAssetIdOnChain = 0;

          for (const item of rawState) {
            const key = Buffer.from(item.key, 'base64').toString();
            if (key === 'yes_asset_id') yesAssetIdOnChain = Number(item.value.uint);
            if (key === 'no_asset_id') noAssetIdOnChain = Number(item.value.uint);
          }

          if (yesAssetIdOnChain === 0 && noAssetIdOnChain === 0) continue;

          positions.set(marketAppId, {
            marketAppId,
            yesAssetId: yesAssetIdOnChain,
            noAssetId: noAssetIdOnChain,
            yesBalance: side === 'Yes' ? amount : 0,
            noBalance: side === 'No' ? amount : 0,
          });
        } catch {
          continue;
        }
      }
    } catch {
      continue;
    }
  }

  return Array.from(positions.values());
};
