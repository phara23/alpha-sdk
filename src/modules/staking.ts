import * as algosdk from 'algosdk';
import { AtomicTransactionComposer, getApplicationAddress } from 'algosdk';
import type {
  AlphaClientConfig,
  StakeAlphaParams,
  UnstakeAlphaParams,
  StakingActionResult,
  StakingPosition,
} from '../types.js';
import {
  DEFAULT_ALPHA_ASSET_ID,
  DEFAULT_STAKING_APP_ID,
  STAKING_REWARD_PRECISION,
} from '../constants.js';
import { checkAppOptIn, checkAssetOptIn } from '../utils/state.js';

/**
 * On-chain ALPHA staking pool.
 *
 * Pure algod — no Alpha platform API:
 */

const STAKE_METHOD = new algosdk.ABIMethod({
  name: 'stake',
  args: [],
  returns: { type: 'uint64' },
});
const UNSTAKE_METHOD = new algosdk.ABIMethod({
  name: 'unstake',
  args: [{ type: 'uint64', name: 'amount' }],
  returns: { type: 'uint64' },
});
const CLAIM_METHOD = new algosdk.ABIMethod({
  name: 'claim',
  args: [],
  returns: { type: 'uint64' },
});
const OPT_IN_METHOD = new algosdk.ABIMethod({
  name: 'opt_in',
  args: [],
  returns: { type: 'uint8' },
});

type StakingIds = {
  stakingAppId: number;
  alphaAssetId: number;
  usdcAssetId: number;
};

const resolveIds = (config: AlphaClientConfig): StakingIds => ({
  stakingAppId: config.stakingAppId ?? DEFAULT_STAKING_APP_ID,
  alphaAssetId: config.alphaAssetId ?? DEFAULT_ALPHA_ASSET_ID,
  usdcAssetId: config.usdcAssetId,
});

type RawValue = { uint: bigint; bytes: Uint8Array };
type StateMap = Record<string, RawValue>;

const keyToString = (key: Uint8Array | string): string =>
  typeof key === 'string'
    ? Buffer.from(key, 'base64').toString('utf8')
    : new TextDecoder().decode(key);

const toBytes = (bytes: unknown): Uint8Array => {
  if (bytes instanceof Uint8Array) return bytes;
  if (typeof bytes === 'string') return new Uint8Array(Buffer.from(bytes, 'base64'));
  return new Uint8Array();
};

const decodeState = (kvs: any[] | undefined): StateMap => {
  const out: StateMap = {};
  for (const entry of kvs ?? []) {
    const key = keyToString(entry.key);
    const value = entry.value ?? {};
    out[key] = {
      uint: value.uint !== undefined ? BigInt(value.uint) : 0n,
      bytes: toBytes(value.bytes),
    };
  }
  return out;
};

/** Big-endian bytes → BigInt (matches on-chain Itob / BytesAdd). */
const bytesToBigInt = (b: Uint8Array): bigint => {
  let r = 0n;
  for (const byte of b) r = (r << 8n) | BigInt(byte);
  return r;
};

const uintOf = (s: StateMap, k: string): bigint => s[k]?.uint ?? 0n;
const bigOf = (s: StateMap, k: string): bigint => bytesToBigInt(s[k]?.bytes ?? new Uint8Array());

const toNumberSafe = (v: bigint): number => {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) {
    throw new Error(`Value ${v.toString()} exceeds Number.MAX_SAFE_INTEGER`);
  }
  return n;
};

/** ASA balance in microunits, or 0 if not opted in / missing. */
const getAssetBalanceMicro = async (
  algodClient: algosdk.Algodv2,
  address: string,
  assetId: number,
): Promise<number> => {
  const info: any = await algodClient.accountInformation(address).do();
  const assets: any[] = info.assets ?? [];
  const holding = assets.find(
    (a: any) => Number(a.assetId ?? a['asset-id']) === assetId,
  );
  return holding ? Number(holding.amount ?? 0) : 0;
};

/** Staked ALPHA (micro) from app local state. null if not opted into the staking app. */
const getStakedMicro = async (
  algodClient: algosdk.Algodv2,
  address: string,
  stakingAppId: number,
): Promise<number | null> => {
  const info: any = await algodClient.accountInformation(address).do();
  const locals: any[] = info.appsLocalState ?? info['apps-local-state'] ?? [];
  const entry = locals.find(
    (a: any) => Number(a.id ?? a.appId ?? a['app-id']) === stakingAppId,
  );
  if (!entry) return null;
  const local = decodeState(entry.keyValue ?? entry['key-value']);
  return toNumberSafe(uintOf(local, 'staked'));
};

