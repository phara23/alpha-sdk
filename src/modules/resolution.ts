import * as algosdk from 'algosdk';
import { AtomicTransactionComposer, getApplicationAddress } from 'algosdk';
import type {
  AlphaClientConfig,
  ResolutionState,
  ResolutionActionResult,
  ProposeResolutionParams,
  DisputeResolutionParams,
  FinalizeResolutionParams,
  ClaimResolutionBondParams,
  ResolutionMarketSummary,
  WalletResolutionBond,
} from '../types.js';
import { DEFAULT_API_BASE_URL, DEFAULT_ALPHA_ASSET_ID, RESOLUTION_OUTCOME } from '../constants.js';
import { checkAssetOptIn } from '../utils/state.js';

/**
 * Community resolution (Oracle-Lite) — propose / dispute / finalize / claim.
 *
 * Each lite-resolved market has its own oracle app (one app per market,
 * `oracleAppId` on the market row). Lifecycle:
 *
 *   propose(outcome)            bonded (USDC base_bond), permissionless
 *   -> dispute(outcome)         2x bond, before the deadline, straight to arbiter
 *   -> finalize_undisputed()    deadline passed, permissionless; pays the
 *                               proposer's ALPHA reward when the oracle is
 *                               armed (rewardsAppId != 0)
 *   claim_bond() / claim_for()  pull-pattern bond payouts
 *
 * All actions are pure algod; the two list/bond reads use the Alpha REST API.
 */

const MIN_FEE = 1_000;

const PROPOSE_METHOD = new algosdk.ABIMethod({
  name: 'propose',
  args: [{ type: 'uint8', name: 'outcome' }],
  returns: { type: 'uint8' },
});
const DISPUTE_METHOD = new algosdk.ABIMethod({
  name: 'dispute',
  args: [{ type: 'uint8', name: 'new_outcome' }],
  returns: { type: 'uint8' },
});
const FINALIZE_METHOD = new algosdk.ABIMethod({
  name: 'finalize_undisputed',
  args: [],
  returns: { type: 'uint8' },
});
const CLAIM_BOND_METHOD = new algosdk.ABIMethod({
  name: 'claim_bond',
  args: [],
  returns: { type: 'uint64' },
});
const CLAIM_FOR_METHOD = new algosdk.ABIMethod({
  name: 'claim_for',
  args: [{ type: 'account', name: 'bonder' }],
  returns: { type: 'uint64' },
});

const flatFee = (sp: algosdk.SuggestedParams, multiple: number): algosdk.SuggestedParams =>
  ({ ...sp, fee: BigInt(MIN_FEE * multiple), flatFee: true }) as algosdk.SuggestedParams;

const keyToString = (key: Uint8Array | string): string =>
  typeof key === 'string'
    ? Buffer.from(key, 'base64').toString('utf8')
    : new TextDecoder().decode(key);

const decodeAddr = (bytes: unknown): string => {
  if (bytes instanceof Uint8Array && bytes.length === 32) return algosdk.encodeAddress(bytes);
  if (typeof bytes === 'string') {
    const b = new Uint8Array(Buffer.from(bytes, 'base64'));
    if (b.length === 32) return algosdk.encodeAddress(b);
  }
  return '';
};

const readGlobals = async (
  algodClient: algosdk.Algodv2,
  appId: number,
): Promise<Record<string, any>> => {
  const info: any = await algodClient.getApplicationByID(appId).do();
  const out: Record<string, any> = {};
  for (const kv of info?.params?.globalState ?? info?.params?.['global-state'] ?? []) {
    out[keyToString(kv.key)] = kv.value ?? {};
  }
  return out;
};

const uintOf = (g: Record<string, any>, key: string): number =>
  g[key]?.uint !== undefined ? Number(g[key].uint) : 0;

// rewards-vault app id -> reward ALPHA asset id (vault config is immutable)
const rewardAssetCache = new Map<number, number>();
const getVaultRewardAsset = async (
  algodClient: algosdk.Algodv2,
  vaultAppId: number,
): Promise<number> => {
  const cached = rewardAssetCache.get(vaultAppId);
  if (cached !== undefined) return cached;
  const g = await readGlobals(algodClient, vaultAppId);
  const assetId = uintOf(g, 'reward_asset');
  if (!assetId) {
    throw new Error(`app ${vaultAppId} has no reward_asset global — not a rewards vault`);
  }
  rewardAssetCache.set(vaultAppId, assetId);
  return assetId;
};

/**
 * Full on-chain state of a market's Oracle-Lite app.
 *
 * Pure algod. `rewardsAppId != 0` means the oracle is armed: its
 * finalize_undisputed pays the proposer's ALPHA reward in the same transaction
 * (the SDK's finalizeResolution handles the extra fee/references automatically).
 */
export const getResolutionState = async (
  config: AlphaClientConfig,
  oracleAppId: number,
): Promise<ResolutionState> => {
  const g = await readGlobals(config.algodClient, oracleAppId);
  return {
    appId: oracleAppId,
    appAddress: getApplicationAddress(oracleAppId).toString(),
    isSetup: uintOf(g, 'is_setup') === 1,
    isLinked: uintOf(g, 'is_linked') === 1,
    marketAppId: uintOf(g, 'market_app_id'),
    arbiter: decodeAddr(g['arbiter']?.bytes),
    collateral: uintOf(g, 'collateral'),
    disputeWindow: uintOf(g, 'dispute_window'),
    baseBondMicro: uintOf(g, 'base_bond'),
    earliestProposeTs: uintOf(g, 'earliest_propose_ts'),
    status: uintOf(g, 'status') as ResolutionState['status'],
    proposedOutcome: uintOf(g, 'proposed_outcome'),
    disputedOutcome: uintOf(g, 'disputed_outcome'),
    deadline: uintOf(g, 'deadline'),
    disputeTs: uintOf(g, 'dispute_ts'),
    winner: uintOf(g, 'winner'),
    resolvedTs: uintOf(g, 'resolved_ts'),
    proposer: {
      addr: decodeAddr(g['p_addr']?.bytes),
      amountMicro: uintOf(g, 'p_amount'),
      claimableMicro: uintOf(g, 'p_claimable'),
    },
    disputer: {
      addr: decodeAddr(g['d_addr']?.bytes),
      amountMicro: uintOf(g, 'd_amount'),
      claimableMicro: uintOf(g, 'd_claimable'),
    },
    rewardsAppId: uintOf(g, 'ext_u1'),
  };
};

/**
 * Propose the outcome of a lite-resolved market under a USDC bond.
 *
 * Group: [USDC base_bond -> oracle app] + [propose(outcome)]. The bond comes
 * back in full if the proposal stands; a lost dispute forfeits it. When the
 * dispute window lapses with no challenge, finalization pays the ALPHA
 * proposer reward (armed oracles) to this wallet.
 *
 * outcome: 0 = No, 1 = Yes, 2 = fifty/fifty.
 */