/**
 * Stake ALPHA into the fee-sharing pool.
 *
 * Builds an atomic group:
 * 1. (Optional) App opt-in via `opt_in()` if the wallet has no local state
 * 2. ALPHA asset transfer to the staking app address
 * 3. App call `stake()` — must immediately follow the ALPHA axfer
 *
 * Purely on-chain (algod only). Amount is micro-ALPHA (6 decimals).
 */
export const stakeAlpha = async (
  config: AlphaClientConfig,
  params: StakeAlphaParams,
): Promise<StakingActionResult> => {
  const { algodClient, signer, activeAddress } = config;
  const { amount } = params;
  const { stakingAppId, alphaAssetId, usdcAssetId } = resolveIds(config);

  if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount)) {
    throw new Error('amount must be a positive integer in micro-ALPHA');
  }

  const alphaBalance = await getAssetBalanceMicro(algodClient, activeAddress, alphaAssetId);
  if (alphaBalance <= 0) {
    throw new Error(
      `Wallet has no ALPHA (ASA ${alphaAssetId}). Opt in and fund the wallet before staking.`,
    );
  }
  if (alphaBalance < amount) {
    throw new Error(
      `Insufficient ALPHA to stake: requested ${amount} micro, wallet has ${alphaBalance} micro.`,
    );
  }

  const sp = await algodClient.getTransactionParams().do();
  const appAddress = getApplicationAddress(stakingAppId).toString();
  const atc = new AtomicTransactionComposer();

  const optedIn = await checkAppOptIn(algodClient, activeAddress, stakingAppId);
  if (!optedIn) {
    atc.addMethodCall({
      appID: stakingAppId,
      method: OPT_IN_METHOD,
      methodArgs: [],
      sender: activeAddress,
      signer,
      suggestedParams: sp,
      onComplete: algosdk.OnApplicationComplete.OptInOC,
    });
  }

  const axfer = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: activeAddress,
    receiver: appAddress,
    amount,
    assetIndex: alphaAssetId,
    suggestedParams: sp,
  });
  atc.addTransaction({ txn: axfer, signer });

  atc.addMethodCall({
    appID: stakingAppId,
    method: STAKE_METHOD,
    methodArgs: [],
    sender: activeAddress,
    signer,
    suggestedParams: sp,
    appForeignAssets: [usdcAssetId],
  });

  const result = await atc.execute(algodClient, 4);
  return {
    success: true,
    txIds: result.txIDs,
    confirmedRound: Number(result.confirmedRound),
  };
};

/**
 * Unstake ALPHA from the pool. The contract inner-transfers ALPHA back, so the
 * app call uses a flat 2_000 microALGO fee.
 */
export const unstakeAlpha = async (
  config: AlphaClientConfig,
  params: UnstakeAlphaParams,
): Promise<StakingActionResult> => {
  const { algodClient, signer, activeAddress } = config;
  const { amount } = params;
  const { stakingAppId, alphaAssetId, usdcAssetId } = resolveIds(config);

  if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount)) {
    throw new Error('amount must be a positive integer in micro-ALPHA');
  }

  const staked = await getStakedMicro(algodClient, activeAddress, stakingAppId);
  if (staked === null) {
    throw new Error(
      `Wallet is not opted into the staking app (${stakingAppId}). Stake ALPHA before unstaking.`,
    );
  }
  if (staked <= 0) {
    throw new Error('No ALPHA staked to unstake.');
  }
  if (staked < amount) {
    throw new Error(
      `Insufficient staked ALPHA to unstake: requested ${amount} micro, staked ${staked} micro.`,
    );
  }

  const sp = await algodClient.getTransactionParams().do();
  const feeSp: algosdk.SuggestedParams = { ...sp, fee: 2000, flatFee: true };

  const atc = new AtomicTransactionComposer();
  atc.addMethodCall({
    appID: stakingAppId,
    method: UNSTAKE_METHOD,
    methodArgs: [BigInt(amount)],
    sender: activeAddress,
    signer,
    suggestedParams: feeSp,
    appForeignAssets: [usdcAssetId, alphaAssetId],
  });

  const result = await atc.execute(algodClient, 4);
  return {
    success: true,
    txIds: result.txIDs,
    confirmedRound: Number(result.confirmedRound),
  };
};