export const proposeResolution = async (
  config: AlphaClientConfig,
  params: ProposeResolutionParams,
): Promise<ResolutionActionResult> => {
  const { algodClient, signer, activeAddress } = config;
  const { oracleAppId, outcome } = params;
  if (![RESOLUTION_OUTCOME.NO, RESOLUTION_OUTCOME.YES, RESOLUTION_OUTCOME.FIFTY_FIFTY].includes(outcome)) {
    throw new Error('outcome must be 0 (No), 1 (Yes) or 2 (fifty/fifty)');
  }
  const state = await getResolutionState(config, oracleAppId);
  if (!state.isLinked) throw new Error(`oracle app ${oracleAppId} is not linked to a market`);
  if (state.status !== 0) throw new Error(`oracle app ${oracleAppId} already has a live proposal (status ${state.status})`);
  const now = Math.floor(Date.now() / 1000);
  if (state.earliestProposeTs > now) {
    throw new Error(`proposals open at unix ${state.earliestProposeTs} (in ${state.earliestProposeTs - now}s)`);
  }

  const sp = await algodClient.getTransactionParams().do();
  const atc = new AtomicTransactionComposer();

  // Armed oracle: the finalize-time ALPHA reward is skipped (forever) for a
  // proposer without an ALPHA opt-in — add the opt-in up front when missing.
  if (state.rewardsAppId > 0) {
    const alphaAssetId = config.alphaAssetId ?? DEFAULT_ALPHA_ASSET_ID;
    if (!(await checkAssetOptIn(algodClient, activeAddress, alphaAssetId))) {
      const alphaOptIn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        sender: activeAddress,
        receiver: activeAddress,
        amount: 0,
        assetIndex: alphaAssetId,
        suggestedParams: sp,
      });
      atc.addTransaction({ txn: alphaOptIn, signer });
    }
  }

  // the bond axfer must sit IMMEDIATELY before the propose call (the contract
  // reads Gtxn[group_index - 1])
  const bond = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: activeAddress,
    receiver: state.appAddress,
    amount: state.baseBondMicro,
    assetIndex: state.collateral,
    suggestedParams: sp,
  });
  atc.addTransaction({ txn: bond, signer });
  atc.addMethodCall({
    appID: oracleAppId,
    method: PROPOSE_METHOD,
    methodArgs: [outcome],
    sender: activeAddress,
    signer,
    suggestedParams: flatFee(sp, 1),
    // propose reads is_resolved from the linked market app
    appForeignApps: [state.marketAppId],
  });
  const result = await atc.execute(algodClient, 4);
  return { success: true, txIds: result.txIDs, confirmedRound: Number(result.confirmedRound) };
};

/**
 * Challenge a live proposal under a 2x USDC bond — the market goes straight
 * to the arbiter. outcome may be a concrete outcome (0/1/2) that differs from
 * the proposal, or 3 (KEEP_OPEN = "not resolvable yet").
 */
export const disputeResolution = async (
  config: AlphaClientConfig,
  params: DisputeResolutionParams,
): Promise<ResolutionActionResult> => {
  const { algodClient, signer, activeAddress } = config;
  const { oracleAppId, outcome } = params;
  const state = await getResolutionState(config, oracleAppId);
  if (state.status !== 1) throw new Error(`oracle app ${oracleAppId} has no live proposal to dispute (status ${state.status})`);
  if (outcome === state.proposedOutcome) throw new Error('dispute outcome must differ from the proposed outcome');
  const now = Math.floor(Date.now() / 1000);
  if (now >= state.deadline) throw new Error('the dispute window has closed — the proposal can only be finalized now');

  const sp = await algodClient.getTransactionParams().do();
  const atc = new AtomicTransactionComposer();
  const bond = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: activeAddress,
    receiver: state.appAddress,
    amount: state.baseBondMicro * 2,
    assetIndex: state.collateral,
    suggestedParams: sp,
  });
  atc.addTransaction({ txn: bond, signer });
  atc.addMethodCall({
    appID: oracleAppId,
    method: DISPUTE_METHOD,
    methodArgs: [outcome],
    sender: activeAddress,
    signer,
    suggestedParams: flatFee(sp, 1),
  });
  const result = await atc.execute(algodClient, 4);
  return { success: true, txIds: result.txIDs, confirmedRound: Number(result.confirmedRound) };
};

/**
 * Settle an unchallenged proposal once its dispute window has lapsed.
 * Permissionless — any funded wallet may call it; the payout targets are
 * fixed by the oracle's own state.
 *
 * When the oracle is ARMED for proposer rewards (rewardsAppId != 0), the same
 * transaction pays the proposer's ALPHA reward from the central vault; the SDK
 * supplies the 4x fee and vault/asset/proposer references automatically.
 */
export const finalizeResolution = async (
  config: AlphaClientConfig,
  params: FinalizeResolutionParams,
): Promise<ResolutionActionResult> => {
  const { algodClient, signer, activeAddress } = config;
  const { oracleAppId } = params;
  const state = await getResolutionState(config, oracleAppId);
  if (state.status !== 1) throw new Error(`oracle app ${oracleAppId} has no live proposal to finalize (status ${state.status})`);
  const now = Math.floor(Date.now() / 1000);
  if (now < state.deadline) {
    throw new Error(`the dispute window is still open for ${state.deadline - now}s`);
  }

  const armed = state.rewardsAppId > 0;
  const sp = await algodClient.getTransactionParams().do();
  const atc = new AtomicTransactionComposer();
  atc.addMethodCall({
    appID: oracleAppId,
    method: FINALIZE_METHOD,
    methodArgs: [],
    sender: activeAddress,
    signer,
    suggestedParams: flatFee(sp, armed ? 4 : 2),
    appForeignApps: armed ? [state.marketAppId, state.rewardsAppId] : [state.marketAppId],
    ...(armed
      ? {
          appForeignAssets: [await getVaultRewardAsset(algodClient, state.rewardsAppId)],
          appAccounts: [state.proposer.addr],
        }
      : {}),
  });
  const result = await atc.execute(algodClient, 4);
  return { success: true, txIds: result.txIDs, confirmedRound: Number(result.confirmedRound) };
};

/**
 * Pull a settled USDC bond payout — the caller's own (`claim_bond`), or on
 * behalf of another bonder (`claim_for`; the payout always goes to the bonder).
 * Adds a USDC opt-in for the receiver's own claim when missing. Returns the
 * claimed micro-USDC amount.
 */
export const claimResolutionBond = async (
  config: AlphaClientConfig,
  params: ClaimResolutionBondParams,
): Promise<ResolutionActionResult> => {
  const { algodClient, signer, activeAddress } = config;
  const { oracleAppId, bonder } = params;
  const state = await getResolutionState(config, oracleAppId);
  const forOther = !!bonder && bonder !== activeAddress;

  const sp = await algodClient.getTransactionParams().do();
  const atc = new AtomicTransactionComposer();
  if (!forOther && !(await checkAssetOptIn(algodClient, activeAddress, state.collateral))) {
    const optIn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: activeAddress,
      receiver: activeAddress,
      amount: 0,
      assetIndex: state.collateral,
      suggestedParams: sp,
    });
    atc.addTransaction({ txn: optIn, signer });
  }
  atc.addMethodCall({
    appID: oracleAppId,
    method: forOther ? CLAIM_FOR_METHOD : CLAIM_BOND_METHOD,
    methodArgs: forOther ? [bonder] : [],
    sender: activeAddress,
    signer,
    suggestedParams: flatFee(sp, 2), // inner USDC refund
    appForeignAssets: [state.collateral],
  });
  const result = await atc.execute(algodClient, 4);
  const claimed = result.methodResults?.at(-1)?.returnValue;
  return {
    success: true,
    txIds: result.txIDs,
    confirmedRound: Number(result.confirmedRound),
    claimedMicro: claimed !== undefined ? Number(claimed) : undefined,
  };
};

/**
 * Lite-resolved markets and their live resolution state (Alpha REST API).
 */
export const getResolutionMarkets = async (
  config: AlphaClientConfig,
): Promise<ResolutionMarketSummary[]> => {
  const baseUrl = config.apiBaseUrl ?? DEFAULT_API_BASE_URL;
  const response = await fetch(`${baseUrl}/resolution/markets`, {
    headers: config.apiKey ? { 'x-api-key': config.apiKey } : undefined,
  });
  if (!response.ok) throw new Error(`resolution/markets failed: HTTP ${response.status}`);
  const body: any = await response.json();
  return (body?.markets ?? body ?? []) as ResolutionMarketSummary[];
};

/**
 * A wallet's live and claimable Oracle-Lite bonds (Alpha REST API).
 */
export const getWalletResolutionBonds = async (
  config: AlphaClientConfig,
  wallet?: string,
): Promise<WalletResolutionBond[]> => {
  const baseUrl = config.apiBaseUrl ?? DEFAULT_API_BASE_URL;
  const address = wallet ?? config.activeAddress;
  const response = await fetch(`${baseUrl}/resolution/bonds?wallet=${encodeURIComponent(address)}`, {
    headers: config.apiKey ? { 'x-api-key': config.apiKey } : undefined,
  });
  if (!response.ok) throw new Error(`resolution/bonds failed: HTTP ${response.status}`);
  const body: any = await response.json();
  return (body?.bonds ?? body ?? []) as WalletResolutionBond[];
};