/**
 * Claim accrued USDC trading-fee rewards. Adds a USDC ASA opt-in when needed.
 * Flat 2_000 microALGO fee covers the inner USDC transfer.
 */
export const claimStakingRewards = async (
  config: AlphaClientConfig,
): Promise<StakingActionResult> => {
  const { algodClient, signer, activeAddress } = config;
  const { stakingAppId, usdcAssetId } = resolveIds(config);

  const sp = await algodClient.getTransactionParams().do();
  const atc = new AtomicTransactionComposer();

  const hasUsdcOptIn = await checkAssetOptIn(algodClient, activeAddress, usdcAssetId);
  if (!hasUsdcOptIn) {
    const optIn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: activeAddress,
      receiver: activeAddress,
      amount: 0,
      assetIndex: usdcAssetId,
      suggestedParams: sp,
    });
    atc.addTransaction({ txn: optIn, signer });
  }

  const feeSp: algosdk.SuggestedParams = { ...sp, fee: 2000, flatFee: true };
  atc.addMethodCall({
    appID: stakingAppId,
    method: CLAIM_METHOD,
    methodArgs: [],
    sender: activeAddress,
    signer,
    suggestedParams: feeSp,
    appForeignAssets: [usdcAssetId],
  });

  const result = await atc.execute(algodClient, 4);
  return {
    success: true,
    txIds: result.txIDs,
    confirmedRound: Number(result.confirmedRound),
  };
};

/**
 * Read a wallet's on-chain staking position (algod only).
 *
 * Claimable mirrors the contract's view: pending + accrued against the current
 * accumulator.
 */
export const getStakingPosition = async (
  config: AlphaClientConfig,
  walletAddress?: string,
): Promise<StakingPosition> => {
  const { algodClient, activeAddress } = config;
  const wallet = walletAddress ?? activeAddress;
  const { stakingAppId, usdcAssetId } = resolveIds(config);
  const appAddress = getApplicationAddress(stakingAppId).toString();

  const [appInfo, accountInfo, poolAccountInfo] = await Promise.all([
    algodClient.getApplicationByID(stakingAppId).do(),
    algodClient.accountInformation(wallet).do(),
    algodClient.accountInformation(appAddress).do(),
  ]);

  const global = decodeState((appInfo as any)?.params?.globalState);
  const totalStaked = uintOf(global, 'total_staked');
  const accRewardPerShare = bigOf(global, 'acc_reward_per_share');

  const locals: any[] =
    (accountInfo as any).appsLocalState ?? (accountInfo as any)['apps-local-state'] ?? [];
  const localEntry = locals.find(
    (a: any) => Number(a.id ?? a.appId ?? a['app-id']) === stakingAppId,
  );

  let staked = 0n;
  let pending = 0n;
  let accSnapshot = 0n;
  let stakedSince = 0n;
  const optedIn = !!localEntry;
  if (localEntry) {
    const local = decodeState(localEntry.keyValue ?? localEntry['key-value']);
    staked = uintOf(local, 'staked');
    pending = uintOf(local, 'pending');
    accSnapshot = bigOf(local, 'acc_snapshot');
    stakedSince = uintOf(local, 'staked_since');
  }

  let claimable = pending;
  if (staked > 0n) {
    const delta = accRewardPerShare - accSnapshot;
    if (delta > 0n) claimable = pending + (staked * delta) / STAKING_REWARD_PRECISION;
  }

  const poolAssets: any[] = (poolAccountInfo as any).assets ?? [];
  const usdcHolding = poolAssets.find(
    (a: any) => Number(a.assetId ?? a['asset-id']) === usdcAssetId,
  );
  const poolUsdcBalance = BigInt(usdcHolding?.amount ?? 0);

  const poolShareBps =
    totalStaked > 0n ? Number((staked * 10_000n) / totalStaked) : 0;

  return {
    optedIn,
    staked: toNumberSafe(staked),
    pending: toNumberSafe(pending),
    claimable: toNumberSafe(claimable),
    stakedSince: toNumberSafe(stakedSince),
    totalStaked: toNumberSafe(totalStaked),
    poolUsdcBalance: toNumberSafe(poolUsdcBalance),
    poolShareBps,
  };
};
